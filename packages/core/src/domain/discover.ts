import { randomUUID } from 'node:crypto';
import type { OlogStore } from '../db.js';
import type { DomainCandidate, ArrowProposal, DiscoveryOptions } from './types.js';

const ABBREV_MAP: Record<string, string> = {
  Elem: 'Element',
  Arr: 'Arrow',
  Prov: 'Provenance',
  Val: 'Value',
  Cfg: 'Configuration',
  Msg: 'Message',
  Err: 'Error',
  Req: 'Request',
  Res: 'Response',
  Impl: 'Implementation',
  Attr: 'Attribute',
  Prop: 'Property',
  Spec: 'Specification',
  Ctor: 'Constructor',
  Lhs: 'Left-Hand Side',
  Rhs: 'Right-Hand Side',
  Src: 'Source',
  Dst: 'Destination',
  Id: 'ID',
};

function splitPascalCase(name: string): string[] {
  // Split at lowercase→uppercase boundary (e.g. OlogElem → Olog, Elem)
  // Also split at uppercase-sequence→uppercase+lowercase (e.g. XMLParser → XML, Parser)
  const spaced = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced.split(' ').filter(s => s.length > 0);
}

/**
 * Convert a PascalCase type name to an olog noun phrase (e.g. "OlogElem" → "an Olog Element").
 */
export function toNounPhrase(pascalName: string): string {
  const words = splitPascalCase(pascalName).map(w => ABBREV_MAP[w] ?? w);
  const noun = words.join(' ');
  const article = /^[aeiouAEIOU]/.test(noun) ? 'an' : 'a';
  return `${article} ${noun}`;
}

/**
 * Returns true if the module path represents an external (non-project) module.
 */
export function isExternalModule(module: string | null, excludeModules?: string[]): boolean {
  if (module === null) return true;
  if (module.startsWith('node:')) return true;
  if (excludeModules) {
    for (const pattern of excludeModules) {
      if (new RegExp(pattern).test(module)) return true;
    }
  }
  return false;
}

/**
 * Build a lookup from code element ID to already-committed domain element.
 * Domain elements point to their code element via an `implementedAs` arrow.
 */
export function getExistingDomainElementsByCodeId(
  store: OlogStore,
): Map<string, { id: string; name: string }> {
  const result = new Map<string, { id: string; name: string }>();
  const existingDomainElems = store.queryElements({ kind: 'domain', limit: 10000 });
  for (const domElem of existingDomainElems) {
    const domOutgoing = store.outgoing(domElem.id);
    for (const arr of domOutgoing) {
      if (arr.kind === 'implementedAs') {
        result.set(arr.dstId, { id: domElem.id, name: domElem.name });
      }
    }
  }
  return result;
}

/**
 * Discover domain candidates from the olog.
 *
 * Reads interface/type/class elements from the store, follows hasProperty and
 * hasType arrows to build proposed domain objects and arrows, and returns the
 * full list of candidates for user review.
 */
