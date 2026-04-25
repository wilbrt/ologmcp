# Shadow-olog implementation guide for opencode plugin developers

Shadow-olog is an opencode plugin that maintains a typed, queryable structural model of a TypeScript codebase — an **ontology log (olog)** in David Spivak's sense — built by fusing **tree-sitter** syntactic ingestion with **typescript-language-server** semantic resolution, persisted in **bun:sqlite**, and surfaced to the agent as a set of custom tools. This guide walks a developer from empty directory to a first-run system. It is organized so you can read it linearly the first time and jump back to sections 4–6 as a reference thereafter.

Every API-level claim was verified against current documentation and source at the time of writing (April 2026). Where behavior is version-sensitive or under-documented, claims are marked **VERIFY:** so you re-confirm against your installed versions before shipping.

---

## 1. Project setup

### 1.1 Monorepo layout

The system is cleanly split into a runtime-agnostic **core** (ontology types, SQLite store, tree-sitter queries, LSP driver) and a thin **opencode-plugin** shell that registers hooks and tools. Keeping them separate lets you unit-test the ingestion pipeline without booting opencode and lets the same core be reused from a CLI or from tests.

```
olog-monorepo/
├── package.json              # workspaces root
├── tsconfig.base.json
├── tsconfig.json             # solution (optional, references only)
├── bunfig.toml
├── bun.lock
├── .github/workflows/ci.yml
└── packages/
    ├── core/
    │   ├── package.json              # "@olog/core"
    │   ├── tsconfig.json
    │   ├── src/
    │   │   ├── index.ts              # re-exports
    │   │   ├── db.ts                 # bun:sqlite store (OlogStore)
    │   │   ├── schema.sql            # DDL
    │   │   ├── ingest/
    │   │   │   ├── treesitter.ts     # Parser + Query
    │   │   │   ├── queries/ts.scm
    │   │   │   └── queries/tsx.scm
    │   │   ├── lsp/
    │   │   │   ├── client.ts         # LspClient (vscode-jsonrpc)
    │   │   │   └── apply-edit.ts     # WorkspaceEdit applier
    │   │   ├── ontology.ts           # elem/arrow/attr types
    │   │   └── util/positions.ts     # UTF-8 ↔ UTF-16 helpers
    │   └── test/*.test.ts
    └── opencode-plugin/
        ├── package.json              # "@olog/opencode-plugin"
        ├── tsconfig.json
        └── src/
            ├── index.ts              # default export Plugin
            ├── tools/olog-query.ts
            ├── tools/olog-plan.ts
            ├── tools/olog-apply.ts
            └── state.ts              # per-session Map<sessionID, ...>
```

### 1.2 Root `package.json`

Pin Bun as `packageManager` so everyone gets the same transpiler/resolver. List native native-binding packages in `trustedDependencies` so Bun runs their postinstall (critical for `tree-sitter` prebuild resolution — see §4.1).

```json
{
  "name": "olog-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.13",
  "workspaces": ["packages/*"],
  "scripts": {
    "build":     "bun --filter '*' run build",
    "typecheck": "bun --filter '*' run typecheck",
    "test":      "bun test",
    "test:watch":"bun test --watch",
    "clean":     "rm -rf packages/*/dist packages/*/*.tsbuildinfo"
  },
  "devDependencies": {
    "@types/bun": "^1.3.12",
    "typescript": "^6.0.3"
  },
  "trustedDependencies": ["tree-sitter", "tree-sitter-typescript"]
}
```

### 1.3 Per-package manifests

`packages/core/package.json`:

```json
{
  "name": "@olog/core",
  "version": "0.0.1",
  "type": "module",
  "module": "src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "import": "./src/index.ts" } },
  "scripts": {
    "build":     "bun build ./src/index.ts --outdir=dist --target=bun --format=esm",
    "typecheck": "tsc --noEmit",
    "test":      "bun test"
  },
  "dependencies": {
    "tree-sitter":            "^0.25.0",
    "tree-sitter-typescript": "^0.23.2",
    "vscode-jsonrpc":         "^8.2.1"
  },
  "devDependencies": { "@types/bun": "^1.3.12", "typescript": "^6.0.3" }
}
```

`packages/opencode-plugin/package.json` — note the **leading `./` in `main` is required** because opencode's Go-based resolver rejects bare `dist/index.js`:

```json
{
  "name": "@olog/opencode-plugin",
  "version": "0.0.1",
  "type": "module",
  "main":   "./dist/index.js",
  "module": "./dist/index.js",
  "types":  "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build":     "bun build ./src/index.ts --outdir=dist --target=node --format=esm --external @opencode-ai/plugin --external @opencode-ai/sdk --external bun:sqlite --sourcemap=linked && tsc -p tsconfig.build.json --emitDeclarationOnly --declaration --outDir dist",
    "typecheck": "tsc --noEmit",
    "test":      "bun test"
  },
  "dependencies": {
    "@olog/core":          "workspace:*",
    "@opencode-ai/plugin": "^1.4.6",
    "@opencode-ai/sdk":    "^1.14.19"
  },
  "devDependencies": { "@types/bun": "^1.3.12", "typescript": "^6.0.3" }
}
```

Use `--target=node` for the published plugin (opencode runs it under Bun, which is Node-compatible in the other direction — avoid `Bun.*` APIs in the plugin shell unless guarded). The **core** package can target `bun` because it's only consumed from the plugin at runtime.

### 1.4 TypeScript configuration

`tsconfig.base.json` — strict, ESM, `moduleResolution: "bundler"` (matches Bun's resolver, accepts `.ts` imports, workspace specifiers, and `package.json#exports`):

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "types": ["bun"],
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true
  },
  "exclude": ["**/node_modules", "**/dist"]
}
```

Each workspace extends it with `rootDir: src` and its `include`. **Composite projects are not required** — Bun resolves `.ts` across workspaces natively via `workspace:*` symlinks. Only add `composite: true` + project references if you need incremental `tsc --build` caches or published `.d.ts` emission.

### 1.5 Dependency versions (verified April 2026)

| Package | Pin | Why |
|---|---|---|
| `bun` | `1.3.13` | Latest stable; contains `Readable.fromWeb` pipeline-stall fix (v1.3.12) critical for LSP |
| `typescript` | `^6.0.3` | Last TS on the JS codebase; TS 7 native preview may need retesting |
| `@types/bun` | `^1.3.12` | Shim over `bun-types`; provides `bun:*` module types |
| `@opencode-ai/plugin` | `^1.4.6` | **VERIFY:** dual version track — npm may also show `1.14.x` in lockstep with the `opencode-ai` CLI. Pin to what `npm view @opencode-ai/plugin version` reports on install day |
| `@opencode-ai/sdk` | `^1.14.19` | Bundled alongside the CLI |
| `tree-sitter` | `^0.25.0` | Modern N-API bindings; no V8-symbol issues on Bun ≥ 1.2 |
| `tree-sitter-typescript` | `^0.23.2` | Must be rebuilt against tree-sitter ≥ 0.22 bindings |
| `web-tree-sitter` | `^0.26.8` | WASM alternative |
| `vscode-jsonrpc` | `^8.2.1` | Stable; 9.0.0-next.x is pre-release |

### 1.6 Build, test, typecheck commands

- `bun install` — installs everything, symlinks workspaces, runs postinstalls for trusted deps.
- `bun --filter '*' run typecheck` — runs `tsc --noEmit` in every package.
- `bun test` — runs all `*.test.ts`. Use `--watch`, `--coverage`, `-t "pattern"`, `--bail=1`.
- `bun --filter '*' run build` — emits `dist/` for the plugin.

Bun does **not** type-check at runtime. `tsc --noEmit` is still the source of truth for types.

---

## 2. The opencode plugin API

opencode loads plugins at session start from three sources: `.opencode/plugin/*.ts` (project), `~/.config/opencode/plugin/*.ts` (global), and npm packages listed in the `plugin` array of `opencode.json`. For npm specs opencode runs `bun install` into `~/.cache/opencode/node_modules/`. Plural (`plugins/`) directory names are accepted for back-compat.

> **VERIFY**: the opencode GitHub repo was migrated from `sst/opencode` to `anomalyco/opencode`; npm package names are unchanged. Docs "Edit page" links now point to `anomalyco/opencode`. Several type-level details below were reconstructed from docs plus session/llm.ts source plus community reverse-engineering because `packages/plugin/src/index.ts` wasn't directly fetchable; cross-check against your installed `@opencode-ai/plugin`.

### 2.1 The `Plugin` type and context

A plugin is an **async factory** that receives a single destructurable context and returns a **`Hooks` object**. The factory runs once per opencode instance; hooks run per event.

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async ({ client, project, $, directory, worktree }) => {
  // one-shot setup here
  return { /* hooks */ }
}
export default MyPlugin
```

Context fields:

- **`client`** — an `OpencodeClient` from `@opencode-ai/sdk` bound to the local opencode server (typically `http://127.0.0.1:4096`). See §3.
- **`project`** — `{ id, worktree, vcs? }`. `project.id` is a git hash or `"global"`; `worktree` is the repo root.
- **`directory`** — current working directory at plugin-load time.
- **`worktree`** — alias for `project.worktree`.
- **`$`** — Bun's tagged-template shell (`Bun.$`), useful for `await $\`git rev-parse HEAD\`.text()`.

