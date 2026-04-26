import { randomUUID } from 'node:crypto';

import type { EgoGraph, MotifCandidate, MotifDiscoveryOptions, MotifInstance } from './types.js';
import { extractEgoGraph } from './ego.js';
import './shape.js';
import { groupEgoGraphs, verifyInternalEquations } from './group.js';
import { buildInMemoryGraph } from './graph.js';
import type { OlogStore } from '../db.js';

export function discoverMotifs(
  store: OlogStore,
  options: MotifDiscoveryOptions = {},
): MotifCandidate[] {
  // Step 1: Load InMemoryGraph
  const graph = buildInMemoryGraph(store);

  // Step 2: Set defaults
  const seedKinds = options.seedKinds ?? ['function', 'class', 'interface'];
  const depth = options.depth ?? 2;
  const minSupport = options.minSupport ?? 3;
  const mineEquationsFlag = options.mineEquations ?? true;

  // Step 3: Select seed elements from graph.elems
  const seedIds: string[] = [];
  for (const [id, elem] of graph.elems) {
    if (!seedKinds.includes(elem.kind)) continue;

    // Check scopeRegex
    const module = store.getElem(id)?.module ?? null;
    if (options.scopeRegex) {
      const regex = new RegExp(options.scopeRegex);
      if (!module || !regex.test(module)) continue;
    }

    // Check excludeModules
    if (options.excludeModules && options.excludeModules.length > 0) {
      if (module && options.excludeModules.some(pattern => new RegExp(pattern).test(module!))) {
        continue;
      }
    }

    seedIds.push(id);
  }

  // Step 4: For each seed, extract ego graph
  const egos: EgoGraph[] = [];
  for (const seedId of seedIds) {
    const ego = extractEgoGraph(graph, seedId, depth, options.arrowKinds);
    egos.push(ego);
  }

  // Step 5: Group ego graphs
  const groups = groupEgoGraphs(egos, minSupport);

  // Step 6: Build candidates from groups
  const candidates: MotifCandidate[] = [];

  for (const group of groups) {
    // Build proposedName from shape
    const objectKinds = group.shape.objects.map(o => o.kind).join('_');
    const arrowLabels = group.shape.arrows.map(a => a.label).join('_');
    const proposedName = `Motif_${objectKinds}_${arrowLabels}`;

    // Build description
    const roleList = group.shape.objects.map(o => o.role).join(', ');
    const description = `Recurring pattern with ${group.support} instances: ${roleList}`;

    // Map EgoGraph instances to MotifInstance
    const instances: MotifInstance[] = group.instances.map(ego => {
      // Get module from store
      const seedElem = store.getElem(ego.seedId);
      const module = seedElem?.module ?? null;

      // Build mappings: shape role -> element ID from ego graph
      // We need to match shape roles to ego elements using the same sorting
      // logic as abstractToShape
      const sortedElements = Array.from(ego.elements.values()).sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        return a.id.localeCompare(b.id);
      });

      const mappings: Record<string, string> = {};
      for (let i = 0; i < group.shape.objects.length; i++) {
        const shapeObj = group.shape.objects[i]!;
        const elem = sortedElements[i]!;
        mappings[shapeObj.role] = elem.id;
      }

      return {
        id: ego.seedId,
        mappings,
        module,
      };
    });

    // Equations (if enabled)
    const equations = mineEquationsFlag
      ? verifyInternalEquations(store, group, options.equationOptions)
      : [];

    // Questions
    const questions = [
      `This motif has ${group.support} instances with ${group.shape.arrows.length} arrow kinds. Consider naming them.`,
    ];

    candidates.push({
      id: randomUUID(),
      shape: group.shape,
      proposedName,
      description,
      support: group.support,
      instances,
      equations,
      questions,
      status: 'proposed',
    });
  }

  // Step 7: Sort by support descending
  candidates.sort((a, b) => b.support - a.support);

  return candidates;
}