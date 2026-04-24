/**
 * Equation candidate evaluation for mining.
 *
 * Given a candidate equation (lhs path, rhs path) and a set of seed elements,
 * follows both paths from each seed and checks whether they reach the same
 * set of elements. Computes coverage (support/total) and collects counterexamples.
 */

import { OlogStore } from '../db.js';
import type { ArrowKind, OlogElem } from '../ontology.js';

export interface Counterexample {
  elementId: string;
  elementName: string;
  elementKind: string;
  lhsResult: string[];
  rhsResult: string[];
}

export interface EquationCandidate {
  /** Left-hand side path (sequence of arrow kinds). */
  lhsPath: ArrowKind[];
  /** Right-hand side path (sequence of arrow kinds). */
  rhsPath: ArrowKind[];
  /** The element kind this equation was tested against. */
  domainKind: string;
  /** Number of seed elements where both paths are defined and agree. */
  support: number;
  /** Number of seed elements where both paths are defined (denominator for coverage). */
  total: number;
  /** Coverage ratio: support / total. 1.0 means equation holds universally. */
  coverage: number;
  /** Concrete counterexamples (up to maxCounterexamples). */
  counterexamples: Counterexample[];
}

/**
 * Evaluate a single candidate equation against a set of seed elements.
 *
 * For each seed element, follows both the lhs and rhs paths. If both reach
 * at least one element, we check if they reach the same set. If they don't,
 * that's a counterexample.
 *
 * @param store - The olog store
 * @param lhsPath - Left-hand side arrow path
 * @param rhsPath - Right-hand side arrow path
 * @param seedElements - Elements to test from
 * @param maxCounterexamples - Maximum number of counterexamples to collect
 * @returns Evaluation result with support, total, coverage, and counterexamples
 */
export function evaluateEquationCandidate(
  store: OlogStore,
  lhsPath: ArrowKind[],
  rhsPath: ArrowKind[],
  seedElements: OlogElem[],
  maxCounterexamples: number = 5,
): EquationCandidate {
  let support = 0;
  let total = 0;
  const counterexamples: Counterexample[] = [];

  const lhsSteps = lhsPath.map((kind) => ({
    kind,
    direction: 'out' as const,
  }));
  const rhsSteps = rhsPath.map((kind) => ({
    kind,
    direction: 'out' as const,
  }));

  // Determine the most common domain kind from the seed elements
  const kindCounts = new Map<string, number>();
  for (const elem of seedElements) {
    kindCounts.set(elem.kind, (kindCounts.get(elem.kind) ?? 0) + 1);
  }
  let domainKind = 'any';
  let maxCount = 0;
  for (const [kind, count] of kindCounts) {
    if (count > maxCount) {
      maxCount = count;
      domainKind = kind;
    }
  }

  for (const elem of seedElements) {
    // Follow LHS path
    const lhsResult = store.traverse({ startId: elem.id, steps: lhsSteps });
    // Follow RHS path
    const rhsResult = store.traverse({ startId: elem.id, steps: rhsSteps });

    // If either path reaches nothing, skip this element (not a valid test)
    if (lhsResult.elements.length === 0 && rhsResult.elements.length === 0) {
      continue; // Neither path valid — skip
    }

    // If only one path is defined, the equation is testable but doesn't hold
    if (lhsResult.elements.length === 0 || rhsResult.elements.length === 0) {
      total++;
      // One side is defined, the other isn't — counterexample
      if (counterexamples.length < maxCounterexamples) {
        counterexamples.push({
          elementId: elem.id,
          elementName: elem.name,
          elementKind: elem.kind,
          lhsResult: lhsResult.elements.map((e) => e.name),
          rhsResult: rhsResult.elements.map((e) => e.name),
        });
      }
      continue;
    }

    // Both paths are defined — check if they reach the same elements
    total++;
    const lhsIds = new Set(lhsResult.elements.map((e) => e.id));
    const rhsIds = new Set(rhsResult.elements.map((e) => e.id));

    // Check if the sets are identical
    const lhsOnly = [...lhsIds].filter((id) => !rhsIds.has(id));
    const rhsOnly = [...rhsIds].filter((id) => !lhsIds.has(id));

    if (lhsOnly.length === 0 && rhsOnly.length === 0) {
      support++;
    } else {
      if (counterexamples.length < maxCounterexamples) {
        counterexamples.push({
          elementId: elem.id,
          elementName: elem.name,
          elementKind: elem.kind,
          lhsResult: lhsResult.elements
            .filter((e) => !rhsIds.has(e.id))
            .map((e) => e.name),
          rhsResult: rhsResult.elements
            .filter((e) => !lhsIds.has(e.id))
            .map((e) => e.name),
        });
      }
    }
  }

  const coverage = total > 0 ? support / total : 0;

  return {
    lhsPath,
    rhsPath,
    domainKind,
    support,
    total,
    coverage,
    counterexamples,
  };
}