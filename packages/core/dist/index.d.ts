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
type ArrowKind = 'extends' | 'implements' | 'calls' | 'imports' | 'exports' | 'references' | 'contains' | 'returns' | 'param' | 'typeof' | 'instanceof' | 'definedIn' | 'inModule' | 'memberOf' | 'callerOf' | 'calleeOf' | 'importsFrom' | 'locatedIn' | 'hasProperty' | 'hasType' | 'implementedAs' | 'throws' | 'other';
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
 * A single operation within a plan — rename, move, addSymbol, removeSymbol, addArrow, removeArrow, rewrite_body, addReexport, or amendType.
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
} | {
    kind: 'rewrite_body';
    target: string;
    rationale: string;
} | {
    kind: 'addReexport';
    module: string;
    name: string;
    fromModule: string;
} | {
    kind: 'amendType';
    target: string;
    field: string;
    action: 'addUnionMember' | 'addProperty';
    value: string;
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

interface DomainCandidate {
    id: string;
    codeElementId: string;
    proposedName: string;
    proposedArrows: ArrowProposal[];
    bridgeArrow: ArrowProposal;
    questions: string[];
    status: 'proposed' | 'accepted' | 'rejected' | 'deferred';
}
interface ArrowProposal {
    id: string;
    name: string;
    domainCandidateId: string;
    codomainName: string;
    codomainCandidateId: string | null;
    /** ID of an already-committed domain element (fallback when codomainCandidateId is null). */
    codomainExistingElemId: string | null;
    total: boolean;
    source: 'field' | 'method' | 'type_ref' | 'extends' | 'implements' | 'kan_extension' | 'pullback';
    confidence: ConfidenceLevel;
    question?: string;
    status: 'proposed' | 'accepted' | 'rejected' | 'modified';
}
interface DomainSessionData {
    id: string;
    status: 'active' | 'committed' | 'abandoned';
    scopeRegex: string | null;
    candidates: DomainCandidate[];
    equations: ProposedEquation[];
    commitSha: string;
    createdAt: number;
    updatedAt: number;
}
interface ProposedEquation {
    id: string;
    name: string;
    humanMessage: string;
    lhs: {
        src: string;
        tgt: string;
        arrows: string[];
    };
    rhs: {
        src: string;
        tgt: string;
        arrows: string[];
    };
}
interface DiscoveryOptions {
    scopeRegex?: string;
    excludeModules?: string[];
}

/**
 * Abstract base class for session CRUD stores.
 * Handles the common get/list/delete pattern and statement preparation,
 * while subclasses define their own create/update/rowToSession logic.
 */
declare abstract class SessionStore<RowType, SessionData> {
    protected readonly db: Database.Database;
    protected readonly insertStmt: Database.Statement;
    protected readonly getStmt: Database.Statement;
    protected readonly listStmt: Database.Statement;
    protected readonly updateStmt: Database.Statement;
    protected readonly deleteStmt: Database.Statement;
    constructor(db: Database.Database, insertSQL: string, selectColumns: string, tableName: string, updateSQL: string);
    protected abstract rowToSession(row: RowType): SessionData;
    get(id: string): SessionData | null;
    list(): SessionData[];
    delete(id: string): void;
}

interface SessionRow$1 {
    id: string;
    status: string;
    scope_regex: string | null;
    candidates_json: string;
    equations_json: string | null;
    commit_sha: string;
    created_at: number;
    updated_at: number;
}
declare class DomainSessionStore extends SessionStore<SessionRow$1, DomainSessionData> {
    constructor(db: Database.Database);
    protected rowToSession(row: SessionRow$1): DomainSessionData;
    create(data: {
        scopeRegex?: string;
        candidates: DomainCandidate[];
        equations: ProposedEquation[];
        commitSha: string;
    }): string;
    update(id: string, data: Partial<DomainSessionData>): void;
}

/**
 * Path enumeration for mining.
 *
 * Generates all valid path sequences (arrow-kind compositions) up to a given
 * depth from the set of arrow kinds available in the olog.
 *
 * A "path" here is a sequence of arrow kinds like ["memberOf", "inModule"],
 * representing composition of morphisms in the olog category.
 */

/**
 * A path through the olog graph: a sequence of arrow kinds.
 * Each step follows an arrow of the given kind in the "out" direction.
 */
interface ArrowPath {
    /** The sequence of arrow kinds (composed left-to-right). */
    arrows: ArrowKind[];
    /** The overall domain kind -> codomain kind, determined by the olog schema. */
    domainKind: string | null;
    codomainKind: string | null;
}
/**
 * Enumerate all arrow kinds that exist in the store.
 * This uses the OlogStore.hasArrowKind() method to check which arrow kinds
 * have at least one arrow, avoiding enumeration of unused kinds.
 */
declare function getArrowKindsInUse(allArrowKinds: ArrowKind[], hasArrowKind: (kind: string) => boolean): ArrowKind[];
/**
 * Enumerate all possible path sequences of depth 1..maxDepth over the given
 * arrow kinds.
 *
 * For depth 1, this is just each arrow kind individually.
 * For depth N, each path is formed by appending an arrow kind to a path of
 * depth N-1.
 *
 * Paths where the same arrow kind appears twice consecutively are pruned
 * (e.g., ["inModule", "inModule"] is unlikely to be meaningful).
 *
 * Returns paths grouped by depth.
 */
declare function enumeratePaths(arrowKinds: ArrowKind[], maxDepth: number): ArrowPath[];

/**
 * Equation candidate evaluation for mining.
 *
 * Given a candidate equation (lhs path, rhs path) and a set of seed elements,
 * follows both paths from each seed and checks whether they reach the same
 * set of elements. Computes coverage (support/total) and collects counterexamples.
 */

interface Counterexample {
    elementId: string;
    elementName: string;
    elementKind: string;
    lhsResult: string[];
    rhsResult: string[];
}
interface EquationCandidate {
    /** Left-hand side path (sequence of arrow kinds). */
    lhsPath: ArrowKind[];
    /** Right-hand side path (sequence of arrow kinds). */
    rhsPath: ArrowKind[];
    /** The element kind this equation was tested against. */
    domainKind: string;
    /** Number of seed elements where both paths are defined and agree. */
    support: number;
    /** Number of seed elements where both paths are defined (denominator for coverage). */
    total: number;
    /** Coverage ratio: support / total. 1.0 means equation holds universally. */
    coverage: number;
    /** Concrete counterexamples (up to maxCounterexamples). */
    counterexamples: Counterexample[];
}
/**
 * Evaluate a single candidate equation against a set of seed elements.
 *
 * For each seed element, follows both the lhs and rhs paths. If both reach
 * at least one element, we check if they reach the same set. If they don't,
 * that's a counterexample.
 *
 * @param store - The olog store
 * @param lhsPath - Left-hand side arrow path
 * @param rhsPath - Right-hand side arrow path
 * @param seedElements - Elements to test from
 * @param maxCounterexamples - Maximum number of counterexamples to collect
 * @returns Evaluation result with support, total, coverage, and counterexamples
 */
declare function evaluateEquationCandidate(store: OlogStore, lhsPath: ArrowKind[], rhsPath: ArrowKind[], seedElements: OlogElem[], maxCounterexamples?: number): EquationCandidate;

declare function shapeHash(shape: MotifShape): string;
declare function abstractToShape(ego: EgoGraph): MotifShape;

declare function discoverMotifs(store: OlogStore, options?: MotifDiscoveryOptions): MotifCandidate[];

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

interface MiningOptions {
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
    /**
     * Restrict to arrow kinds that touch elements of these kinds.
     * When specified, only arrow kinds that have at least one arrow whose
     * source or destination element is of one of these kinds will be
     * included in path enumeration. This is useful for focusing mining
     * on domain-relevant arrows (e.g., passing ['domain'] will only
     * consider arrows that connect to/from domain objects).
     * Intersected with arrowKinds if both are specified.
     */
    touchingElementKinds?: string[];
    /** Maximum number of counterexamples per equation (default 5). */
    maxCounterexamples: number;
    /** Number of seed elements per kind to sample (default 100). */
    sampleSize: number;
}
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
declare function mineEquations(store: OlogStore, options?: Partial<MiningOptions>): EquationCandidate[];

/**
 * Motif discovery types.
 *
 * A motif is a recurring structural pattern in the olog graph — formally,
 * a strongly meaningful functor from a small template olog to the codebase olog.
 *
 * The types here mirror the domain discovery session model (start/refine/commit)
 * and are persisted via MotifSessionStore + motif template/instance tables.
 */

/** Induced subgraph around a seed element, produced by ego-graph extraction. */
interface EgoGraph {
    /** The seed element ID that this ego-graph was expanded from. */
    seedId: string;
    /** The kind of the seed element. */
    seedKind: string;
    /** All elements in the ego-graph, keyed by element ID. */
    elements: Map<string, {
        id: string;
        kind: string;
        name: string;
    }>;
    /** All arrows in the ego-graph. */
    arrows: Array<{
        srcId: string;
        kind: string;
        dstId: string;
    }>;
}
/** A group of ego-graphs that share the same shape, filtered by minimum support. */
interface ShapeGroup {
    /** The canonical shape shared by all instances. */
    shape: MotifShape;
    /** The concrete ego-graph instances matching this shape. */
    instances: EgoGraph[];
    /** Count of instances (same as instances.length after filtering). */
    support: number;
}
/** A canonical shape template: kind-abstracted objects and arrow labels. */
interface MotifShape {
    /** Deterministic hash for fast grouping (JSON of sorted objects + arrows). */
    hash: string;
    /** Object slots, each a role label and element kind. */
    objects: Array<{
        role: string;
        kind: string;
    }>;
    /** Arrow slots: fromRole → toRole labeled with an arrow kind. */
    arrows: Array<{
        fromRole: string;
        label: string;
        toRole: string;
    }>;
}
/** A single concrete mapping from shape roles to real olog elements. */
interface MotifInstance {
    id: string;
    /** Shape role → concrete olog element ID. */
    mappings: Record<string, string>;
    /** Module of the seed element, for grouping and display. */
    module: string | null;
}
/** A motif candidate produced by discovery, ready for user review. */
interface MotifCandidate {
    id: string;
    /** The canonical shape of this motif. */
    shape: MotifShape;
    /** Auto-generated or user-overridden name. */
    proposedName: string;
    /** Human-readable description of what structural pattern this captures. */
    description: string;
    /** Number of concrete instances found in the olog. */
    support: number;
    /** Concrete instance mappings. */
    instances: MotifInstance[];
    /** Internal equations that hold for all instances (mined via Tier 1). */
    equations: Array<{
        lhsPath: string[];
        rhsPath: string[];
        coverage: number;
    }>;
    /** Clarifying questions for the user. */
    questions: string[];
    status: 'proposed' | 'accepted' | 'rejected' | 'deferred';
}
interface MotifDiscoveryOptions {
    /** Element kinds to use as seeds (default: ['function', 'class', 'interface']). */
    seedKinds?: string[];
    /** Ego-graph expansion depth (default: 2). */
    depth?: number;
    /** Arrow kinds to follow during expansion (default: all in use). */
    arrowKinds?: string[];
    /** Minimum support (instance count) for a motif to be surfaced (default: 3). */
    minSupport?: number;
    /** Whether to mine equations internal to each motif (default: true). */
    mineEquations?: boolean;
    /** Options passed through to mineEquations when mineEquations=true. */
    equationOptions?: Partial<MiningOptions>;
    /** Regex to scope seeds to specific modules (default: none = all). */
    scopeRegex?: string;
    /** Exclude modules matching these patterns. */
    excludeModules?: string[];
}
interface MotifSessionData {
    id: string;
    status: 'active' | 'committed' | 'abandoned';
    scopeRegex: string | null;
    candidates: MotifCandidate[];
    commitSha: string;
    createdAt: number;
    updatedAt: number;
}

interface SessionRow {
    id: string;
    status: string;
    scope_regex: string | null;
    candidates_json: string;
    commit_sha: string;
    created_at: number;
    updated_at: number;
}
declare class MotifSessionStore extends SessionStore<SessionRow, MotifSessionData> {
    constructor(db: Database.Database);
    protected rowToSession(row: SessionRow): MotifSessionData;
    create(data: {
        scopeRegex?: string;
        candidates: MotifCandidate[];
        commitSha: string;
    }): string;
    update(id: string, data: Partial<MotifSessionData>): void;
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
    private readonly _sessions;
    private readonly _motifSessions;
    private readonly getElemStmt;
    private readonly getArrStmt;
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
    private readonly insertMotifTemplateStmt;
    private readonly insertMotifInstanceStmt;
    constructor(path: string);
    get sessions(): DomainSessionStore;
    get motifSessions(): MotifSessionStore;
    commitSha(): string;
    isFresh(head: string): boolean;
    ingestFull(elems: ElemRow[], arrs: ArrRow[], sha: string): number;
    /** Return the set of relative module paths that have at least one tree-sitter element. */
    getIngestedModules(): Set<string>;
    /** Delete all tree-sitter elements for a given module (cascade removes arrows). */
    deleteModuleTreeSitterElements(module: string): void;
    /** Return a map of element name → [ids] across all elements, for cross-file resolution. */
    getAllElemNameToIds(): Map<string, string[]>;
    /** Return a map of element id → module for all elements with a module. */
    getAllElemIdToModule(): Map<string, string>;
    /**
     * Insert elements and arrows for specific files without wiping the whole store.
     * Used by incremental ingestion. Arrows that reference non-existent elements are silently skipped.
     */
    ingestFile(elems: ElemRow[], arrs: ArrRow[], sha: string): void;
    getElem(id: string): OlogElem | null;
    getArr(id: string): OlogArr | null;
    outgoing(srcId: string): OlogArr[];
    incoming(dstId: string): OlogArr[];
    /** Derive virtual arrows that are no longer stored: inModule/locatedIn (≡ definedIn),
     *  contains (≡ inverse definedIn for files), imports (≡ inverse importsFrom for files). */
    outgoingDerived(elemId: string): OlogArr[];
    getElemsByModule(module: string): OlogElem[];
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
    addMotifTemplate(template: {
        id: string;
        name: string;
        description: string;
        shape: MotifShape;
        equations: Array<{
            lhsPath: string[];
            rhsPath: string[];
            coverage: number;
        }>;
        provenance: {
            source: string;
            commitSha: string;
            confidence: string;
        };
    }): void;
    getMotifTemplates(): Array<{
        id: string;
        name: string;
        description: string;
        shape: MotifShape;
        equations: Array<{
            lhsPath: string[];
            rhsPath: string[];
            coverage: number;
        }>;
        provenance: {
            source: string;
            commitSha: string;
            confidence: string;
        };
        createdAt: number;
    }>;
    addMotifInstance(instance: {
        id: string;
        templateId: string;
        mappings: Record<string, string>;
        provenance: {
            source: string;
            commitSha: string;
            confidence: string;
        };
    }): void;
    getMotifInstances(templateId: string): Array<{
        id: string;
        templateId: string;
        mappings: Record<string, string>;
        provenance: {
            source: string;
            commitSha: string;
            confidence: string;
        };
        createdAt: number;
    }>;
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
    /**
     * Load every arrow as lightweight {src_id, kind, dst_id} rows.
     * Used to build the in-memory adjacency map for fast mining.
     */
    loadAllArrows(): Array<{
        src_id: string;
        kind: string;
        dst_id: string;
    }>;
    /**
     * Load every element's id, kind, and name.
     * Used for kind annotation and counterexample names during mining.
     */
    loadElemMeta(): Map<string, {
        kind: string;
        name: string;
    }>;
    /**
     * Get all distinct arrow kinds where either the source or destination element
     * is of one of the given element kinds.
     *
     * This is useful for mining: when you want to restrict path enumeration to
     * only arrow kinds that connect to domain objects (or any other element kind),
     * this method returns the relevant arrow kinds.
     *
     * @param elementKinds - Array of element kinds to filter by (e.g., ['domain'])
     * @returns Sorted array of distinct ArrowKind values
     */
    getArrowKindsForElementKinds(elementKinds: string[]): ArrowKind[];
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

/**
 * Represents a property extracted from a structured declaration
 * (interface field, class member, etc.)
 */
interface PropertyExtract {
    name: string;
    span: string;
    typeText: string;
    optional: boolean;
    readonly: boolean;
    typeRefs: string[];
    parentName: string;
    parentKind: string;
}
/**
 * Minimal parser interface shared by tree-sitter bindings.
 * Both native `tree-sitter` and `web-tree-sitter` satisfy this.
 */
interface TreeSitterParser {
    parse(input: string): {
        rootNode: TreeSitterNode;
        delete?(): void;
    };
}
/**
 * Minimal node interface shared by tree-sitter bindings.
 */
interface TreeSitterNode {
    type: string;
    text: string;
    startPosition: {
        row: number;
        column: number;
    };
    endPosition: {
        row: number;
        column: number;
    };
    parent: TreeSitterNode | null;
    namedChildren: TreeSitterNode[];
    childForFieldName(fieldName: string): TreeSitterNode | null;
    descendantForPosition(start: {
        row: number;
        column: number;
    }, end: {
        row: number;
        column: number;
    }): TreeSitterNode | null;
    hasError: boolean;
    walk(): TreeSitterCursor;
}
interface TreeSitterCursor {
    nodeType: string;
    nodeText: string;
    nodeId: number;
    nodeIsNamed: boolean;
    nodeIsMissing: boolean;
    startPosition: {
        row: number;
        column: number;
    };
    endPosition: {
        row: number;
        column: number;
    };
    currentNode: TreeSitterNode;
    currentFieldName: string;
    gotoParent(): boolean;
    gotoFirstChild(): boolean;
    gotoNextSibling(): boolean;
}
/**
 * Minimal query interface shared by tree-sitter bindings.
 */
interface TreeSitterQuery {
    matches(node: TreeSitterNode): TreeSitterQueryMatch[];
    captures(node: TreeSitterNode): TreeSitterQueryCapture[];
    delete(): void;
}
interface TreeSitterQueryMatch {
    pattern: number;
    captures: TreeSitterQueryCapture[];
}
interface TreeSitterQueryCapture {
    name: string;
    node: TreeSitterNode;
    text?: string;
}
/**
 * Configuration object for a language adapter.
 * Contains the static data properties shared across all adapter implementations.
 * Adapter classes can define a config constant and spread it into their properties.
 */
interface LanguageAdapterConfig {
    /** Unique language identifier (e.g. 'typescript', 'clojure') */
    languageId: string;
    /** File extensions this adapter handles, with leading dot */
    extensions: string[];
    /** Glob pattern for file discovery */
    globPattern: string;
    /** Map from tree-sitter node type to olog element kind */
    nodeTypeToKind: Record<string, OlogKind>;
    /** Map from olog element kind to tree-sitter node types */
    kindToNodeTypes: Record<string, string[]>;
}
/**
 * Language adapter interface — each supported language provides an
 * implementation that knows how to parse source files, extract elements
 * and arrows, and resolve imports for that language.
 */
interface LanguageAdapter<ParserT = TreeSitterParser> {
    /** Unique language identifier (e.g. 'typescript', 'clojure') */
    languageId: string;
    /** File extensions this adapter handles, with leading dot */
    extensions: string[];
    /** Glob pattern for file discovery (e.g. 'any .ts, .tsx, .mts or .cts file') */
    globPattern: string;
    /** Create a configured tree-sitter Parser for the given file */
    createParser(filename: string): ParserT;
    /** Get the .scm query file path for a given source file */
    queryPath(filename: string): string;
    /** Extract raw elements and arrows from source via tree-sitter queries */
    extractElements(parser: ParserT, source: string, queryPath: string, fromFile?: string, projectRoot?: string): {
        elements: RawElement[];
        arrows: RawArrow[];
    };
    /** Map a tree-sitter node type to a canonical olog element kind */
    nodeTypeToKind: Record<string, OlogKind>;
    /** Map an olog element kind to tree-sitter node types (reverse mapping) */
    kindToNodeTypes: Record<string, string[]>;
    /** Extract properties (interface fields, class members, etc.) — optional */
    extractProperties?(parser: ParserT, source: string, moduleName: string): PropertyExtract[];
    /** Find the containing function/method name for a position — optional */
    findContainingFunctionName?(node: unknown, row: number, col: number): string | null;
    /** Resolve an import specifier to a file path — optional */
    resolveImportSpecifier?(importPath: string, fromFile: string, projectRoot: string): string | null;
}
/**
 * Registry of language adapters. Adapters are registered at runtime
 * and looked up by file extension.
 */
declare class AdapterRegistry {
    private adapters;
    private extensionMap;
    /** Register a language adapter */
    register(adapter: LanguageAdapter): void;
    /** Look up the adapter for a given filename (by its extension) */
    getForFile(filename: string): LanguageAdapter | null;
    /** Get all registered file extensions across all adapters */
    allExtensions(): string[];
    /** Get all glob patterns across all adapters */
    allGlobPatterns(): string[];
    /** Check if an adapter is registered for a given language id */
    hasAdapter(languageId: string): boolean;
}
/** Set the global default adapter registry (called during project ingestion setup) */
declare function setDefaultRegistry(registry: AdapterRegistry): void;
/** Get the global default adapter registry */
declare function getDefaultRegistry(): AdapterRegistry | undefined;

declare function ingestProject(projectRoot: string, store: OlogStore, registry?: AdapterRegistry): IngestResult;
/**
 * Incremental ingestion: processes only files that are new or modified since the last index.
 * New files: present on disk but not yet in the olog.
 * Modified files: changed according to git since the stored commit SHA, or since uncommitted edits.
 * Does not touch unchanged files, so it is much faster on large codebases.
 */
declare function ingestChangedFiles(projectRoot: string, store: OlogStore, registry?: AdapterRegistry): IngestResult;
declare function reindexProject(projectRoot: string, store: OlogStore, registry?: AdapterRegistry): IngestResult;

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

type DelegationTask = 'write_function_body' | 'write_test' | 'write_migration' | 'rewrite_body' | 'write_documentation';
interface DelegationBrief {
    task: DelegationTask;
    target: {
        id: string;
        name: string;
        kind: string;
        module: string;
        signature: string;
        bodyPlaceholder: string;
        filePath: string;
        lineRange: {
            start: number;
            end: number;
        };
    };
    mustCall: Array<{
        name: string;
        signature: string;
        importStatement: string;
        calleeBodySnippet: string;
        calleeCallees: Array<{
            name: string;
            module: string;
            snippet: string;
        }>;
    }>;
    mustImplement: Array<{
        name: string;
        fullDeclaration: string;
        importStatement: string;
    }>;
    usedBy: Array<{
        name: string;
        callSiteSnippet: string;
    }>;
    importsInTargetFile: string[];
    /**
     * mustCall entries whose module is not imported in the target file.
     * Each entry carries the import statement needed to fix it.
     */
    missingImports: Array<{
        name: string;
        module: string;
        suggestedImport: string;
    }>;
    analogues: Array<{
        name: string;
        similarity: number;
        fullSource: string;
        callees: string[];
        modulePath: string;
    }>;
    targetFileContent: string;
    /**
     * Domain model context for this code element.
     * Null when no domain model has been built yet.
     */
    domainContext: {
        /** Domain concept(s) this element directly implements via implementedAs. */
        ownConcepts: Array<{
            id: string;
            name: string;
            /** Domain arrows involving this concept (excluding implementedAs). */
            arrows: Array<{
                name: string;
                direction: 'outgoing' | 'incoming';
                peerName: string;
            }>;
        }>;
        /** Domain concepts reachable via callers/callees (Kan neighborhood). */
        neighborConcepts: Array<{
            name: string;
            via: 'caller' | 'callee';
            codeElementName: string;
        }>;
    } | null;
    acceptanceCriteria: string[];
    provenance: {
        ologCommitSha: string;
        confidence: 'resolved' | 'unresolved' | 'mixed';
        generatedAt: string;
    };
}
interface ContextOverrides {
    mustCall?: string[];
    mustImplement?: string[];
    analogues?: string[];
}

declare function assembleBrief(store: OlogStore, projectRoot: string, task: DelegationTask, targetId: string, overrides?: ContextOverrides, maxAnalogues?: number, snippetLines?: number, extraCriteria?: string[]): DelegationBrief | {
    ok: false;
    error: string;
};

declare class SourceResolver {
    private projectRoot;
    private fileCache;
    constructor(projectRoot: string);
    readSpan(filePath: string, span: string): string | null;
    readContext(filePath: string, span: string, contextLines?: number): string | null;
    readDeclaration(filePath: string, span: string, kind: string): string | null;
    readSignature(filePath: string, span: string, kind: string): string | null;
    readBody(filePath: string, span: string, kind: string, maxLines?: number): string | null;
    readImportBlock(filePath: string): string[];
    computeImportStatement(symbolName: string, symbolModule: string, targetModule: string): string;
    readFileContent(filePath: string, maxLines?: number): string | null;
    /**
     * Read a window of source focused on a span: contextBefore lines above the
     * start of the span and contextAfter lines below the end, with an omission
     * comment if the file has content before the window.
     */
    readFocused(filePath: string, span: string, contextBefore?: number, contextAfter?: number): string | null;
    private readFile;
}
/** Extract the relative file path prefix from a full span string. */
declare function filePathFromSpan(span: string): string | null;

interface AnalogueCandidate {
    id: string;
    name: string;
    kind: string;
    module: string | null;
    span: string | null;
    similarity: number;
}

/**
 * Olog traversal functions for assembling delegation context.
 *
 * These functions query the OlogStore to gather structural context
 * (mustCall, mustImplement, usedBy, imports) without reading any source
 * files. All results are element IDs, names, modules, and spans.
 */

interface MustCallEntry {
    id: string;
    name: string;
    kind: string;
    module: string | null;
    span: string | null;
    attrs: Record<string, unknown>;
}
interface MustImplementEntry {
    id: string;
    name: string;
    kind: string;
    module: string | null;
    span: string | null;
}
interface UsedByEntry {
    id: string;
    name: string;
    kind: string;
    module: string | null;
    span: string | null;
}
interface ImportEntry {
    name: string;
    sourceModule: string | null;
    targetModule: string | null;
    /** Language-specific raw import text (e.g. "[myapp.fee-model :as fee-model]" for Clojure). */
    rawText?: string;
}
interface StructuralContext {
    mustCall: MustCallEntry[];
    mustImplement: MustImplementEntry[];
    usedBy: UsedByEntry[];
    imports: ImportEntry[];
}
interface DomainContext {
    ownConcepts: Array<{
        id: string;
        name: string;
        arrows: Array<{
            name: string;
            direction: 'outgoing' | 'incoming';
            peerName: string;
        }>;
    }>;
    neighborConcepts: Array<{
        name: string;
        via: 'caller' | 'callee';
        codeElementName: string;
    }>;
}

declare function minePullbacks(store: OlogStore, options?: DiscoveryOptions): DomainCandidate[];
/**
 * Convert a PascalCase type name to an olog noun phrase (e.g. "OlogElem" → "an Olog Element").
 */
declare function toNounPhrase(pascalName: string): string;
/**
 * Convert any function name style (kebab-case, snake_case, camelCase, PascalCase)
 * to an olog noun phrase. Strips namespace qualifiers before converting.
 */
declare function toNounPhraseFromName(name: string): string;
/**
 * Returns true if the module path represents an external (non-project) module.
 */
declare function isExternalModule(module: string | null, excludeModules?: string[]): boolean;
/**
 * Build a lookup from code element ID to already-committed domain element.
 * Domain elements point to their code element via an `implementedAs` arrow.
 */
declare function getExistingDomainElementsByCodeId(store: OlogStore): Map<string, {
    id: string;
    name: string;
}>;
/**
 * Discover domain candidates from the olog.
 *
 * Reads interface/type/class elements from the store, follows hasProperty and
 * hasType arrows to build proposed domain objects and arrows, and returns the
 * full list of candidates for user review.
 */
declare function discoverDomainCandidates(store: OlogStore, options?: DiscoveryOptions): DomainCandidate[];
/**
 * Left Kan extension of the implementedAs functor along the code call graph.
 *
 * Starting from every committed domain element, follows callerOf edges in the
 * code graph up to maxDepth hops. For each reachable code element:
 * - If it already has a domain label: propose a "calls" arrow between the two
 *   domain concepts (stored on a shell candidate for the source domain element).
 * - If it has no domain label: propose a new domain candidate and a "calls"
 *   arrow from the source concept to it.
 *
 * Returns a mix of shell candidates (status="accepted", existing domain elements
 * that gain new arrows) and new candidates (status="proposed") for review.
 */
declare function extendDomainByKan(store: OlogStore, options?: {
    maxDepth?: number;
    excludeModules?: string[];
}): DomainCandidate[];

/**
 * Candidate pair generation for mining.
 *
 * Given a list of enumerated paths, generates pairs (lhs, rhs) where both
 * paths could potentially commute — i.e., they share the same domain object
 * type and could plausibly reach elements of compatible types.
 *
 * Since we don't have a static schema of domain/codomain kinds per arrow
 * (the olog is dynamic), we resolve domain/codomain kinds empirically:
 * by following each path from a sample of elements and recording what kinds
 * we reach. Two paths are candidates if they share at least one common
 * domain kind.
 */

interface CandidatePair {
    lhs: ArrowKind[];
    rhs: ArrowKind[];
}
/**
 * Annotate each path with its empirically determined domain and codomain kinds.
 *
 * For each path, we:
 * 1. Pick a sample of elements of each kind
 * 2. Follow the path from those elements
 * 3. Record the kinds of reached elements
 *
 * This produces domain→codomain pairs that tell us which paths can
 * potentially commute.
 */
declare function annotatePathKinds(paths: ArrowPath[], store: OlogStore, elementKinds: string[], sampleSize?: number): ArrowPath[];
/**
 * Generate candidate equation pairs from annotated paths.
 *
 * Two paths are candidates for an equation if:
 * 1. They share at least one common domain kind (i.e., both can be followed from
 *    elements of the same kind)
 * 2. Their codomain kinds overlap (they reach elements of overlapping types)
 *
 * To avoid trivial equations, we also filter out:
 * - Pairs where lhs == rhs (identity equation)
 * - Pairs that are subsumed by a shorter equation with the same coverage
 */
declare function generateCandidatePairs(paths: ArrowPath[]): CandidatePair[];

/**
 * In-memory graph for fast mining.
 *
 * Loads the full adjacency structure and element metadata into memory once,
 * then provides O(1) outgoing-arrow lookups and pre-computes all (path, seed)
 * traversal results so the mining inner loop makes zero database queries.
 */

/** Adjacency map + element metadata, loaded in two bulk SQL queries. */
interface InMemoryGraph {
    /** srcId → [{kind, dstId}] */
    outgoing: Map<string, Array<{
        kind: string;
        dstId: string;
    }>>;
    /** elemId → {kind, name} for annotation and counterexample rendering. */
    elems: Map<string, {
        kind: string;
        name: string;
    }>;
}

declare function extractEgoGraph(graph: InMemoryGraph, seedId: string, depth: number, arrowKinds?: string[]): EgoGraph;

declare function groupEgoGraphs(egos: EgoGraph[], minSupport: number): ShapeGroup[];
declare function verifyInternalEquations(store: OlogStore, group: ShapeGroup, options?: Partial<MiningOptions>): Array<{
    lhsPath: string[];
    rhsPath: string[];
    coverage: number;
}>;

export { AdapterRegistry, type AnalogueCandidate, type ApplyResult$1 as ApplyResult, type ArrowKind, type ArrowPath, type ArrowProposal, type CandidatePair, type ChangeInstruction, type ConfidenceLevel, type ConstraintKind, type ContextOverrides, type Counterexample, type DelegationBrief, type DelegationTask, type DiscoveryOptions, type DomainCandidate, type DomainContext, type DomainSessionData, DomainSessionStore, type DumpResult, type EgoGraph, type EquationCandidate, type FileSnapshot, type ImportEntry, type IngestResult, type InspectResult, type IntegrityConstraint, type LanguageAdapter, type LanguageAdapterConfig, type MiningOptions, type MotifCandidate, type MotifDiscoveryOptions, type MotifInstance, type MotifSessionData, MotifSessionStore, type MotifShape, type MustCallEntry, type MustImplementEntry, type OlogArr, type OlogAttr, type OlogElem, type OlogKind, OlogStore, type Path, type PathEquation, type Plan, type PlanOperation, type PropertyExtract, type ProposedEquation, type Provenance, type QueryResult, type RawArrow, type RawElement, type RenderAndApplyResult, type RenderResult, type SchemaProposal, SessionStore, type ShapeGroup, type SourceEdit, SourceResolver, type StructuralContext, type TraverseOptions, type TreeSitterNode, type TreeSitterParser, type TreeSitterQuery, type TreeSitterQueryCapture, type TreeSitterQueryMatch, type UsedByEntry, type ValidationResult, type Violation, abstractToShape, annotatePathKinds, applyEditsToString, applySourceEdits, arrowId, assembleBrief, discoverDomainCandidates, discoverMotifs, enumeratePaths, evaluateConstraints, evaluateEquation, evaluateEquationCandidate, evaluatePathEquations, extendDomainByKan, extractEgoGraph, filePathFromSpan, generateCandidatePairs, getArrowKindsInUse, getDefaultRegistry, getExistingDomainElementsByCodeId, groupEgoGraphs, ingestChangedFiles, ingestProject, isExternalModule, isNounPhrase, mineEquations, minePullbacks, offsetAt, reindexProject, renderAndApplyPlan, renderPlan, rollback, setDefaultRegistry, shapeHash, toNounPhrase, toNounPhraseFromName, traverse, validateEquation, verifyInternalEquations };
