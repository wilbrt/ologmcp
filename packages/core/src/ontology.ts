
export interface WorkingSetNote {
  setId: string;
  targetId: string;
  note: string;
  updatedAt: number;
}
export const ELEM_KINDS = [
  'file', 'module', 'symbol', 'callsite', 'import', 'type', 'interface',
  'class', 'enum', 'function', 'method', 'const', 'var', 'namespace',
  'property', 'domain', 'other',
] as const;

export const ARROW_KINDS = [
  'extends', 'implements', 'calls', 'imports', 'exports', 'references',
  'contains', 'returns', 'param', 'typeof', 'instanceof', 'definedIn',
  'inModule', 'memberOf', 'callerOf', 'calleeOf', 'importsFrom', 'locatedIn',
  'hasProperty', 'hasType', 'implementedAs', 'proposedImplementation', 'throws', 'other',
] as const;

export type OlogKind = typeof ELEM_KINDS[number];
export type ArrowKind = typeof ARROW_KINDS[number];

export interface OlogElem {
  id: string;
  kind: OlogKind;
  name: string;
  module: string | null;
  span: string | null;
  attrs: Record<string, unknown>;
}

export interface OlogArr {
  id: string;
  kind: ArrowKind;
  srcId: string;
  dstId: string;
  attrs: Record<string, unknown>;
}

export interface OlogAttr {
  elemId: string;
  key: string;
  value: string | null;
}

export interface IngestResult {
  filesProcessed: number;
  elementsCreated: number;
  arrowsCreated: number;
  durationMs: number;
}

export type QueryResult = OlogElem[];

export interface InspectResult {
  element: OlogElem;
  outgoing: OlogArr[];
  incoming: OlogArr[];
}

export interface DumpResult {
  commitSha: string;
  elementCounts: Record<string, number>;
  arrowCounts: Record<string, number>;
  totalElements: number;
  totalArrows: number;
}

export interface RawElement {
  kind: OlogKind;
  name: string;
  module: string;
  span: string;
  attrs: Record<string, unknown>;
}

export interface RawArrow {
  kind: ArrowKind;
  srcModule: string;
  srcName: string;
  dstModule: string;
  dstName: string;
  attrs: Record<string, unknown>;
}

export type ConfidenceLevel = 'resolved' | 'unresolved' | 'tentative';

export interface Path {
  src: string;
  tgt: string;
  arrows: string[];
}

export interface PathEquation {
  id: string;
  name: string;
  humanMessage: string;
  lhs: Path;
  rhs: Path;
  provenance: Provenance | null;
}

export type ConstraintKind = 'existence' | 'layering' | 'monotonicity' | 'totality';

export interface IntegrityConstraint {
  id: string;
  name: string;
  kind: ConstraintKind;
  message: string | null;
  config: Record<string, unknown>;
  provenance: Provenance | null;
}

export interface Provenance {
  source: string;
  commitSha: string;
  ingestedAt: number;
  confidence: ConfidenceLevel;
}

export interface SchemaProposal {
  description: string;
  operations: PlanOperation[];
}

export type PlanOperation =
  | { kind: 'rename'; target: string; newName: string }
  | { kind: 'move'; target: string; newModule: string }
  | { kind: 'addSymbol'; module: string; name: string; symbolKind: string }
  | { kind: 'removeSymbol'; target: string }
  | { kind: 'addArrow'; arrowKind: string; src: string; dst: string }
  | { kind: 'removeArrow'; arrowId: string }
  | { kind: 'rewrite_body'; target: string; rationale: string }
  | { kind: 'addReexport'; module: string; name: string; fromModule: string }
  | { kind: 'amendType'; target: string; field: string; action: 'addUnionMember' | 'addProperty'; value: string };

export interface Plan {
  operations: PlanOperation[];
  hash: string;
  rationale: string;
  invariants: {
    equations: PathEquation[];
    constraints: IntegrityConstraint[];
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ChangeInstruction {
  path: string;
  line: number;
  column: number;
  oldText: string;
  newText: string;
}

export interface ApplyResult {
  applied: number;
  skipped: number;
  errors: string[];
  changes: ChangeInstruction[];
}

export interface WorkingSetMeta {
  id: string;
  name: string;
  planHash: string | null;
  elementCount: number;
  arrowCount: number;
  updatedAt: number;
}

export interface WorkingSet {
  id: string;
  name: string;
  planHash: string | null;
  elements: OlogElem[];
  arrows: OlogArr[];
  notes?: WorkingSetNote[];
}

export interface SyntheticArr {
  id: string;
  setId: string;
  kind: string;
  srcId: string;
  dstId: string | null;
  note: string | null;
  source: string;
  synthetic: true;
}

export interface WorkingSetGraph {
  elements: OlogElem[];
  arrows: OlogArr[];
  syntheticArrows: SyntheticArr[];
}
