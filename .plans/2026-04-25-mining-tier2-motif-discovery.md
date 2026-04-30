# Plan: Mining Tier 2 — Motif Discovery

## Intent

Implement the motif discovery pipeline: ego-graph extraction, shape abstraction, frequency grouping, and optional internal equation verification. Motifs are recurring structural patterns in the olog graph (formally: strongly meaningful functors from a small template olog to the codebase olog). This is patterned after the existing domain discovery system (start → refine → commit session model) and persisted via new SQLite tables. The tool should accept existing olog equations as constraints and also be able to mine fresh equations for internal motif verification.

## Olog operations

- addSymbol `packages/core/src/mining/motifs.ts` kind `file`
- addSymbol `packages/core/src/mining/session.ts` kind `file`
- addSymbol `packages/core/src/mining/types.ts` kind `file`
- addSymbol `packages/core/src/mining/ego.ts` kind `file`
- addSymbol `packages/core/src/mining/shape.ts` kind `file`
- addSymbol `packages/core/src/mining/group.ts` kind `file`
- addSymbol `packages/mcp-server/src/tools/olog-discover-motifs.ts` kind `file`

(These are new files that will be created. The olog operations above represent the structural intent; actual implementation will be coordinated via `@edit` delegation.)

## Invariants to preserve

- `mineEquations` must remain unchanged — Tier 2 calls it as a subroutine, not replaces it
- `OlogStore` schema is additive only (new tables, no mutation of existing tables)
- `olog_domain_discover` session model is the template — motif discovery must follow the same start/refine/commit pattern
- Arrow kinds in `OlogKind` / `ArrowKind` are not extended — motifs use existing element and arrow kinds
- `InMemoryGraph` and `PathResultCache` from Tier 1 are reused, not duplicated

## Implementation milestones

### Milestone 1: Types and Session Store

New files:
1. `core/mining/types.ts` — `MotifTemplate`, `MotifInstance`, `MotifCandidate`, `MotifSessionData`, `MotifDiscoveryOptions`
2. `core/mining/session.ts` — `MotifSessionStore` (mirrors `DomainSessionStore`): `create`, `get`, `list`, `update`, `delete`, `rowToSession`
3. `core/db.ts` — Add `olog_motif_session` table DDL to constructor; expose `sessionStore` accessor (parallel to `sessions`)

### Milestone 2: Ego-Graph Extraction and Shape Abstraction

4. `core/mining/ego.ts` — `extractEgoGraph(store, seedId, depth, arrowKinds?)`: Given a seed element, expand N hops along outgoing arrows. Returns the induced subgraph (elements + arrows). Reuses `InMemoryGraph` from `graph.ts`.
5. `core/mining/shape.ts` — `abstractToShape(egoGraph)`: Replace concrete element IDs with their kinds, producing a canonical shape template. Arrow labels are preserved. Two ego-graphs produce the same shape iff they are structurally isomorphic (same kind DAG, same arrow labels).

### Milestone 3: Grouping and Equation Verification

6. `core/mining/group.ts` — `groupEgoGraphs(egoGraphs, minSupport)`: Group ego-graphs by shape hash, count instances per shape, filter by minSupport (default 3). For each surviving shape, optionally run Tier 1 `mineEquations` restricted to the instances (using `touchingElementKinds` to scope it), attaching discovered equations as internal invariants.
7. `core/mining/motifs.ts` — `discoverMotifs(store, options)`: Orchestrates the full pipeline: seed selection → ego extraction → shape abstraction → grouping → equation verification → candidate scoring. Returns `MotifCandidate[]` ready for a session.

### Milestone 4: MCP Tool and Session Wiring

8. `mcp-server/tools/olog-discover-motifs.ts` — MCP tool `olog_discover_motifs` with three actions:
   - `action=start`: Calls `discoverMotifs`, creates session, returns candidates
   - `action=refine`: Accepts/rejects/renames candidates, updates session
   - `action=commit`: Writes accepted motif templates + instances to olog tables + session tables, marks session committed
   - `action=list` / `action=get`: Session introspection
9. `mcp-server/index.ts` — Register `registerOlogDiscoverMotifs(server, store)`
10. `core/index.ts` — Export new types and functions

### Milestone 5: Schema and Persistence

11. `core/db.ts` — Add two new tables:
    - `olog_motif_template`: `id`, `name`, `description`, `shape_json`, `equations_json`, `provenance_json`, `created_at`
    - `olog_motif_instance`: `id`, `template_id`, `mappings_json`, `provenance_json`, `created_at`
    - `olog_motif_session`: `id`, `status`, `scope_regex`, `candidates_json`, `commit_sha`, `created_at`, `updated_at`

## Acceptance criteria