A single file may export multiple named `Plugin` functions; each is treated as an independent plugin.

### 2.2 Hooks: signatures and semantics

The reconstructed `Hooks` interface. All hooks are optional.

```ts
interface Hooks {
  event?:                (input: { event: Event }) => Promise<void>
  config?:               (config: Config) => Promise<void>
  tool?:                 Record<string, ToolDefinition>
  auth?:                 AuthHook
  "chat.message"?:       (input: {}, output: { message: UserMessage, parts: Part[] }) => Promise<void>
  "chat.params"?:        (input: ChatParamsInput, output: ChatParamsOutput) => Promise<void>
  "chat.headers"?:       (input: ChatParamsInput, output: { headers: Record<string,string> }) => Promise<void>
  "permission.ask"?:     (input: PermInput, output: { status: "ask"|"allow"|"deny" }) => Promise<void>
  "tool.execute.before"?:(input: { tool: string, sessionID: string, callID: string },
                          output: { args: Record<string, any> }) => Promise<void>
  "tool.execute.after"?: (input: { tool: string, sessionID: string, callID: string },
                          output: { title: string, output: string, metadata: Record<string, any> }) => Promise<void>
  "shell.env"?:          (input: { cwd: string }, output: { env: Record<string,string> }) => Promise<void>
  "experimental.session.compacting"?:     (input: any, output: any) => Promise<void>
  "experimental.chat.system.transform"?:  (input: any, output: { system: string[] }) => Promise<void>
}
```

**`event`** — fires for a broad set of event types. Key ones for shadow-olog:

- Session lifecycle: `session.created`, `session.updated`, `session.idle`, `session.error`, `session.deleted`, `session.compacted`, `session.diff`, `session.status`.
- Messages: `message.updated`, `message.part.updated`, `message.part.removed`, `message.removed`.
- Tools: `tool.execute.before`, `tool.execute.after` (also available as standalone hooks — prefer the dedicated hook when you want to mutate args).
- Files: `file.edited`, `file.watcher.updated`.
- Permissions: `permission.asked`, `permission.replied`.
- LSP: `lsp.updated`, `lsp.client.diagnostics`.
- Misc: `installation.updated`, `server.connected`, `command.executed`, `todo.updated`, `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`, `shell.env`.

**Session ID extraction is inconsistent across event payloads.** Use a resilient extractor:

```ts
const sid = (e: any): string | undefined =>
  e?.properties?.sessionID ?? e?.sessionID ?? e?.session_id
```

**`tool.execute.before(input, output)`** — `output.args` is a live, mutable reference. Assign `output.args.command = sanitized` to modify. `throw` to **block** the tool call; the throw surfaces as a tool error to the LLM. This is the **reliably-called** enforcement point (see permission caveat below).

**`tool.execute.after(input, output)`** — rewrite `output.title`, `output.output`, `output.metadata`. Use this to sanitize stdout, attach metadata, or log.

**`chat.params(input, output)`** — called in `packages/opencode/src/session/llm.ts` right before the LLM request. `output` looks like:

```ts
{
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  options: Record<string, unknown>   // provider-specific bag
}
```

Anything you add to `output.options` lands in the outgoing provider call — e.g. Anthropic-specific `cacheControl`, OpenAI `reasoningEffort` / `textVerbosity` / `include` / `store`. Temperature/topP/maxOutputTokens go straight into the AI-SDK call. You can verify delivery by enabling the provider SDK's request logging or by setting `OPENCODE_LOG_LEVEL=DEBUG`.

**`chat.message`** — intercept the user message before dispatch; mutate `output.message.content` or `output.parts`. A clean place to inject olog context as additional parts.

