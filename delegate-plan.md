# olog_delegate Implementation Plan

> **Status: IMPLEMENTED** — All 6 phases complete. Both packages compile.  
> Remaining: integration tests, opencode.json agent wiring.

## 1. Rationale

Most problems with writing software are conceptual. Creating the olog graph for the
wanted change — deciding what to rename, what to move, what invariants hold — requires
a powerful model. But once the plan has been made, writing the actual code is
pattern-matching: follow the signatures, call the right functions, match the style.

`olog_delegate` bridges these two cost tiers. The powerful model queries the olog and
assembles a **fully resolved brief** — every signature, import, and analogue is
concretized into plain text. The cheap model receives this brief and writes code. It
never touches the olog, never reads files, never does structural reasoning.

```
┌──────────────────────────────────────────────────────────────┐
│                     POWERFUL MODEL                           │
│                                                             │
│  Queries olog for structure. Never reads files.             │
│  All conceptual work happens here:                           │
│  • What to change (plan)                                   │
│  • What invariants hold (validate)                          │
│  • What the call graph looks like (query)                   │
│  • Which patterns to follow (analogue discovery)            │
│  • What imports exist (importsFrom arrows)                  │
│                                                             │
│  olog_query ──► structural knowledge ──► brief assembly    │
│                        │                                     │
│  olog_delegate ──► reads files to resolve IDs to text ──┘ │
│                                                             │
│  olog_apply(render=true) ──► stubs on disk                  │
└──────────────────────┬───────────────────────────────────────┘
                       │ DelegationBrief (fully resolved JSON)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                      CHEAP MODEL                            │
│                                                             │
│  Receives self-contained brief. Never queries olog.         │
│  Never reads files (all text is in the brief).              │
│  Pattern-matching and code writing only:                    │
│  • Follow analogue implementations                          │
│  • Call every function in mustCall                          │
│  • Satisfy every interface in mustImplement                 │
│  • Obey imperative acceptance criteria                      │
│                                                             │
│  Input:  DelegationBrief JSON                               │
│  Output: { artifacts: [{ path, oldText, newText }] }       │
└──────────────────────────────────────────────────────────────┘
```

## 2. What the Olog Replaces

Without the olog, a powerful model would need to read many files to discover:
- "What does a tool registration look like?"
- "What does this function call?"
- "What implements this interface?"
- "What imports does this module already have?"
- "What's similar to what I'm writing?"

With the olog, all of these are graph queries:

| Question | Olog Traversal | Result |
|---|---|---|
| What does `f` call? | `f --calleeOf--> CallSite --callerOf--> Symbol` | Callee names, modules, spans |
| What calls `f`? | `f --callerOf--> CallSite --calleeOf--> Caller` | Caller names, modules, spans |
| What implements `I`? | `I --implements(in)--` Elements | Implementing classes/functions |
| What does module M import? | `M --contains--> Import --importsFrom--> Source` | Import names, source modules |
| What's similar to `f`? | Same-kind elements ranked by Jaccard on calleeOf sets | Ranked analogue list |

The brief assembly then reads **only the specific files** needed to extract source
snippets. Not "read everything to find patterns" — "the olog already told me where
the patterns are; now give me their text."

## 3. Architecture

### 3.1 The Brief Is the Contract

The `DelegationBrief` is the single contract between the two model tiers. Every
field is concrete text — no element IDs, no structural predicates, no "look up this
interface." The cheap model reads the brief and writes code.

### 3.2 Assembly Is Deterministic, Not LLM

The brief assembly is a pure function inside the MCP server process. It:
1. Queries the `OlogStore` (graph traversals via `store.traverse()`)
2. Reads source files at specific spans (via `projectRoot` + element spans)
3. Computes import paths (via `computeRelativeImportPath()`, already in core)
4. Discovers analogues (Jaccard similarity on calleeOf sets)
5. Fills in acceptance criteria from task-type templates

No LLM involved. The powerful model calls `olog_delegate` as an MCP tool and gets
back a JSON brief. The host agent (opencode) then dispatches a subagent with the
brief + the subagent system prompt.

### 3.3 Tool Schema

