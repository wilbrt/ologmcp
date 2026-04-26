import type { EgoGraph, MotifShape, ShapeGroup } from './types.js';
import { abstractToShape } from './shape.js';
import type { OlogStore } from '../db.js';
import { mineEquations } from './index.js';
import type { MiningOptions } from './index.js';

export function groupEgoGraphs(egos: EgoGraph[], minSupport: number): ShapeGroup[] {
  // 1. Create a Map<string, EgoGraph[]> keyed by shape hash
  const groups = new Map<string, EgoGraph[]>();

  // 2. For each ego-graph, compute abstractToShape(ego) to get a MotifShape,
  //    use shape.hash as the grouping key
  for (const ego of egos) {
    const shape = abstractToShape(ego);
    const hash = shape.hash;

    if (!groups.has(hash)) {
      groups.set(hash, []);
    }
    groups.get(hash)!.push(ego);
  }

  // 3. For each group with instances.length >= minSupport, create a ShapeGroup
  const result: ShapeGroup[] = [];
  for (const [, instances] of groups) {
    if (instances.length >= minSupport) {
      const shape = abstractToShape(instances[0]!);
      result.push({
        shape,
        instances,
        support: instances.length,
      });
    }
  }

  // 5. Sort groups by support descending
  result.sort((a, b) => b.support - a.support);

  // 6. Return the array of ShapeGroups
  return result;
}

export function verifyInternalEquations(
  store: OlogStore,
  group: ShapeGroup,
  options?: Partial<MiningOptions>,
): Array<{ lhsPath: string[]; rhsPath: string[]; coverage: number }> {
  // 1. Collect all element IDs from all instances in the group
  const elementIds = new Set<string>();
  for (const instance of group.instances) {
    for (const id of instance.elements.keys()) {
      elementIds.add(id);
    }
  }

  // 2. Convert elementIds to element kinds by looking them up in the ego-graph elements
  const firstInstance = group.instances[0];
  if (!firstInstance) return [];

  const elementKinds = [
    ...new Set(
      [...elementIds]
        .map((id) => firstInstance.elements.get(id)?.kind)
        .filter((kind): kind is string => Boolean(kind)),
    ),
  ];

  // 3. Call mineEquations scoped to the group's element kinds
  const equations = mineEquations(store, {
    elementKinds,
    sampleSize: elementIds.size,
    minCoverage: 0.8,
    ...options,
  });

  // 4. Map the returned equations to { lhsPath, rhsPath, coverage } objects
  return equations.map((eq) => ({
    lhsPath: eq.lhsPath,
    rhsPath: eq.rhsPath,
    coverage: eq.coverage,
  }));
}
