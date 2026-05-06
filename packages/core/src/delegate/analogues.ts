import type { OlogStore } from '../db.js';
import type { OlogElem } from '../ontology.js';

export interface AnalogueCandidate {
  id: string;
  name: string;
  kind: string;
  module: string | null;
  span: string | null;
  similarity: number;
}

export function findAnalogues(
  store: OlogStore,
  target: OlogElem,
  limit: number = 3,
  workingSetIds?: Set<string>,
): AnalogueCandidate[] {
  const targetCallees = getCalleeSet(store, target);

  const candidates = store.queryElements({
    kind: target.kind,
    limit: 200,
  });

  const scored: AnalogueCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.id === target.id) continue;
    if (candidate.module === target.module) continue;

    const candidateCallees = getCalleeSet(store, candidate);

    const intersectionSize = countIntersection(targetCallees, candidateCallees);
    const unionSize = targetCallees.size + candidateCallees.size - intersectionSize;
    const calleeSimilarity = unionSize === 0 ? 0 : intersectionSize / unionSize;

    // Same-name function in another module is always a useful analogue (predecessor or variant)
    const nameSimilarity = candidate.name === target.name ? 0.5 : 0;

    // Calibrated to lift a WS element with weak similarity (~0.2) above an unrelated element with strong callee overlap (~0.5)
    const WS_RELEVANCE_BONUS = 0.3;
    const wsBonus = workingSetIds?.has(candidate.id) ? WS_RELEVANCE_BONUS : 0;

    const similarity = Math.min(1, Math.max(calleeSimilarity, nameSimilarity) + wsBonus);

    if (similarity > 0) {
      scored.push({
        id: candidate.id,
        name: candidate.name,
        kind: candidate.kind,
        module: candidate.module,
        span: candidate.span,
        similarity,
      });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

function getCalleeSet(store: OlogStore, elem: OlogElem): Set<string> {
  const result = new Set<string>();

  const outgoing = store.outgoing(elem.id);
  for (const arrow of outgoing) {
    if (arrow.kind === 'callerOf' || arrow.kind === 'calls') {
      result.add(arrow.dstId);
    }
  }

  return result;
}

function countIntersection(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count++;
  }
  return count;
}