# Learnings

## Task 3: SQLite Schema DDL + OlogStore

### better-sqlite3 API Differences from bun:sqlite
- Use `new Database(path)` — auto-creates file, no `create: true` or `strict: true` options
- Use `db.prepare(sql).all()/.get()/.run()` instead of `db.query<T>(sql)`
- Use `db.transaction(fn)()` — call directly, no `.immediate()` needed
- `db.pragma(string)` returns arrays/objects; for single values use `db.pragma('name', { simple: true })`
- For `sqlite_version()`, more reliable to use `db.prepare("SELECT sqlite_version() as v").get()`

### Custom REGEXP Function
SQLite does not have a native REGEXP function. With better-sqlite3, register one via:
```ts
this.db.function('regexp', { deterministic: true }, (pattern, text) => {
  return new RegExp(pattern).test(text ?? '') ? 1 : 0;
});
```
This enables `column REGEXP ?` in parameterized queries.

### Schema Design
- STRICT tables require SQLite >= 3.37.0 — verified at startup
- WITHOUT ROWID on small lookup tables (meta, attr, prov) for efficiency
- ON DELETE CASCADE on all FKs so `DELETE FROM olog_elem` cascades to arrows, attrs, prov, violations
- `json_valid(attrs)` CHECK ensures attrs column always contains valid JSON
- 9 indexes covering all FK columns and frequently queried columns (kind, name, module)

### TypeScript Strictness
- `version.split('.').map(Number)` produces `number[]`, but destructured values still need `?? 0` defaults to satisfy strict null checks

### Runtime Verification
- In-memory store test passed: ingest, query, getElem (null for missing), outgoing/incoming, dumpCounts, isFresh, commitSha
- Regex query test passed: kind filter, nameRegex, moduleRegex, combined filters

## Task 5: Tree-sitter Parser Factory & Element/Arrow Extractor

### tree-sitter-typescript Import
- `import TS from 'tree-sitter-typescript'` gives `{typescript: Language, tsx: Language}`
- Access grammars via `TS.typescript.language` and `TS.tsx.language` (type `unknown`, assignable to `any`)
- Works with `esModuleInterop: true` + `verbatimModuleSyntax: true`

### tree-sitter Query API
- `Parser.Query(language, scmContent)` creates a query from .scm file content
- `query.matches(tree.rootNode)` returns `QueryMatch[]` with `captures: QueryCapture[]`
- Multiple captures can share the same name in one match (e.g. multiple `@import.name`)
- Use `Map<string, QueryCapture[]>` to handle duplicate capture names

### Tree Memory Management
- `tree.delete()` exists at runtime but is absent from TS type declarations
- Must use type assertion: `(tree as unknown as { delete: () => void }).delete()`
- Guard with `'delete' in tree && typeof ... === 'function'` for safety

### Span Format
- tree-sitter `Point` uses 0-based row/column; must add 1 for 1-based format
- Format: `"startLine:startCol-endLine:endCol"`

### Containing Function Lookup
- Walk up `node.parent` chain to find nearest function-like ancestor
- Handle: `function_declaration`, `generator_function_declaration`, `method_definition`, `arrow_function`, `function_expression`
- Arrow functions and anonymous function expressions: check `parent.type === 'variable_declarator'` for name

## Task 6: File Discovery + Project Ingestion Orchestrator

### glob Package Usage
- `globSync` from `glob` v11 works for synchronous file discovery
- Pattern `**/*.{ts,tsx,mts,cts}` with `cwd: projectRoot` and `absolute: true` returns absolute paths
- Hard-coded ignore patterns: `['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/.olog/**', '**/*.d.ts']`

### Span Format Interop
- `treesitter.ts` returns spans as `line:col-line:col` without path prefix
- `project.ts` must prepend `relativePath` to construct full span: `relativePath:line:col-line:col`
- Use `formatSpan` from `ids.ts` to ensure consistent formatting

### Arrow Construction Strategy
- `contains`: file element -> every non-file symbol element in that file
- `imports`: file element -> each import element (explicitly built in project.ts)
- `calls`: containing function -> callsite element (uses span-based containment lookup)
- Raw arrows from `extractFromFile` are also processed, resolving `srcName`/`dstName` via per-file `nameToId` map

### File Size Guard
- Skip files > 1MB with `statSync` before reading
- Use `console.error` for warnings (never `console.log` — stdout reserved for MCP protocol)

### Git HEAD Resolution
- `execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8' })`
- Wrap in try/catch, default to `'nogit'` when git unavailable
- `store.isFresh(head)` enables commit-SHA keyed caching for fast startup

### Structural Typing with Internal Interfaces
- `OlogStore.ingestFull` expects `ElemRow[]` and `ArrRow[]` (not exported from `db.ts`)
- TypeScript structural typing allows passing compatible inline objects without importing the private interfaces
  - Must use `src_id`/`dst_id` (snake_case) for arrows to match `ArrRow` shape

## Task 8-12: MCP Server Entry Point + 4 Tools

### MCP SDK API (v1.x)
- `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
- `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
- Tool registration: `server.registerTool(name, { description, inputSchema, annotations }, handler)`
- Handler returns `{ content: [{ type: "text", text: ... }], isError?: boolean }`
- `inputSchema` must be a Zod schema object with `.describe()` on every field

### tsup Bundling with Workspace Dependencies
- `@olog/core` must be in `noExternal` to be bundled into the mcp-server dist
- `glob` must be in `external` — bundling it causes runtime failures (0 files discovered)
- Native addons (`better-sqlite3`, `tree-sitter`, `tree-sitter-typescript`) must be `external`
- Asset files (`schema.sql`, `queries/*.scm`) must be copied to `dist/` post-build because bundled `__dirname` resolves to `dist/`

### exactOptionalPropertyTypes Compatibility
- With `exactOptionalPropertyTypes: true`, cannot pass `undefined` to optional properties
- Must build the options object conditionally instead of using ternary for `undefined`

### Startup Ingestion Timing
- Ingestion runs BEFORE `server.connect(transport)` — blocks until complete
- This is intentional per spec: "ingestion blocks until complete, logs to stderr"
- Stdin messages are buffered by the OS pipe and processed after connection

### Console Logging
- Only `console.error` is allowed — stdout is reserved for MCP protocol JSON-RPC
- All logging (startup, errors, warnings) goes to stderr

## Critical Fix: tree-sitter Language Object

### Bug: `setLanguage` receives wrong object type
- `TS.typescript.language` is an internal object (`Language_v2` or similar), NOT the same type that `parser.setLanguage()` expects
- This caused runtime error: `Cannot read properties of undefined (reading '166')`

### Fix: Use `TS.typescript` directly (not `.language`)
```typescript
// WRONG (causes runtime error):
parser.setLanguage(TS.typescript.language);  // '166' undefined error

// CORRECT:
parser.setLanguage(TS.typescript);  // TS.typescript IS the Language object
parser.setLanguage(TS.tsx);
```

### Verification
- TypeScript compilation passes
- `parserFor('test.ts')` parses `function hello() { return 42; }` successfully -> root type: `program`
- `parserFor('test.tsx')` parses `const x = <div>hello</div>` successfully -> root type: `program`