1. `discoverMotifs` produces motif candidates with support counts when run on the current olog (715 elements)
2. The start/refine/commit flow works identically to `olog_domain_discover`
3. Accepted motifs are persisted across server restarts
4. Existing `mineEquations` (Tier 1) is not modified and continues to work independently
5. Internal equation verification uses existing `mineEquations` with `touchingElementKinds` scoping
6. The MCP tool is registered and usable via `olog_discover_motifs` with actions `start`, `refine`, `commit`, `list`, `get`
7. No new OlogKind or ArrowKind values are introduced

## Validation status

[x] olog_plan created (hash: 21a9d740cdd58af88ac2f0e022f9e39f89da312c32a59f51efe01532e70170ec)
[x] olog_validate passed
[x] Milestone 1 completed (types, session store, db accessor)
[x] Milestone 2 completed (ego-graph extraction, shape abstraction)
[x] Milestone 3 completed (grouping, equation verification, discoverMotifs)
[x] Milestone 4 completed (MCP tool, wiring, exports)
[x] Milestone 5 completed (template/instance tables, persistence methods)
[x] olog_reindex run

## Detailed Design

### Types (`core/mining/types.ts`)

```typescript
/** A shape template: an abstract motif olog with kind-abstracted objects and arrow labels. */
export interface MotifShape {
  /** Shape hash for fast grouping (deterministic hash of object kinds + arrow labels + topology). */
  hash: string;
  /** Ordered list of object slots, each identified by a role label and element kind. */
  objects: Array<{ role: string; kind: string }>;
  /** Ordered list of arrow slots: from → to by label. */
  arrows: Array<{ fromRole: string; label: string; toRole: string }>;
}

/** A motif candidate produced by discovery, ready for user review. */
export interface MotifCandidate {
  id: string;
  /** The canonical shape of this motif. */
  shape: MotifShape;
  /** Human-readable name (auto-generated or user-overridden). */
  proposedName: string;
  /** Description of what structural pattern this motif captures. */
  description: string;
  /** Number of concrete instances found in the olog. */
  support: number;
  /** Concrete instances: element ID mappings from shape roles to real elements. */
  instances: Array<{
    id: string;
    mappings: Record<string, string>; // role → element ID
    module: string | null; // module of the seed element for grouping
  }>;
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

export interface MotifDiscoveryOptions {
  /** Element kinds to use as seeds (default: ['function', 'class', 'interface']). */
  seedKinds?: string[];
  /** Ego-graph expansion depth (default: 2). */
  depth?: number;
  /** Arrow kinds to follow during expansion (default: all in use). */
  arrowKinds?: ArrowKind[];
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

export interface MotifSessionData {
  id: string;
  status: 'active' | 'committed' | 'abandoned';
  scopeRegex: string | null;
  candidates: MotifCandidate[];
  commitSha: string;
  createdAt: number;
  updatedAt: number;
}
```

### Ego-Graph (`core/mining/ego.ts`)

```typescript
export interface EgoGraph {
  seedId: string;
  seedKind: string;
  elements: Map<string, { id: string; kind: string; name: string }>;
  arrows: Array<{ srcId: string; kind: string; dstId: string }>;
}

/** Expand N hops from a seed element, collecting the induced subgraph. */
export function extractEgoGraph(
  graph: InMemoryGraph,
  seedId: string,
  depth: number,
  arrowKinds?: ArrowKind[],
): EgoGraph
```

### Shape Abstraction (`core/mining/shape.ts`)

```typescript
/** Produce a canonical shape from an ego graph. Two ego-graphs produce the same shape
 *  iff their kind DAGs and arrow labels are isomorphic. */
export function abstractToShape(ego: EgoGraph): MotifShape

/** Deterministic hash of a shape for fast grouping. */
export function shapeHash(shape: MotifShape): string
```

Algorithm:
1. Collect all elements in the ego-graph, keyed by ID
2. For each element, create a role slot: `{ role: kind + "_" + index, kind }`
3. For each arrow, create an arrow slot: `{ fromRole, label, toRole }`
4. To canonicalize: sort objects by `(kind, role)`, sort arrows by `(fromRole, label, toRole)`
5. Hash the canonical JSON string

### Grouping (`core/mining/group.ts`)

```typescript
export interface ShapeGroup {
  shape: MotifShape;
  instances: EgoGraph[];
  support: number;
}

/** Group ego-graphs by shape, filter by minimum support. */
export function groupEgoGraphs(
  egos: EgoGraph[],
  minSupport: number,
): ShapeGroup[]

/** Optionally mine equations within a shape group, scoped to the instances. */
export function verifyInternalEquations(
  store: OlogStore,
  group: ShapeGroup,
  options?: Partial<MiningOptions>,
): Array<{ lhsPath: string[]; rhsPath: string[]; coverage: number }>
```

