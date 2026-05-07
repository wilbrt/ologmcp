# olog-mcp

A structural model server for software codebases, exposed as an MCP server for use with [opencode](https://opencode.ai). It ingests your codebase using tree-sitter, builds a persistent graph (the *olog*) of every element and relationship, and gives AI agents grounded, queryable structural knowledge — so they plan and edit code based on facts, not guesses.

## What you get

**Four agents** pre-configured in opencode:

| Agent | Purpose |
|---|---|
| `@olog-ingestion` | Interactive domain modeling — discover objects, propose arrows, mine structural invariants |
| `@olog-orchestrate` | Plan structural changes, validate them against the olog, delegate implementation to the edit agent |
| `@olog-orient` | Read-only structural queries — answers focused questions about the codebase from olog facts |
| `@olog-implement` | Source editor — receives a fully-resolved brief and writes code, verified with `tsc` |

**Two MCP servers** with different tool sets:

### Core server (`olog`) — available to all agents

| Tool | What it does |
|---|---|
| `olog_query` | Search and traverse the graph by kind, name regex, module regex, or multi-hop arrow following |
| `olog_inspect` | Full detail on a single element — provenance, span, incoming/outgoing arrows |
| `olog_overview` | High-level overview: element counts by kind, arrow counts, recent provenance |
| `olog_reindex` | Re-ingest the codebase after source changes |
| `olog_propose_schema` | Add domain objects, arrows, and path equations to the olog |
| `olog_plan` | Describe a set of structural operations (rename, move, add, remove) as a plan |
| `olog_validate` | Check a plan against uniqueness, referential integrity, and path equation constraints |
| `olog_apply` | Execute a validated plan — writes source edits and updates the olog |
| `olog_render` | Preview the source edits a plan would produce without applying them |
| `olog_delegate` | Assemble a DelegationBrief — all context an edit agent needs to implement one slice |
| `olog_dot` | Export the domain graph as Graphviz DOT for visualisation |

### Mining server (`olog-mining`) — `@olog-ingestion` only

| Tool | What it does |
|---|---|
| `olog_mine_equations` | Discover path equations that hold in the graph (structural invariants) |
| `olog_domain_discover` | Interactive session: surface domain objects from types/interfaces/classes |
| `olog_discover_motifs` | Find recurring structural patterns across the codebase |

The mining server opens the existing DB without re-ingesting — the core server owns ingestion on startup.

## Prerequisites

- **Node.js** 20 or later
- **opencode** — [opencode.ai](https://opencode.ai)

## Installation

Run this once in the root of the project you want to model:

```bash
npx -p @olog/mcp-server olog-mcp-init
```

This will:
1. Detect which languages your project uses
2. Write four agent files into `.opencode/agents/`
3. Add both MCP server configurations to `opencode.json`

Commit both — teammates get the agents automatically when they open the project in opencode.

```bash
git add .opencode/agents/ opencode.json
git commit -m "Add olog-mcp"
```

## Language support

The init command detects languages automatically by looking for indicator files:

| Language | Detected by |
|---|---|
| TypeScript / JavaScript | `tsconfig.json`, `package.json`, `*.ts`, `*.tsx` |
| Clojure / ClojureScript | `deps.edn`, `project.clj`, `shadow-cljs.edn`, `*.clj`, `*.cljs` |

Detection result is written into `opencode.json` as `OLOG_LANGUAGES`. Edit that value manually if you want to override it.

For Clojure/ClojureScript projects using re-frame, the adapter indexes `reg-sub`, `reg-event-db`, `reg-event-fx`, `reg-fx`, and `reg-cofx` forms as named elements, and emits `callerOf` arrows for `subscribe` and `dispatch` call sites.

For projects not yet supported, the server starts without a language adapter — the olog will be empty until a parser for your language is added. See [Adding a language adapter](#adding-a-language-adapter) below.

## How it works

### Ingestion

When opencode starts, the core MCP server automatically ingests your codebase using tree-sitter. Every function, class, type, interface, method, import, and call site becomes an element in the olog. Relationships between them (calls, imports, extends, implements, etc.) become arrows.

The olog is stored in `.olog/olog.sqlite` in your project root. Add it to `.gitignore` — it is regenerated on each start.

### Domain modeling

The olog starts with code-level elements. The `@olog-ingestion` agent helps you lift those into a *domain layer* — named concepts like "Order", "Customer", "Shipment" — with typed arrows between them and structural invariants (path equations) that must hold.

Use `@olog-ingestion` to:
- Run a discovery session: surfaces candidate domain objects from your types and interfaces
- Accept, reject, rename, and refine candidates interactively
- Mine path equations from the graph to formalise architectural constraints

### Planning and editing

The `@olog-orchestrate` agent helps you plan structural changes (renames, moves, extractions, new abstractions). It:
1. Gathers structural context by delegating queries to `@olog-orient`
2. Writes a plan file to `.plans/`
3. Validates the plan against olog constraints before touching any code
4. Delegates each implementation slice to `@olog-implement` with a fully-resolved brief

The `@olog-implement` agent receives a `DelegationBrief` — a self-contained JSON with the target file, analogous implementations, required interfaces, and acceptance criteria. It writes the code and verifies with `tsc`.

### Visualisation

Export the domain layer as a Graphviz DOT graph:

```bash
npm run dot:svg   # render and open as SVG (requires graphviz)
npm run dot       # print DOT to stdout
```

Or call `olog_dot` directly from any agent.

## Configuration

The generated `opencode.json` section:

```json
{
  "mcp": {
    "olog": {
      "type": "local",
      "command": ["npx", "-y", "-p", "@olog/mcp-server", "olog-mcp"],
      "environment": { "OLOG_LANGUAGES": "typescript" },
      "enabled": true
    },
    "olog-mining": {
      "type": "local",
      "command": ["npx", "-y", "-p", "@olog/mcp-server", "olog-mcp-mining"],
      "environment": { "OLOG_LANGUAGES": "typescript" },
      "enabled": true
    }
  }
}
```

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `OLOG_ROOT` | `cwd` | Project root to ingest |
| `OLOG_LANGUAGES` | auto-detected | Comma-separated list of language adapters to load |

## Adding a language adapter

A language adapter is a small package that wraps a tree-sitter grammar and maps parse tree nodes to olog element/arrow kinds.

1. Create a package `packages/lang-<name>/` modelled on `packages/lang-typescript/`
2. Export a class `<Name>Adapter` that implements `LanguageAdapter` from `@olog/core`
3. Add `@olog/lang-<name>` to the `dependencies` of `@olog/mcp-server`
4. Add `'@olog/lang-<name>'` and its tree-sitter grammar to the `external` array in `packages/mcp-server/tsup.config.ts`
5. Add an entry to `ADAPTER_CLASS` in `packages/mcp-server/src/index.ts`
6. Add detection signals to `INDICATORS` in `packages/mcp-server/src/detect.ts`

## Development

```bash
npm install
npm run build       # build all packages
npm run typecheck   # type-check all packages
npm run dot:svg     # visualise the domain graph of this repo
```

The repository is a monorepo with four packages:

| Package | Description |
|---|---|
| `packages/core` | Store (SQLite), ingestion pipeline, constraint engine, mining, planning |
| `packages/lang-typescript` | Tree-sitter TypeScript/TSX adapter |
| `packages/lang-clojure` | Tree-sitter Clojure/ClojureScript adapter (includes re-frame support) |
| `packages/mcp-server` | MCP server, tool registration, `init` CLI |