**`permission.ask`** — set `output.status = "allow"` or `"deny"` to short-circuit the user prompt. **VERIFY:** an open issue (anomalyco/opencode#7006) reports this hook is not being invoked in some recent versions. **Do not rely on `permission.ask` for hard enforcement** — use `tool.execute.before` with `throw` instead.

**`shell.env`** — fires for every shell invocation (AI `bash` tool and user terminals). Mutate `output.env` to inject secrets or `PROJECT_ROOT`-style vars.

**`auth`** — register a provider and/or a `fetch` wrapper. Used by plugins like `opencode-claude-auth` to rewrite outbound LLM requests. Not needed by shadow-olog.

### 2.3 Registering custom tools

Plugins expose tools via the `tool` field of the returned hooks object, using the `tool()` helper from `@opencode-ai/plugin`. The helper bundles Zod as `tool.schema`.

```ts
import { tool, type Plugin } from "@opencode-ai/plugin"
const z = tool.schema

export const OlogTools: Plugin = async ({ client }) => ({
  tool: {
    olog_query: tool({
      description: "Query the ontology. Returns elements matching kind+name filters.",
      args: {
        kind: z.enum(["type","interface","class","function","method","import","call","any"]).default("any"),
        name: z.string().optional().describe("regex against element name"),
        limit: z.number().int().min(1).max(500).default(50),
      },
      async execute(args, ctx) {
        // ctx: { sessionID, messageID, agent, abort: AbortSignal }
        if (ctx.abort.aborted) throw new Error("aborted")
        const rows = store.query(args)
        return {
          title: `olog_query(${args.kind}${args.name ? ", /"+args.name+"/" : ""})`,
          output: JSON.stringify(rows, null, 2),
          metadata: { rows: rows.length, sessionID: ctx.sessionID },
        }
      },
    }),
  },
})
```

The LLM sees a tool named `olog_query` with the description and a JSON-Schema-ified argument object. Tool names collide with built-ins: plugin tools **win** over built-ins with the same name.

An alternative tool-registration path exists: **`.opencode/tool/*.ts` files**. Filename becomes the tool name; the default export is a `tool()` call. Use this only when a tool has no setup state; otherwise keep them in a plugin so they can close over the `OlogStore` instance.

### 2.4 Plugin loading and hot reload

- Local plugins under `.opencode/plugin/` are loaded directly by Bun (no build step).
- npm plugins via `opencode.json`'s `plugin: [...]` array. Supported specifiers: `"pkg"`, `"pkg@version"`, scoped `"@org/pkg"`, `file:///absolute/path/dist/index.js`, and relative local paths.
- opencode runs `bun install` at startup and caches in `~/.cache/opencode/node_modules/`. Local plugins that need their own npm deps ship a `.opencode/package.json` — opencode installs that too.
- Pin versions in `opencode.json` (`"foo@1.2.3"`) to avoid unpinned auto-upgrades at startup.
- **Hot reload**: opencode re-initializes plugins when config files change, but **live reload of plugin source is not documented**. Restart opencode after editing plugin code.

### 2.5 Logging and error handling

**Never use `console.log`.** It can corrupt the TUI and is not captured in structured logs. Use the SDK:

```ts
await client.app.log({
  body: { service: "olog", level: "info" | "warn" | "error" | "debug", message: "...", extra: {} }
})
```

Logs land in `~/.local/share/opencode/log/*.log`. Run `opencode --log-level DEBUG` for verbose console output during development (**VERIFY:** issue #6583 reports this flag can delete the pre-existing log file — confirm on current version).

**Never crash opencode.** Wrap every hook body in `try { ... } catch (e) { await log("error", ...) }`. An unhandled rejection from a hook has historically broken session flow (issue #11392). The only hook where `throw` is semantically meaningful is `tool.execute.before` (blocks the tool).

### 2.6 Permissions

Two systems operate in parallel: (a) config-driven `permission` rules in `opencode.json`, (b) the `permission.ask` plugin hook. Because the hook is unreliable across versions, use `tool.execute.before` as the enforcement point and use config-driven rules for coarse allow/deny lists.

### 2.7 Slash commands

**Plugins cannot register `/`-commands** (feature request anomalyco/opencode#5305 is open). Commands are file-based: drop a markdown file in `.opencode/command/*.md` (project) or `~/.config/opencode/command/` (global). Frontmatter sets `description`, `agent`, `model`; body is the prompt template with `@file`, `!shell`, and `$ARGUMENTS` placeholders. Plugins can reactively observe `command.executed` events and push context via `client.session.prompt({ body: { noReply: true, ... } })`.

---

## 3. The opencode SDK and subagent dispatch

### 3.1 SDK shape

`@opencode-ai/sdk` exposes two factories:

```ts
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"

// Plugins use this — connect to the already-running opencode server
const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  responseStyle: "fields",  // or "data"
  throwOnError: false,
})
```

Client namespaces (verbatim from SDK docs):

| Namespace | Relevant methods for shadow-olog |
|---|---|
| `global`  | `health()` |
| `app`     | `log({ body: { service, level, message, extra? } })`, `agents()` |
| `project` | `current()`, `list()` |
| `path`    | `get()` |
| `config`  | `get()`, `providers()` |
| `find`    | `text()`, `files()`, `symbols()` |
| `file`    | `read({ query: { path } })`, `status()` |
| `tui`     | `appendPrompt()`, `submitPrompt()`, `showToast()`, `executeCommand()` |
| `event`   | `subscribe() → { stream: AsyncIterable<Event> }` (SSE) |
| `session` | `list`, `get`, `children`, `create`, `prompt`, `abort`, `messages`, `delete`, etc. |

### 3.2 The task tool and subagent configuration

opencode ships a built-in `task` tool (`packages/opencode/src/tool/task.ts`) analogous to Claude Code's. The LLM invokes it with:

```jsonc
{ "description": "short", "prompt": "detailed task", "subagent_type": "olog-ingest", "task_id": "ses_..." /* optional */ }
```

`task` creates a **child session** (`parentID: currentSessionID`), selects the named agent, prompts it, and returns the final assistant message. The subagent's intermediate tool calls are **not** injected into the parent's context — only the summary. Plugin `tool.execute.before` hooks **do not fire for tool calls made inside a subagent session** (issue #5894) — enforce restrictions via the subagent's `permission:` config, not plugin hooks.

**Subagent markdown at `.opencode/agent/<name>.md`** (the canonical plural `agents/` is also accepted). Filename becomes the agent ID.

```markdown
---
description: Ingest a TypeScript file tree and emit structured elements+arrows
mode: subagent            # primary | subagent | all
hidden: true              # invoked programmatically, not via @-autocomplete
model: anthropic/claude-haiku-4-20250514
temperature: 0.1
steps: 25                 # (replaces deprecated maxSteps)
permission:
  edit: deny
  webfetch: deny
  bash: { "*": deny, "rg *": allow, "grep *": allow }
---
You are the olog-ingest subagent. You have read-only tools and must return …
```

Tool-restriction precedence (later overrides earlier, within a pattern map **last matching rule wins** — put `"*"` first):

1. Hardcoded defaults → 2. Native agent defaults → 3. Global `permission` in `opencode.json` → 4. `agent.<name>.permission` in `opencode.json` → 5. Markdown frontmatter → 6. Session-level `permission` passed to `Session.create`.

### 3.3 Dispatching a subagent from a plugin

There is no dedicated `client.task.dispatch()` API. Reproduce what `TaskTool.execute` does:

```ts
const { data: child } = await client.session.create({
  body: { parentID: toolCtx.sessionID, title: "olog-ingest dispatch" },
})

const { data } = await client.session.prompt({
  path: { id: child.id },
  body: {
    agent: "olog-ingest",
    parts: [{ type: "text", text: "..." }],
    format: {
      type: "json_schema",
      schema: { type: "object", properties: { elems: { type: "array" } }, required: ["elems"] },
      retryCount: 2,
    },
  },
})

const structured = (data as any)?.info?.structured_output
```

For **context injection only** (no LLM turn), set `noReply: true` on a prompt sent to the **parent** session — useful for pushing olog snapshots into the primary agent's context.

> **VERIFY**: `session.create` body shape. `parentID` is how `TaskTool` calls it internally; the OpenAPI-generated SDK types may surface it as `parent_id`. If the typed surface rejects `parentID`, cast or use `throwOnError: false` and inspect the wire payload.

### 3.4 Failures, timeouts, cancellation

- No built-in per-task timeout. Implement it: `Promise.race([promptPromise, timer])` + `client.session.abort({ path: { id: childId } })`.
- Issue #6573: when running via REST mode, `task`-dispatched subagents can hang in `{ type: "busy" }`. Always wrap with timeout in production.
- Structured-output failures appear as `data.info.error` with `{ name: "StructuredOutputError", message, retries }`.

A robust wrapper for shadow-olog:

```ts
async function dispatchSubagent(client: any, opts: {
  parentSessionID: string; agent: string; prompt: string; timeoutMs?: number
}): Promise<{ ok: true; text: string; structured?: unknown } | { ok: false; reason: string }> {
  const { data: child } = await client.session.create({
    body: { parentID: opts.parentSessionID, title: `${opts.agent} dispatch` },
  })
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? 120_000)
  try {
    const { data } = await client.session.prompt({
      path: { id: child.id },
      body: { agent: opts.agent, parts: [{ type: "text", text: opts.prompt }] },
      signal: abort.signal as any,
    })
    if (data.info?.error) return { ok: false, reason: `${data.info.error.name}: ${data.info.error.message}` }
    const text = (data.parts ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
    return { ok: true, text, structured: (data as any)?.info?.structured_output }
  } catch (e: any) {
    if (abort.signal.aborted) {
      await client.session.abort({ path: { id: child.id } }).catch(() => {})
      return { ok: false, reason: "timeout" }
    }
    return { ok: false, reason: e?.message ?? String(e) }
  } finally { clearTimeout(timer) }
}
```

---

## 4. Tree-sitter integration in Bun

### 4.1 Native vs WASM

**Native** (`tree-sitter@^0.25.0` + `tree-sitter-typescript@^0.23.2`) uses prebuildify-generated N-API addons. Expect ~2–4× faster parsing than WASM on large files. Compatibility has been rough historically (Bun issues #2732, #3524, #4188, #4254, #6311 all involved old NAN-era bindings linking against V8 symbols JavaScriptCore doesn't provide), but the current bindings (tree-sitter ≥ 0.21 rewrote to pure N-API) resolve that class of issues. The remaining sharp edges:

- **Trusted dependencies**: without them, Bun skips postinstalls and you get `Cannot find module './prebuilds/<platform>/tree-sitter.node'`. Both packages are in Bun's default trusted list, but list them explicitly in your root `package.json` for portability (see §1.2).
- No prebuild for your (OS, arch, libc) → falls back to `node-gyp`, which needs Python 3 + a C++ toolchain. Alpine/musl has no prebuild at all.
- Issue #23770 (still open) reports sporadic prebuild resolution failures on Bun 1.3.0; if hit, `bun pm trust --all && rm -rf node_modules bun.lock && bun install`.

**WASM** (`web-tree-sitter@^0.26.8` + grammar `.wasm` files) runs identically on every platform including Alpine, Windows, and CI with no toolchain. Slower, but 100% reproducible. The `function-graph-overview` project explicitly confirms it works well in Bun.

**Recommendation for shadow-olog**: **start with native** and keep the WASM path as a fallback behind a feature flag. Native's speed matters when reingesting after a branch switch on a large repo.

### 4.2 Parser setup — native

```ts
// packages/core/src/ingest/treesitter.ts
import Parser from "tree-sitter"
import TS from "tree-sitter-typescript"

export function parserFor(filename: string): Parser {
  const p = new Parser()
  p.setLanguage(/\.(tsx|jsx)$/i.test(filename) ? TS.tsx : TS.typescript)
  return p
}
```

### 4.3 Parser setup — WASM fallback

```ts
import { Parser, Language } from "web-tree-sitter"
import path from "node:path"

let initialized: Promise<void> | null = null
const cache = new Map<string, Language>()

async function ensureInit() {
  if (!initialized) {
    initialized = Parser.init({
      locateFile: (n: string) => path.join(import.meta.dir, "wasm", n),
    })
  }
  await initialized
}

export async function parserForWasm(filename: string): Promise<Parser> {
  await ensureInit()
  const key = /\.(tsx|jsx)$/i.test(filename) ? "tsx" : "typescript"
  let lang = cache.get(key)
  if (!lang) {
    lang = await Language.load(path.join(import.meta.dir, "wasm", `tree-sitter-${key}.wasm`))
    cache.set(key, lang)
  }
  const p = new Parser()
  p.setLanguage(lang)
  return p
}
```

### 4.4 TypeScript queries (`.scm`)

Put these in `packages/core/src/ingest/queries/ts.scm`. They capture the universal-base elements — File, Module, Symbol, CallSite, Import — plus enough metadata for arrows.

```scheme
;; --- function_declaration -------------------------------------------------
(function_declaration
  name: (identifier) @function.name
  parameters: (formal_parameters) @function.params
  return_type: (type_annotation)? @function.return_type
  body: (statement_block) @function.body) @function

;; --- arrow_function (anonymous; use parent for a usable name) -------------
(variable_declarator
  name: (identifier) @function.name
  value: (arrow_function
           parameters: (_) @function.params
           body: (_) @function.body) @function) @function.decl

(export_statement (arrow_function) @function)

(pair
  key: [(property_identifier) (string)] @function.name
  value: (arrow_function) @function)

;; --- method_definition ----------------------------------------------------
(method_definition
  name: (_) @method.name
  parameters: (formal_parameters) @method.params
  return_type: (type_annotation)? @method.return_type
  body: (statement_block)? @method.body) @method

(abstract_method_signature name: (_) @method.name) @method.abstract

;; --- class_declaration ----------------------------------------------------
(class_declaration
  name: (type_identifier) @class.name
  type_parameters: (type_parameters)? @class.type_params
  (class_heritage)? @class.heritage
  body: (class_body) @class.body) @class

;; --- interface_declaration ------------------------------------------------
(interface_declaration
  name: (type_identifier) @interface.name
  type_parameters: (type_parameters)? @interface.type_params
  body: (interface_body) @interface.body) @interface

;; --- type_alias_declaration -----------------------------------------------
(type_alias_declaration
  name: (type_identifier) @typealias.name
  type_parameters: (type_parameters)? @typealias.type_params
  value: (_) @typealias.value) @typealias

;; --- enum_declaration -----------------------------------------------------
(enum_declaration
  name: (identifier) @enum.name
  body: (enum_body) @enum.body) @enum

;; --- import_statement -----------------------------------------------------
(import_statement
  (import_clause
    [ (identifier) @import.default
      (namespace_import (identifier) @import.namespace)
      (named_imports
        (import_specifier
          name: (identifier) @import.name
          alias: (identifier)? @import.alias)) ])?
  source: (string (string_fragment) @import.source)) @import

(export_statement
  source: (string (string_fragment) @reexport.source)) @reexport

;; --- call_expression ------------------------------------------------------
(call_expression
  function: (identifier) @call.callee
  arguments: (arguments) @call.args) @call

(call_expression
  function: (member_expression
              object: (_) @call.receiver
              property: (property_identifier) @call.method)
  arguments: (arguments) @call.args) @call.member

(new_expression
  constructor: (_) @new.ctor
  arguments: (arguments)? @new.args) @new

;; --- require("x") detection (CJS) ----------------------------------------
((call_expression
  function: (identifier) @_id
  arguments: (arguments (string (string_fragment) @require.source)))
  (#eq? @_id "require"))
```

Syntax quick reference: `(node_type)` matches named nodes; `field: (child)` constrains by field; `@capture.name` captures; `[ (a) (b) ]` alternation; `?` / `*` / `+` quantifiers; predicates like `(#eq? @c "x")`, `(#match? @c "^[A-Z]")`, `(#any-of? @c "a" "b")`. **Always use double quotes** in queries — single quotes fail to parse.

### 4.5 Running queries

```ts
import Parser from "tree-sitter"
import fs from "node:fs/promises"

export async function extractFromFile(parser: Parser, source: string, scmPath: string) {
  const scm = await fs.readFile(scmPath, "utf8")
  const query = new Parser.Query(parser.getLanguage()!, scm)  // native API
  const tree = parser.parse(source)
  const out: Array<{ kind: string; name: string; startByte: number; endByte: number }> = []
  for (const m of query.matches(tree.rootNode)) {
    const caps: Record<string, any> = {}
    for (const c of m.captures) caps[c.name] = c.node
    const push = (kind: string, nameNode?: any, whole?: any) => {
      if (nameNode && whole) out.push({
        kind, name: nameNode.text,
        startByte: whole.startIndex, endByte: whole.endIndex,
      })
    }
    push("function",  caps["function.name"],  caps["function"])
    push("class",     caps["class.name"],     caps["class"])
    push("interface", caps["interface.name"], caps["interface"])
    push("typealias", caps["typealias.name"], caps["typealias"])
    push("enum",      caps["enum.name"],      caps["enum"])
    push("method",    caps["method.name"],    caps["method"])
  }
  return out
}
```

Compile `Query` once per (grammar, .scm file) pair and reuse. Scope queries to subtrees (`query.matches(subtreeNode)`) when incrementally reingesting.

### 4.6 Incremental parsing

```ts
type Edit = {
  startIndex: number; oldEndIndex: number; newEndIndex: number;
  startPosition:  { row: number; column: number }
  oldEndPosition: { row: number; column: number }
  newEndPosition: { row: number; column: number }
}

let tree = parser.parse(source)
// After an edit (byte offsets in UTF-8, column = bytes):
tree.edit({
  startIndex: 0, oldEndIndex: 3, newEndIndex: 5,
  startPosition:  { row: 0, column: 0 },
  oldEndPosition: { row: 0, column: 3 },
  newEndPosition: { row: 0, column: 5 },
})
const newTree = parser.parse(newSource, tree)
const changed = tree.getChangedRanges(newTree)   // ranges whose syntax changed
tree = newTree
```

Reparse from scratch (no old tree) when: the file changed on disk outside your edit stream, you switched grammar (`.ts ↔ .tsx`), or byte math is in doubt. A coherent sequence of `tree.edit()` calls before one `parser.parse` is normal. **Never call `tree.edit()` on an already-superseded tree.**

### 4.7 Position conversion

Tree-sitter reports **UTF-8 byte offsets** (and `column` is bytes within the line). LSP `Position.character` is **UTF-16 code units** by default. You cannot hand a tree-sitter `Point` to LSP for non-ASCII content without conversion.

```ts
export function lspToByte(src: string, line: number, character: number): number {
  let utf16Start = 0
  for (let l = 0; l < line; l++) {
    const nl = src.indexOf("\n", utf16Start)
    if (nl < 0) return Buffer.byteLength(src, "utf8")
    utf16Start = nl + 1
  }
  const prefix = src.slice(utf16Start, utf16Start + character)
  return Buffer.byteLength(src.slice(0, utf16Start), "utf8") + Buffer.byteLength(prefix, "utf8")
}

export function pointToLsp(src: string, row: number, byteColumn: number) {
  let utf16Start = 0
  for (let l = 0; l < row; l++) utf16Start = src.indexOf("\n", utf16Start) + 1
  const lineEnd = src.indexOf("\n", utf16Start)
  const line = src.slice(utf16Start, lineEnd < 0 ? src.length : lineEnd)
  const buf = Buffer.from(line, "utf8")
  const slice = buf.slice(0, byteColumn).toString("utf8")
  return { line: row, character: slice.length }
}
```

For large files precompute a `Uint32Array` of line-start byte offsets.

### 4.8 TSX handling

`tree-sitter-typescript` exports two Language objects. **Treat them as separate parsers** keyed by extension. `.typescript` does not parse JSX (so `<T>x` is a type assertion). `.tsx` parses JSX (so `<T>x` is an element). The `.tsx` grammar is ~5–15% slower due to conflict resolution. For `.js`/`.mjs`/`.cjs` files without JSX or Flow, prefer `tree-sitter-javascript` if you add it; otherwise `.tsx` is a safe superset.

### 4.9 Memory and error recovery

- Native: call `tree.delete()` when discarding a tree (underlying arena); primitive fields on `SyntaxNode` become invalid after delete — copy them out first.
- WASM (`web-tree-sitter`): `.delete()` is required on `Parser`, `Tree`, `Query`, `TreeCursor` to avoid Emscripten-heap leaks in long-running ingestion.
- Error nodes: `node.type === "ERROR"`, `node.hasError` (this or any descendant), `node.isError`, `node.isMissing` (zero-width parser-inserted). Treat an ERROR anywhere as a parse-quality signal but never as a fatal error — tree-sitter recovers greedily.
- Threading: `Parser`, `Tree`, `Query` are **per-instance, not thread-safe**. `Language` objects are immutable and shareable within the same VM. For whole-repo ingest, fan out `N = cpuCount` Bun workers, each loading its own `Parser` + compiled `Query`.

---

## 5. LSP integration with typescript-language-server

### 5.1 The server

`typescript-language-server` is a thin LSP wrapper around `tsserver` (the one shipped with the `typescript` npm package). Install as a user prerequisite or bundle as a local devDependency:

```sh
# User-global
npm install -g typescript-language-server typescript

# Project-local (preferred — pin the version)
bun add -d typescript-language-server typescript
# then invoke as ./node_modules/.bin/typescript-language-server --stdio
```

Invocation **must include `--stdio`**; without it the binary prints help and exits. Supported requests (from `src/lsp-server.ts`) include everything shadow-olog needs: `textDocument/documentSymbol` (hierarchical), `definition`, `typeDefinition`, `implementation`, `references`, `hover`, `prepareRename`, `rename`, `codeAction`, `codeAction/resolve`, `callHierarchy/prepareCallHierarchy` + `incomingCalls` + `outgoingCalls`, `textDocument/semanticTokens/full` and `/range` (yes — it is supported in current versions; gate on `initResult.capabilities.semanticTokensProvider`), `inlayHint`, `foldingRange`. It also emits a custom `$/typescriptVersion` notification after initialize.

### 5.2 Spawning in Bun

**Critical Bun quirk:** `Bun.spawn` returns `subprocess.stdout` as a Web `ReadableStream<Uint8Array>` and `subprocess.stdin` as a Bun `FileSink` — neither is what `vscode-jsonrpc/node`'s `StreamMessageReader`/`StreamMessageWriter` expects (Node `Readable`/`Writable`). This has burned many people (Bun issue #4635 documents the exact "Received response 0 without active response promise" symptom; issue #25498 documents the missing compat bridge).

**Use `node:child_process.spawn` from Bun.** It's fully supported by Bun, yields real Node streams, and is the boring, tested path.

```ts
// packages/core/src/lsp/client.ts
import { spawn, type ChildProcess } from "node:child_process"
import * as rpc from "vscode-jsonrpc/node"

export class LspClient {
  private child!: ChildProcess
  conn!: rpc.MessageConnection

  async start(cmd = "typescript-language-server", args = ["--stdio"]) {
    this.child = spawn(cmd, args, { stdio: ["pipe","pipe","pipe"] })
    this.child.stderr!.on("data", (b) => process.stderr.write(`[tsls] ${b}`))

    this.conn = rpc.createMessageConnection(
      new rpc.StreamMessageReader(this.child.stdout!),
      new rpc.StreamMessageWriter(this.child.stdin!),
    )

    // Server notifications we observe
    this.conn.onNotification("textDocument/publishDiagnostics", (p) => this.onDiagnostics?.(p))
    this.conn.onNotification("window/logMessage",  () => {})
    this.conn.onNotification("window/showMessage", () => {})
    this.conn.onNotification("$/typescriptVersion", () => {})

    // Server requests we must answer
    this.conn.onRequest("workspace/configuration",           () => [null])
    this.conn.onRequest("window/workDoneProgress/create",    () => null)
    this.conn.onRequest("client/registerCapability",         () => null)
    this.conn.onRequest("client/unregisterCapability",       () => null)
    this.conn.onRequest("workspace/applyEdit",               () => ({ applied: true }))

    this.conn.onError(([err]) => console.error("rpc err", err))
    this.conn.onClose(()      => console.error("rpc closed"))
    this.conn.listen()

    this.child.on("exit", (code, signal) => {
      console.error(`tsserver exited code=${code} signal=${signal}`)
      this.onExit?.(code, signal)
    })
  }

  onDiagnostics?: (p: any) => void
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void

  request<T = any>(method: string, params?: any, timeoutMs = 30_000): Promise<T> {
    return Promise.race([
      this.conn.sendRequest<T>(method, params),
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`LSP timeout: ${method}`)), timeoutMs)),
    ])
  }
  notify(method: string, params?: any) { return this.conn.sendNotification(method, params) }

  async dispose() {
    try { await this.request("shutdown", null, 5_000) } catch {}
    try { this.conn.sendNotification("exit") } catch {}
    this.child.kill("SIGTERM")
  }
}
```

**If you must use `Bun.spawn`** (for its `exited` Promise and AbortSignal integration), bridge streams with `Readable.fromWeb(proc.stdout)` for stdout and a Node `Writable` wrapping the FileSink for stdin. Bun v1.3.12 fixed a `Readable.fromWeb` pipeline stall — require that version at minimum. Even with the bridge, production reliability favors `node:child_process`.

### 5.3 Initialize handshake

```ts
import { pathToFileURL } from "node:url"
const rootUri = pathToFileURL(process.cwd()).href

const initResult = await client.request("initialize", {
  processId: process.pid,
  clientInfo: { name: "shadow-olog", version: "0.1.0" },
  rootUri, rootPath: process.cwd(),
  workspaceFolders: [{ uri: rootUri, name: "root" }],
  initializationOptions: {
    preferences: {
      includeInlayParameterNameHints: "all",
      allowIncompleteCompletions: true,
      importModuleSpecifierPreference: "shortest",
    },
    tsserver: { logVerbosity: "off", useSyntaxServer: "auto" },
    maxTsServerMemory: 4096,
  },
  capabilities: {
    workspace: {
      applyEdit: true,
      workspaceEdit: {
        documentChanges: true,                              // MANDATORY for file renames
        resourceOperations: ["create","rename","delete"],
        failureHandling: "textOnlyTransactional",
      },
      didChangeConfiguration: { dynamicRegistration: true },
      symbol: { dynamicRegistration: true, symbolKind: { valueSet: Array.from({length:26},(_,i)=>i+1) } },
      executeCommand: { dynamicRegistration: true },
      configuration: true, workspaceFolders: true,
      semanticTokens: { refreshSupport: true },
    },
    textDocument: {
      synchronization: { dynamicRegistration: true, didSave: true },
      publishDiagnostics: { relatedInformation: true, versionSupport: true },
      hover:          { contentFormat: ["markdown","plaintext"] },
      definition:     { linkSupport: true },
      typeDefinition: { linkSupport: true },
      implementation: { linkSupport: true },
      references:     { dynamicRegistration: true },
      documentSymbol: { hierarchicalDocumentSymbolSupport: true,
                        symbolKind: { valueSet: Array.from({length:26},(_,i)=>i+1) } },
      codeAction: {
        codeActionLiteralSupport: { codeActionKind: { valueSet:
          ["","quickfix","refactor","refactor.extract","refactor.inline","refactor.rewrite",
           "source","source.organizeImports","source.fixAll"] } },
        resolveSupport: { properties: ["edit"] }, dataSupport: true, isPreferredSupport: true,
      },
      rename: { prepareSupport: true, prepareSupportDefaultBehavior: 1, honorsChangeAnnotations: true },
      callHierarchy: { dynamicRegistration: true },
      semanticTokens: {
        requests: { range: true, full: { delta: false } },
        tokenTypes: ["namespace","type","class","enum","interface","struct","typeParameter","parameter",
          "variable","property","enumMember","event","function","method","macro","keyword","modifier",
          "comment","string","number","regexp","operator","decorator"],
        tokenModifiers: ["declaration","definition","readonly","static","deprecated","abstract","async",
          "modification","documentation","defaultLibrary"],
        formats: ["relative"], overlappingTokenSupport: false, multilineTokenSupport: false,
      },
    },
    window: { workDoneProgress: true },
    general: { positionEncodings: ["utf-16"] },
  },
  trace: "off",
})
await client.notify("initialized", {})
```

Always inspect `initResult.capabilities` before issuing requests (`semanticTokensProvider`, `callHierarchyProvider`, etc.).

### 5.4 Document lifecycle

Most LSP requests return `null` until the file has been `didOpen`'d. tsserver uses the in-memory buffer as authoritative after `didOpen`; disk changes are ignored for open files.

```ts
function langIdForPath(p: string) {
  const ext = p.endsWith(".tsx") ? "tsx" : p.endsWith(".jsx") ? "jsx"
    : p.endsWith(".mjs")||p.endsWith(".cjs")||p.endsWith(".js") ? "js" : "ts"
  return { tsx:"typescriptreact", jsx:"javascriptreact", js:"javascript", ts:"typescript" }[ext]
}

async function didOpen(client: LspClient, file: string) {
  const text = await Bun.file(file).text()
  await client.notify("textDocument/didOpen", {
    textDocument: {
      uri: pathToFileURL(require("node:path").resolve(file)).href,
      languageId: langIdForPath(file), version: 1, text,
    },
  })
}
```

`didChange` accepts either full-text (`contentChanges: [{ text }]`) or incremental (`contentChanges: [{ range, text }, ...]`). Bump `version` monotonically. typescript-language-server advertises `TextDocumentSyncKind.Incremental` (2), but full-text sync is simpler and reliable.

### 5.5 Key requests

**`textDocument/documentSymbol`** → hierarchical `DocumentSymbol[]` when `hierarchicalDocumentSymbolSupport: true`, else flat `SymbolInformation[]`. Shape: `{ name, detail?, kind, range, selectionRange, children? }`.

**`textDocument/definition` / `typeDefinition` / `implementation`** → `LocationLink[]` with `linkSupport:true` (includes `originSelectionRange`, `targetUri`, `targetRange`, `targetSelectionRange`).

**`textDocument/references`** — `{ textDocument, position, context: { includeDeclaration: true } }` → `Location[]`.

**Call hierarchy — do this right:**

```ts
// Step 1: prepare once per declaration (from documentSymbol selectionRange.start)
const items = await client.request("callHierarchy/prepareCallHierarchy", {
  textDocument: { uri }, position: decl.selectionRange.start,
})

// Step 2: per item, one incoming + one outgoing call
for (const item of items ?? []) {
  const inc = await client.request("callHierarchy/incomingCalls", { item })
  const out = await client.request("callHierarchy/outgoingCalls", { item })
  // inc[i].fromRanges gives you the call-site ranges for free —
  // do NOT call prepareCallHierarchy again per call site.
}
```

This is the single biggest scaling lever. `prepareCallHierarchy` runs a full semantic resolve at that position; doing it per call site on a large codebase is catastrophic. The `fromRanges` field in `incomingCalls` results already contains the call-site positions you want.

**`textDocument/semanticTokens/full`** → packed `data: uint32[]` in relative line/char deltas (5 ints per token). Decode using `initResult.capabilities.semanticTokensProvider.legend`.

**`textDocument/hover`** → `{ contents: MarkupContent | MarkedString | MarkedString[], range? }`.

**Rename round-trip:**

```ts
const prep = await client.request("textDocument/prepareRename", { textDocument: { uri }, position })
// prep: null | Range | { range, placeholder } | { defaultBehavior: true }
if (!prep) throw new Error("Rename not allowed here")
const edit = await client.request("textDocument/rename", { textDocument: { uri }, position, newName })
if (edit) await applyWorkspaceEdit(edit)
```

**`textDocument/codeAction`** → `CodeAction[]` possibly without `edit` populated; resolve via `codeAction/resolve` before applying.

### 5.6 Applying WorkspaceEdit

```ts
import fs from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"

type Pos = { line: number; character: number }
type TextEdit = { range: { start: Pos; end: Pos }; newText: string }

function offsetAt(text: string, pos: Pos): number {
  let line = 0, off = 0
  while (line < pos.line) {
    const nl = text.indexOf("\n", off)
    if (nl < 0) return text.length
    off = nl + 1; line++
  }
  return Math.min(off + pos.character, text.length)
}

function applyTextEditsToString(text: string, edits: TextEdit[]): string {
  // Sort reverse (end-to-start) so earlier offsets aren't invalidated.
  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line
    return b.range.start.character - a.range.start.character
  })
  let out = text
  for (const e of sorted) {
    const s = offsetAt(out, e.range.start)
    const t = offsetAt(out, e.range.end)
    if (t < s) throw new Error("invalid edit")
    out = out.slice(0, s) + e.newText + out.slice(t)
  }
  return out
}

export async function applyWorkspaceEdit(edit: any) {
  if (edit.documentChanges?.length) {
    for (const ch of edit.documentChanges) {
      if (ch.kind === "create") {
        const p = fileURLToPath(ch.uri)
        const exists = await fs.stat(p).then(() => true, () => false)
        if (exists) {
          if (ch.options?.overwrite) await fs.writeFile(p, "")
          else if (!ch.options?.ignoreIfExists) throw new Error(`create: exists: ${p}`)
        } else {
          await fs.mkdir(dirname(p), { recursive: true })
          await fs.writeFile(p, "")
        }
      } else if (ch.kind === "rename") {
        await fs.rename(fileURLToPath(ch.oldUri), fileURLToPath(ch.newUri))
      } else if (ch.kind === "delete") {
        await fs.rm(fileURLToPath(ch.uri), { recursive: !!ch.options?.recursive, force: false })
          .catch((e) => { if (!ch.options?.ignoreIfNotExists) throw e })
      } else {
        const p = fileURLToPath(ch.textDocument.uri)
        const before = await fs.readFile(p, "utf8").catch(() => "")
        await fs.writeFile(p, applyTextEditsToString(before, ch.edits), "utf8")
      }
    }
    return
  }
  if (edit.changes) {
    for (const [uri, edits] of Object.entries<any>(edit.changes)) {
      const p = fileURLToPath(uri)
      const before = await fs.readFile(p, "utf8").catch(() => "")
      await fs.writeFile(p, applyTextEditsToString(before, edits as TextEdit[]), "utf8")
    }
  }
}
```

**Rules.** Prefer `documentChanges` (ordered, versioned, supports file ops). Positions are UTF-16 code units (LSP default); JS strings are already UTF-16, so `offsetAt` Just Works for TS. Edits within one file must not overlap — sort reverse. Mirror edits to your didOpen'd documents via `didChange` if you keep a local buffer cache.

### 5.7 Lifecycle and scaling

**Shutdown**: `shutdown` request → server replies null → `exit` notification → process exits. Always wrap individual requests in `Promise.race` with a timeout; tsserver can hang on malformed `tsconfig.json`.

**Crash recovery**: on `child.on("exit")`, schedule a restart with exponential backoff (250 ms → 10 s, cap at 5 failures), then re-play `initialize` + re-`didOpen` for the working set.

**Scaling rules.** (1) Call `prepareCallHierarchy` per **declaration**, never per call site; use `incomingCalls` `fromRanges` for the call-site positions. (2) Use a sliding window of open documents (50–200 max); `didOpen` → query → `didClose`. (3) Prefer `workspace/symbol` for global lookups over opening every file. (4) Debounce `didChange` during rapid edits (~100–200 ms). (5) Warm up: open the entry file, wait for `$/typescriptVersion` and first `publishDiagnostics` before heavy queries.

---

## 6. SQLite persistence with bun:sqlite

`bun:sqlite` is synchronous, built-in, 3–6× faster than `better-sqlite3` for reads, and needs no install.

### 6.1 Opening and pragmas

```ts
import { Database } from "bun:sqlite"

const db = new Database("olog.sqlite", { create: true, strict: true })
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous  = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA temp_store   = MEMORY;
  PRAGMA mmap_size    = 268435456;  -- 256 MiB
`)
```

With `strict: true` you bind `{ id: 1 }` instead of `{ $id: 1 }` and extra keys throw. WAL produces `-wal`/`-shm` sidecar files; on macOS (Apple-patched SQLite) these persist past `db.close()`, so to force cleanup: `db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close()`.

### 6.2 Schema DDL for the olog

`packages/core/src/schema.sql`:

```sql
-- Meta (single-row config)
CREATE TABLE IF NOT EXISTS olog_meta (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

-- Elements (universal-base: File, Module, Symbol, CallSite, Import + system-cluster)
CREATE TABLE IF NOT EXISTS olog_elem (
  id      TEXT    NOT NULL PRIMARY KEY,
  kind    TEXT    NOT NULL,
  name    TEXT    NOT NULL,
  module  TEXT,
  span    TEXT,                        -- "path:line:col-line:col"
  attrs   TEXT    NOT NULL DEFAULT '{}',
  CHECK (kind IN (
    'file','module','symbol','callsite','import',       -- universal-base
    'type','interface','class','enum','function','method','const','var',
    'namespace','ingestor','tool','hook','other'        -- system-cluster
  )),
  CHECK (json_valid(attrs))
) STRICT;
CREATE INDEX IF NOT EXISTS ix_olog_elem_kind   ON olog_elem(kind);
CREATE INDEX IF NOT EXISTS ix_olog_elem_module ON olog_elem(module);
CREATE INDEX IF NOT EXISTS ix_olog_elem_name   ON olog_elem(name);

-- Arrows (typed edges)
CREATE TABLE IF NOT EXISTS olog_arr (
  id     TEXT NOT NULL PRIMARY KEY,
  kind   TEXT NOT NULL,
  src_id TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  attrs  TEXT NOT NULL DEFAULT '{}',
  CHECK (kind IN ('extends','implements','calls','imports','exports',
                  'references','contains','returns','param','typeof','instanceof','other')),
  CHECK (json_valid(attrs)),
  FOREIGN KEY (src_id) REFERENCES olog_elem(id) ON DELETE CASCADE,
  FOREIGN KEY (dst_id) REFERENCES olog_elem(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX IF NOT EXISTS ix_olog_arr_src  ON olog_arr(src_id, kind);
CREATE INDEX IF NOT EXISTS ix_olog_arr_dst  ON olog_arr(dst_id, kind);
CREATE INDEX IF NOT EXISTS ix_olog_arr_kind ON olog_arr(kind);

-- Attributes (sparse sidecar K/V)
CREATE TABLE IF NOT EXISTS olog_attr (
  elem_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT,
  PRIMARY KEY (elem_id, key),
  FOREIGN KEY (elem_id) REFERENCES olog_elem(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_olog_attr_key ON olog_attr(key);

-- Provenance (what produced each element, per commit)
CREATE TABLE IF NOT EXISTS olog_prov (
  elem_id TEXT NOT NULL, source TEXT NOT NULL, commit_sha TEXT NOT NULL, ingested_at INTEGER NOT NULL,
  PRIMARY KEY (elem_id, source, commit_sha),
  FOREIGN KEY (elem_id) REFERENCES olog_elem(id) ON DELETE CASCADE,
  CHECK (source IN ('tree-sitter','lsp','manual','heuristic','other'))
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_olog_prov_sha ON olog_prov(commit_sha);

-- Violations (rule-engine output)
CREATE TABLE IF NOT EXISTS olog_violation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  elem_id TEXT NOT NULL, rule TEXT NOT NULL, message TEXT NOT NULL,
  FOREIGN KEY (elem_id) REFERENCES olog_elem(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX IF NOT EXISTS ix_olog_viol_elem ON olog_violation(elem_id);
CREATE INDEX IF NOT EXISTS ix_olog_viol_rule ON olog_violation(rule);
```

### 6.3 Store wrapper

```ts
// packages/core/src/db.ts
import { Database, type Statement } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const DDL  = readFileSync(resolve(here, "schema.sql"), "utf8")

export interface ElemRow { id: string; kind: string; name: string; module: string | null; span: string | null; attrs: string }
export interface ArrRow  { id: string; kind: string; src_id: string; dst_id: string; attrs: string }

export class OlogStore {
  readonly db: Database
  #insElem: Statement; #insArr: Statement; #insProv: Statement
  #getElem: Statement; #getMeta: Statement; #setMeta: Statement
  #txIngest: (elems: ElemRow[], arrs: ArrRow[], sha: string) => number

  constructor(path = "olog.sqlite") {
    this.db = new Database(path, { create: true, strict: true })
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
                  PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`)
    this.db.exec(DDL)
    this.db.run(`INSERT OR IGNORE INTO olog_meta(key,value)
                 VALUES ('schema_version','1'),('commit_sha','')`)

    this.#insElem = this.db.prepare(`
      INSERT INTO olog_elem(id,kind,name,module,span,attrs)
      VALUES (:id,:kind,:name,:module,:span,:attrs)
      ON CONFLICT(id) DO UPDATE SET
        kind=excluded.kind, name=excluded.name,
        module=excluded.module, span=excluded.span, attrs=excluded.attrs`)
    this.#insArr  = this.db.prepare(`INSERT OR REPLACE INTO olog_arr(id,kind,src_id,dst_id,attrs)
                                     VALUES (:id,:kind,:src_id,:dst_id,:attrs)`)
    this.#insProv = this.db.prepare(`INSERT OR REPLACE INTO olog_prov(elem_id,source,commit_sha,ingested_at)
                                     VALUES (:elem_id,'tree-sitter',:sha,:now)`)
    this.#getElem = this.db.prepare(`SELECT * FROM olog_elem WHERE id=:id`)
    this.#getMeta = this.db.prepare(`SELECT value FROM olog_meta WHERE key=:key`)
    this.#setMeta = this.db.prepare(`UPDATE olog_meta SET value=:value WHERE key=:key`)

    this.#txIngest = this.db.transaction((elems: ElemRow[], arrs: ArrRow[], sha: string) => {
      const now = Date.now()
      this.db.run("DELETE FROM olog_elem")   // cascades to arrows, attrs, prov, violations
      for (const e of elems) this.#insElem.run(e)
      for (const a of arrs)  this.#insArr.run(a)
      for (const e of elems) this.#insProv.run({ elem_id: e.id, sha, now })
      this.#setMeta.run({ key: "commit_sha", value: sha })
      return elems.length
    })
  }

  commitSha() { return (this.#getMeta.get({ key: "commit_sha" }) as any).value as string }
  isFresh(head: string) { return this.commitSha() === head }
  ingestFull(elems: ElemRow[], arrs: ArrRow[], sha: string) { return this.#txIngest.immediate(elems, arrs, sha) }

  /** Incremental per-file reingest: delete elements whose module == file, then upsert new ones. */
  ingestFile(file: string, elems: ElemRow[], arrs: ArrRow[], sha: string) {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM olog_elem WHERE module=:m`).run({ m: file })
      for (const e of elems) this.#insElem.run(e)
      for (const a of arrs)  this.#insArr.run(a)
      for (const e of elems) this.#insProv.run({ elem_id: e.id, sha, now: Date.now() })
      this.#setMeta.run({ key: "commit_sha", value: sha })
      return elems.length
    })
    return tx.immediate()
  }

  getElem(id: string) { return (this.#getElem.get({ id }) as ElemRow | null) ?? null }
  outgoing(srcId: string) { return this.db.query<ArrRow, { src: string }>(`SELECT * FROM olog_arr WHERE src_id=:src`).all({ src: srcId }) }
  close() { this.db.close() }
}
```

### 6.4 Commit-SHA keyed caching

On plugin load, compare `store.commitSha()` against `git rev-parse HEAD`:

```ts
const head = (await Bun.$`git rev-parse HEAD`.quiet().text()).trim()
if (!store.isFresh(head)) {
  const { elems, arrs } = await ingestProject(worktree)
  store.ingestFull(elems, arrs, head)
}
```

For incremental updates during a session, listen to `file.edited` events and call `store.ingestFile(path, ...)` on the affected file only — the `ON DELETE CASCADE` on `olog_elem` wipes stale arrows/attrs/prov for that file automatically when you delete by `module`.

---

## 7. Development workflow and tooling

### 7.1 Linking a local plugin

Three paths, in increasing ceremony:

- **Symlink into `.opencode/plugin/`** (simplest): `ln -s "$PWD/packages/opencode-plugin/src/index.ts" .opencode/plugin/olog.ts`. opencode auto-loads on startup; edit → restart → applied.
- **`file:///absolute` in `opencode.json`**: `{"plugin":["file:///Users/me/olog-monorepo/packages/opencode-plugin/dist/index.js"]}`. Requires the leading `./` in the plugin's `package.json#main`. Relative `file:..` is **VERIFY:** some builds accept it; prefer the absolute URL.
- **`bun link`** (npm-style symlink): `cd packages/opencode-plugin && bun link`, then in the test project `bun link @olog/opencode-plugin` and list it in `opencode.json`'s `plugin` array.

### 7.2 Logs and observability

- App logs: `~/.local/share/opencode/log/*.log`. Use `client.app.log({ body: { service: "olog", level, message, extra }})` inside the plugin — entries land in the opencode log stream with correct level and are searchable by `service`.
- Per-session debug logs: write to `.opencode/olog/logs/<sessionID>.log` yourself from hooks, keyed by the extracted session ID.
- Verbose mode: `opencode --log-level DEBUG` (**VERIFY**: issue #6583 reports this flag can wipe the log file on some builds).
- Project artifacts: `~/.local/share/opencode/project/<slug>/storage/`.

### 7.3 Debugging the instance

Add an introspection tool so you can ask the agent itself what the olog knows:

```ts
olog_dump: tool({
  description: "Dump a summary of the current olog (counts per kind, recent violations).",
  args: { verbose: tool.schema.boolean().default(false) },
  async execute(args) {
    const counts = store.db.query("SELECT kind, COUNT(*) as n FROM olog_elem GROUP BY kind").all()
    const viols  = store.db.query("SELECT rule, COUNT(*) as n FROM olog_violation GROUP BY rule").all()
    return { title: "olog_dump", output: JSON.stringify({ commit: store.commitSha(), counts, viols }, null, 2) }
  },
}),
```

Also add `olog_inspect` that takes an element id and returns `getElem` + its outgoing arrows, and `olog_ingestion_trace` that returns the last N lines of `.opencode/olog/logs/current.log`.

### 7.4 Testing

Unit tests run in `bun:test`:

```ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { OlogStore } from "../src/db"

let store: OlogStore
beforeAll(() => { store = new OlogStore(":memory:") })
afterAll(()  => { store.close() })

describe("OlogStore", () => {
  test("caches by commit sha", () => {
    store.ingestFull([{ id:"e1", kind:"type", name:"User", module:"m.ts", span:null, attrs:"{}" }], [], "deadbeef")
    expect(store.isFresh("deadbeef")).toBe(true)
    expect(store.isFresh("cafef00d")).toBe(false)
  })
})
```

Integration tests spin up a real `typescript-language-server` against a fixture directory and assert on documentSymbol / references output. Mock the opencode client with `mock()` / `spyOn()` from `bun:test` for plugin-hook tests.

### 7.5 CI

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  build-test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix: { os: [ubuntu-latest, macos-latest], bun: ["1.3.13"] }
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: "${{ matrix.bun }}" }
      - uses: actions/cache@v4
        with:
          path: |
            ~/.bun/install/cache
            node_modules
          key: ${{ runner.os }}-bun-${{ hashFiles('**/bun.lock') }}
          restore-keys: ${{ runner.os }}-bun-
      - run: npm install -g typescript-language-server typescript
      - run: bun install --frozen-lockfile
      - run: bun --filter '*' run typecheck
      - run: bun test --coverage --reporter=junit --reporter-outfile=./bun.xml
      - run: bun --filter '*' run build
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: junit-${{ matrix.os }}, path: bun.xml }
```

---

## 8. Practical first-run experience

### 8.1 Prerequisites

A user installs the plugin once; shadow-olog's startup sequence assumes:

1. **opencode** is installed (`curl -fsSL https://opencode.ai/install | bash` or equivalent).
2. **typescript-language-server** is on `PATH` (`npm install -g typescript-language-server typescript`). The plugin fails closed — if it can't spawn `typescript-language-server --stdio`, it logs a warning and disables LSP-backed features while keeping tree-sitter ingestion operational.
3. The project is under git (the commit-SHA cache keys off `git rev-parse HEAD`).

### 8.2 What happens on first session

1. opencode boots, reads `opencode.json`, runs `bun install` for listed npm plugins, and imports the plugin factory.
2. The factory opens `<worktree>/.shadow-olog/olog.sqlite`, runs DDL, seeds meta.
3. It computes current HEAD. If `store.isFresh(head)` is false (including the empty-DB case), it kicks off the initial ingest asynchronously so the session isn't blocked.
4. Initial ingest: enumerate `**/*.{ts,tsx,mts,cts}` (respecting `.gitignore`), parse each with tree-sitter, extract elements/arrows via the `.scm` query, persist in a single `BEGIN IMMEDIATE` transaction keyed by HEAD sha. The user sees a toast via `client.tui.showToast({ body: { message: "shadow-olog: ingesting…", variant: "info" } })`.
5. When complete, the plugin logs `service: "olog", level: "info", message: "ingested N elements, M arrows"`, and registers tools (`olog_query`, `olog_plan`, `olog_apply`, `olog_dump`, `olog_inspect`).
6. On `file.edited` events the plugin re-ingests the affected file incrementally (§6.3) and rebumps the meta commit_sha to `"working"` until a git commit event resets it.

### 8.3 Configuration file

`.shadow-olog/config.json` (project-local, optional — sensible defaults otherwise):

```jsonc
{
  "$schema": "./schema.json",
  "include": ["src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
  "exclude": ["**/node_modules/**", "**/dist/**", "**/*.d.ts"],
  "treeSitter": { "engine": "native" },     // or "wasm"
  "lsp": {
    "command": "typescript-language-server",
    "args": ["--stdio"],
    "initializationOptions": { "maxTsServerMemory": 4096 },
    "maxOpenDocuments": 100
  },
  "callHierarchy": { "mode": "per-declaration" },  // never "per-callsite"
  "log": { "level": "info" }
}
```

### 8.4 Slash commands

Plugins cannot register slash commands, so shadow-olog ships its commands as markdown files the installer drops into `.opencode/command/`:

```markdown
---
description: Query the shadow-olog for elements matching a kind/name filter
agent: build
---
Use the `olog_query` tool with kind=$1 and name=$2 to find structural elements and show the top 20 hits.
```

Users invoke `/olog-query function "handle.*"` in the chat.

### 8.5 Opencode.json for the user

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@olog/opencode-plugin@0.0.1"],
  "agent": {
    "olog-ingest": {
      "description": "Read-only TypeScript ingest helper",
      "mode": "subagent",
      "hidden": true,
      "model": "anthropic/claude-haiku-4-20250514",
      "permission": {
        "edit": "deny",
        "webfetch": "deny",
        "bash": { "*": "deny", "rg *": "allow", "grep *": "allow" }
      }
    }
  }
}
```

---

## Conclusion

The shadow-olog architecture has three load-bearing integration surfaces, and each has a single sharp edge you must respect. **On the opencode side** that edge is `permission.ask` unreliability — enforce via `tool.execute.before` and agent `permission:` config, never via the ask hook. **On the Bun/LSP seam** it is that `Bun.spawn`'s Web-streams stdio does not speak `vscode-jsonrpc/node` — use `node:child_process.spawn` from Bun and save yourself days of debugging phantom "Received response N without active response promise" errors. **On the LSP scaling side** it is `prepareCallHierarchy` per declaration, not per call-site — `incomingCalls[i].fromRanges` already has the call-site positions you want.

Build the core package first (schema, store, tree-sitter ingest, LSP driver, position helpers) with exhaustive unit tests against fixture files — everything there runs standalone without opencode. Then shell it into the plugin: one factory, one `OlogStore`, a handful of tools, an `event` hook that watches `file.edited` and re-ingests incrementally, a `chat.message` hook that injects a compact olog snapshot as context on the first user turn of each session. Everything else — subagent dispatch, refactor planning via `codeAction` + `rename`, violation rules — is additive and doesn't change the shape of the system.

Pin your versions; this stack has four packages (`@opencode-ai/plugin`, `tree-sitter`, `web-tree-sitter`, `vscode-jsonrpc`) with either dual-version tracks or known version-specific gotchas. Re-verify the **VERIFY:** notes against whatever `npm view` shows the day you build.