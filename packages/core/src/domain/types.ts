import type { ConfidenceLevel } from '../ontology.js';

export interface DomainCandidate {
  id: string;
  codeElementId: string;
  proposedName: string;
  proposedArrows: ArrowProposal[];
  bridgeArrow: ArrowProposal;
  questions: string[];
  status: 'proposed' | 'accepted' | 'rejected' | 'deferred';
}

export interface ArrowProposal {
  id: string;
  name: string;
  domainCandidateId: string;
  codomainName: string;
  codomainCandidateId: string | null;
  /** ID of an already-committed domain element (fallback when codomainCandidateId is null). */
  codomainExistingElemId: string | null;
  total: boolean;
  source: 'field' | 'method' | 'type_ref' | 'extends' | 'implements';
  confidence: ConfidenceLevel;
  question?: string;
  status: 'proposed' | 'accepted' | 'rejected' | 'modified';
}

export interface DomainSessionData {
  id: string;
  status: 'active' | 'committed' | 'abandoned';
  scopeRegex: string | null;
  candidates: DomainCandidate[];
  equations: ProposedEquation[];
  commitSha: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProposedEquation {
  id: string;
  name: string;
  humanMessage: string;
  lhs: { src: string; tgt: string; arrows: string[] };
  rhs: { src: string; tgt: string; arrows: string[] };
}

export interface DiscoveryOptions {
  scopeRegex?: string;
  excludeModules?: string[];
}
