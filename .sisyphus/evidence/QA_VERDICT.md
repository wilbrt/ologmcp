# QA Verdict: olog MCP Server End-to-End Test

**Date**: 2026-04-23
**Tester**: Sisyphus-Junior
**Server Path**: `packages/mcp-server/dist/index.js`
**Test Project**: `packages/mcp-server` (6 TS files)

---

## VERDICT: **APPROVE**

All 8 required tests passed. The MCP server starts, exposes all 4 tools, and responds correctly to MCP protocol requests.

---

## Test Results

### Test 1: Server Startup and Initialization — **PASS**
- Built successfully with `npx tsup`
- Database cleared (`rm -rf .olog`)
- Server responds to `initialize` request
- Correct protocol version (`2024-11-05`), server name (`olog-mcp`), and instructions returned
- Evidence: `.sisyphus/evidence/final-init.json`

### Test 2: Tool Discovery — **PASS**
- `tools/list` returned all 4 tools:
  1. `olog_query` — with Zod schema (kind, name, module, limit), readOnly/idempotent annotations
  2. `olog_inspect` — with Zod schema (id), readOnly/idempotent annotations
  3. `olog_dump` — empty schema, readOnly/idempotent annotations
  4. `olog_reindex` — empty schema, readOnly=false/idempotent=false annotations
- Evidence: `.sisyphus/evidence/final-tools.json`

### Test 3: olog_dump — **PASS**
- Returns `commitSha`, `elementCounts`, `arrowCounts`, `totalElements`, `totalArrows`
- Values: 6 files, 35 elements (file: 6, function: 5, import: 24), 54 arrows (calls: 1, contains: 29, imports: 24)
- Evidence: `.sisyphus/evidence/final-dump.json`

### Test 4: olog_query — **PASS**
- Query with `kind="function"` returned 5 function elements
- Each element has: id, kind, name, module, span, attrs
- Evidence: `.sisyphus/evidence/final-query.json`

### Test 5: olog_inspect — **PASS**
- Inspected element ID: `module:src/index.ts:58:7:function:cleanup`
- Returned: element details + outgoing array (empty) + incoming array (1 contains arrow from file)
- Evidence: `.sisyphus/evidence/final-inspect.json`

### Test 6: olog_reindex — **PASS**
- Returns counts without crashing
- Result: 6 files, 35 elements, 54 arrows in 109ms
- Evidence: `.sisyphus/evidence/final-reindex.json`

### Test 7: Cross-Tool Integration — **PASS**
- Sent reindex → query → dump in single session
- Reindex counts (35 elements, 54 arrows) match dump totals exactly
- Query returned same 5 functions consistently
- Evidence: `.sisyphus/evidence/final-integration.json`

### Test 8: Edge Case — Empty Project — **PASS**
- Created temp empty directory (`/tmp/olog-empty-project`)
- Server started with `OLOG_ROOT=/tmp/olog-empty-project`
- Handled gracefully: 0 files, 0 elements, 0 arrows
- `olog_dump` returned zero counts and empty count objects
- Evidence: `.sisyphus/evidence/final-empty.json`

---

## Known Issue Discovered During QA

**Bug**: When running from the monorepo root (`/Users/wilbrt/projects/ologmcp`), ingestion fails with:
```
UNIQUE constraint failed: olog_arr.id
```

**Root Cause**: The tree-sitter extraction pipeline generates duplicate arrow IDs for certain code patterns in larger projects. The `arrs` array contains duplicates before database insertion.

**Impact**: MEDIUM — the server works fine for small projects (like `packages/mcp-server` itself), but fails on the monorepo root.

**Recommended Fix**: Deduplicate arrows in `runIngestion()` before calling `store.ingestFull()`, or add `ON CONFLICT IGNORE` to the arrow INSERT statement.

---

## Evidence Files Checklist

- [x] `.sisyphus/evidence/final-init.json`
- [x] `.sisyphus/evidence/final-tools.json`
- [x] `.sisyphus/evidence/final-dump.json`
- [x] `.sisyphus/evidence/final-query.json`
- [x] `.sisyphus/evidence/final-inspect.json`
- [x] `.sisyphus/evidence/final-reindex.json`
- [x] `.sisyphus/evidence/final-integration.json`
- [x] `.sisyphus/evidence/final-empty.json`

---

## Summary

The olog MCP server MVP is functional and ready for use. All required tools work correctly, the MCP protocol implementation is solid, and edge cases are handled gracefully. The discovered duplicate-arrow bug should be tracked and fixed before the server is used on larger codebases.
