# Plan: Structural Pattern Extractions

## Intent
Four recurring structural patterns were identified through motif discovery and structural analysis. Extractions will reduce code duplication, improve readability, and make the codebase easier to reason about. The invariant-breaking functions are documented as intentional design choices (cross-module calls), not bugs.

---

## Investigation: Call-Graph Invariant Breakers

The equation mining found 5 functions that break the near-invariant `f.inModule = f.calls.definedIn` (i.e., "a function's module matches its callees' definition module"). All 5 are **intentional cross-module calls**, not bugs:

| Function | Module | Cross-module callee | Callee's module |
|---|---|---|---|
| `discoverFiles` | `ingest/project.ts` | `allGlobPatterns` | `ingest/adapter.ts` |
| `ingestChangedFiles` | `ingest/project.ts` | `getForFile` | `ingest/adapter.ts` |
| `runIngestion` | `ingest/project.ts` | `getForFile` | `ingest/adapter.ts` |
| `annotatePathKinds` | `mining/candidates.ts` | `traverse` | `traverse.ts` |
| `evaluateEquationCandidate` | `mining/evaluate.ts` | `traverse` | `traverse.ts` |

**Conclusion:** These are normal — the codebase has legitimate cross-module function calls. No fix needed.

---

## Extraction 1: SessionStore<T> Generic Base (HIGH IMPACT)

### Problem
`MotifSessionStore` and `DomainSessionStore` are near-identical CRUD stores:
- **7 identical methods**: `constructor`, `create`, `get`, `list`, `update`, `delete`, `rowToSession`
- **5 identical properties**: `insertStmt`, `getStmt`, `listStmt`, `updateStmt`, `deleteStmt`
- Differences: table name (`olog_motif_session` vs `olog_domain_session`), `SessionRow` interface (Domain adds `equations_json`), `rowToSession` deserialization, and error message strings

### Plan
Create a generic `SessionStore<RowType, SessionData>` base class in `packages/core/src/store/session-store.ts`:

```
class SessionStore<RowType, SessionData> {
  protected db: Database.Database;
  protected insertStmt: Database.Statement;
  protected getStmt: Database.Statement;
  protected listStmt: Database.Statement;
  protected updateStmt: Database.Statement;
  protected deleteStmt: Database.Statement;

  constructor(db: Database.Database, tableName: string, columns: string[])
  create(data: SessionData): string
  get(id: string): SessionData | null
  list(): SessionData[]
  update(id: string, data: Partial<SessionData>): void
  delete(id: string): void
  protected abstract rowToSession(row: RowType): SessionData
}
```

Then refactor:
- `MotifSessionStore extends SessionStore<MotifSessionRow, MotifSessionData>` — override `rowToSession`
- `DomainSessionStore extends SessionStore<DomainSessionRow, DomainSessionData>` — override `rowToSession`
- `OlogStore` unchanged (it delegates to these stores)

### Olog operations
- `addSymbol` `packages/core/src/store/session-store.ts` `SessionStore` kind `class`

### Implementation slices
1. `write_function_body`: `SessionStore` class — generic base with all CRUD methods
2. `rewrite_body`: `MotifSessionStore` — extend base, remove duplicated code
3. `rewrite_body`: `DomainSessionStore` — extend base, remove duplicated code

### Acceptance criteria
- All existing tests pass unchanged
- `MotifSessionStore` and `DomainSessionStore` each < 30 lines
- No behavioral change to any session API

---

## Extraction 2: LanguageAdapter Configuration Object (MEDIUM IMPACT)

### Problem
`ClojureAdapter` and `TypeScriptAdapter` both implement `LanguageAdapter<Parser>` with:
- **5 identical properties**: `languageId`, `extensions`, `globPattern`, `nodeTypeToKind`, `kindToNodeTypes`
- **5 methods** with genuinely different implementations

The methods differ significantly (Clojure uses shared parser instance, TypeScript creates per-call; `resolveImportSpecifier` logic is entirely different). A base class would add complexity without much deduplication benefit.

### Plan (Revised from original)
Rather than a base class, extract a **LanguageAdapterConfig** data object:

```typescript
export interface LanguageAdapterConfig {
  languageId: string;
  extensions: string[];
  globPattern: string;
  nodeTypeToKind: Record<string, OlogKind>;
  kindToNodeTypes: Record<string, string[]>;
}
```

Adapters can define their config as a constant and spread it:

```typescript
const TS_CONFIG: LanguageAdapterConfig = { ... };

export class TypeScriptAdapter implements LanguageAdapter<Parser> {
  languageId = TS_CONFIG.languageId;
  extensions = TS_CONFIG.extensions;
  // ... methods differ
}
```

This reduces property repetition without forcing a class hierarchy on genuinely different implementations.

### Implementation slices
1. `write_function_body`: `LanguageAdapterConfig` interface in `adapter.ts` — defines the config type
2. `rewrite_body`: `TypeScriptAdapter` — extract config constant
3. `rewrite_body`: `ClojureAdapter` — extract config constant

