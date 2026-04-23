# olog MCP Server — MVP Build Plan

## TL;DR

> **Quick Summary**: Build an MCP server that exposes a typed, queryable structural model (ontology log) of a TypeScript codebase. Uses tree-sitter for syntactic ingestion, SQLite for persistence, and the MCP protocol (stdio) for tool access. The core engine is packaged separately so future consumers (opencode plugin, CLI) can reuse it.
> 
> **Deliverables**:
> - `packages/core` — Tree-sitter ingestion, SQLite store, ontology types, query logic
> - `packages/mcp-server` — MCP server shell with 4 tools via stdio transport
> - Monorepo scaffolding (package.json workspaces, tsconfig, tsup build)
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Scaffolding → Core (ingestion + store) → MCP Server (tools + wiring)

---

## Context

### Original Request
User wants to create an MCP server based on the Shadow-olog design from `plan.md` (a 1420-line implementation guide). The strategic shift: build the MCP server first, so any MCP client can consume it. The opencode plugin comes later as a thin consumer.

### Interview Summary
**Key Discussions**:
- Scope: MVP — tree-sitter + SQLite + query tools only. LSP deferred.
- Runtime: Node.js throughout (NOT Bun — native tree-sitter doesn't work with Bun)
- SQLite: better-sqlite3 instead of bun:sqlite
- Transport: stdio (standard for local dev tool MCP servers)
- Project root: process.cwd() with optional OLOG_ROOT env var override
- Ingestion: Auto on server startup + manual olog_reindex tool
- Language: TypeScript/TSX only
- Data exposure: Tools only (no MCP resources or prompts)
- Tests: No automated unit/integration tests — QA via agent-executed scenarios

**Research Findings**:
- MCP SDK v1.29.0: `McpServer` high-level API, `StdioServerTransport`, Zod input validation
- Tool registration: `server.registerTool(name, {description, inputSchema, annotations}, handler)`
- better-sqlite3: No `db.query<T>()` — must use `db.prepare().all()/.get()/.run()`. Transaction API similar to bun:sqlite.
- Production MCP patterns: Module separation, separate schema from handler, structured logging to stderr

### Metis Review
**Identified Gaps** (all addressed):
- Tool surface undefined → Frozen to 4 tools: olog_query, olog_inspect, olog_dump, olog_reindex
- Element ID generation missing → Deterministic: `module:relative/path:line:col:kind:name`
- Arrow ID generation missing → Deterministic: `src_id:kind:dst_id`
- better-sqlite3 not drop-in for bun:sqlite → db.query<T>() replaced with db.prepare().all()
- No build tooling decided → tsup for bundling, tsc --noEmit for type checking, tsx for dev
- Auto-ingestion on first use causes timeout → Changed to ingest on server startup
- No startup checks → Added SQLite version check, directory creation, parser validation
- No graceful shutdown → Added SIGINT/SIGTERM handlers with WAL checkpoint

---

## Work Objectives

### Core Objective
Build a working MCP server that parses a TypeScript codebase with tree-sitter, persists structural elements and arrows in SQLite, and exposes query/inspect/dump/reindex tools via the MCP stdio protocol.

### Concrete Deliverables
- `packages/core/src/ontology.ts` — Element, Arrow, Attr type definitions
- `packages/core/src/schema.sql` — SQLite DDL (5 tables)
- `packages/core/src/db.ts` — OlogStore class wrapping better-sqlite3
- `packages/core/src/ingest/treesitter.ts` — Tree-sitter parser factory
- `packages/core/src/ingest/extract.ts` — Query runner + element/arrow extraction
- `packages/core/src/ingest/queries/ts.scm` — TypeScript tree-sitter queries
- `packages/core/src/ingest/queries/tsx.scm` — TSX tree-sitter queries
- `packages/core/src/ingest/project.ts` — File discovery + project-wide ingestion orchestrator
- `packages/core/src/index.ts` — Re-exports
- `packages/mcp-server/src/index.ts` — MCP server entry point with startup ingestion
- `packages/mcp-server/src/tools/olog-query.ts` — olog_query tool
- `packages/mcp-server/src/tools/olog-inspect.ts` — olog_inspect tool
- `packages/mcp-server/src/tools/olog-dump.ts` — olog_dump tool
- `packages/mcp-server/src/tools/olog-reindex.ts` — olog_reindex tool

### Definition of Done
- [ ] `tsc --noEmit` passes in both packages
- [ ] `node packages/mcp-server/dist/index.js` starts and responds to MCP initialize
- [ ] All 4 tools are discoverable via `tools/list`
- [ ] Ingestion of a TS project populates SQLite with elements and arrows
- [ ] `olog_query` returns matching elements with kind/name/module filters
- [ ] `olog_inspect` returns element detail + outgoing/incoming arrows
- [ ] `olog_dump` returns summary counts
- [ ] `olog_reindex` drops and rebuilds the database

### Must Have
- Deterministic element IDs (`module:relative/path:line:col:kind:name`)
- Deterministic arrow IDs (`src_id:kind:dst_id`)
- Auto-ingestion on server startup (with commit-SHA cache check)
- `.olog/` directory auto-creation for SQLite database
- Graceful shutdown with SIGINT/SIGTERM handlers
- Tool annotations (readOnlyHint, idempotentHint)
- Zod schemas with `.describe()` on every field
- Tree-sitter parse error tolerance (partial extraction + stderr warning)
- File size limit (1MB) with skip-and-log
- Hard-coded ignore patterns (node_modules, dist, build, .git, .olog, *.d.ts)
- SQLite version check on startup (>= 3.37.0 for STRICT tables)
- Server `instructions` string explaining tool usage to the LLM

### Must NOT Have (Guardrails)
- NO LSP code — no `lsp/` directory, no `vscode-jsonrpc`, no LSP client
- NO Bun APIs — no `bun:sqlite`, no `Bun.file()`, no `Bun.$`, no `import.meta.dir`
- NO opencode plugin code — no `@opencode-ai/plugin`, no `@opencode-ai/sdk`, no hooks
- NO WASM fallback — no `web-tree-sitter`, no `.wasm` files
- NO MCP resources or prompts — tools only
- NO configuration file parsing — hardcoded defaults, project root from cwd
- NO HTTP transport — stdio only
- NO file watching / incremental re-ingestion triggers — full re-ingest only
- NO violation rules engine — table exists in DDL but never written to
- NO subagent dispatch — no child sessions, no agent markdown
- NO JavaScript parsing — TypeScript/TSX only, no `.js`/`.mjs`/`.cjs`
- NO progress reporting — ingestion blocks until complete, returns stats
- NO CLI mode / REPL — MCP protocol only
- NO `console.log` — logging to stderr only (stdout reserved for MCP protocol)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO (no test framework configured)
- **Automated tests**: None
- **Framework**: N/A
- **QA**: Agent-executed scenarios only (start server, invoke tools, verify output)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **MCP Server**: Use Bash — start server process, send MCP JSON-RPC messages via stdin, parse responses
- **Core Engine**: Use Bash (node REPL / tsx) — import modules, call functions, verify output
- **SQLite Store**: Use Bash — create store, insert data, query results

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — scaffolding + foundation):
├── Task 1: Monorepo scaffolding [quick]
├── Task 2: Ontology types (Element, Arrow, Attr) [quick]
├── Task 3: SQLite schema DDL + OlogStore [unspecified-high]
└── Task 4: Tree-sitter queries (.scm files) [quick]