```typescript
// packages/mcp-server/src/tools/olog-delegate.ts

server.registerTool('olog_delegate', {
  description:
    'Assemble a fully-resolved structural brief for a text-generation subagent. ' +
    'Traverses the olog to collect signatures, call graphs, interface contracts, ' +
    'import paths, and analogue source code. Returns a self-contained brief ' +
    'that requires NO further olog queries — designed for consumption by a ' +
    'smaller/cheaper model that will write the actual code.',
  inputSchema: z.object({
    task: z.enum([
      'write_function_body',
      'write_test',
      'write_migration',
      'rewrite_body',
      'write_documentation',
    ]).describe('The type of text-generation task.'),

    target: z.string().describe(
      'Element ID of the target entity (e.g., "symbol:src/auth.verifyJwt").'
    ),

    contextOverrides: z.object({
      mustCall: z.array(z.string()).optional(),
      mustImplement: z.array(z.string()).optional(),
      analogues: z.array(z.string()).optional(),
    }).optional().describe(
      'Manual overrides. When provided, these REPLACE the automatically ' +
      'derived values (not merge).'
    ),

    acceptanceCriteria: z.array(z.string()).optional().describe(
      'Additional acceptance criteria, merged with task-type defaults.'
    ),

    maxAnalogues: z.number().int().min(0).max(5).default(3).describe(
      'Maximum number of analogue implementations to include.'
    ),

    snippetLines: z.number().int().min(10).max(200).default(50).describe(
      'Maximum lines of source code per snippet.'
    ),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
}, async ({ task, target, ... }) => { /* ... */ });
```

### 3.4 Brief Schema

```typescript
interface DelegationBrief {
  // ── Identity ──
  task: DelegationTask;

  target: {
    id: string;
    name: string;
    kind: string;
    module: string;
    signature: string;          // RESOLVED: "export function verifyJwt(header: string): Result<...>"
    bodyPlaceholder: string;   // RESOLVED: "{\n  // TODO: implement\n}" or ""
    filePath: string;          // module → file path
    lineRange: { start: number; end: number };
  };

  // ── Structural context (ALL resolved — no IDs, no lookups) ──

  mustCall: Array<{
    name: string;
    signature: string;          // RESOLVED from source
    importStatement: string;    // RESOLVED: "import { checkJwt } from '../validation/check.js'"
    calleeBodySnippet: string;  // RESOLVED: first N lines of callee body (pattern reference)
  }>;

  mustImplement: Array<{
    name: string;
    fullDeclaration: string;    // RESOLVED: entire interface source text
    importStatement: string;    // RESOLVED
  }>;

  usedBy: Array<{
    name: string;
    callSiteSnippet: string;   // RESOLVED: the lines where they call our target (±2 lines)
  }>;

  importsInTargetFile: string[];  // RESOLVED: full import lines already in the target file

  // ── Analogues (fully resolved source) ──

  analogues: Array<{
    name: string;
    similarity: number;        // 0-1 Jaccard on calleeOf sets
    fullSource: string;         // RESOLVED: entire function body
    callees: string[];          // names of what this analogue calls
    modulePath: string;
  }>;

  // ── Target file context ──
  targetFileContent: string;    // RESOLVED: current file content (truncated if huge)

  // ── Acceptance criteria (imperative, no structural reasoning) ──
  acceptanceCriteria: string[];

  // ── Provenance ──
  provenance: {
    ologCommitSha: string;
    confidence: 'resolved' | 'unresolved' | 'mixed';
    generatedAt: string;
  };
}
```

### 3.5 Subagent System Prompt

Short, imperative, reference-free. The cheap model never needs to understand the olog:

```markdown
# Code Generation Agent

You receive a `DelegationBrief`. Write code that satisfies the brief.

## Input

The brief is self-contained. Every signature, import, and pattern you need is
included as resolved text. You do NOT need to look up anything. You do NOT have
access to the olog or to source files.

## Rules

1. **Follow analogues.** The `analogues` field contains complete implementations
   of similar functions. Match their style: naming, error handling, return
   patterns, import conventions.

2. **Call every function in `mustCall`.** These are mandatory. Your code must
   invoke each one.

3. **Satisfy every interface in `mustImplement`.** The full interface source is
   provided. Implement every property and method it declares.

4. **Preserve existing code.** If `target.signature` already exists, keep the
   signature exactly. If `target.bodyPlaceholder` is present, replace only the
   placeholder body.

5. **Use imports from `importsInTargetFile`** before adding new ones. New
   imports should follow the same conventions as existing ones.

6. **No structural changes.** Do not rename, move, or delete any symbols. Do
   not change exports. Only write the body.

7. **Output format.** Return JSON:
   ```json
   {
     "artifacts": [
       { "path": "relative/path.ts", "oldText": "exact text", "newText": "replacement" }
     ]
   }
   ```
   For new files: `oldText` is `""`, `path` is the target file path.
   For existing files: `oldText` must match exactly (use `target.bodyPlaceholder`).

8. **Acceptance criteria are hard constraints.** Every item must be satisfied.
   If you cannot satisfy one, explain why instead of silently omitting it.

9. **Keep it simple.** Prefer clarity over cleverness. Match the patterns in
   the analogues.
```