### Discovery Orchestrator (`core/mining/motifs.ts`)

```typescript
/** Full motif discovery pipeline. */
export function discoverMotifs(
  store: OlogStore,
  options?: MotifDiscoveryOptions,
): MotifCandidate[]
```

Algorithm:
1. Load `InMemoryGraph` (reuse from Tier 1)
2. Select seed elements by `seedKinds`, filtered by `scopeRegex`/`excludeModules`
3. For each seed, `extractEgoGraph(graph, seedId, depth, arrowKinds)`
4. For each ego, `abstractToShape(ego)`
5. `groupEgoGraphs(egos, minSupport)` → `ShapeGroup[]`
6. For each group with support ≥ minSupport:
   a. Build a `MotifCandidate` with auto-generated name and description
   b. If `mineEquations`, run `verifyInternalEquations(store, group, options.equationOptions)`
   c. Attach equations to the candidate
   d. Generate clarifying questions (e.g., "this motif has 3 arrow kinds; consider naming them")
7. Sort candidates by support (descending)
8. Return candidates

### Session Store (`core/mining/session.ts`)

Mirrors `DomainSessionStore` exactly:

```typescript
export class MotifSessionStore {
  constructor(private db: Database.Database) {}
  create(data: { scopeRegex?: string; candidates: MotifCandidate[]; commitSha: string }): string
  get(id: string): MotifSessionData | null
  list(): MotifSessionData[]
  update(id: string, data: Partial<MotifSessionData>): void
  delete(id: string): void
}
```

Table DDL:
```sql
CREATE TABLE IF NOT EXISTS olog_motif_session (
  id              TEXT PRIMARY KEY,
  status          TEXT NOT NULL CHECK (status IN ('active', 'committed', 'abandoned')),
  scope_regex     TEXT,
  candidates_json TEXT NOT NULL CHECK (json_valid(candidates_json)),
  commit_sha      TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS olog_motif_template (
  id              TEXT NOT NULL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  shape_json      TEXT NOT NULL CHECK (json_valid(shape_json)),
  equations_json  TEXT CHECK (json_valid(equations_json)),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  created_at      INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS olog_motif_instance (
  id              TEXT NOT NULL PRIMARY KEY,
  template_id     TEXT NOT NULL,
  mappings_json   TEXT NOT NULL CHECK (json_valid(mappings_json)),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (template_id) REFERENCES olog_motif_template(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS ix_motif_template_name ON olog_motif_template(name);
CREATE INDEX IF NOT EXISTS ix_motif_instance_template ON olog_motif_instance(template_id);
```

### MCP Tool (`mcp-server/tools/olog-discover-motifs.ts`)

Three actions mirroring `olog_domain_discover`:

**`start`**: Takes `scopeRegex`, `excludeModules`, `seedKinds`, `depth`, `minSupport`, `mineEquations`, `equationOptions`. Calls `discoverMotifs()`, creates session, returns `{ sessionId, candidates, questions }`.

**`refine`**: Takes `sessionId`, `responses[]` (each with `candidateId`, `status`, optional `nameOverride`, `arrowOverrides`). Updates session, returns updated `{ candidates, questions }`.

**`commit`**: Takes `sessionId`, `provenance`. Writes:
  - Accepted motif templates → `olog_motif_template` rows
  - Accepted motif instances → `olog_motif_instance` rows
  - Accepted equations (from internal verification) → via `olog_propose_schema`
  - Marks session as `committed`

**`list`** / **`get`**: Session introspection (consistent with domain discover).

### Integration with `core/index.ts`

```typescript
export { discoverMotifs } from './mining/motifs.js';
export type { MotifCandidate, MotifShape, MotifDiscoveryOptions, MotifSessionData } from './mining/types.js';
export { MotifSessionStore } from './mining/session.js';
export { extractEgoGraph, type EgoGraph } from './mining/ego.js';
export { abstractToShape, shapeHash } from './mining/shape.js';
export { groupEgoGraphs, verifyInternalEquations, type ShapeGroup } from './mining/group.js';
```

### Integration with `core/db.ts`

In the `OlogStore` constructor, after existing table creation:
```typescript
this.db.exec(`
  CREATE TABLE IF NOT EXISTS olog_motif_session ( ... );
  CREATE TABLE IF NOT EXISTS olog_motif_template ( ... );
  CREATE TABLE IF NOT EXISTS olog_motif_instance ( ... );
  CREATE INDEX IF NOT EXISTS ix_motif_template_name ON olog_motif_template(name);
  CREATE INDEX IF NOT EXISTS ix_motif_instance_template ON olog_motif_instance(template_id);
`);
this.#motifSessions = new MotifSessionStore(this.db);
```

Add accessor:
```typescript
get motifSessions(): MotifSessionStore { return this.#motifSessions; }
```