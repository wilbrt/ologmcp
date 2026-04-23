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
