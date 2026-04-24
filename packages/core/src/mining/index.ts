/**
 * Tier 1: Path Equation Mining
 *
 * Discovers path equations that hold (or nearly hold) in the olog graph.
 * Tests all possible commutativity conditions between arrow paths up to
 * the specified depth, returning equations ranked by coverage ratio.
 *
 * Formalism: An olog C is a category with objects (elements) and morphisms
 * (arrows). Path equations assert that two paths compose to the same
 * morphism. Mining discovers these equations empirically by following
 * paths from seed elements and comparing destinations.
 */

import { OlogStore } from '../db.js';
import type { ArrowKind, OlogElem } from '../ontology.js';
import { enumeratePaths, getArrowKindsInUse, type ArrowPath } from './paths.js';
import { annotatePathKinds, generateCandidatePairs, type CandidatePair } from './candidates.js';
import { evaluateEquationCandidate, type EquationCandidate, type Counterexample } from './evaluate.js';

export type { EquationCandidate, Counterexample };

export interface MiningOptions {
  /** Maximum path length to explore (default 3). */
  maxDepth: number;
  /** Minimum coverage ratio to report (0–1, default 1.0). */
  minCoverage: number;
  /** Maximum number of equations to return (default 50). */
  maxResults: number;
  /** Restrict to these arrow kinds (default: all in use). */
  arrowKinds?: ArrowKind[];
  /** Restrict seed elements to these kinds (default: all major kinds). */
  elementKinds?: string[];
  /** Maximum number of counterexamples per equation (default 5). */
  maxCounterexamples: number;
  /** Number of seed elements per kind to sample (default 100). */
  sampleSize: number;
}

export const DEFAULT_MINING_OPTIONS: MiningOptions = {
  maxDepth: 3,
  minCoverage: 1.0,
  maxResults: 50,
  maxCounterexamples: 5,
  sampleSize: 100,
};

const ALL_ARROW_KINDS: ArrowKind[] = [
  'extends',
  'implements',
  'calls',
  'imports',
  'exports',
  'references',
  'contains',
  'returns',
  'param',
  'typeof',
  'instanceof',
  'definedIn',
  'inModule',
  'memberOf',
  'callerOf',
  'calleeOf',
  'importsFrom',
  'locatedIn',
  'other',
];

const DEFAULT_ELEMENT_KINDS: string[] = [
  'function',
  'method',
  'class',
  'interface',
  'type',
  'import',
  'module',
];

/**
 * Mine path equations from the olog graph.
 *
 * Algorithm:
 * 1. Enumerate all possible paths of depth 1..maxDepth
 * 2. Annotate each path with its domain/codomain kinds
 * 3. Generate candidate equation pairs (paths that share domain kinds)
 * 4. Evaluate each candidate against seed elements
 * 5. Filter by coverage, deduplicate, and return
 */
