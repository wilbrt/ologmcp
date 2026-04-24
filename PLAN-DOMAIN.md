# Domain Modeling System — Implementation Plan

## Problem

The current olog contains only **code-level syntax objects** (functions, files, imports, modules) connected by **structural arrows** (`definedIn`, `inModule`, `calls`, `importsFrom`). These answer IDE-navigation questions like "where is this function?" but cannot answer **domain reasoning questions** like:

- What is an OlogElem and what does it consist of?
- How does Provenance flow from ingestion to query results?
- What is the relationship between a Plan and the Violations that can result from validating it?

The types that define the application's domain (`OlogElem`, `PathEquation`, `IntegrityConstraint`, `Provenance`, etc.) exist in the olog only as `interface` syntax nodes with `definedIn` arrows pointing to files. Their **semantic content** — their fields, their relationships to each other — is invisible.

This conflates the **schema** (what types exist and how they relate) with the **instance** (what functions and files exist). In Spivak's olog formalism, both layers should be modeled and connected.

## Architecture

```
Code-Level Layer (tree-sitter ingestion):
  interface OlogElem ──hasProperty──▶ property "kind"
                                  ──hasProperty──▶ property "name"
  property "kind"    ──hasType──────▶ type OlogKind
  property "provenance" ──hasType──▶ interface Provenance

Domain Layer (discovery + user refinement):
  an Olog Element ──has kind──▶──▶ an Olog Kind
                  ──has provenance──▶ a Provenance
                  ──implemented as──▶ interface OlogElem  (bridge arrow)
```

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Domain object kind | `domain` (new OlogKind) | Distinct from code kinds; enables clean queries |
| Bridge arrow kind | `implementedAs` (new ArrowKind) | Verb phrase connecting domain concept to code implementation |
| Property element kind | `property` (new OlogKind) | First-class; queryable by any tool |
| Property arrows | `hasProperty` + `hasType` (new ArrowKinds) | interface ──hasProperty──▶ property ──hasType──▶ type reference |
| Primitives in domain model | No | Only arrows between domain concepts |
| Discovery input | Olog queries, not source re-parsing | Properties extracted during ingestion; discovery reads from olog |
| Storage | Same SQLite database | Domain objects use existing tables, distinguished by kind |
| Session storage | New `olog_domain_session` table | Persists across MCP server restarts |
| Provenance source | Add `llm` as valid value | For domain objects proposed by LLM sessions |
| Discovery scope | User chooses per session (moduleRegex) | Prevents overwhelming discovery |
| Discovery candidates | All project-defined types, user filters | Inclusive but with refinement |
| Source CHECK constraint | Remove from `olog_prov` | Can't ALTER in SQLite; validation is application-level |

## New Element and Arrow Kinds

### OlogKind additions

- **`property`** — A field/property of an interface, type, or class. `attrs: { typeText: string, optional: boolean, readonly: boolean }`
- **`domain`** — A domain concept created during domain modeling sessions. Named with noun phrases (e.g., "an Olog Element").

### ArrowKind additions

- **`hasProperty`** — From an interface/type/class to a property element. Total: every property belongs to one type.
- **`hasType`** — From a property element to a type reference that exists in the olog. Only created when the referenced type is a project-defined element or resolved import. Not total.
- **`implementedAs`** — From a domain object to a code-level element. Bridges domain layer to syntax layer.

## Property Extraction Design

### Why extraction during ingestion, not during discovery?

Field structure (which properties an interface has, and what types they reference) is **syntactic, objective fact** — precisely what tree-sitter should extract during ingestion. The domain discovery tool then **queries the olog** to propose concepts, not re-parses files. This means:

- Property data is always up-to-date after re-ingestion
- Any tool can query "what fields does OlogElem have?" via `hasProperty` arrows
- Domain discovery has no dependency on source file access

### How tree-sitter extracts properties

Rather than a single `.scm` query (which has known issues with repeated captures), we use a **two-phase approach**:

**Phase 1** (existing): The current `ts.scm` query extracts interface/type/class declarations with their names.

**Phase 2** (new): For each interface/type/class element found in Phase 1, use `findEnclosingDeclaration` to locate the AST node, then walk its children to extract `property_signature` nodes.

For each property:
- `name`: from `childForFieldName('name')`
- `optional`: check for `?` child node
- `readonly`: check for `readonly` modifier
- `typeText`: full text of the `type_annotation` child
- `typeRefs`: all `type_identifier` descendants within the type annotation (e.g., `OlogKind`, `Provenance`)
- `span`: formatted from node positions

