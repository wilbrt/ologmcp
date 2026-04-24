/**
 * Path enumeration for mining.
 *
 * Generates all valid path sequences (arrow-kind compositions) up to a given
 * depth from the set of arrow kinds available in the olog.
 *
 * A "path" here is a sequence of arrow kinds like ["memberOf", "inModule"],
 * representing composition of morphisms in the olog category.
 */

import type { ArrowKind } from '../ontology.js';

/**
 * A path through the olog graph: a sequence of arrow kinds.
 * Each step follows an arrow of the given kind in the "out" direction.
 */
export interface ArrowPath {
  /** The sequence of arrow kinds (composed left-to-right). */
  arrows: ArrowKind[];
  /** The overall domain kind -> codomain kind, determined by the olog schema. */
  domainKind: string | null;
  codomainKind: string | null;
}

/** Maximum arrow kinds to enumerate per depth level. */
const MAX_ARROW_KINDS = 20;

/**
 * Enumerate all arrow kinds that exist in the store.
 * This uses the OlogStore.hasArrowKind() method to check which arrow kinds
 * have at least one arrow, avoiding enumeration of unused kinds.
 */
export function getArrowKindsInUse(
  allArrowKinds: ArrowKind[],
  hasArrowKind: (kind: string) => boolean,
): ArrowKind[] {
  return allArrowKinds.filter((k) => hasArrowKind(k));
}

/**
 * Enumerate all possible path sequences of depth 1..maxDepth over the given
 * arrow kinds.
 *
 * For depth 1, this is just each arrow kind individually.
 * For depth N, each path is formed by appending an arrow kind to a path of
 * depth N-1.
 *
 * Paths where the same arrow kind appears twice consecutively are pruned
 * (e.g., ["inModule", "inModule"] is unlikely to be meaningful).
 *
 * Returns paths grouped by depth.
 */
export function enumeratePaths(
  arrowKinds: ArrowKind[],
  maxDepth: number,
): ArrowPath[] {
  const paths: ArrowPath[] = [];

  // Depth 1: each arrow kind is its own path
  for (const kind of arrowKinds) {
    paths.push({
      arrows: [kind],
      domainKind: null,
      codomainKind: null,
    });
  }

  // Depth 2..maxDepth: extend each path by one arrow kind
  let currentDepthPaths = paths.slice(); // depth 1
  for (let depth = 2; depth <= maxDepth; depth++) {
    const nextDepthPaths: ArrowPath[] = [];
    for (const existingPath of currentDepthPaths) {
      for (const kind of arrowKinds) {
        // Prune: skip paths where the same arrow kind appears twice in a row.
        // E.g. ["inModule", "inModule"] is almost never meaningful.
        const lastArrow = existingPath.arrows[existingPath.arrows.length - 1];
        if (kind === lastArrow) continue;

        nextDepthPaths.push({
          arrows: [...existingPath.arrows, kind],
          domainKind: null,
          codomainKind: null,
        });
      }
    }
    paths.push(...nextDepthPaths);
    currentDepthPaths = nextDepthPaths;

    // Safety: stop if we've generated an excessive number of paths
    if (paths.length > 10000) break;
  }

  return paths;
}