## 4. Assembly Algorithm

### Step 1: Olog Traversals (no file reading)

```
MUST CALL:    target --calleeOf--> CallSite --> resolve callee symbols
MUST IMPLEMENT: target --implements--> Interface symbols  [if supported by schema]
USED BY:      target --callerOf(in)--> CallSite --calleeOf--> Caller symbols
IMPORTS:      targetModule import elements --importsFrom--> source modules
ANALOGUES:    same-kind elements, ranked by Jaccard(calleeSet, targetCalleeSet)
```

All results are element IDs, names, modules, and spans. No file reading yet.

### Step 2: Source Resolution (file reading, minimal)

For each element that needs a source snippet:
1. Map module → file path via `moduleToFilePath()` (existing in `render/paths.ts`)
2. Use element span to extract just the relevant lines
3. For import statements, read just the import section of the file

This is targeted — reads are by span, not by whole file (except the target file).

### Step 3: Import Computation (no file reading)

Using `importsFrom` arrows and `computeRelativeImportPath()` (existing):
```
"import { X } from '<relative-path-computed-from-olog-modules>'"
```

### Step 4: Analogue Discovery (olog + targeted file reading)

1. Find elements of same kind as target
2. Compute Jaccard similarity: |calleeOf(target) ∩ calleeOf(candidate)| / |calleeOf(target) ∪ calleeOf(candidate)|
3. Filter out the target itself
4. Sort by similarity descending
5. Take top `maxAnalogues`
6. For each: read their full body from source

### Step 5: Acceptance Criteria (template-based)

Merge task-type defaults with user-provided criteria. All expressed as imperative rules.

### Step 6: Assemble and return JSON

## 5. Task-Type Default Acceptance Criteria

| Task | Default Criteria |
|------|-----------------|
| `write_function_body` | 1. Must compile without type errors. 2. Must call every function listed in mustCall. 3. Must return a value matching the signature. 4. Must not change the function signature or exports. 5. Follow the coding patterns in the analogues. |
| `write_test` | 1. Must compile. 2. Must import the target function. 3. Must have at least one test case for each mustCall function. 4. Must follow the test framework patterns in the analogues. 5. Must be in a `.test.ts` or `.spec.ts` file. |
| `write_migration` | 1. Must compile. 2. Must be idempotent (safe to run twice). 3. Must use the project's database client (see analogues). 4. Must include both up and down if the framework requires it. |
| `rewrite_body` | 1. Must compile. 2. Must preserve the existing signature and exports. 3. Must call every function in mustCall. 4. Must not introduce new dependencies not in the criteria. 5. Must be strictly better than the current body. |
| `write_documentation` | 1. Must be valid JSDoc/TSDoc. 2. Must document all parameters. 3. Must include `@returns` with type. 4. Must include at least one `@example` if analogues have examples. 5. Must describe thrown errors. |

## 6. File Structure

```
packages/core/src/delegate/
├── index.ts         # Public API: assembleBrief(), DelegationBrief type
├── context.ts       # Olog traversal: gather mustCall, mustImplement, usedBy, imports
├── resolve.ts       # Source resolution: read files, extract snippets, compute imports
└── analogues.ts     # Analogue discovery and Jaccard similarity scoring

packages/mcp-server/src/tools/
└── olog-delegate.ts # MCP tool registration
```

## 7. Registration Changes ✅ DONE

**`packages/mcp-server/src/index.ts`** — DONE:
```typescript
import { registerOlogDelegate } from './tools/olog-delegate.js';
registerOlogDelegate(server, store, projectRoot);
```

**`packages/core/src/index.ts`** — DONE:
```typescript
export { assembleBrief, type DelegationBrief, type DelegationTask, type ContextOverrides } from './delegate/index.js';
export { SourceResolver } from './delegate/resolve.js';
export type { AnalogueCandidate } from './delegate/analogues.js';
export type { MustCallEntry, MustImplementEntry, UsedByEntry, ImportEntry, StructuralContext } from './delegate/context.js';
```

## 8. Integration with Existing Pipeline

The delegation plugs into the existing workflow at a specific point:

```
1. olog_plan        → describe structural change
2. olog_validate    → verify invariants hold
3. olog_apply       → apply structural change (with render=true: stubs on disk)
4. olog_delegate    → assemble brief for the stub's body content
5. (cheap model)    → write body using brief
6. olog_reindex     → refresh structural model
```

Steps 1-3 are existing. Step 4 is new. Step 5 is done by the host agent's
subagent dispatch (not by the MCP server). Step 6 is existing.