Tree-sitter correctly handles:
- Simple types: `kind: OlogKind` → typeRefs `["OlogKind"]`
- Union types: `provenance: Provenance | null` → typeRefs `["Provenance"]`
- Array types: `operations: PlanOperation[]` → typeRefs `["PlanOperation"]`
- Nested object types: `{ equations: PathEquation[]; constraints: IntegrityConstraint[] }` → typeRefs `["PathEquation", "IntegrityConstraint"]`
- Primitives: `name: string` → typeRefs `[]` (no `type_identifier` nodes)

### Type reference resolution

For each `typeRef` found in a property's type annotation:
1. Check if the name matches any element in the current file's name-to-id map → create `hasType` arrow
2. Check if it matches an import in the current file → resolve via `importsFrom` arrow → create `hasType` arrow
3. Neither → skip the `hasType` arrow (external/primitive type); `attrs.typeText` preserves the information

### Property element IDs

Format: `module:{relativePath}:{line}:{col}:property:{ParentName}.{fieldName}`

Example: `module:packages/core/src/ontology.ts:54:5:property:OlogElem.kind`

The `ParentName.fieldName` naming ensures uniqueness while making properties discoverable by name.

## File Changes

### 1. `packages/core/src/ontology.ts`

Add to `OlogKind` union:
```
| 'property'
| 'domain'
```

Add to `ArrowKind` union:
```
| 'hasProperty'
| 'hasType'
| 'implementedAs'
```

### 2. `packages/core/src/schema.sql`

Add `olog_domain_session` table:
```sql
CREATE TABLE IF NOT EXISTS olog_domain_session (
  id              TEXT PRIMARY KEY,
  status          TEXT NOT NULL CHECK (status IN ('active', 'committed', 'abandoned')),
  scope_regex     TEXT,
  candidates_json TEXT NOT NULL CHECK (json_valid(candidates_json)),
  equations_json  TEXT CHECK (json_valid(equations_json)),
  commit_sha      TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_domain_session_status ON olog_domain_session(status);
```

