# olog-mcp

A structural model server for software codebases, exposed as an MCP server for use with [opencode](https://opencode.ai). It ingests your codebase using tree-sitter, builds a persistent graph (the *olog*) of every element and relationship, and gives AI agents grounded, queryable structural knowledge — so they plan and edit code based on facts, not guesses.

## What you get

**Five agents** pre-configured in opencode:

| Agent | Purpose |
|---|---|
| `@olog-elicit` | PM interlocutor — elicits domain concepts through conversation and writes a confirmed DomainBrief to `.plans/briefs/` |
| `@olog-ingestion` | Domain ingestion — runs interactive discovery sessions to surface domain objects from types and classes, and mines structural invariants |
| `@olog-orchestrate` | Plans structural changes, validates them against the olog, and delegates implementation slices to `@olog-implement` |
| `@olog-orient` | Read-only structural queries — answers focused questions about the codebase from olog facts |
| `@olog-implement` | Source editor — receives a fully-resolved DelegationBrief and writes code, verified with `tsc` |

**Three MCP servers** with different tool sets:

### Core server (`olog`) — available to all agents

| Tool | What it does |
|---|---|
| `olog_query` | Search and traverse the graph by kind, name regex, module regex, or multi-hop arrow following |
| `olog_inspect` | Full detail on a single element — provenance, span, incoming/outgoing arrows |
| `olog_overview` | High-level overview: element counts by kind, arrow counts, and all domain elements by name |
| `olog_reindex` | Re-ingest the codebase after source changes |
| `olog_propose_schema` | Add domain objects, arrows, and path equations to the olog |
| `olog_domain_dryrun` | Validate proposed objects/arrows/equations without writing to the DB |
| `olog_plan` | Describe a set of structural operations (rename, move, add, remove) as a validated plan |
| `olog_validate` | Check a plan against uniqueness, referential integrity, and path equation constraints |
| `olog_apply` | Execute a validated plan by hash — writes source edits and updates the olog |
| `olog_render` | Preview the source edits a plan would produce without applying them |
| `olog_delegate` | Assemble a DelegationBrief — all context an edit agent needs to implement one slice |
| `olog_propose_functor` | Map DomainBrief elements to olog elements; asserts `proposedImplementation` arrows into the working set |
| `olog_plan_revise` | Classify each plan operation as keep/rollback/redirect when a DomainBrief changes mid-execution |
| `olog_dot_domain` | Export the domain graph as Graphviz DOT, with optional working-set overlay |
| `olog_ws_open` | Open a named working set to accumulate structural knowledge across a session |
| `olog_ws_add` | Add olog elements to a working set |
| `olog_ws_query` | Query the working set graph with arrow traversal |
| `olog_ws_assert` | Assert a synthetic arrow into a working set (dependency, ambiguity, proposed implementation) |
| `olog_ws_annotate` | Attach a plain-English note to a working set element or arrow |
| `olog_ws_pause` | Pause a working set to preserve it across a revision or handoff |
| `olog_ws_resume` | Resume a paused working set |
| `olog_ws_resolve_synthetic` | Resolve a synthetic arrow's unknown destination once the target element is identified |
| `olog_ws_drop` | Drop a working set when the session is complete |

### Mining server (`olog-mining`) — `@olog-ingestion` only

| Tool | What it does |
|---|---|
| `olog_mine_equations` | Discover path equations that hold in the graph (structural invariants) |
| `olog_domain_discover` | Interactive session: surface domain objects from types/interfaces/classes |
| `olog_discover_motifs` | Find recurring structural patterns across the codebase |

The mining server opens the existing DB without re-ingesting — the core server owns ingestion on startup.

### WS-assert server (`olog-ws-assert`) — `@olog-implement` only

Exposes only `olog_ws_assert`. The implement agent writes to working sets through this minimal server so it cannot access any other olog tools.

## Prerequisites

- **Node.js** 20 or later
- **opencode** — [opencode.ai](https://opencode.ai)

## Installation

Clone the repository and build:

```bash
git clone https://github.com/wilbrt/ologmcp.git /path/to/olog-mcp
cd /path/to/olog-mcp
npm install
npm run build
```

Then run the init command once in the root of the project you want to model:

```bash
node /path/to/olog-mcp/packages/mcp-server/dist/index-init.js
```

This will:
1. Detect which languages your project uses
2. Write five agent files into `.opencode/agents/`
3. Add all three MCP server configurations to `opencode.json`, pointing at the built scripts

Also add `.olog/` to your project's `.gitignore` — the SQLite database is regenerated on each start and should not be committed:

```bash
echo '.olog/' >> .gitignore
```

Commit everything — teammates get the agents automatically when they open the project in opencode:

```bash
git add .opencode/agents/ opencode.json .gitignore
git commit -m "Add olog-mcp"
```

### Elicit-to-orchestrate handoff

Copy `.opencode/commands/olog-orchestrate-brief.md` from this repository into your project's `.opencode/commands/` directory. This adds a `/olog-orchestrate-brief` slash command that opens a fresh orchestration session with the most recently confirmed DomainBrief.

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

The olog is stored in `.olog/olog.sqlite` in your project root. It is regenerated on each start and should not be committed.

### Domain specification (PM workflow)

The PM never sees JSON or code. The full flow:

**1. Elicitation** — open `@olog-elicit` and describe what the system should do. The agent asks focused questions about domain concepts, relationships, and invariants. All tool output is translated to plain English before anything is shown to you. When the conversation is complete and you confirm, the agent writes a `DomainBrief` to `.plans/briefs/` and gives you a file path.

**2. Planning** — pass that file path to `@olog-orchestrate`. The orchestrate agent maps each brief concept to an existing olog element or plans to create a new one, drafts a plan in `.plans/`, validates it against structural constraints, and presents the plan to you in plain English. No IDs, no JSON.

**3. Execution** — on your approval, orchestrate runs the mechanical operations (`rename`, `move`, `addSymbol`, etc.) via `olog_apply`, then delegates each source-edit slice to `@olog-implement` with a fully-resolved DelegationBrief. Between slices it tells you in plain English what changed and asks whether to continue.

**4. Revision** — if implement discovers an ambiguity that only the PM can resolve, orchestrate pauses, presents the question in plain English, and waits for your answer before resuming.

### Domain ingestion (bottom-up)

Use `@olog-ingestion` to build the domain layer from the bottom up — surfacing domain objects from existing types and interfaces and mining structural invariants. This is the alternative to elicitation for teams that want to model what they already have rather than specify what they want to build.

### Planning without a DomainBrief

`@olog-orchestrate` can also be invoked directly with a plain-English goal. It queries the olog via `@olog-orient`, drafts a plan, validates, and executes — the same flow minus the elicitation and mapping steps.

### Visualisation

Export the domain layer as a Graphviz DOT graph by calling `olog_dot_domain` from any agent, or from the olog-mcp directory:

```bash
OLOG_ROOT=/path/to/your-project npm run dot:svg   # render and open as SVG (requires graphviz)
OLOG_ROOT=/path/to/your-project npm run dot       # print DOT to stdout
```

## Configuration

The generated `opencode.json` section (paths are set by the init command to wherever you cloned olog-mcp):

```json
{
  "mcp": {
    "olog": {
      "type": "local",
      "command": ["/path/to/olog-mcp/run-olog-mcp.sh"],
      "environment": { "OLOG_LANGUAGES": "typescript" },
      "enabled": true
    },
    "olog-mining": {
      "type": "local",
      "command": ["/path/to/olog-mcp/run-olog-mining-mcp.sh"],
      "environment": { "OLOG_LANGUAGES": "typescript" },
      "enabled": true
    },
    "olog-ws-assert": {
      "type": "local",
      "command": ["/path/to/olog-mcp/run-olog-ws-assert-mcp.sh"],
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

The repository is a monorepo with five packages:

| Package | Description |
|---|---|
| `packages/core` | Store (SQLite), ingestion pipeline, constraint engine, mining, planning |
| `packages/lang-typescript` | Tree-sitter TypeScript/TSX adapter |
| `packages/lang-clojure` | Tree-sitter Clojure/ClojureScript adapter (includes re-frame support) |
| `packages/mcp-server` | MCP server, tool registration, `init` CLI |
| `packages/viewer` | Working set graph viewer (local web UI) |