`olog_delegate` is purely additive — it's a read-only tool that produces a JSON
payload. The existing tools are untouched.

## 9. Implementation Order

| Phase | Files | Description |
|-------|-------|-------------|
| **Phase 1** | `core/delegate/context.ts` | Olog traversal functions. Input: `OlogStore` + target element ID. Output: resolved element lists (IDs, names, modules, spans). No file reading. |
| **Phase 2** | `core/delegate/analogues.ts` | Jaccard similarity scoring on calleeOf sets. Pure olog traversal. |
| **Phase 3** | `core/delegate/resolve.ts` | The critical bridge. Takes olog traversal results, reads specific source files at specific spans, extracts text. Only place files are read. |
| **Phase 4** | `core/delegate/index.ts` | `assembleBrief()` orchestrator: context → resolve → analogues → criteria. Exports `DelegationBrief` type. |
| **Phase 5** | `mcp-server/tools/olog-delegate.ts` | MCP tool thin wrapper: validate target ID, call `assembleBrief()`, return JSON. |
| **Phase 6** | `mcp-server/index.ts`, `core/index.ts` | Registration + exports. One line each. |
| **Phase 7** | Tests | Unit tests for each phase, integration test with the full pipeline. |

## 10. What This Does NOT Change

- The existing `olog_apply`, `olog_render`, `olog_plan`, `olog_validate` tools are **untouched**.
- The render pipeline's stub generation (`addSymbol` strategy) continues to work as before.
- The `OlogStore` schema is **unchanged** — no new tables, no new arrow kinds.
- The `planStore` in-memory map is **unchanged**.
- The MCP server binary grows by exactly one tool registration.

## 11. Analogue Discovery Algorithm

```typescript
function findAnalogues(
  store: OlogStore,
  target: OlogElem,
  limit: number = 3
): AnalogueCandidate[] {
  // Step 1: Get the target's callee set
  const targetCallees = new Set(
    store.traverse({ startId: target.id, steps: [{ kind: 'calleeOf' }] })
      .elements.map(e => e.id)
  );

  // Step 2: Find elements of same kind
  const candidates = store.queryElements({
    kind: target.kind,
    limit: 200,
  }).filter(e => e.id !== target.id);

  // Step 3: Score by Jaccard similarity
  const scored = candidates.map(candidate => {
    const candidateCallees = new Set(
      store.traverse({ startId: candidate.id, steps: [{ kind: 'calleeOf' }] })
        .elements.map(e => e.id)
    );
    const intersection = new Set(
      [...targetCallees].filter(id => candidateCallees.has(id))
    );
    const union = new Set([...targetCallees, ...candidateCallees]);
    const similarity = union.size === 0 ? 0 : intersection.size / union.size;

    return { candidate, similarity };
  });

  // Step 4: Sort descending, take top N
  return scored
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
```

## 12. Source Resolution Design

The `resolve.ts` module is the only place that reads files. It does so surgically:

```typescript
interface SourceResolver {
  // Read a specific span from a file
  readSpan(filePath: string, span: string): string;

  // Read lines around a span (for call site context)
  readContext(filePath: string, span: string, contextLines: number): string;

  // Read the full declaration of an element (using tree-sitter)
  readDeclaration(filePath: string, span: string, kind: string): string;

  // Read the import block of a file
  readImportBlock(filePath: string): string[];

  // Read the full content of a file (up to a limit)
  readFileContent(filePath: string, maxLines: number): string;

  // Compute the import statement for a symbol
  computeImportStatement(
    symbolName: string,
    symbolModule: string,
    targetModule: string
  ): string;
}
```

The `computeImportStatement` function uses `computeRelativeImportPath()` from
`packages/core/src/render/paths.ts` — an existing, tested function.

For declaration extraction, `findEnclosingDeclaration()` from
`packages/core/src/render/declaration.ts` is already available and tested.

## 13. Olog Schema Addition

No schema changes are needed. The delegation tool uses existing olog elements and
arrows exclusively:

- `function`, `method`, `class`, `interface` elements — for targets and analogues
- `calleeOf`, `callerOf` arrows — for call graph
- `implements` arrows — for interface contracts
- `importsFrom` arrows — for import resolution
- `inModule`, `locatedIn` arrows — for file path resolution
- `span` element attribute — for source text extraction

If `implements` arrows are not yet populated by ingestion (they currently aren't in
the tree-sitter ingest), they can be added as a future enhancement. The delegation
tool will gracefully degrade — `mustImplement` will be empty if no `implements`
arrows exist, and the acceptance criteria will not include interface satisfaction
requirements that it cannot verify.