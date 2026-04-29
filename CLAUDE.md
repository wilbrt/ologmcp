# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install            # install all workspace dependencies
npm run build          # build all packages (tsup + copies schema.sql and .scm query files)
npm run typecheck      # type-check all packages
npm run dot            # print DOT graph of this repo's domain layer to stdout
npm run dot:svg        # render and open as SVG (requires graphviz)
```

There are no tests yet (`npm run test` echoes a placeholder in each package).

To build a single package:
```bash
npm run build --workspace=packages/core
npm run build --workspace=packages/mcp-server
```

## Architecture

This is an npm workspaces monorepo. Four packages:

| Package | npm name | Role |
|---|---|---|
| `packages/core` | `@olog/core` | SQLite store, ingestion, constraint engine, mining, planning, rendering, delegation |
| `packages/lang-typescript` | `@olog/lang-typescript` | Tree-sitter TypeScript/TSX adapter |
| `packages/lang-clojure` | `@olog/lang-clojure` | Tree-sitter Clojure adapter |
| `packages/mcp-server` | `@olog/mcp-server` | MCP server process, tool registration, `init` CLI |

### Data model (`packages/core/src/ontology.ts`)

The olog is a graph stored in SQLite (`.olog/olog.sqlite` in the target project root). Two core entity types:

- **OlogElem** — a named node with a `kind` (`OlogKind`: file, module, function, class, interface, type, method, const, domain, etc.), an optional `module` path, an optional source `span`, and a JSON `attrs` bag.
- **OlogArr** — a directed edge with a `kind` (`ArrowKind`: calls, imports, extends, implements, contains, hasProperty, implementedAs, etc.), `srcId`, `dstId`, and a JSON `attrs` bag.

Elements carry **provenance** (`olog_prov`): `source` ('tree-sitter', 'llm', 'manual'), `commit_sha`, `ingested_at`, and `confidence` ('resolved' | 'unresolved' | 'tentative').

Domain-layer elements have `kind = 'domain'`. They are written by `olog_propose_schema` / `olog_domain_discover` and persist across re-indexing (only tree-sitter-sourced elements are cleared on reindex; non-tree-sitter elements are preserved).

### Ingestion pipeline

`ingestProject` (`packages/core/src/ingest/project.ts`) walks the project root, dispatches each file to the matching `LanguageAdapter` (looked up from `AdapterRegistry` by file extension), runs tree-sitter queries, and calls `OlogStore.ingestFull()` to write everything in one transaction.

`OlogStore` (`packages/core/src/db.ts`) wraps `better-sqlite3`. It requires SQLite >= 3.37.0 (STRICT tables). The SQL schema is at `packages/core/src/schema.sql` and is copied to `dist/` at build time. Tree-sitter `.scm` query files live in `packages/core/src/ingest/queries/` and are also copied to `dist/`.

### Language adapters

Each adapter implements `LanguageAdapter` (`packages/core/src/ingest/adapter.ts`):
- `languageId`, `extensions`, `globPattern`
- `createParser(filename)` — returns a configured tree-sitter parser
- `queryPath(filename)` — returns the `.scm` query file for this file
- `extractElements(parser, source, queryPath)` — returns `{ elements: RawElement[], arrows: RawArrow[] }`
- Optional: `extractProperties`, `findContainingFunctionName`, `resolveImportSpecifier`

To add a new language, follow the steps in the README's "Adding a language adapter" section — create `packages/lang-<name>/`, implement `LanguageAdapter`, register it in `ADAPTER_CLASS` in `packages/mcp-server/src/index.ts`, and add detection signals to `packages/mcp-server/src/detect.ts`.

### MCP server

`packages/mcp-server/src/index.ts` is the entry point. On startup it:
1. Creates `.olog/olog.sqlite` in `OLOG_ROOT` (default: `cwd`)
2. Loads language adapters specified by `OLOG_LANGUAGES` (or auto-detected)
3. Runs `ingestProject`
4. Registers all 14 tools on the `McpServer` instance
5. Connects via `StdioServerTransport`

Each tool lives in `packages/mcp-server/src/tools/olog-<name>.ts` and exports a single `register*` function that receives `(server, store, [projectRoot])`.

When invoked as `node dist/index.js init`, it runs the init CLI (`packages/mcp-server/src/init.ts`) to write agent files and `opencode.json` into a target project.

### Build notes

`packages/mcp-server` build script copies `../core/src/schema.sql` and `../core/src/ingest/queries/` into `dist/`. If you add `.scm` query files, ensure the build script picks them up. The `tsup.config.ts` in each package marks native addons (`better-sqlite3`, tree-sitter grammar `.node` files) as external.