Wave 2 (After Wave 1 — core ingestion pipeline):
├── Task 5: Tree-sitter parser factory + extractor [deep]
├── Task 6: File discovery + project ingestion orchestrator [unspecified-high]
└── Task 7: ID generation helpers [quick]

Wave 3 (After Wave 2 — MCP server shell + tools):
├── Task 8: MCP server entry point + startup ingestion [unspecified-high]
├── Task 9: olog_query tool [quick]
├── Task 10: olog_inspect tool [quick]
├── Task 11: olog_dump tool [quick]
└── Task 12: olog_reindex tool [quick]

Wave FINAL (After ALL tasks — verification):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real QA — end-to-end MCP server test (unspecified-high)
└── Task F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay

Critical Path: Task 1 → Task 3 → Task 5 → Task 6 → Task 8 → F1-F4 → user okay
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 4 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 2, 3, 4, 5, 6, 7, 8-12 | 1 |
| 2 | 1 | 3, 5, 9, 10 | 1 |
| 3 | 1, 2 | 5, 6, 8 | 1 |
| 4 | 1 | 5 | 1 |
| 5 | 3, 4 | 6, 8 | 2 |
| 6 | 5, 7 | 8 | 2 |
| 7 | 1, 2 | 5, 6 | 2 |
| 8 | 3, 5, 6 | 9-12, F1-F4 | 3 |
| 9 | 2, 3, 8 | F1-F4 | 3 |
| 10 | 2, 3, 8 | F1-F4 | 3 |
| 11 | 3, 8 | F1-F4 | 3 |
| 12 | 3, 5, 8 | F1-F4 | 3 |

### Agent Dispatch Summary

