/**
 * In-memory graph for fast mining.
 *
 * Loads the full adjacency structure and element metadata into memory once,
 * then provides O(1) outgoing-arrow lookups and pre-computes all (path, seed)
 * traversal results so the mining inner loop makes zero database queries.
 */

import type { OlogStore } from '../db.js';
import type { OlogElem } from '../ontology.js';
import type { ArrowPath } from './paths.js';

/** Adjacency map + element metadata, loaded in two bulk SQL queries. */
export interface InMemoryGraph {
  /** srcId → [{kind, dstId}] */
  outgoing: Map<string, Array<{ kind: string; dstId: string }>>;
  /** elemId → {kind, name} for annotation and counterexample rendering. */
  elems: Map<string, { kind: string; name: string }>;
}

/**
 * Mapping from path key (arrows joined with '→') to a map of
 * seedId → Set of reached element IDs.  Only non-empty results are stored.
 */
export type PathResultCache = Map<string, Map<string, Set<string>>>;

/** Build an in-memory graph from the store in two bulk queries. */
export function buildInMemoryGraph(store: OlogStore): InMemoryGraph {
  const rawArrows = store.loadAllArrows();
  const outgoing = new Map<string, Array<{ kind: string; dstId: string }>>();
  for (const { src_id, kind, dst_id } of rawArrows) {
    let list = outgoing.get(src_id);
    if (!list) {
      list = [];
      outgoing.set(src_id, list);
    }
    list.push({ kind, dstId: dst_id });
  }
  return { outgoing, elems: store.loadElemMeta() };
}

/** Follow a sequence of arrow kinds from startId, returning reached element IDs. */
export function followPath(
  graph: InMemoryGraph,
  startId: string,
  arrowKinds: readonly string[],
): Set<string> {
  let current = new Set<string>([startId]);
  for (const kind of arrowKinds) {
    const next = new Set<string>();
    for (const id of current) {
      for (const arr of graph.outgoing.get(id) ?? []) {
        if (arr.kind === kind) next.add(arr.dstId);
      }
    }
    current = next;
    if (current.size === 0) return current;
  }
  return current;
}

/** Stable string key for a path (arrow sequence). */
export function pathKey(arrows: readonly string[]): string {
  return arrows.join('→');
}

/**
 * Pre-compute traversal results for every (path, seed) combination in one pass.
 *
 * The result cache maps pathKey → (seedId → Set<reachedId>).
 * Pairs where no elements are reached are omitted to save memory.
 */
export function precomputePathResults(
  graph: InMemoryGraph,
  paths: ArrowPath[],
  seeds: OlogElem[],
): PathResultCache {
  const cache: PathResultCache = new Map();
  const seenKeys = new Set<string>();

  for (const path of paths) {
    const key = pathKey(path.arrows);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const seedResults = new Map<string, Set<string>>();
    for (const seed of seeds) {
      const reached = followPath(graph, seed.id, path.arrows);
      if (reached.size > 0) {
        seedResults.set(seed.id, reached);
      }
    }
    cache.set(key, seedResults);
  }

  return cache;
}