export function mineEquations(
  store: OlogStore,
  options: Partial<MiningOptions> = {},
): EquationCandidate[] {
  const opts: MiningOptions = { ...DEFAULT_MINING_OPTIONS, ...options };

  // Determine which arrow kinds to use
  const arrowKinds = opts.arrowKinds ?? getArrowKindsInUse(ALL_ARROW_KINDS, (k) => store.hasArrowKind(k));

  // Determine which element kinds to seed from
  const elementKinds = opts.elementKinds ?? DEFAULT_ELEMENT_KINDS;

  // Step 1: Enumerate paths
  const paths = enumeratePaths(arrowKinds, opts.maxDepth);

  // Step 2: Annotate paths with domain/codomain kinds
  annotatePathKinds(paths, store, elementKinds, opts.sampleSize);

  // Step 3: Generate candidate pairs
  const candidates = generateCandidatePairs(paths);

  // Gather seed elements for evaluation
  const seedElements: { kind: string; elements: OlogElem[] }[] = [];
  for (const kind of elementKinds) {
    const elems = store.queryElements({ kind, limit: opts.sampleSize });
    if (elems.length > 0) {
      seedElements.push({ kind, elements: elems });
    }
  }

  // Step 4: Evaluate each candidate
  const results: EquationCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    // Canonicalize: shorter path first, then lexicographic
    const key = canonicalEquationKey(candidate.lhs, candidate.rhs);
    if (seen.has(key)) continue;
    seen.add(key);

    // Evaluate against all seed kinds
    const allSeeds: OlogElem[] = [];
    for (const group of seedElements) {
      allSeeds.push(...group.elements);
    }

    const result = evaluateEquationCandidate(
      store,
      candidate.lhs,
      candidate.rhs,
      allSeeds,
      opts.maxCounterexamples,
    );

    // Skip if total is 0 (no seed element had both paths defined)
    if (result.total === 0) continue;

    // Skip if coverage is below threshold
    if (result.coverage < opts.minCoverage) continue;

    results.push(result);

    // Early termination if we have enough results
    if (results.length >= opts.maxResults * 2) break; // extra for later dedup
  }

  // Step 5: Sort by coverage (descending), then by total (descending)
  results.sort((a, b) => {
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    return b.total - a.total;
  });

  // Deduplicate: remove equations that are subsumed by a shorter equation
  // An equation A∘B = C∘D is subsumed by X∘A∘B = X∘C∘D (or A∘B∘Y = C∘D∘Y)
  // for any X, Y. Keep only the shortest form.
  const deduped: EquationCandidate[] = [];
  for (const result of results) {
    if (deduped.length >= opts.maxResults) break;

    // Check if this equation is subsumed by an already-accepted one
    let subsumed = false;
    for (const existing of deduped) {
      if (isSubsumedBy(result, existing)) {
        subsumed = true;
        break;
      }
    }

    if (!subsumed) {
      deduped.push(result);
    }
  }

  return deduped;
}

/**
 * Check if equation `candidate` is subsumed by `existing`.
 *
 * An equation lhs = rhs is subsumed by another if the other is shorter
 * and has equal coverage. For example, if A∘B = C holds at 100%,
 * then A∘B∘D = C∘D also holds at 100% but is subsumed.
 */
function isSubsumedBy(
  candidate: EquationCandidate,
  existing: EquationCandidate,
): boolean {
  // Same coverage is required for subsumption
  if (candidate.coverage !== existing.coverage) return false;

  const cLhs = candidate.lhsPath.join('→');
  const cRhs = candidate.rhsPath.join('→');
  const eLhs = existing.lhsPath.join('→');
  const eRhs = existing.rhsPath.join('→');

  // Check if existing is a strict prefix of candidate's equation
  // e.g., if existing is "A∘B = C" and candidate is "A∘B∘D = C∘D"
  const pairs: [string, string][] = [
    [cLhs, cRhs],
    [eLhs, eRhs],
  ];

  // The existing equation subsumes the candidate if:
  // - The candidate's lhs starts with existing's lhs AND
  //   the candidate's rhs starts with existing's rhs AND
  //   the remaining suffix is the same on both sides
  // OR
  // - The candidate's lhs ends with existing's lhs AND
  //   the candidate's rhs ends with existing's rhs AND
  //   the remaining prefix is the same on both sides

  // Check prefix extension: X∘(existing.lhs) = X∘(existing.rhs)
  // means existing.lhs∘Y = existing.rhs∘Y also holds
  if (
    cLhs.startsWith(eLhs + '→') &&
    cRhs.startsWith(eRhs + '→') &&
    cLhs.slice(eLhs.length) === cRhs.slice(eRhs.length)
  ) {
    return true;
  }

  // Check suffix extension: (existing.lhs)∘Y = (existing.rhs)∘Y
  if (
    cLhs.endsWith('→' + eLhs) &&
    cRhs.endsWith('→' + eRhs) &&
    cLhs.slice(0, cLhs.length - eLhs.length) ===
      cRhs.slice(0, cRhs.length - eRhs.length)
  ) {
    return true;
  }

  return false;
}

function canonicalEquationKey(lhs: ArrowKind[], rhs: ArrowKind[]): string {
  const lhsKey = lhs.join('→');
  const rhsKey = rhs.join('→');
  // Always put the lexicographically smaller one first
  if (lhsKey <= rhsKey) {
    return `${lhsKey}≡${rhsKey}`;
  }
  return `${rhsKey}≡${lhsKey}`;
}

export type { ArrowPath };