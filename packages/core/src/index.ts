export { OlogStore } from './db.js';
export type {
  OlogElem,
  OlogArr,
  OlogAttr,
  IngestResult,
  QueryResult,
  InspectResult,
  DumpResult,
  RawElement,
  RawArrow,
  ArrowKind,
  OlogKind,
  ConfidenceLevel,
  Path,
  PathEquation,
  ConstraintKind,
  IntegrityConstraint,
  Provenance,
  SchemaProposal,
  PlanOperation,
  Plan,
  ValidationResult,
  ChangeInstruction,
  ApplyResult,
} from './ontology.js';
export { traverse, type TraverseOptions } from './traverse.js';
export {
  evaluateConstraints,
  evaluatePathEquations,
  evaluateEquation,
  type Violation,
} from './constraints.js';
export {
  isNounPhrase,
  validateEquation,
} from './equations.js';
export { arrowId } from './ingest/ids.js';
export {
  ingestProject,
  reindexProject,
  ingestChangedFiles,
} from './ingest/project.js';
export {
  type LanguageAdapter,
  type LanguageAdapterConfig,
  type PropertyExtract,
  type TreeSitterParser,
  type TreeSitterNode,
  type TreeSitterQuery,
  type TreeSitterQueryMatch,
  type TreeSitterQueryCapture,
  AdapterRegistry,
  setDefaultRegistry,
  getDefaultRegistry,
} from './ingest/adapter.js';
export {
  renderPlan,
  renderAndApplyPlan,
  type RenderResult,
  type RenderAndApplyResult,
  type SourceEdit,
  type FileSnapshot,
  applyEditsToString,
  applySourceEdits,
  rollback,
  offsetAt,
} from './render/index.js';
export {
  assembleBrief,
  type DelegationBrief,
  type DelegationTask,
  type ContextOverrides,
} from './delegate/index.js';
export { SourceResolver, filePathFromSpan } from './delegate/resolve.js';
export type { AnalogueCandidate } from './delegate/analogues.js';
export type {
  MustCallEntry,
  MustImplementEntry,
  UsedByEntry,
  ImportEntry,
  StructuralContext,
  DomainContext,
} from './delegate/context.js';
export {
  mineEquations,
  type MiningOptions,
  type ArrowPath,
} from './mining/index.js';
export { discoverDomainCandidates, extendDomainByKan, minePullbacks, toNounPhrase, toNounPhraseFromName, isExternalModule, getExistingDomainElementsByCodeId } from './domain/discover.js';
export type {
  DomainCandidate,
  ArrowProposal,
  DomainSessionData,
  ProposedEquation,
  DiscoveryOptions,
} from './domain/types.js';
export { DomainSessionStore } from './domain/session.js';
export { SessionStore } from './session-store.js';

export { enumeratePaths, getArrowKindsInUse } from './mining/paths.js';
export {
  annotatePathKinds,
  generateCandidatePairs,
  type CandidatePair,
} from './mining/candidates.js';
export {
  evaluateEquationCandidate,
  type EquationCandidate,
  type Counterexample,
} from './mining/evaluate.js';
export { discoverMotifs } from './mining/motifs.js';
export type {
  MotifCandidate,
  MotifShape,
  MotifDiscoveryOptions,
  MotifSessionData,
  MotifInstance,
  EgoGraph,
  ShapeGroup,
} from './mining/types.js';
export { MotifSessionStore } from './mining/session.js';
export { extractEgoGraph } from './mining/ego.js';
export { abstractToShape, shapeHash } from './mining/shape.js';
export { groupEgoGraphs, verifyInternalEquations } from './mining/group.js';
