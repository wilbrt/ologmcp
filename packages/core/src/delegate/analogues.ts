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
    const similarity = unionSize === 0 ? 0 : intersectionSize / unionSize;

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

  const incoming = store.incoming(elem.id);
  const callerOfArrows = incoming.filter(a => a.kind === 'callerOf');

  for (const arrow of callerOfArrows) {
    const callSiteOutgoing = store.outgoing(arrow.srcId);
    const calleeOfArrow = callSiteOutgoing.find(a => a.kind === 'calleeOf');
    if (calleeOfArrow) {
      result.add(calleeOfArrow.dstId);
    }
  }

  const directCalls = store.outgoing(elem.id).filter(a => a.kind === 'calls');
  for (const arrow of directCalls) {
    result.add(arrow.dstId);
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