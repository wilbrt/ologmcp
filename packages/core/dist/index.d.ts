import Database from 'better-sqlite3';

/**
 * Ontology type definitions for the olog (ontology log).
 * These types define the data model for elements and arrows in the ontology.
 */
/**
 * Union of all element kinds in the ontology.
 */
type OlogKind = 'file' | 'module' | 'symbol' | 'callsite' | 'import' | 'type' | 'interface' | 'class' | 'enum' | 'function' | 'method' | 'const' | 'var' | 'namespace' | 'property' | 'domain' | 'other';
/**
 * Union of all arrow kinds in the ontology.
 */
type ArrowKind = 'extends' | 'implements' | 'calls' | 'imports' | 'exports' | 'references' | 'contains' | 'returns' | 'param' | 'typeof' | 'instanceof' | 'definedIn' | 'inModule' | 'memberOf' | 'callerOf' | 'calleeOf' | 'importsFrom' | 'locatedIn' | 'hasProperty' | 'hasType' | 'implementedAs' | 'other';
/**
 * Represents an element in the ontology.
 */
interface OlogElem {
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
interface OlogArr {
    id: string;
    kind: ArrowKind;
    srcId: string;
    dstId: string;
    attrs: Record<string, unknown>;
}
/**
 * Represents an attribute of an element.
 */
interface OlogAttr {
    elemId: string;
    key: string;
    value: string | null;
}
/**
 * Result of an ingest operation.
 */
interface IngestResult {
    filesProcessed: number;
    elementsCreated: number;
    arrowsCreated: number;
    durationMs: number;
}
/**
 * Result of a query operation - returns elements.
 */
type QueryResult = OlogElem[];
/**
 * Result of inspecting a single element with its arrows.
 */
interface InspectResult {
    element: OlogElem;
    outgoing: OlogArr[];
    incoming: OlogArr[];
}
/**
 * Result of a full dump operation.
 */
interface DumpResult {
    commitSha: string;
    elementCounts: Record<string, number>;
    arrowCounts: Record<string, number>;
    totalElements: number;
    totalArrows: number;
}
/**
 * Raw element during extraction (before ID generation).
 */
interface RawElement {
    kind: OlogKind;
    name: string;
    module: string;
    span: string;
    attrs: Record<string, unknown>;
}
/**
 * Raw arrow during extraction (before ID generation).
 */
interface RawArrow {
    kind: ArrowKind;
    srcModule: string;
    srcName: string;
    dstModule: string;
    dstName: string;
    attrs: Record<string, unknown>;
}
type ConfidenceLevel = 'resolved' | 'unresolved' | 'tentative';
/**
 * A path through the olog graph: a sequence of arrows from src to tgt.
 */
interface Path {
    src: string;
    tgt: string;
    arrows: string[];
}
/**
 * A path equation asserting that two paths are equivalent.
 */
interface PathEquation {
    id: string;
    name: string;
    humanMessage: string;
    lhs: Path;
    rhs: Path;
    provenance: Provenance | null;
}
type ConstraintKind = 'existence' | 'layering' | 'monotonicity' | 'totality';
/**
 * An integrity constraint on the olog graph.
 */
interface IntegrityConstraint {
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
interface Provenance {
    source: string;
    commitSha: string;
    ingestedAt: number;
    confidence: ConfidenceLevel;
}
/**
 * A proposed change to the olog schema.
 */
interface SchemaProposal {
    description: string;
    operations: PlanOperation[];
}
/**
 * A single operation within a plan — rename, move, addSymbol, removeSymbol, addArrow, or removeArrow.
 */
type PlanOperation = {
    kind: 'rename';
    target: string;
    newName: string;
} | {
    kind: 'move';
    target: string;
    newModule: string;
} | {
    kind: 'addSymbol';
    module: string;
    name: string;
    symbolKind: string;
} | {
    kind: 'removeSymbol';
    target: string;
} | {
    kind: 'addArrow';
    arrowKind: string;
    src: string;
    dst: string;
} | {
    kind: 'removeArrow';
    arrowId: string;
};
interface Plan {
    operations: PlanOperation[];
    hash: string;
    rationale: string;
    invariants: {
        equations: PathEquation[];
        constraints: IntegrityConstraint[];
    };
}
interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
/**
 * File edit instruction with position and replacement text.
 */
interface ChangeInstruction {
    path: string;
    line: number;
    column: number;
    oldText: string;
    newText: string;
}
interface ApplyResult$1 {
    applied: number;
    skipped: number;
    errors: string[];
    changes: ChangeInstruction[];
}

interface TraverseStep {
    kind: string;
    direction: 'in' | 'out';
}
interface TraverseOptions {
    startId: string;
    steps: TraverseStep[];
    minConfidence?: ConfidenceLevel;
}
/**
 * Multi-hop graph traversal: start at an element, follow a sequence of
 * arrow-kind/direction steps, collecting all reached elements and the
 * arrows traversed. Optionally filter by minimum provenance confidence.
 */
declare function traverse(db: Database.Database, opts: TraverseOptions): {
    elements: OlogElem[];
    arrows: OlogArr[];
};

interface ElemRow {
    id: string;
    kind: string;
    name: string;
    module: string | null;
    span: string | null;
    attrs: string;
}
interface ArrRow {
    id: string;
    kind: string;
    src_id: string;
    dst_id: string;
    attrs: string;
}
declare class OlogStore {
    private db;
    private readonly getElemStmt;
    private readonly outgoingStmt;
    private readonly incomingStmt;
    private readonly insertEquationStmt;
    private readonly getEquationsStmt;
    private readonly getEquationsForObjectStmt;
    private readonly insertConstraintStmt;
    private readonly getConstraintsStmt;
    private readonly getProvenanceStmt;
    private readonly insertElemStmt;
    private readonly insertArrStmt;
    private readonly insertProvStmt;
    private readonly hasArrowKindStmt;
    constructor(path: string);
    commitSha(): string;
    isFresh(head: string): boolean;
    ingestFull(elems: ElemRow[], arrs: ArrRow[], sha: string): number;
    getElem(id: string): OlogElem | null;
    outgoing(srcId: string): OlogArr[];
    incoming(dstId: string): OlogArr[];
    queryElements(opts: {
        kind?: string;
        nameRegex?: string;
        moduleRegex?: string;
        limit: number;
    }): OlogElem[];
    dumpCounts(): {
        elementCounts: Record<string, number>;
        arrowCounts: Record<string, number>;
        totalElements: number;
        totalArrows: number;
    };
    addEquation(eq: PathEquation): void;
    getEquations(): PathEquation[];
    getEquationsForObject(objectId: string): PathEquation[];
    addConstraint(constraint: IntegrityConstraint): void;
    getConstraints(): IntegrityConstraint[];
    traverse(opts: TraverseOptions): {
        elements: OlogElem[];
        arrows: OlogArr[];
    };
    queryElementsWithConfidence(opts: {
        kind?: string;
        nameRegex?: string;
        moduleRegex?: string;
        minConfidence?: ConfidenceLevel;
        limit: number;
    }): OlogElem[];
    getProvenance(elemId: string): Provenance | null;
    applyPlan(operations: PlanOperation[]): ApplyResult$1;
    addElement(elem: OlogElem): void;
    addArrow(arr: OlogArr): void;
    addProvenance(elemId: string, prov: Provenance): void;
    hasArrowKind(kind: string): boolean;
    close(): void;
    private rowToElem;
    private rowToArr;
    private rowToEquation;
    private rowToConstraint;
}

interface Violation {
    id: string;
    kind: string;
    humanMessage: string;
    involved: string[];
}
declare function evaluateConstraints(store: OlogStore, _operations: PlanOperation[]): {
    valid: boolean;
    violations: Violation[];
};
declare function evaluatePathEquations(store: OlogStore, _operations: PlanOperation[]): {
    valid: boolean;
    violations: Violation[];
};
declare function evaluateEquation(eq: PathEquation, store: OlogStore): {
    valid: boolean;
    involved: string[];
    message: string;
};

/**
 * Validates that a name is a proper noun phrase.
 * It must start with an uppercase letter after an optional "a"/"an"/"the" prefix.
 */
declare function isNounPhrase(name: string): boolean;
/**
 * Validates a path equation.
 * - Checks that lhs.src === rhs.src and lhs.tgt === rhs.tgt
 * - Checks that all arrow kinds in lhs.arrows and rhs.arrows exist in the
 *   database or are being proposed concurrently.
 */
declare function validateEquation(eq: PathEquation, store: OlogStore, proposedArrowKinds?: string[]): {
    valid: boolean;
    errors: string[];
};

/**
 * Generates an arrow/edge ID between two elements.
 * Format: ${srcId}:${kind}:${dstId}
 */
declare function arrowId(srcId: string, kind: string, dstId: string): string;

declare function discoverTsFiles(projectRoot: string): string[];
declare function ingestProject(projectRoot: string, store: OlogStore): IngestResult;
declare function reindexProject(projectRoot: string, store: OlogStore): IngestResult;

/**
 * Core types and utilities for source-file editing.
 * SourceEdit positions are 1-based line/column to match tree-sitter span format.
 */
interface SourceEdit {
    /** Relative path from project root (e.g. "src/tools/olog-query.ts") */
    filePath: string;
    /** Human-readable description of what this edit does */
    label: string;
    /** Text to find within the line/col range for verification. null means insert without matching. */
    oldText: string | null;
    /** Replacement text. Empty string means deletion. */
    newText: string;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
}
interface FileSnapshot {
    filePath: string;
    originalContent: string;
}
interface ApplyResult {
    applied: number;
    skipped: number;
    errors: string[];
    snapshots: FileSnapshot[];
    affectedFiles: string[];
}
/** Convert a 1-based (line, col) position to a 0-based character offset. */
declare function offsetAt(source: string, line: number, col: number): number;
/** Apply an ordered list of SourceEdits to a single source string. Sorts in reverse position order first. */
declare function applyEditsToString(source: string, edits: SourceEdit[]): string;
/** Apply an array of SourceEdits to disk files. Groups by file, sorts within each file, applies atomically. */
declare function applySourceEdits(edits: SourceEdit[], projectRoot: string, readFile?: (path: string) => Promise<string>, writeFile?: (path: string, content: string) => Promise<void>): Promise<ApplyResult>;
/** Roll back files to their original content using snapshots. Best-effort — does not throw. */
declare function rollback(snapshots: FileSnapshot[], projectRoot: string): Promise<void>;

interface RenderResult {
    edits: SourceEdit[];
    warnings: string[];
    conflicts: Array<{
        edit1: SourceEdit;
        edit2: SourceEdit;
        message: string;
    }>;
    affectedFiles: string[];
}
interface RenderAndApplyResult extends RenderResult {
    applyResult: ApplyResult | null;
    verificationDiscrepancies: string[];
}
declare function renderPlan(store: OlogStore, operations: PlanOperation[], projectRoot: string): RenderResult;
/**
 * Render a plan and apply the edits to disk, then verify by re-ingesting.
 */
declare function renderAndApplyPlan(store: OlogStore, operations: PlanOperation[], projectRoot: string, reingestFn?: (projectRoot: string, store: OlogStore) => void): Promise<RenderAndApplyResult>;

export { type ApplyResult$1 as ApplyResult, type ArrowKind, type ChangeInstruction, type ConfidenceLevel, type ConstraintKind, type DumpResult, type FileSnapshot, type IngestResult, type InspectResult, type IntegrityConstraint, type OlogArr, type OlogAttr, type OlogElem, type OlogKind, OlogStore, type Path, type PathEquation, type Plan, type PlanOperation, type Provenance, type QueryResult, type RawArrow, type RawElement, type RenderAndApplyResult, type RenderResult, type SchemaProposal, type SourceEdit, type TraverseOptions, type ValidationResult, type Violation, applyEditsToString, applySourceEdits, arrowId, discoverTsFiles, evaluateConstraints, evaluateEquation, evaluatePathEquations, ingestProject, isNounPhrase, offsetAt, reindexProject, renderAndApplyPlan, renderPlan, rollback, traverse, validateEquation };