- **Wave 1**: 4 — T1 → `quick`, T2 → `quick`, T3 → `unspecified-high`, T4 → `quick`
- **Wave 2**: 3 — T5 → `deep`, T6 → `unspecified-high`, T7 → `quick`
- **Wave 3**: 5 — T8 → `unspecified-high`, T9-T12 → `quick`
- **FINAL**: 4 — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Monorepo Scaffolding

  **What to do**:
  - Create root `package.json` with `workspaces: ["packages/*"]`, `"type": "module"`, `"packageManager": "npm"` (no Bun)
  - Create `tsconfig.base.json` adapted from plan.md §1.4 but with `"types": ["node"]` instead of `["bun"]`
  - Create `packages/core/package.json` — `"@olog/core"`, ESM exports pointing to `src/index.ts`, dependencies: `tree-sitter`, `tree-sitter-typescript`, `better-sqlite3`, `glob`. DevDeps: `typescript`, `@types/node`, `@types/better-sqlite3`, `tsx`, `tsup`
  - Create `packages/core/tsconfig.json` extending base with `rootDir: src`, `include: ["src"]`
  - Create `packages/mcp-server/package.json` — `"@olog/mcp-server"`, `"bin": {"olog-mcp": "./dist/index.js"}`, deps: `@olog/core: workspace:*`, `@modelcontextprotocol/sdk`, `zod`. DevDeps: `typescript`, `@types/node`, `tsx`, `tsup`
  - Create `packages/mcp-server/tsconfig.json` extending base
  - Create `packages/mcp-server/tsup.config.ts` with `entry: ["src/index.ts"]`, `format: ["esm"]`, `target: "node20"`, `external: ["better-sqlite3", "tree-sitter", "tree-sitter-typescript", "@modelcontextprotocol/sdk"]`, `sourcemap: true`, `banner: { js: "#!/usr/bin/env node" }`
  - Create `packages/core/src/` and `packages/mcp-server/src/` directories (empty `index.ts` placeholder files)
  - Run `npm install` (or equivalent) and verify workspaces resolve

  **Must NOT do**:
  - No Bun-specific config (no `bunfig.toml`, no `trustedDependencies`)
  - No `@types/bun` dependency
  - No `@opencode-ai/plugin` or `@opencode-ai/sdk` dependency
  - No `opencode-plugin` package directory

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Standard project scaffolding, well-defined file structure
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `git-master`: No git operations needed

  **Parallelization**:
  - **Can Run In Parallel**: NO (foundation for everything else)
  - **Parallel Group**: Wave 1 (must complete first)
  - **Blocks**: Tasks 2, 3, 4, 5, 6, 7, 8-12
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `plan.md:56-76` — Root package.json structure (adapt: remove `packageManager: "bun"`, `trustedDependencies`, `@types/bun`)
  - `plan.md:82-100` — Core package.json (adapt: replace `bun:sqlite` with `better-sqlite3`, add `glob`)
  - `plan.md:103-126` — Plugin package.json (adapt for mcp-server: replace `@opencode-ai/*` with `@modelcontextprotocol/sdk`, add `zod`)
  - `plan.md:130-160` — tsconfig.base.json (adapt: `"types": ["node"]`, remove bun references)

  **API/Type References**:
  - `@modelcontextprotocol/sdk` — import paths: `server/mcp.js`, `server/stdio.js`
  - `better-sqlite3` — API: `new Database(path)`, `db.prepare(sql)`, `db.transaction(fn)`

  **External References**:
  - tsup docs: https://tsup.egg.land/ — configuration options for native addon externals
  - MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk — peer dependency on zod

  **WHY Each Reference Matters**:
  - `plan.md:56-76` — Template for root package.json but must remove Bun-specifics (trustedDependencies, bun packageManager)
  - `plan.md:82-100` — Template for core package but must swap bun:sqlite → better-sqlite3 and add glob for file discovery
  - `plan.md:130-160` — Template for tsconfig but types:["bun"] → types:["node"] is critical or Node APIs won't be typed

  **Acceptance Criteria**:
  - [ ] Root package.json exists with workspaces and `"type": "module"`
  - [ ] `tsconfig.base.json` exists with `"types": ["node"]`, `"strict": true`, `"moduleResolution": "bundler"`
  - [ ] `packages/core/package.json` exists with correct deps (tree-sitter, tree-sitter-typescript, better-sqlite3, glob)
  - [ ] `packages/mcp-server/package.json` exists with bin field, @modelcontextprotocol/sdk, zod
  - [ ] `packages/mcp-server/tsup.config.ts` marks native addons as external
  - [ ] `npm install` completes without errors
  - [ ] `npx tsc --noEmit` in both packages shows no config errors (may show import errors — acceptable at this stage)

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Scaffolding integrity check
    Tool: Bash
    Preconditions: npm install has been run
    Steps:
      1. `cat packages/core/package.json | grep -c "better-sqlite3"` → expect 1
      2. `cat packages/mcp-server/package.json | grep -c "@modelcontextprotocol/sdk"` → expect 1
      3. `cat tsconfig.base.json | grep '"types": \["node"\]'` → expect match
      4. `ls packages/core/src/index.ts` → expect file exists
      5. `ls packages/mcp-server/src/index.ts` → expect file exists
      6. `grep -c "opencode-ai" packages/core/package.json packages/mcp-server/package.json` → expect 0 (no opencode deps)
      7. `grep -c "bun:sqlite\|@types/bun\|bunfig" packages/core/package.json packages/mcp-server/package.json` → expect 0
    Expected Result: All checks pass
    Failure Indicators: Missing files, wrong deps, Bun references present
    Evidence: .sisyphus/evidence/task-1-scaffold-check.txt
  ```

  **Commit**: YES (with Task 2, 3, 4)
  - Message: `feat(core): scaffold monorepo with core and mcp-server packages`
  - Files: All Wave 1 files
  - Pre-commit: `npx tsc --noEmit`

- [x] 2. Ontology Types

  **What to do**:
  - Create `packages/core/src/ontology.ts` with type definitions for the olog model
  - Define `OlogKind` union type from schema: `'file'|'module'|'symbol'|'callsite'|'import'|'type'|'interface'|'class'|'enum'|'function'|'method'|'const'|'var'|'namespace'|'other'`
  - Define `ArrowKind` union type: `'extends'|'implements'|'calls'|'imports'|'exports'|'references'|'contains'|'returns'|'param'|'typeof'|'instanceof'|'other'`
  - Define `OlogElem` interface: `{ id: string; kind: OlogKind; name: string; module: string | null; span: string | null; attrs: Record<string, unknown> }`
  - Define `OlogArr` interface: `{ id: string; kind: ArrowKind; srcId: string; dstId: string; attrs: Record<string, unknown> }`
  - Define `OlogAttr` interface: `{ elemId: string; key: string; value: string | null }`
  - Define `IngestResult` interface: `{ filesProcessed: number; elementsCreated: number; arrowsCreated: number; durationMs: number }`
  - Define `QueryResult` type (returned by olog_query): array of `OlogElem`
  - Define `InspectResult` type (returned by olog_inspect): `{ element: OlogElem; outgoing: OlogArr[]; incoming: OlogArr[] }`
  - Define `DumpResult` type (returned by olog_dump): `{ commitSha: string; elementCounts: Record<string, number>; arrowCounts: Record<string, number>; totalElements: number; totalArrows: number }`

  **Must NOT do**:
  - No runtime logic — this file is pure types/interfaces only
  - No imports from bun:sqlite or better-sqlite3
  - No Zod schemas here (those go in the MCP server tools)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure type definitions, no logic, straightforward
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 3, 4 — after Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 3, 5, 9, 10
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `plan.md:1083-1143` — Schema DDL with exact kind enums for CHECK constraints — these define the valid kind values

  **WHY Each Reference Matters**:
  - `plan.md:1083-1143` — The DDL's CHECK constraints are the source of truth for valid kind values. The TypeScript types must match exactly.

  **Acceptance Criteria**:
  - [ ] `packages/core/src/ontology.ts` exists with all types defined
  - [ ] Types match the CHECK constraints in schema DDL
  - [ ] `npx tsc --noEmit` in packages/core passes

  **QA Scenarios**:

  ```
  Scenario: Type definitions compile
    Tool: Bash
    Preconditions: Task 1 complete, npm install done
    Steps:
      1. `cd packages/core && npx tsc --noEmit`
      2. `grep -c "OlogKind\|ArrowKind\|OlogElem\|OlogArr\|InspectResult\|DumpResult\|IngestResult" src/ontology.ts`
    Expected Result: tsc passes, all 7+ type names found
    Failure Indicators: tsc errors, missing type exports
    Evidence: .sisyphus/evidence/task-2-types-check.txt
  ```

  **Commit**: YES (grouped with Wave 1)

- [x] 3. SQLite Schema DDL + OlogStore

  **What to do**:
  - Create `packages/core/src/schema.sql` — copy DDL from plan.md §6.2 but adapted: keep `olog_violation` table (empty, for future), keep `olog_meta` table
  - Create `packages/core/src/db.ts` — OlogStore class wrapping better-sqlite3
  - Constructor: `new OlogStore(path: string)` — opens database with `new Database(path)` (NOT `{ create: true, strict: true }` — better-sqlite3 auto-creates), runs PRAGMAs (WAL, foreign_keys, busy_timeout), runs DDL, seeds meta
  - Startup check: `const [{ sqlite_version }] = db.pragma('sqlite_version()')` — assert >= 3.37.0
  - Implement `commitSha(): string` — read from olog_meta
  - Implement `isFresh(head: string): boolean` — compare against stored commit_sha
  - Implement `ingestFull(elems, arrs, sha): number` — transaction: DELETE all olog_elem (cascades), INSERT elems, INSERT arrs, INSERT prov, UPDATE meta commit_sha
  - Implement `getElem(id: string): OlogElem | null` — prepared statement .get()
  - Implement `outgoing(srcId: string): OlogArr[]` — prepared statement .all()
  - Implement `incoming(dstId: string): OlogArr[]` — prepared statement .all()
  - Implement `queryElements(opts: { kind?: string; nameRegex?: string; moduleRegex?: string; limit: number }): OlogElem[]` — parameterized SQL query
  - Implement `dumpCounts(): { elementCounts: Record<string, number>; arrowCounts: Record<string, number>; totalElements: number; totalArrows: number }` — GROUP BY queries
  - Implement `close(): void` — PRAGMA wal_checkpoint(TRUNCATE), db.close()
  - Key difference from plan.md: NO `db.query<T>(sql)` — use `db.prepare(sql).all()/.get()/.run()` instead
  - Key difference: NO `strict: true` constructor option — not a better-sqlite3 option
  - Key difference: Transaction API nearly identical: `db.transaction(fn)()` — call directly (no `.immediate()` needed for better-sqlite3's default EXCLUSIVE mode)

  **Must NOT do**:
  - No bun:sqlite imports
  - No `db.query<T>()` method calls (better-sqlite3 doesn't have this)
  - No `{ strict: true }` constructor option
  - No `Bun.file()` or `import.meta.dir` — use `import.meta.url` + `fileURLToPath` + `dirname` for schema.sql resolution

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Core database layer with multiple methods, needs careful better-sqlite3 API translation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 2, 4 — after Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 5, 6, 8, 9, 10, 11, 12
  - **Blocked By**: Tasks 1, 2

  **References**:

  **Pattern References**:
  - `plan.md:1076-1143` — Exact DDL for all 5 tables — copy verbatim
  - `plan.md:1148-1219` — OlogStore class template — must adapt for better-sqlite3 API differences

  **API/Type References**:
  - `packages/core/src/ontology.ts` — OlogElem, OlogArr, DumpResult types (from Task 2)

  **External References**:
  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/wiki/API — `db.prepare()`, `stmt.all()/.get()/.run()`, `db.transaction()`, `db.pragma()`
  - better-sqlite3 transactions: https://github.com/WiseLibs/better-sqlite3/wiki/Transactions — `db.transaction(fn)` returns a function, call it directly

  **WHY Each Reference Matters**:
  - `plan.md:1148-1219` — Template for OlogStore but every `db.query<T>()` call must become `db.prepare().all()/.get()` and `db.transaction(fn).immediate()` becomes `db.transaction(fn)()`. The `.immediate()` method does exist on better-sqlite3 transactions for BEGIN IMMEDIATE but default transaction mode is EXCLUSIVE which is fine for our use.
  - `plan.md:1076-1143` — DDL is SQLite-standard, works identically with better-sqlite3. Copy it.
  - better-sqlite3 wiki — The API differs from bun:sqlite in important ways. Key: no `.query()` convenience method, `db.prepare()` returns a statement object with `.all()/.get()/.run()` methods.

  **Acceptance Criteria**:
  - [ ] `packages/core/src/schema.sql` exists with all 5 tables (olog_meta, olog_elem, olog_arr, olog_attr, olog_prov, olog_violation)
  - [ ] `packages/core/src/db.ts` exists with OlogStore class
  - [ ] OlogStore constructor opens database, runs DDL, sets PRAGMAs
  - [ ] SQLite version check on startup (assert >= 3.37.0)
  - [ ] All methods use better-sqlite3 API (db.prepare().all()/.get()/.run())
  - [ ] `npx tsc --noEmit` in packages/core passes

  **QA Scenarios**:

  ```
  Scenario: OlogStore creates and queries in-memory database
    Tool: Bash
    Preconditions: packages/core built, better-sqlite3 installed
    Steps:
      1. Run: `npx tsx -e "
         import { OlogStore } from './packages/core/src/db.js';
         const store = new OlogStore(':memory:');
         store.ingestFull(
           [{ id:'e1', kind:'function', name:'hello', module:'index.ts', span:'index.ts:1:1-1:20', attrs:'{}' }],
           [{ id:'a1', kind:'contains', src_id:'e1', dst_id:'e1', attrs:'{}' }],
           'deadbeef'
         );
         console.log('isFresh:', store.isFresh('deadbeef'));
         console.log('commitSha:', store.commitSha());
         const elem = store.getElem('e1');
         console.log('elem name:', elem?.name);
         const dump = store.dumpCounts();
         console.log('totalElements:', dump.totalElements);
         store.close();
         "`
    Expected Result: isFresh: true, commitSha: deadbeef, elem name: hello, totalElements: 1
    Failure Indicators: Errors importing, method not found, wrong return types
    Evidence: .sisyphus/evidence/task-3-store-check.txt

  Scenario: OlogStore handles non-existent element gracefully
    Tool: Bash
    Preconditions: Store created with no data
    Steps:
      1. Run: `npx tsx -e "
         import { OlogStore } from './packages/core/src/db.js';
         const store = new OlogStore(':memory:');
         const elem = store.getElem('nonexistent');
         console.log('result:', elem);
         store.close();
         "`
    Expected Result: result: null
    Failure Indicators: Throwing error instead of returning null
    Evidence: .sisyphus/evidence/task-3-store-null-check.txt
  ```

  **Commit**: YES (grouped with Wave 1)

- [x] 4. Tree-sitter Queries

  **What to do**:
  - Create `packages/core/src/ingest/queries/ts.scm` — copy from plan.md §4.4 (TypeScript queries)
  - Create `packages/core/src/ingest/queries/tsx.scm` — can be identical to ts.scm for MVP (TSX uses same query patterns plus JSX, but our base queries work for both)
  - Add header comment: `;; Tested with tree-sitter-typescript 0.23.2 — update queries if upgrading the grammar.`

  **Must NOT do**:
  - No JavaScript-specific query patterns
  - No custom queries beyond what plan.md provides
  - No Python or other language queries

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Copy existing queries from plan.md, minimal creation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 2, 3 — after Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `plan.md:549-637` — Complete tree-sitter queries for TypeScript — copy these verbatim into ts.scm

  **WHY Each Reference Matters**:
  - `plan.md:549-637` — These are the exact queries that capture functions, classes, interfaces, type aliases, enums, methods, imports, call expressions, new expressions, and require calls. They are the proven starting point.

  **Acceptance Criteria**:
  - [ ] `packages/core/src/ingest/queries/ts.scm` exists with all query patterns from plan.md
  - [ ] `packages/core/src/ingest/queries/tsx.scm` exists (same content as ts.scm)
  - [ ] Header comment with tested version present

  **QA Scenarios**:

  ```
  Scenario: Query files exist and are valid
    Tool: Bash
    Preconditions: Task 1 complete
    Steps:
      1. `test -f packages/core/src/ingest/queries/ts.scm && echo "ts.scm exists"`
      2. `test -f packages/core/src/ingest/queries/tsx.scm && echo "tsx.scm exists"`
      3. `grep -c "function_declaration\|class_declaration\|interface_declaration\|call_expression" packages/core/src/ingest/queries/ts.scm`
    Expected Result: Both files exist, at least 4 key patterns found
    Failure Indicators: Missing files, empty content
    Evidence: .sisyphus/evidence/task-4-queries-check.txt
  ```

  **Commit**: YES (grouped with Wave 1)

- [x] 5. Tree-sitter Parser Factory + Extractor

  **What to do**:
  - Create `packages/core/src/ingest/treesitter.ts`
  - Implement `parserFor(filename: string): Parser` — creates Parser, sets language to TS.typescript or TS.tsx based on extension
  - Implement `extractFromFile(parser: Parser, source: string, queryPath: string): { elements: RawElement[]; arrows: RawArrow[] }`
    - Read .scm file, create `Parser.Query`, parse source, iterate matches
    - Extract elements: function, class, interface, typealias, enum, method with name + byte range
    - Extract arrows: import→source (imports), call→callee (calls), contains (file→symbol)
    - Return raw extraction results (before ID generation and store insertion)
  - Use `fs.readFile` (not `Bun.file()`) and `import.meta.url` + `fileURLToPath` + `dirname` for path resolution
  - Handle ERROR nodes: if `node.hasError`, log warning to stderr but continue extracting valid subtrees
  - Handle file read errors: return empty results with warning

  **Must NOT do**:
  - No `Bun.file()` — use `fs.readFile`
  - No WASM fallback function
  - No LSP integration
  - No `console.log` — use `console.error` for warnings

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core tree-sitter integration, query parsing, element extraction logic — complex and load-bearing
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 7 — after Wave 1)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 6, 8, 12
  - **Blocked By**: Tasks 3, 4

  **References**:

  **Pattern References**:
  - `plan.md:502-510` — Native parser setup: `new Parser()`, `p.setLanguage()`, TS.typescript vs TS.tsx
  - `plan.md:647-669` — `extractFromFile()` function template — iterate matches, build output array
  - `plan.md:733-737` — Memory management: `tree.delete()` when discarding, ERROR node handling

  **API/Type References**:
  - `packages/core/src/ontology.ts` — OlogKind, ArrowKind types (from Task 2)
  - `packages/core/src/db.ts` — OlogStore, ElemRow/ArrRow types (from Task 3)

  **External References**:
  - tree-sitter Node API: https://github.com/tree-sitter/tree-sitter/blob/master/bindings/node/README.md — Parser, Query, Tree, SyntaxNode APIs

  **WHY Each Reference Matters**:
  - `plan.md:502-510` — Parser initialization pattern, but must use `import` syntax not Bun-style. The key insight is two languages: TS.typescript for .ts, TS.tsx for .tsx.
  - `plan.md:647-669` — Extraction loop template. The plan.md version uses a simplified approach — we need to extend it to also extract arrows (calls, imports, contains) in addition to elements.
  - `plan.md:733-737` — Memory and error handling. `tree.delete()` is important for native bindings. `node.hasError` lets us detect parse errors without aborting.

  **Acceptance Criteria**:
  - [ ] `packages/core/src/ingest/treesitter.ts` exists
  - [ ] `parserFor()` creates correct parser for .ts and .tsx files
  - [ ] `extractFromFile()` returns elements and arrows from a TypeScript source string
  - [ ] ERROR nodes are handled gracefully (warning to stderr, partial extraction)
  - [ ] `npx tsc --noEmit` passes

  **QA Scenarios**:

  ```
  Scenario: Parse a simple TypeScript file
    Tool: Bash
    Preconditions: tree-sitter and tree-sitter-typescript installed
    Steps:
      1. Create a test file: `echo 'export function hello(name: string): string { return "Hello " + name; } export class Greeter { greet(n: string) { return hello(n); } }' > /tmp/test-olog.ts`
      2. Run: `npx tsx -e "
         import { parserFor, extractFromFile } from './packages/core/src/ingest/treesitter.js';
         import * as fs from 'node:fs';
         import * as path from 'node:path';
         const parser = parserFor('test.ts');
         const source = fs.readFileSync('/tmp/test-olog.ts', 'utf8');
         const scmPath = path.resolve('packages/core/src/ingest/queries/ts.scm');
         const result = extractFromFile(parser, source, scmPath);
         console.log('elements:', result.elements.length);
         console.log('arrows:', result.arrows.length);
         console.log('kinds:', [...new Set(result.elements.map(e => e.kind))]);
         "`
    Expected Result: elements >= 3 (function, class, method), arrows >= 1 (contains or calls)
    Failure Indicators: 0 elements, parse error, import failure
    Evidence: .sisyphus/evidence/task-5-parser-check.txt

  Scenario: Handle file with syntax errors
    Tool: Bash
    Preconditions: parserFor and extractFromFile working
    Steps:
      1. Create a broken TS file: `echo 'function hello( { return 1; class Foo {' > /tmp/test-broken.ts`
      2. Run extraction on it
    Expected Result: Returns partial results (whatever tree-sitter can recover), stderr warning emitted, no crash
    Failure Indicators: Crash, exception, empty stderr (no warning)
    Evidence: .sisyphus/evidence/task-5-error-check.txt
  ```

  **Commit**: YES (grouped with Wave 2)

- [x] 6. File Discovery + Project Ingestion Orchestrator

  **What to do**:
  - Create `packages/core/src/ingest/project.ts`
  - Implement `discoverTsFiles(projectRoot: string): string[]`
    - Use `glob` package with pattern `**/*.{ts,tsx,mts,cts}`, cwd: projectRoot
    - Hard-coded ignore: `["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "**/.olog/**", "**/*.d.ts"]`
    - Return absolute paths
  - Implement `ingestProject(projectRoot: string, store: OlogStore): IngestResult`
    - Get HEAD sha via `child_process.execSync("git rev-parse HEAD", { cwd: projectRoot }).toString().trim()` — wrap in try/catch, default to `"nogit"` if git unavailable
    - If `store.isFresh(head)` → return early with zeros (no re-ingestion needed)
    - Discover files, parse each with tree-sitter, extract elements and arrows
    - Generate element IDs: `module:relative/path:line:col:kind:name` (use the helper from Task 7)
    - Generate arrow IDs: `src_id:kind:dst_id` (use the helper from Task 7)
    - Build `contains` arrows: for each element in a file, create an arrow from the file element to the symbol element
    - Build `imports` arrows: for each import element, create an arrow from the importing file to the imported source
    - Build `calls` arrows: for each call expression, create an arrow from the containing function/method to the callee
    - Set `module` field to relative path from project root
    - Set `span` field to `relative/path:line:col-endLine:endCol` (1-based)
    - Set `attrs` to `"{}"` for now (no extra attributes in MVP)
    - Add file elements (kind: "file") for each discovered file
    - Skip files > 1MB with stderr warning
    - Skip unreadable files with stderr warning
    - Call `store.ingestFull(elems, arrs, head)` in a single transaction
    - Return IngestResult with counts and timing
  - Implement `reindexProject(projectRoot: string, store: OlogStore): IngestResult`
    - Always re-ingest regardless of commit SHA
    - Same logic as ingestProject but bypasses isFresh check

  **Must NOT do**:
  - No `.gitignore` file reading — use hard-coded ignore patterns only
  - No file watching / incremental ingestion
  - No config file parsing
  - No JavaScript file discovery
  - No `console.log` — stderr only

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Orchestrates the full pipeline, multiple integration points, needs careful error handling
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 7 — after Wave 1, but needs Task 5 for extractFromFile)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 3, 5, 7

  **References**:

  **Pattern References**:
  - `plan.md:1348-1354` — First-run experience: enumerate files, parse each, persist in single transaction
  - `plan.md:1223-1234` — Commit-SHA keyed caching pattern (isFresh check before ingestion)
  - `plan.md:1204-1214` — ingestFile method for incremental — reference for module-based deletion but don't implement the trigger

  **API/Type References**:
  - `packages/core/src/ontology.ts` — IngestResult type
  - `packages/core/src/db.ts` — OlogStore.ingestFull(), .isFresh()
  - `packages/core/src/ingest/treesitter.ts` — parserFor(), extractFromFile()

  **External References**:
  - glob package: https://github.com/isaacs/node-glob — `glob.sync(pattern, { cwd, ignore })` or async `glob(pattern, opts)`

  **WHY Each Reference Matters**:
  - `plan.md:1348-1354` — The first-run workflow description is the behavioral spec for ingestProject. The key insight is: discover → parse each → build elements+arrows → single transaction insert.
  - `plan.md:1223-1234` — The caching pattern (commit SHA comparison) is how we avoid redundant re-ingestion. Essential for startup speed on subsequent runs.

  **Acceptance Criteria**:
  - [ ] `packages/core/src/ingest/project.ts` exists
  - [ ] `discoverTsFiles()` returns .ts/.tsx/.mts/.cts files, excluding node_modules/dist/build/.git/.olog/*.d.ts
  - [ ] `ingestProject()` populates OlogStore with elements and arrows
  - [ ] `ingestProject()` skips if database is fresh (commit SHA match)
  - [ ] `reindexProject()` always re-ingests regardless of freshness
  - [ ] Files > 1MB are skipped with warning
  - [ ] `npx tsc --noEmit` passes

  **QA Scenarios**:

  ```
  Scenario: Discover TypeScript files in a real project
    Tool: Bash
    Preconditions: packages/core installed
    Steps:
      1. Run: `npx tsx -e "
         import { discoverTsFiles } from './packages/core/src/ingest/project.js';
         const files = discoverTsFiles(process.cwd());
         console.log('found:', files.length, 'files');
         const hasNodeModules = files.some(f => f.includes('node_modules'));
         const hasDist = files.some(f => f.includes('/dist/'));
         console.log('has node_modules:', hasNodeModules);
         console.log('has dist:', hasDist);
         "`
    Expected Result: found >= 0 files, hasNodeModules: false, hasDist: false
    Failure Indicators: node_modules files included, crash
    Evidence: .sisyphus/evidence/task-6-discover-check.txt

  Scenario: Full ingestion on a small project
    Tool: Bash
    Preconditions: OlogStore and extractFromFile working
    Steps:
      1. Create a temp project: `mkdir -p /tmp/olog-test && echo 'export function add(a: number, b: number) { return a + b; }' > /tmp/olog-test/math.ts && echo 'import { add } from "./math"; export function calc() { return add(1, 2); }' > /tmp/olog-test/calc.ts`
      2. Run ingestion on it, verify elements and arrows created
      3. Query the store for elements
    Expected Result: Elements for both files, functions, import. Arrows for imports, contains, calls.
    Failure Indicators: 0 elements, missing arrows, crash
    Evidence: .sisyphus/evidence/task-6-ingest-check.txt
  ```

  **Commit**: YES (grouped with Wave 2)

- [x] 7. ID Generation Helpers

  **What to do**:
  - Create `packages/core/src/ingest/ids.ts`
  - Implement `elemId(module: string, line: number, col: number, kind: string, name: string): string`
    - Returns `module:${module}:${line}:${col}:${kind}:${name}`
    - `module` is the relative file path (e.g., `src/index.ts`)
    - `line` and `col` are 1-based (from tree-sitter startPosition, which is 0-based → add 1)
  - Implement `arrowId(srcId: string, kind: string, dstId: string): string`
    - Returns `${srcId}:${kind}:${dstId}`
  - Implement `fileElemId(relativePath: string): string`
    - Returns `file:${relativePath}` — ID for the file element itself
  - Implement `formatSpan(relativePath: string, startLine: number, startCol: number, endLine: number, endCol: number): string`
    - Returns `relativePath:startLine:startCol-endLine:endCol` (all 1-based)
  - Export all functions

  **Must NOT do**:
  - No UUID generation — deterministic IDs only
  - No random components — IDs must be reproducible from the same source

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple pure functions, no dependencies
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 5, 6 — after Task 1)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `plan.md:1083-1096` — Schema shows `id TEXT NOT NULL PRIMARY KEY` — the ID format must produce unique, deterministic values

  **WHY Each Reference Matters**:
  - The ID format determines whether upserts work correctly (ON CONFLICT DO UPDATE) and whether arrows can reference elements. Deterministic IDs from the same source always produce the same ID, enabling idempotent re-ingestion.

  **Acceptance Criteria**:
  - [ ] `packages/core/src/ingest/ids.ts` exists with all 4 functions
  - [ ] Same inputs always produce same output
  - [ ] Different inputs produce different outputs
  - [ ] `npx tsc --noEmit` passes

  **QA Scenarios**:

  ```
  Scenario: ID functions are deterministic
    Tool: Bash
    Preconditions: packages/core installed
    Steps:
      1. Run: `npx tsx -e "
         import { elemId, arrowId, fileElemId, formatSpan } from './packages/core/src/ingest/ids.js';
         const id1 = elemId('src/index.ts', 10, 5, 'function', 'hello');
         const id2 = elemId('src/index.ts', 10, 5, 'function', 'hello');
         console.log('same input same output:', id1 === id2);
         const id3 = elemId('src/index.ts', 11, 5, 'function', 'hello');
         console.log('different line different id:', id1 !== id3);
         const aid1 = arrowId('src:1:1:function:hello', 'calls', 'src:2:1:function:world');
         console.log('arrow id:', aid1);
         const fid = fileElemId('src/index.ts');
         console.log('file elem id:', fid);
         const span = formatSpan('src/index.ts', 10, 5, 10, 42);
         console.log('span:', span);
         "`
    Expected Result: same input same output: true, different line different id: true, valid IDs and spans
    Failure Indicators: Non-deterministic IDs, malformed format
    Evidence: .sisyphus/evidence/task-7-ids-check.txt
  ```

  **Commit**: YES (grouped with Wave 2)

- [x] 8. MCP Server Entry Point + Startup Ingestion

  **What to do**:
  - Create `packages/mcp-server/src/index.ts` — the main entry point
  - Import `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
  - Import `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
  - Determine project root: `process.env.OLOG_ROOT || process.cwd()`
  - Ensure `.olog/` directory exists: `fs.mkdirSync(path.join(projectRoot, '.olog'), { recursive: true })`
  - Create OlogStore: `new OlogStore(path.join(projectRoot, '.olog', 'olog.sqlite'))`
  - Run startup ingestion: `ingestProject(projectRoot, store)` — this blocks until complete, logs to stderr
  - If `.olog/` not in `.gitignore`, log a suggestion to stderr (don't modify .gitignore)
  - Create McpServer with:
    ```typescript
    const server = new McpServer(
      { name: "olog-mcp", version: "0.0.1" },
      {
        instructions: `This server provides a structural model (ontology log) of the TypeScript codebase at ${projectRoot}. Use olog_query to search for elements by kind/name/module. Use olog_inspect to get details and connections for a specific element. Use olog_dump for an overview. Use olog_reindex to refresh after code changes. The name and module parameters in olog_query accept JavaScript regex patterns.`,
        capabilities: { logging: {} }
      }
    )
    ```
  - Register all 4 tools (import from separate files — Tasks 9-12)
  - Connect to stdio transport: `const transport = new StdioServerTransport(); await server.connect(transport);`
  - Add graceful shutdown handlers:
    ```typescript
    const cleanup = () => { try { store.close(); } catch {} process.exit(0); }
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
    ```
  - Add `packages/core/src/index.ts` re-exporting all public API: `export { OlogStore } from './db.js'`, `export type { OlogElem, OlogArr, ... } from './ontology.js'`, `export { ingestProject, reindexProject, discoverTsFiles } from './ingest/project.js'`, etc.

  **Must NOT do**:
  - No HTTP server code
  - No `console.log` — stderr only
  - No config file parsing
  - No MCP resources or prompts
  - No `Bun.*` APIs

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Wires everything together, startup logic, graceful shutdown, MCP server setup — multiple integration points
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on all Wave 2 tasks)
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 9, 10, 11, 12, F1-F4
  - **Blocked By**: Tasks 3, 5, 6

  **References**:

  **Pattern References**:
  - `plan.md:1348-1354` — First-run experience: auto-ingest on startup, toast notification (we log to stderr instead)

  **API/Type References**:
  - `packages/core/src/db.ts` — OlogStore constructor and methods
  - `packages/core/src/ingest/project.ts` — ingestProject, reindexProject
  - `@modelcontextprotocol/sdk/server/mcp.js` — McpServer class
  - `@modelcontextprotocol/sdk/server/stdio.js` — StdioServerTransport class

  **External References**:
  - MCP SDK server guide: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md

  **WHY Each Reference Matters**:
  - McpServer and StdioServerTransport are the official high-level API. The import paths with `.js` extension are required for ESM resolution on Node.js. The `instructions` field is critical — it's what the LLM sees to understand how to use the tools.

  **Acceptance Criteria**:
  - [ ] `packages/mcp-server/src/index.ts` exists
  - [ ] `packages/core/src/index.ts` exists with re-exports
  - [ ] Server starts and responds to MCP initialize request
  - [ ] Startup ingestion runs automatically
  - [ ] `.olog/` directory created on first run
  - [ ] SIGINT/SIGTERM handled gracefully
  - [ ] `npx tsc --noEmit` passes in both packages

  **QA Scenarios**:

  ```
  Scenario: MCP server responds to initialize
    Tool: Bash
    Preconditions: All core modules built, dependencies installed
    Steps:
      1. Build: `cd packages/mcp-server && npx tsup`
      2. Send initialize request via stdin:
         `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | timeout 30 node packages/mcp-server/dist/index.js 2>/dev/null | head -1`
    Expected Result: JSON response with "result" containing server capabilities
    Failure Indicators: No response, timeout, non-JSON output on stdout
    Evidence: .sisyphus/evidence/task-8-server-init.txt

  Scenario: .olog directory created on first run
    Tool: Bash
    Preconditions: Clean state (no .olog/ directory)
    Steps:
      1. `rm -rf /tmp/olog-test-project/.olog`
      2. `mkdir -p /tmp/olog-test-project && echo 'export const x = 1' > /tmp/olog-test-project/test.ts`
      3. `cd /tmp/olog-test-project && OLOG_ROOT=/tmp/olog-test-project timeout 10 node /path/to/packages/mcp-server/dist/index.js < /dev/null 2>/dev/null; ls -la .olog/`
    Expected Result: `.olog/` directory exists with `olog.sqlite` file
    Failure Indicators: No .olog/ directory, no sqlite file
    Evidence: .sisyphus/evidence/task-8-directory-check.txt
  ```

  **Commit**: YES (grouped with Wave 3)

- [x] 9. olog_query Tool

  **What to do**:
  - Create `packages/mcp-server/src/tools/olog-query.ts`
  - Export a function that registers the tool on the McpServer instance
  - Tool definition:
    ```typescript
    server.registerTool('olog_query', {
      description: 'Query the ontology log for structural elements matching filters. Returns elements with their kind, name, module (file path), and span (location).',
      inputSchema: z.object({
        kind: z.enum(["file","module","symbol","callsite","import","type","interface","class","enum","function","method","const","var","namespace","any"]).default("any").describe("Element kind to filter by. Use 'any' to match all kinds."),
        name: z.string().optional().describe("Regex pattern matched against element name. Examples: '^handle', 'User', 'Button$'"),
        module: z.string().optional().describe("Regex pattern matched against module (relative file path). Examples: 'src/components', 'utils/'"),
        limit: z.number().int().min(1).max(500).default(50).describe("Maximum number of results to return"),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    }, async ({ kind, name, module, limit }) => {
      // Call store.queryElements({ kind, nameRegex: name, moduleRegex: module, limit })
      // Return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] }
      // If no results: { content: [{ type: "text", text: "No elements found matching criteria" }] }
      // On error: { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true }
    })
    ```

  **Must NOT do**:
  - No MCP resource registration
  - No `console.log`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple tool registration with one store method call
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 10, 11, 12)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 2, 3, 8

  **References**:

  **API/Type References**:
  - `packages/core/src/db.ts` — OlogStore.queryElements() method
  - `@modelcontextprotocol/sdk/server/mcp.js` — server.registerTool() API

  **External References**:
  - MCP SDK tool guide: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md#tools

  **WHY Each Reference Matters**:
  - The tool registration API is `server.registerTool(name, definition, handler)`. The `inputSchema` must be a Zod schema. The `annotations` field is optional but helpful for clients.

  **Acceptance Criteria**:
  - [ ] `packages/mcp-server/src/tools/olog-query.ts` exists
  - [ ] Tool registered with correct Zod schema
  - [ ] Tool returns matching elements as JSON
  - [ ] Tool returns error message for invalid regex
  - [ ] `npx tsc --noEmit` passes

  **QA Scenarios**:

  ```
  Scenario: Query for functions
    Tool: Bash
    Preconditions: Server running with ingested data
    Steps:
      1. Send tools/call request:
         `echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"olog_query","arguments":{"kind":"function","limit":10}}}' | timeout 30 node packages/mcp-server/dist/index.js 2>/dev/null`
    Expected Result: JSON response containing function elements
    Failure Indicators: Error response, empty results on a project with functions
    Evidence: .sisyphus/evidence/task-9-query-check.txt
  ```

  **Commit**: YES (grouped with Wave 3)

- [x] 10. olog_inspect Tool

  **What to do**:
  - Create `packages/mcp-server/src/tools/olog-inspect.ts`
  - Tool definition:
    ```typescript
    server.registerTool('olog_inspect', {
      description: 'Get detailed information about a specific element by ID, including all its outgoing and incoming arrows (connections to other elements).',
      inputSchema: z.object({
        id: z.string().describe("Element ID to inspect. Get IDs from olog_query results."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    }, async ({ id }) => {
      // Call store.getElem(id), store.outgoing(id), store.incoming(id)
      // If element not found: return { content: [{ type: "text", text: `Element not found: ${id}` }], isError: true }
      // Otherwise: return { content: [{ type: "text", text: JSON.stringify({ element, outgoing, incoming }, null, 2) }] }
    })
    ```

  **Must NOT do**:
  - No MCP resource registration
  - No `console.log`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple tool with three store method calls
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 9, 11, 12)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 2, 3, 8

  **References**:

  **API/Type References**:
  - `packages/core/src/db.ts` — OlogStore.getElem(), .outgoing(), .incoming()
  - `packages/core/src/ontology.ts` — InspectResult type

  **Acceptance Criteria**:
  - [ ] `packages/mcp-server/src/tools/olog-inspect.ts` exists
  - [ ] Tool returns element + outgoing + incoming arrows
  - [ ] Tool returns error for non-existent element ID
  - [ ] `npx tsc --noEmit` passes

  **QA Scenarios**:

  ```
  Scenario: Inspect an existing element
    Tool: Bash
    Preconditions: Server running with ingested data
    Steps:
      1. First query for an element to get its ID
      2. Then inspect that element by ID
    Expected Result: Element details with outgoing/incoming arrow arrays
    Failure Indicators: "Element not found" for a valid ID, missing arrows
    Evidence: .sisyphus/evidence/task-10-inspect-check.txt

  Scenario: Inspect non-existent element
    Tool: Bash
    Preconditions: Server running
    Steps:
      1. Call olog_inspect with a bogus ID like "nonexistent:123"
    Expected Result: isError: true, message contains "Element not found"
    Failure Indicators: Crash, no isError flag
    Evidence: .sisyphus/evidence/task-10-inspect-error.txt
  ```

  **Commit**: YES (grouped with Wave 3)

- [x] 11. olog_dump Tool

  **What to do**:
  - Create `packages/mcp-server/src/tools/olog-dump.ts`
  - Tool definition:
    ```typescript
    server.registerTool('olog_dump', {
      description: 'Get a summary overview of the ontology log: element counts by kind, arrow counts by kind, and total counts. Useful for understanding what the olog knows about the codebase.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true }
    }, async () => {
      // Call store.dumpCounts() and store.commitSha()
      // Return { content: [{ type: "text", text: JSON.stringify({ commitSha, ...dumpCounts }, null, 2) }] }
    })
    ```

  **Must NOT do**:
  - No parameters beyond the empty schema
  - No `console.log`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simplest tool — one store call, no parameters
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 9, 10, 12)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 3, 8

  **References**:

  **API/Type References**:
  - `packages/core/src/db.ts` — OlogStore.dumpCounts(), .commitSha()
  - `packages/core/src/ontology.ts` — DumpResult type

  **Acceptance Criteria**:
  - [ ] `packages/mcp-server/src/tools/olog-dump.ts` exists
  - [ ] Tool returns counts by kind + totals + commit SHA
  - [ ] `npx tsc --noEmit` passes

  **QA Scenarios**:

  ```
  Scenario: Dump overview
    Tool: Bash
    Preconditions: Server running with ingested data
    Steps:
      1. Call olog_dump with no arguments
    Expected Result: JSON with elementCounts, arrowCounts, totalElements, totalArrows, commitSha
    Failure Indicators: Missing fields, crash
    Evidence: .sisyphus/evidence/task-11-dump-check.txt
  ```

  **Commit**: YES (grouped with Wave 3)

- [x] 12. olog_reindex Tool

  **What to do**:
  - Create `packages/mcp-server/src/tools/olog-reindex.ts`
  - Tool definition:
    ```typescript
    server.registerTool('olog_reindex', {
      description: 'Force a full re-ingestion of the TypeScript codebase. Use this after code changes to refresh the structural model. This drops all existing elements and rebuilds from scratch.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false }
    }, async () => {
      // Call reindexProject(projectRoot, store)
      // Return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
      // On error: { content: [{ type: "text", text: `Reindex failed: ${e.message}` }], isError: true }
    })
    ```

  **Must NOT do**:
  - No incremental re-ingestion — always full
  - No file watching trigger
  - No `console.log`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: One orchestrator call, straightforward
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 9, 10, 11)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 3, 5, 8

  **References**:

  **API/Type References**:
  - `packages/core/src/ingest/project.ts` — reindexProject()
  - `packages/core/src/ontology.ts` — IngestResult type

  **Acceptance Criteria**:
  - [ ] `packages/mcp-server/src/tools/olog-reindex.ts` exists
  - [ ] Tool drops and rebuilds all elements/arrows
  - [ ] Tool returns IngestResult with counts and timing
  - [ ] `npx tsc --noEmit` passes

  **QA Scenarios**:

  ```
  Scenario: Reindex the project
    Tool: Bash
    Preconditions: Server running with ingested data
    Steps:
      1. Call olog_reindex
      2. Then call olog_dump to verify counts
    Expected Result: Reindex returns IngestResult with non-zero counts. Dump shows updated data.
    Failure Indicators: Error, zero counts after reindex
    Evidence: .sisyphus/evidence/task-12-reindex-check.txt

  Scenario: Reindex on project with no TS files
    Tool: Bash
    Preconditions: Empty directory
    Steps:
      1. Set OLOG_ROOT to an empty directory
      2. Start server and call olog_reindex
    Expected Result: Returns { filesProcessed: 0, elementsCreated: 0, arrowsCreated: 0 } — no crash
    Failure Indicators: Crash, error on empty project
    Evidence: .sisyphus/evidence/task-12-reindex-empty.txt
  ```

  **Commit**: YES (grouped with Wave 3)

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` in both packages. Review all files for: `as any`/`@ts-ignore`, empty catches, console.log, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `TypeCheck [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real QA** — `unspecified-high`
  Start the MCP server from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-tool integration (reindex then query). Test edge cases: empty project, no TS files, corrupted file. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(core): scaffold monorepo with core and mcp-server packages` — all Wave 1 files
- **Wave 2**: `feat(core): add tree-sitter ingestion pipeline with project orchestrator` — all Wave 2 files
- **Wave 3**: `feat(mcp-server): add MCP server with 4 olog tools` — all Wave 3 files

---

## Success Criteria

### Verification Commands
```bash
# Type checking passes
cd packages/core && npx tsc --noEmit         # Expected: 0 errors
cd packages/mcp-server && npx tsc --noEmit   # Expected: 0 errors

# Server starts and responds to MCP initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node packages/mcp-server/dist/index.js
# Expected: JSON response with capabilities

# Tools are discoverable
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node packages/mcp-server/dist/index.js
# Expected: JSON response listing 4 tools
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] Server starts and responds to MCP initialize
- [ ] All 4 tools work correctly
- [ ] Ingestion populates SQLite with elements and arrows
- [ ] Graceful shutdown works
