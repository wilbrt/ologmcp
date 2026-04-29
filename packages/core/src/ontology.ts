/**
 * Ontology type definitions for the olog (ontology log).
 * These types define the data model for elements and arrows in the ontology.
 */

/**
 * Union of all element kinds in the ontology.
 */
export type OlogKind =
  | 'file'
  | 'module'
  | 'symbol'
  | 'callsite'
  | 'import'
  | 'type'
  | 'interface'
  | 'class'
  | 'enum'
  | 'function'
  | 'method'
  | 'const'
  | 'var'
  | 'namespace'
  | 'property'
  | 'domain'
  | 'other';

/**
 * Union of all arrow kinds in the ontology.
 */
export type ArrowKind =
  | 'extends'
  | 'implements'
  | 'calls'
  | 'imports'
  | 'exports'
  | 'references'
  | 'contains'
  | 'returns'
  | 'param'
  | 'typeof'
  | 'instanceof'
  | 'definedIn'
  | 'inModule'
  | 'memberOf'
  | 'callerOf'
  | 'calleeOf'
  | 'importsFrom'
  | 'locatedIn'
  | 'hasProperty'
  | 'hasType'
  | 'implementedAs'
  | 'throws'
  | 'other';

/**
 * Represents an element in the ontology.
 */
export interface OlogElem {
  id: string;
  kind: OlogKind;
  name: string;
  module: string | null;
  span: string | null;
  attrs: Record<string, unknown>;
}

/**
 * Represents an arrow (relationship) in the ontology.
 */
export interface OlogArr {
  id: string;
  kind: ArrowKind;
  srcId: string;
  dstId: string;
  attrs: Record<string, unknown>;
}

/**
 * Represents an attribute of an element.
 */
export interface OlogAttr {
  elemId: string;
  key: string;
  value: string | null;
}

/**
 * Result of an ingest operation.
 */
export interface IngestResult {
  filesProcessed: number;
  elementsCreated: number;
  arrowsCreated: number;
  durationMs: number;
}

/**
 * Result of a query operation - returns elements.
 */
export type QueryResult = OlogElem[];

/**
 * Result of inspecting a single element with its arrows.
 */
export interface InspectResult {
  element: OlogElem;
  outgoing: OlogArr[];
  incoming: OlogArr[];
}

/**
 * Result of a full dump operation.
 */
export interface DumpResult {
  commitSha: string;
  elementCounts: Record<string, number>;
  arrowCounts: Record<string, number>;
  totalElements: number;
  totalArrows: number;
}

/**
 * Raw element during extraction (before ID generation).
 */
export interface RawElement {
  kind: OlogKind;
  name: string;
  module: string;
  span: string;
  attrs: Record<string, unknown>;
}

/**
 * Raw arrow during extraction (before ID generation).
 */
export interface RawArrow {
  kind: ArrowKind;
  srcModule: string;
  srcName: string;
  dstModule: string;
  dstName: string;
  attrs: Record<string, unknown>;
}

export type ConfidenceLevel = 'resolved' | 'unresolved' | 'tentative';

/**
 * A path through the olog graph: a sequence of arrows from src to tgt.
 */
export interface Path {
  src: string;
  tgt: string;
  arrows: string[];
}

/**
 * A path equation asserting that two paths are equivalent.
 */
export interface PathEquation {
  id: string;
  name: string;
  humanMessage: string;
  lhs: Path;
  rhs: Path;
  provenance: Provenance | null;
}

export type ConstraintKind = 'existence' | 'layering' | 'monotonicity' | 'totality';

/**
 * An integrity constraint on the olog graph.
 */
export interface IntegrityConstraint {
  id: string;
  name: string;
  kind: ConstraintKind;
  message: string | null;
  config: Record<string, unknown>;
  provenance: Provenance | null;
}

/**
 * Provenance information for an element, arrow, equation, or constraint.
 */
export interface Provenance {
  source: string;
  commitSha: string;
  ingestedAt: number;
  confidence: ConfidenceLevel;
}

/**
 * A proposed change to the olog schema.
 */
export interface SchemaProposal {
  description: string;
  operations: PlanOperation[];
}

/**
 * A single operation within a plan — rename, move, addSymbol, removeSymbol, addArrow, or removeArrow.
 */
export type PlanOperation =
  | { kind: 'rename'; target: string; newName: string }
  | { kind: 'move'; target: string; newModule: string }
  | { kind: 'addSymbol'; module: string; name: string; symbolKind: string }
  | { kind: 'removeSymbol'; target: string }
  | { kind: 'addArrow'; arrowKind: string; src: string; dst: string }
  | { kind: 'removeArrow'; arrowId: string };

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

/**
 * File edit instruction with position and replacement text.
 */
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