### Acceptance criteria
- No change to `LanguageAdapter` interface itself
- Both adapters still pass their existing tests
- Config objects are clearly typed and documented

---

## Extraction 3: queryRelatedElements Helper (MEDIUM IMPACT)

### Problem
Three of the five `gather*` functions share a common pattern:
```typescript
// gatherMustCall, gatherMustImplement partial, gatherUsedBy
const arrows = direction === 'outgoing' ? store.outgoing(targetId) : store.incoming(targetId);
const filtered = arrows.filter(a => a.kind === arrowKind);
const results = filtered.flatMap(a => store.getElem(side(a)).filter(Boolean));
```

But the functions differ in important ways:
- `gatherMustImplement` checks **both** outgoing and incoming arrows
- `gatherUsedBy` deduplicates via `Set`
- `gatherImports` uses `store.queryElements` (not `outgoing`/`incoming`)
- `gatherDomainContext` has completely different logic

### Plan
Extract `queryRelatedElements(store, targetId, options)` to encapsulate the common `direction → filter → resolve → map` pipeline:

```typescript
interface QueryOptions {
  direction: 'incoming' | 'outgoing' | 'both';
  arrowKind: string;
  dedup?: boolean;
  mapFn?: (elem: ElemRow, arrow: ArrRow) => T;
}

function queryRelatedElements<T>(
  store: OlogStore,
  targetId: string,
  options: QueryOptions
): T[]
```

Then refactor:
- `gatherMustCall`: 1 call to `queryRelatedElements`
- `gatherUsedBy`: 1 call to `queryRelatedElements` with `dedup: true`
- `gatherMustImplement`: 2 calls (one for outgoing, one for incoming) or 1 call with `direction: 'both'`
- `gatherImports` and `gatherDomainContext`: unchanged (their logic is too different)

### Olog operations
- `addSymbol` `packages/core/src/delegate/context.ts` `queryRelatedElements` kind `function`

### Implementation slices
1. `write_function_body`: `queryRelatedElements` in `context.ts`
2. `rewrite_body`: `gatherMustCall` — use `queryRelatedElements`
3. `rewrite_body`: `gatherUsedBy` — use `queryRelatedElements`
4. `rewrite_body`: `gatherMustImplement` — use `queryRelatedElements`

### Acceptance criteria
- All existing exports remain unchanged
- Test suite passes
- 3 of 5 gather* functions are simplified
- `queryRelatedElements` has unit test coverage

---

## Extraction 4: SourceResolver read* Partial Unification (LOW-MEDIUM IMPACT)

### Problem
7 methods in `SourceResolver` with varying signatures:
- `readSpan(filePath, span)` — parse_span → read_file → line_slice
- `readDeclaration(filePath, span, kind)` — parse_span → read_file → find_declaration
- `readSignature(filePath, span, kind)` — delegates to readDeclaration → trim
- `readBody(filePath, span, kind, maxLines?)` — delegates to readDeclaration → extract_body
- `readImportBlock(filePath)` — read_file → parse_imports
- `readFileContent(filePath, maxLines?)` — read_file → optional_truncate
- `readFocused(filePath, span, ctxBefore?, ctxAfter?)` — parse_span → read_file → window_slice

Common sub-pattern in 4 methods: `parseSpan(span) → this.readFile(filePath) → null-check → process lines`

### Plan (Conservative)
Extract just the common sub-pattern as a private helper, not a full strategy pattern:

```typescript
private requireSource(
  filePath: string,
  span?: string
): { parsed: ParsedSpan | null; source: string; lines: string[] } | null
```

This removes the repeated `parseSpan → readFile → null-check` boilerplate from `readSpan`, `readFocused`, and simplifies error handling in others. The individual methods keep their unique logic.

### Implementation slices
1. `write_function_body`: `requireSource` private method in `SourceResolver`
2. `rewrite_body`: `readSpan` — use `requireSource`
3. `rewrite_body`: `readFocused` — use `requireSource`
4. `rewrite_body`: `readDeclaration` — use `requireSource`

### Acceptance criteria
- All 7 public methods keep their existing signatures
- No behavioral change
- ~20 lines of boilerplate removed

---

## Priority Order

| # | Extraction | Impact | Effort |
|---|---|---|---|
| 1 | SessionStore<T> | High — biggest duplication, ~200 lines removed | Medium |
| 2 | queryRelatedElements helper | Medium — simplifies 3 of 5 gather functions | Small |
| 3 | LanguageAdapterConfig | Medium — cleans up property repetition | Small |
| 4 | SourceResolver requireSource | Low-Medium — removes boilerplate in 3 methods | Small |

## Validation status
- [x] olog_plan created (hash: 4a48d093...)
- [x] olog_validate passed
- [ ] SessionStore<T> slice delegated
- [ ] queryRelatedElements slice delegated
- [ ] LanguageAdapterConfig slice delegated
- [ ] SourceResolver requireSource slice delegated
- [ ] olog_reindex run