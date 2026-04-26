import type { EgoGraph } from './types.js';
import type { InMemoryGraph } from './graph.js';

export function extractEgoGraph(
  graph: InMemoryGraph,
  seedId: string,
  depth: number,
  arrowKinds?: string[]
): EgoGraph {
  const seedElement = graph.elems.get(seedId);
  if (!seedElement) {
    throw new Error(`Seed element not found: ${seedId}`);
  }

  const elements = new Map<string, { id: string; kind: string; name: string }>();
  elements.set(seedId, { id: seedId, kind: seedElement.kind, name: seedElement.name });

  const arrows: Array<{ srcId: string; kind: string; dstId: string }> = [];
  const visited = new Set<string>([seedId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: seedId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.depth >= depth) {
      continue;
    }

    const outgoing = graph.outgoing.get(current.id) ?? [];
    for (const arrow of outgoing) {
      if (arrowKinds && !arrowKinds.includes(arrow.kind)) {
        continue;
      }

      arrows.push({ srcId: current.id, kind: arrow.kind, dstId: arrow.dstId });

      if (!visited.has(arrow.dstId)) {
        visited.add(arrow.dstId);

        const destElem = graph.elems.get(arrow.dstId);
        if (destElem) {
          elements.set(arrow.dstId, {
            id: arrow.dstId,
            kind: destElem.kind,
            name: destElem.name,
          });
          queue.push({ id: arrow.dstId, depth: current.depth + 1 });
        }
      }
    }
  }

  return {
    seedId,
    seedKind: seedElement.kind,
    elements,
    arrows,
  };
}