export function discoverDomainCandidates(
  store: OlogStore,
  options: DiscoveryOptions = {},
): DomainCandidate[] {
  // Step 1: collect all structured type elements
  const elements = [
    ...store.queryElements({ kind: 'interface', limit: 10000 }),
    ...store.queryElements({ kind: 'type', limit: 10000 }),
    ...store.queryElements({ kind: 'class', limit: 10000 }),
  ];

  // Step 2: filter by scope and exclude externals
  const filtered = elements.filter(elem => {
    if (isExternalModule(elem.module, options.excludeModules)) return false;
    if (options.scopeRegex) {
      try {
        if (!new RegExp(options.scopeRegex).test(elem.module ?? '')) return false;
      } catch {
        // invalid regex — skip filter
      }
    }
    return true;
  });

  // Step 3: create candidates (first pass — no arrow proposals yet)
  const candidates: DomainCandidate[] = filtered.map(elem => {
    const candidateId = randomUUID();
    const bridgeArrow: ArrowProposal = {
      id: randomUUID(),
      name: 'implemented as',
      domainCandidateId: candidateId,
      codomainName: elem.name,
      codomainCandidateId: null,
      codomainExistingElemId: null,
      total: true,
      source: 'field',
      confidence: 'resolved',
      status: 'proposed',
    };
    return {
      id: candidateId,
      codeElementId: elem.id,
      proposedName: toNounPhrase(elem.name),
      proposedArrows: [],
      bridgeArrow,
      questions: [],
      status: 'proposed',
    };
  });

  // Build lookup: code element id → candidate
  const codeIdToCandidate = new Map<string, DomainCandidate>();
  for (const c of candidates) {
    codeIdToCandidate.set(c.codeElementId, c);
  }

  // Build lookup: code element id → already-committed domain element
  // (domain elements from a previous session that survive re-indexing)
  const existingDomainByCodeId = getExistingDomainElementsByCodeId(store);

  // Step 4: add arrow proposals by following hasProperty → hasType chains
  for (const candidate of candidates) {
    const elem = store.getElem(candidate.codeElementId);
    if (!elem) continue;

    const outgoing = store.outgoing(candidate.codeElementId);
    const propertyArrows = outgoing.filter(a => a.kind === 'hasProperty');

    if (propertyArrows.length === 0 && elem.kind === 'type') {
      candidate.questions.push(
        `"${elem.name}" appears to be a type alias. If it is a union of string literals, should it become a domain concept, or should each value be a separate domain object?`,
      );
    }

    for (const propArrow of propertyArrows) {
      const propElem = store.getElem(propArrow.dstId);
      if (!propElem) continue;

      const propAttrs = propElem.attrs as Record<string, unknown>;
      const typeText = (propAttrs.typeText as string) ?? '';
      const optional = propAttrs.optional === true;
      const isArray = typeText.includes('[]') || typeText.includes('Array<');
      const isRecord = typeText.includes('Record<') || (typeText.startsWith('{') && !typeText.includes('null'));

      // The property name is the part after the dot in "ParentName.propName"
      const propName = propElem.name.includes('.')
        ? propElem.name.split('.').slice(1).join('.')
        : propElem.name;

      const propOutgoing = store.outgoing(propArrow.dstId);
      const typeArrows = propOutgoing.filter(a => a.kind === 'hasType');

      for (const typeArrow of typeArrows) {
        const typeElem = store.getElem(typeArrow.dstId);
        if (!typeElem) continue;

        const targetCandidate = codeIdToCandidate.get(typeArrow.dstId);
        const existingDomain = targetCandidate ? null : existingDomainByCodeId.get(typeArrow.dstId) ?? null;
        const total = !optional && !isArray;

        const proposal: ArrowProposal = {
          id: randomUUID(),
          name: `has ${propName}`,
          domainCandidateId: candidate.id,
          codomainName: targetCandidate?.proposedName ?? existingDomain?.name ?? typeElem.name,
          codomainCandidateId: targetCandidate?.id ?? null,
          codomainExistingElemId: existingDomain?.id ?? null,
          total,
          source: 'field',
          confidence: targetCandidate || existingDomain ? 'resolved' : 'unresolved',
          status: 'proposed',
        };

        if (optional) {
          proposal.question = `The field "${propName}" is optional (nullable). Is this arrow total (every ${candidate.proposedName} must have one) or partial?`;
        } else if (isArray) {
          proposal.question = `The field "${propName}" is an array. The arrow "has ${propName}" would be many-valued. Should ${typeElem.name} be reified with a back-reference?`;
        }

        candidate.proposedArrows.push(proposal);
      }

      if (typeArrows.length === 0 && isRecord) {
        candidate.questions.push(
          `The field "${propName}" has a generic container type ("${typeText}"). Should individual attributes be modeled as separate domain arrows?`,
        );
      }
    }

    // Step 5: add arrow proposals from extends/implements code-level arrows
    const structuralArrows = outgoing.filter(a => a.kind === 'extends' || a.kind === 'implements');
    for (const structArrow of structuralArrows) {
      const targetCandidate = codeIdToCandidate.get(structArrow.dstId);
      const existingDomain = targetCandidate ? null : existingDomainByCodeId.get(structArrow.dstId) ?? null;

      // Only propose when we can resolve the codomain to a domain concept
      if (!targetCandidate && !existingDomain) continue;

      const targetElem = store.getElem(structArrow.dstId);
      if (!targetElem) continue;

      const arrowName = structArrow.kind === 'extends' ? 'extends' : 'implements';
      const proposal: ArrowProposal = {
        id: randomUUID(),
        name: arrowName,
        domainCandidateId: candidate.id,
        codomainName: targetCandidate?.proposedName ?? existingDomain?.name ?? targetElem.name,
        codomainCandidateId: targetCandidate?.id ?? null,
        codomainExistingElemId: existingDomain?.id ?? null,
        total: true,
        source: structArrow.kind as 'extends' | 'implements',
        confidence: 'resolved',
        status: 'proposed',
      };
      candidate.proposedArrows.push(proposal);
    }
  }

  return candidates;
}
