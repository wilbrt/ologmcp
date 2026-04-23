# Plan Compliance Audit — olog MCP Server

**Date**: 2026-04-23
**Result**: ✅ APPROVE — All 26 checks pass

## Must Have [12/12 PASS]

| # | Check | Evidence |
|---|-------|----------|
| 1 | Deterministic element IDs | `ids.ts:11-19` — `elemId()` format `module:${module}:${line}:${col}:${kind}:${name}` |
| 2 | Deterministic arrow IDs | `ids.ts:25-27` — `arrowId()` format `${srcId}:${kind}:${dstId}` |
| 3 | Auto-ingestion on startup | `index.ts:29` — `ingestProject(projectRoot, store)` called before server connect |
| 4 | `.olog/` auto-creation | `index.ts:14-15` — `mkdirSync(ologDir, { recursive: true })` |
| 5 | Graceful shutdown | `index.ts:58-66` — SIGINT/SIGTERM handlers with `store.close()` |
| 6 | Tool annotations | All 4 tools have `readOnlyHint`/`idempotentHint` annotations |
| 7 | Zod `.describe()` | All tool input fields have `.describe()` |
| 8 | Parse error tolerance | `treesitter.ts:98-100` — `console.error` warning on `hasError`, continues extraction |
| 9 | File size limit (1MB) | `project.ts:20,109` — `ONE_MB = 1024*1024`, skip with stderr warning |
| 10 | Hard-coded ignore patterns | `project.ts:11-18` — node_modules, dist, build, .git, .olog, *.d.ts |
| 11 | SQLite version check | `db.ts:41-48` — `SELECT sqlite_version()`, throws if < 3.37.0 |
| 12 | Server instructions | `index.ts:44` — `instructions` string describing all 4 tools |

## Must NOT Have [14/14 PASS]

| # | Check | Evidence |
|---|-------|----------|
| 1 | NO LSP code | No vscode-jsonrpc, LspClient, lsp/ directory |
| 2 | NO Bun APIs | No bun:sqlite, Bun.file, Bun.$, import.meta.dir |
| 3 | NO opencode plugin | No @opencode-ai/plugin or @opencode-ai/sdk |
| 4 | NO WASM fallback | No web-tree-sitter or .wasm in source |
| 5 | NO MCP resources/prompts | No registerResource/registerPrompt in source |
| 6 | NO config file parsing | No config.json or .shadow-olog/config |
| 7 | NO HTTP transport | No SSEServerTransport, Express, Fastify |
| 8 | NO file watching | No fs.watch, chokidar, file.edited |
| 9 | NO violation rules engine | olog_violation table in DDL only, never written to |
| 10 | NO subagent dispatch | No client.session.create or subagent |
| 11 | NO JavaScript parsing | Glob pattern `**/*.{ts,tsx,mts,cts}` only |
| 12 | NO progress reporting | No progress/token usage in source |
| 13 | NO CLI mode | No REPL, CLI mode, --cli |
| 14 | NO console.log | All logging uses console.error (stderr) |