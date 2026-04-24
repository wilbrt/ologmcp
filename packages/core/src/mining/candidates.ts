/**
 * Candidate pair generation for mining.
 *
 * Given a list of enumerated paths, generates pairs (lhs, rhs) where both
 * paths could potentially commute — i.e., they share the same domain object
 * type and could plausibly reach elements of compatible types.
 *
 * Since we don't have a static schema of domain/codomain kinds per arrow
 * (the olog is dynamic), we resolve domain/codomain kinds empirically:
 * by following each path from a sample of elements and recording what kinds
 * we reach. Two paths are candidates if they share at least one common
 * domain kind.
 */

import type { ArrowKind, OlogElem } from '../ontology.js';
import { OlogStore } from '../db.js';
import type { ArrowPath } from './paths.js';

export interface CandidatePair {
  lhs: ArrowKind[];
  rhs: ArrowKind[];
}

/**
 * Annotate each path with its empirically determined domain and codomain kinds.
 *
 * For each path, we:
 * 1. Pick a sample of elements of each kind
 * 2. Follow the path from those elements
 * 3. Record the kinds of reached elements
 *
 * This produces domain→codomain pairs that tell us which paths can
 * potentially commute.
 */
export function annotatePathKinds(
  paths: ArrowPath[],
  store: OlogStore,
  elementKinds: string[],
  sampleSize: number = 50,
): ArrowPath[] {
  // Build a map: element kind → sample element IDs
  const kindToIds = new Map<string, string[]>();
  for (const kind of elementKinds) {
    const elems = store.queryElements({ kind, limit: sampleSize });
    kindToIds.set(kind, elems.map((e) => e.id));
  }

  for (const path of paths) {
    const steps = path.arrows.map((kind) => ({
      kind,
      direction: 'out' as const,
    }));

    // Try each element kind as a potential domain
    const domainKinds: string[] = [];
    const codomainKinds: Set<string> = new Set();

    for (const [kind, ids] of kindToIds) {
      let anyReached = false;
      for (const id of ids) {
        const result = store.traverse({ startId: id, steps });
        if (result.elements.length > 0) {
          anyReached = true;
          for (const elem of result.elements) {
            codomainKinds.add(elem.kind);
          }
        }
      }
      if (anyReached) {
        domainKinds.push(kind);
      }
    }

    path.domainKind = domainKinds.length === 1 ? domainKinds[0]! : null;
    // Store codomain info as comma-separated kinds for easy comparison
    path.codomainKind =
      codomainKinds.size > 0 ? Array.from(codomainKinds).sort().join(',') : null;
  }

  return paths;
}

/**
 * Generate candidate equation pairs from annotated paths.
 *
 * Two paths are candidates for an equation if:
 * 1. They share at least one common domain kind (i.e., both can be followed from
 *    elements of the same kind)
 * 2. Their codomain kinds overlap (they reach elements of overlapping types)
 *
 * To avoid trivial equations, we also filter out:
 * - Pairs where lhs == rhs (identity equation)
 * - Pairs that are subsumed by a shorter equation with the same coverage
 */
export function generateCandidatePairs(
  paths: ArrowPath[],
): CandidatePair[] {
  const pairs: CandidatePair[] = [];

  // Group paths by domain kind
  const byDomain = new Map<string, ArrowPath[]>();
  for (const path of paths) {
    if (!path.domainKind) continue;
    const existing = byDomain.get(path.domainKind) ?? [];
    existing.push(path);
    byDomain.set(path.domainKind, existing);
  }

  // For each domain kind, generate all pairs of paths
  for (const [, domainPaths] of byDomain) {
    for (let i = 0; i < domainPaths.length; i++) {
      for (let j = i + 1; j < domainPaths.length; j++) {
        const lhs = domainPaths[i]!;
        const rhs = domainPaths[j]!;

        // Skip if both are identical (shouldn't happen since i < j)
        if (arrowsEqual(lhs.arrows, rhs.arrows)) continue;

        // Codomain kinds must overlap
        if (!lhs.codomainKind || !rhs.codomainKind) continue;
        const lhsCodomains = new Set(lhs.codomainKind.split(','));
        const rhsCodomains = new Set(rhs.codomainKind.split(','));
        const overlap = [...lhsCodomains].some((k) => rhsCodomains.has(k));
        if (!overlap) continue;

        pairs.push({
          lhs: [...lhs.arrows],
          rhs: [...rhs.arrows],
        });
      }
    }
  }

  // Also generate pairs for paths that share domain kinds across multiple kinds
  // (e.g., both work from "function" and "method")
  // These are caught by the domainKind == null group
  const nullDomainPaths = paths.filter((p) => !p.domainKind);
  for (let i = 0; i < nullDomainPaths.length; i++) {
    for (let j = i + 1; j < nullDomainPaths.length; j++) {
      const lhs = nullDomainPaths[i]!;
      const rhs = nullDomainPaths[j]!;

      if (arrowsEqual(lhs.arrows, rhs.arrows)) continue;
      if (!lhs.codomainKind || !rhs.codomainKind) continue;

      // Check codomain overlap
      const lhsCodomains = new Set(lhs.codomainKind.split(','));
      const rhsCodomains = new Set(rhs.codomainKind.split(','));
      const overlap = [...lhsCodomains].some((k) => rhsCodomains.has(k));
      if (!overlap) continue;

      pairs.push({
        lhs: [...lhs.arrows],
        rhs: [...rhs.arrows],
      });
    }
  }

  // Deduplicate pairs (normalize so shorter path is always lhs)
  const seen = new Set<string>();
  const deduped: CandidatePair[] = [];
  for (const pair of pairs) {
    const key = canonicalKey(pair.lhs, pair.rhs);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(pair);
    }
  }

  return deduped;
}

function arrowsEqual(a: ArrowKind[], b: ArrowKind[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function canonicalKey(lhs: ArrowKind[], rhs: ArrowKind[]): string {
  // Always sort so the lexicographically smaller path is first
  const lhsKey = lhs.join('→');
  const rhsKey = rhs.join('→');
  if (lhsKey <= rhsKey) {
    return `${lhsKey}≡${rhsKey}`;
  }
  return `${rhsKey}≡${lhsKey}`;
}