Remove CHECK constraint from `olog_prov`:
- Change `CHECK (source IN ('tree-sitter','lsp','manual','heuristic','other'))` to no constraint
- This requires a migration in `db.ts` that recreates the table for existing databases (SQLite doesn't support ALTER CONSTRAINT)

### 3. `packages/core/src/ingest/treesitter.ts`

Add `extractPropertiesFromFile` function:

```typescript
export interface PropertyExtract {
  name: string;
  span: string;
  typeText: string;
  optional: boolean;
  readonly: boolean;
  typeRefs: string[];
  parentName: string;
  parentKind: string;
}

export function extractPropertiesFromFile(
  parser: Parser,
  source: string,
  moduleName: string,
): PropertyExtract[]
```

Implementation:
1. Parse source with tree-sitter
2. Walk the AST to find `interface_declaration`, `type_alias_declaration`, `class_declaration` nodes
3. For each, get the name via `childForFieldName('name')`
4. Walk the body/children to find `property_signature` nodes (for interfaces/types) or `property_declaration`/`public_field_definition` nodes (for classes)
5. For each property:
   - `name`: `childForFieldName('name').text`
   - `optional`: check for `?` child
   - `readonly`: check for `readonly` modifier child
   - `typeText`: `childForFieldName('type').text`
   - `typeRefs`: collect all `type_identifier` descendants within the type annotation
   - `span`: formatted from node positions
   - `parentName`: name of the containing declaration
   - `parentKind`: mapped from node type

For type aliases that are union types (like `OlogKind`, `ArrowKind`), don't extract properties — they have no fields.

For type aliases that are object types (like `PlanOperation`), walk the object type's property signatures.

For classes, focus on explicitly declared properties (not methods, which are already captured as `method` elements).

### 4. `packages/core/src/ingest/project.ts`

After the main element/arrow extraction loop, add a property extraction pass:

```
For each file that was processed:
  1. Collect all interface/type/class elements from nameToId
  2. Call extractPropertiesFromFile(parser, source, relativePath)
  3. For each PropertyExtract:
     a. Create a 'property' element:
        id = elemId(relativePath, line, col, 'property', parentName + '.' + name)
        kind = 'property'
        attrs = { typeText, optional, readonly }
     b. Create 'hasProperty' arrow from parent → property
     c. For each typeRef that resolves to an element in the olog:
        - Check nameToId map for same-file matches
        - Check imports for cross-file matches
        - If found, create 'hasType' arrow from property → that element
```

### 5. `packages/core/src/domain/types.ts` (NEW)

```typescript
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
  total: boolean;
  source: 'field' | 'method' | 'type_ref';
  confidence: 'resolved' | 'unresolved' | 'tentative';
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
```

### 6. `packages/core/src/domain/discover.ts` (NEW)

Core discovery function — reads from the olog:

```typescript
export function discoverDomainCandidates(
  store: OlogStore,
  options?: DiscoveryOptions,
): DomainCandidate[]
```

Algorithm:
1. Query store for all `interface`, `type`, `class` elements
2. Filter by `scopeRegex` (if provided) and exclude external modules (`node:`, package imports)
3. For each type element:
   a. Generate noun-phrase name via `toNounPhrase(element.name)`
   b. Follow `hasProperty` arrows from this element
   c. For each property:
      - Follow `hasType` arrows to find referenced types
      - If a type reference resolves to another project-defined element → propose arrow
      - If primitive (no `hasType` arrow) → skip
      - If optional → `total: false`
      - If array type → `total: false` (many-valued)
   d. Generate bridge arrow: `<domain name> --implementedAs--> <code element>`
   e. Generate clarifying questions for ambiguous cases:
      - Union types of string literals
      - Optional fields
      - Generic containers like `Record<string, unknown>`
      - Type aliases vs interfaces
4. Return sorted candidates (exported/widely-referenced first)

```typescript
export function toNounPhrase(pascalName: string): string
```

Rules:
- Split PascalCase into words: `OlogElem` → `["Olog", "Elem"]`
- Map common abbreviations: `Elem` → `Element`, `Arr` → `Arrow`, `Prov` → `Provenance`, `Val` → `Value`
- Join with article: `["Olog", "Element"]` → `an Olog Element` (vowel start → `an`)
- Single words: `Plan` → `a Plan`, `Path` → `a Path`

```typescript
export function isExternalModule(module: string | null, excludeModules?: string[]): boolean
```

Returns true if module starts with `node:`, matches an exclude pattern, or is null.

### 7. `packages/core/src/domain/session.ts` (NEW)

```typescript
export class DomainSessionStore {
  constructor(private db: Database.Database) {}

  create(data: {
    scopeRegex?: string;
    candidates: DomainCandidate[];
    equations: ProposedEquation[];
    commitSha: string;
  }): string

  get(id: string): DomainSessionData | null
  list(): DomainSessionData[]
  update(id: string, data: Partial<DomainSessionData>): void
  delete(id: void
}
```

Uses the same database instance as `OlogStore`. Prepared statements for performance.

### 8. `packages/core/src/db.ts`

Changes:
- Add migration to remove `olog_prov.source` CHECK constraint (recreate table for existing DBs)
- Execute `olog_domain_session` table creation in the constructor
- Add `DomainSessionStore` as a property: `this.sessions = new DomainSessionStore(this.db)`
- Expose `get sessionStore(): DomainSessionStore` accessor

The migration for removing the CHECK constraint:
```sql
-- Only run if the old CHECK exists
CREATE TABLE IF NOT EXISTS olog_prov_new (
  elem_id      TEXT NOT NULL,
  source       TEXT NOT NULL,
  commit_sha   TEXT NOT NULL,
  ingested_at  INTEGER NOT NULL,
  confidence   TEXT NOT NULL DEFAULT 'resolved',
  PRIMARY KEY (elem_id, source, commit_sha),
  FOREIGN KEY (elem_id) REFERENCES olog_elem(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

INSERT INTO olog_prov_new SELECT elem_id, source, commit_sha, ingested_at, confidence FROM olog_prov;
DROP TABLE olog_prov;
ALTER TABLE olog_prov_new RENAME TO olog_prov;
CREATE INDEX IF NOT EXISTS idx_prov_elem_id ON olog_prov(elem_id);
```

### 9. `packages/core/src/constraints.ts`

Update `isSchemaElement` to handle `kind === 'domain'` and `kind === 'property'`:

```typescript
function isSchemaElement(elem: OlogElem): string | null {
  if (elem.kind === 'domain') return 'domain';
  if (elem.kind === 'property') return 'property';
  const schemaKind = (elem.attrs as Record<string, unknown> | null)?.schemaKind;
  if (typeof schemaKind === 'string') return schemaKind;
  if (elem.kind === 'other' && elem.module === null && elem.span === null) {
    const match = elem.name.match(/^(?:a|an)\s+(\S+)/);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}
```

### 10. `packages/core/src/mining/index.ts`

Add to `ALL_ARROW_KINDS`:
```
'hasProperty', 'hasType', 'implementedAs'
```

Add to `DEFAULT_ELEMENT_KINDS`:
```
'domain', 'property'
```

### 11. `packages/core/src/index.ts`

Add exports:
```typescript
export { discoverDomainCandidates, toNounPhrase, isExternalModule } from './domain/discover.js';
export type { DomainCandidate, ArrowProposal, DomainSessionData, ProposedEquation, DiscoveryOptions } from './domain/types.js';
export { DomainSessionStore } from './domain/session.js';
export { extractPropertiesFromFile, type PropertyExtract } from './ingest/treesitter.js';
```

### 12. `packages/mcp-server/src/tools/olog-domain-discover.ts` (NEW)

Single MCP tool `olog_domain_discover` with three actions:

**`action: 'start'`**
```typescript
inputSchema: z.object({
  action: z.literal('start'),
  scopeRegex: z.string().optional(),
  excludeModules: z.array(z.string()).optional(),
})
```
- Calls `discoverDomainCandidates(store, options)`
- Creates a `DomainSessionData` in SQLite
- Returns `{ sessionId, candidates, questions }`

**`action: 'refine'`**
```typescript
inputSchema: z.object({
  action: z.literal('refine'),
  sessionId: z.string(),
  responses: z.array(z.object({
    candidateId: z.string(),
    status: z.enum(['accepted', 'rejected', 'deferred']),
    nameOverride: z.string().optional(),
    arrowOverrides: z.array(z.object({
      arrowId: z.string(),
      status: z.enum(['accepted', 'rejected', 'modified']),
      newName: z.string().optional(),
      totalOverride: z.boolean().optional(),
    })).optional(),
  })),
})
```
- Updates candidates in the session based on user decisions
- Removes arrows that reference rejected candidates
- Returns updated `{ candidates, questions }`

**`action: 'commit'`**
```typescript
inputSchema: z.object({
  action: z.literal('commit'),
  sessionId: z.string(),
  provenance: z.object({
    source: z.enum(['manual', 'llm']),
    commitSha: z.string(),
    confidence: z.enum(['resolved', 'unresolved', 'tentative']),
  }),
})
```
- For each accepted candidate:
  - `store.addElement()` with `kind='domain'`, `name=proposedName`, `module=null`, `span=null`
  - `store.addProvenance()` with the provided provenance
- For each accepted arrow proposal:
  - Resolve domain/codomain names to element IDs
  - `store.addArrow()` with the arrow kind from the proposal name
- For each bridge arrow:
  - `store.addArrow()` with `kind='implementedAs'`
- Marks session as `committed`
- Returns `{ addedObjects, addedArrows, addedBridges }`

### 13. `packages/mcp-server/src/index.ts`

- Import `registerOlogDomainDiscover`
- Call `registerOlogDomainDiscover(server, store)`
- Update instructions string to mention `olog_domain_discover`

## Example Output

Running domain discovery with `scopeRegex: "packages/core/src/ontology.ts"` would propose:

**Domain Objects:**

| Proposed Name | Source Element | Kind |
|---|---|---|
| an Olog Element | `interface OlogElem` | domain |
| an Olog Arrow | `interface OlogArr` | domain |
| an Olog Kind | `type OlogKind` | domain |
| an Arrow Kind | `type ArrowKind` | domain |
| a Confidence Level | `type ConfidenceLevel` | domain |
| a Provenance | `interface Provenance` | domain |
| a Path | `interface Path` | domain |
| a Path Equation | `interface PathEquation` | domain |
| a Constraint Kind | `type ConstraintKind` | domain |
| an Integrity Constraint | `interface IntegrityConstraint` | domain |
| a Plan | `interface Plan` | domain |
| a Plan Operation | `type PlanOperation` | domain |
| a Validation Result | `interface ValidationResult` | domain |

**Proposed Arrows (from hasProperty + hasType):**

| Arrow | Domain → Codomain | Source | Total |
|---|---|---|---|
| has kind | an Olog Element → an Olog Kind | `OlogElem.kind` | yes |
| has provenance | an Olog Element → a Provenance | `OlogElem.provenance` (nullable) | no |
| has source | an Olog Arrow → an Olog Element | `OlogArr.srcId` | yes |
| has target | an Olog Arrow → an Olog Element | `OlogArr.dstId` | yes |
| has kind | an Olog Arrow → an Arrow Kind | `OlogArr.kind` | yes |
| has left-hand side | a Path Equation → a Path | `PathEquation.lhs` | yes |
| has right-hand side | a Path Equation → a Path | `PathEquation.rhs` | yes |
| has provenance | a Path Equation → a Provenance | `PathEquation.provenance` (nullable) | no |
| has kind | an Integrity Constraint → a Constraint Kind | `IntegrityConstraint.kind` | yes |
| has provenance | an Integrity Constraint → a Provenance | `IntegrityConstraint.provenance` (nullable) | no |
| has confidence | a Provenance → a Confidence Level | `Provenance.confidence` | yes |
| consists of | a Plan → a Plan Operation | `Plan.operations` (array) | no |

**Bridge Arrows (`implementedAs`):**

| Domain Object | Code Element |
|---|---|
| an Olog Element | `interface OlogElem` |
| an Olog Arrow | `interface OlogArr` |
| an Olog Kind | `type OlogKind` |
| an Arrow Kind | `type ArrowKind` |
| a Provenance | `interface Provenance` |
| a Path | `interface Path` |
| a Path Equation | `interface PathEquation` |
| a Constraint Kind | `type ConstraintKind` |
| an Integrity Constraint | `interface IntegrityConstraint` |
| a Plan | `interface Plan` |
| a Plan Operation | `type PlanOperation` |
| a Validation Result | `interface ValidationResult` |

**Clarifying Questions:**

1. "`OlogKind` is a type alias for a union of 14 string literals. Should it become a domain concept (an Olog Kind), or should each value be a separate domain object?"

2. "`ArrowKind` is similarly a union of 19 string literals. Same question."

3. "The field `operations: PlanOperation[]` is an array. The arrow `consists of: a Plan → a Plan Operation` would be many-valued. Should a Plan Operation be reified with an `occurs in` arrow pointing back to a Plan?"

4. "`attrs: Record<string, unknown>` on `OlogElem` and `OlogArr` is a generic container. Should individual attributes be modeled as separate domain arrows?"

5. "`ConfidenceLevel` is a union of three string literals. Should this be a domain concept with three instances, or a value set?"

## Implementation Order

| Step | File | What | Dependencies |
|------|------|------|-------------|
| 1 | `packages/core/src/ontology.ts` | Add `'property'`, `'domain'` to `OlogKind`; `'hasProperty'`, `'hasType'`, `'implementedAs'` to `ArrowKind` | None |
| 2 | `packages/core/src/schema.sql` | Add `olog_domain_session` table; remove `olog_prov` source CHECK | None |
| 3 | `packages/core/src/ingest/treesitter.ts` | Add `extractPropertiesFromFile` + `PropertyExtract` type | Step 1 |
| 4 | `packages/core/src/ingest/project.ts` | Add property extraction pass after main ingestion loop | Steps 1, 3 |
| 5 | `packages/core/src/domain/types.ts` | Define domain modeling types | Step 1 |
| 6 | `packages/core/src/domain/discover.ts` | `discoverDomainCandidates`, `toNounPhrase`, `isExternalModule` | Steps 1, 5 |
| 7 | `packages/core/src/domain/session.ts` | `DomainSessionStore` with SQLite persistence | Steps 2, 5 |
| 8 | `packages/core/src/db.ts` | Add session table DDL, source constraint migration, expose session store | Steps 2, 7 |
| 9 | `packages/core/src/constraints.ts` | Update `isSchemaElement` for `domain` and `property` kinds | Step 1 |
| 10 | `packages/core/src/mining/index.ts` | Add new kinds to defaults | Step 1 |
| 11 | `packages/core/src/index.ts` | Export new domain types and functions | Steps 6, 7 |
| 12 | `packages/mcp-server/src/tools/olog-domain-discover.ts` | MCP tool with start/refine/commit actions | Steps 6, 7, 11 |
| 13 | `packages/mcp-server/src/index.ts` | Register tool, update instructions | Step 12 |

## Follow-Up: Syntax-Level Arrow Cleanup

After the domain modeling system is in place, the syntax-level arrows should be cleaned up separately:

1. **Remove `calls`/`callerOf` redundancy** — They are identical at 100% coverage. Keep `calls` only. Reify call sites as `callsite` elements with `has caller` and `has callee` arrows.

2. **Collapse location arrows** — Keep `definedIn: a Symbol → a File`. Fix `inModule` to point to `a Module` instead of `a File` or remove it. Remove `locatedIn` if semantically identical to `definedIn`.

3. **Remove or populate `repository of`** — Either populate it for all modules or remove the dead test arrows.

4. **Rename arrows as verb phrases** — `callerOf` → `has caller`, `calleeOf` → `has callee`, `memberOf` → `is a member of`.