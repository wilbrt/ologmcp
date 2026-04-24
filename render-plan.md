# Render Agent: Olog → Source Reconciliation

## 1. Overview

The render agent bridges the gap between the olog's structural model and source files. When a validated plan describes a structural change (rename, move, add, remove), the render agent computes and applies the minimal set of source-file edits that make the actual code structurally consistent with the new olog state. After rendering, re-ingestion must confirm the olog matches.

**Analogy**: The olog is the shadow DOM (desired state). Source files are the real DOM (actual state). The render agent is the reconciler that diffs them and produces mutations.

```
            ┌─────────────┐
            │  olog_plan   │  (desired structural mutation)
            └──────┬───────┘
                   │ validated
                   ▼
            ┌─────────────┐     ┌──────────────┐
            │  olog_validate│────►│   rendered    │
            └──────┬───────┘     │   olog state  │
                   │ passes       │  (plan applied│
                   ▼              │   to DB)      │
            ┌─────────────┐     └──────┬──────── ┘
            │   render     │            │
            │   agent       │◄──────────┘
            └──────┬───────┘
                   │ computes
                   ▼
            ┌─────────────────────────────────┐
            │         SourceEdit[]             │
            │  — precise text mutations        │
            │    per affected file             │
            └──────┬──────────────────────────┘
                   │ applied to disk
                   ▼
            ┌─────────────┐
            │ re-ingest    │  (verify source ≈ olog)
            └─────────────┘
```

## 2. Core Types

```typescript
/** A single text replacement within a source file. */
interface SourceEdit {
  /** Relative path from project root (e.g. "src/tools/olog-query.ts") */
  filePath: string
  /** Human-readable description of what this edit does */
  label: string
  /** Text to find — exact match within the line/col range. 
   *  null means "insert at position without matching". */
  oldText: string | null
  /** Replacement text. Empty string means deletion. */
  newText: string
  /** 1-based line, 1-based column — matches tree-sitter span format */
  startLine: number
  startCol: number
  endLine: number
  endCol: number
}

/** Result of rendering a plan into source edits. */
interface RenderResult {
  edits: SourceEdit[]
  warnings: string[]      // operations needing manual review
  affectedFiles: string[]
}

/** Context needed by the render agent. */
interface RenderContext {
  store: OlogStore          // post-plan olog state (plan already applied to DB)
  plan: Plan                // the validated plan
  projectRoot: string       // absolute path to project root
  readFile(path: string): Promise<string>  // read file from disk
}
```

## 3. Pipeline Stages

The render pipeline has three sequential stages:

```
plan.operations
      │
      ▼
┌──────────────┐
│  expand()     │  Expand compound operations into atomic edits
│  - rename →   │    declaration-rename + reference-updates + import-updates
│  - move →     │    add-declaration + add-import + remove-declaration + update-importers
│  - addSymbol →│    insert-stub + add-imports-if-needed
│  - etc.       │
└──────┬───────┘
       │ AtomicEdit[]
       ▼
┌──────────────┐
│  localize()   │  Convert atomic edits to SourceEdits using olog spans
│  - read spans│    and source file content
│  - compute   │
│    ranges     │
└──────┬───────┘
       │ SourceEdit[]
       ▼
┌──────────────┐
│  order()     │  Topologically sort edits per file
│  - per-file  │    (declarations before references, removals last)
│  - conflict  │    Detect overlapping edits
│    detection │
└──────┬───────┘
       │ SourceEdit[] (ordered, conflict-free)
       ▼
  apply(edits) → write to disk → re-ingest → verify
```

### 3.1 expand()

Input: `PlanOperation[]`
Output: `AtomicEdit[]`

Each plan operation expands into one or more atomic edits:

| Plan Operation | Atomic Edits |
|---------------|-------------|
| `rename` | EditDeclaration, EditReferences, EditImportSites |
| `move` | InsertDeclaration, InsertImport, DeleteDeclaration, UpdateImporterPaths, OptionallyInsertReexport |
| `addSymbol` | InsertDeclaration, InsertImport |
| `removeSymbol` | DeleteDeclaration, RemoveDeadImports, ReportAffectedCallSites |
| `addArrow` | (usually) Noop, or InsertImport for `importsFrom`, MoveMethod for `memberOf` |
| `removeArrow` | (usually) Noop, or RemoveImport for `importsFrom` |

### 3.2 localize()

Input: `AtomicEdit[]`, `RenderContext`
Output: `SourceEdit[]`

For each atomic edit, compute the exact character range in the target file:

- **EditDeclaration**: Use the element's `span` from the olog to locate the identifier. Read the file, verify `oldText` matches at the position, produce the `SourceEdit`.
- **EditReferences / EditImportSites**: For each reference site, use the `imports` / `importsFrom` / `callerOf` / `calleeOf` arrows to find all files referencing the renamed element. Use each reference element's span to compute edit positions.
- **InsertDeclaration**: Read the target file, find the insertion point (after imports, before the last export, or at end of file). Produce an `oldText: null` insertion edit.
- **DeleteDeclaration**: Use the element's span — but we need the **full declaration range** (not just the identifier). Section 5 covers this gap.
- **InsertImport / RemoveImport**: Parse the import section of the target file. Compute insertion position. Section 6 covers import manipulation.

### 3.3 order()

Input: `SourceEdit[]`
Output: `SourceEdit[]` (reordered, conflict-checked)

Rules:
1. **Within a single file**: Sort edits by position, **descending** (end of file first). This means later positions are applied before earlier ones, so character offsets remain valid.
2. **Deletions before insertions at the same position**: When an edit deletes code and another inserts at the same spot, the deletion goes first.
3. **Conflict detection**: If two edits overlap (their ranges intersect), mark both as conflicting and add a warning. Do not apply overlapping edits.
4. **Cross-file ordering**: File edits are independent and can be applied in any order. Group by file for readability.

## 4. Operation → Source Mutation Mapping

### 4.1 `rename`

**Olog provides**: Element ID, old name, new name, span, module.

| Mutation | Mechanism | Precision |
|----------|-----------|-----------|
| Declaration site | Span-gated text replacement at the exact identifier position | Exact (tree-sitter span) |
| Reference sites in same module | `callerOf`/`calleeOf` arrows → find call-site elements → replace identifier at each span | Exact (olog-guided) |
| Import sites in other modules | Follow `imports` + `importsFrom` arrows to find all files importing this symbol, replace the imported name at each span | Exact (olog-guided) |
| Re-exports | Follow `exports` arrows | Exact (olog-guided) |

**Strategy A (floor — always available)**: Use olog spans for all sites. The tree-sitter ingestion captures function names, method names, import names, and call-site callee names, each with a precise span. Replace the identifier text at each span position.

**Strategy B (ceiling — LSP)**: When LSP is available, delegate the entire rename to `textDocument/prepareRename` → `textDocument/rename`. This handles all edge cases (string references, JSDoc, etc.) that the olog doesn't track. Falls back to Strategy A if LSP is unavailable.

### 4.2 `move`

**Olog provides**: Element ID, old module, new module, element span.

| Mutation | Mechanism |
|----------|-----------|
| Extract declaration from source module | Use element span to get **full declaration range** (see §5), read source text in that range |
| Add declaration to target module | Insert the extracted text at an appropriate position (after imports, before exports) |
| Add import in target module | Compute relative path, construct import statement, insert into import section |
| Delete declaration from source module | Delete the character range of the declaration (including trailing newline) |
| Update all importers | For every file with an `importsFrom` arrow pointing at the old module for this name, update the import source path to the new relative path |
| Add re-export in old module (optional) | `export { <name> } from '<new-relative-path>'` for backward compatibility |

This is the most complex operation. Sub-phases:
1. **Extract**: Read source file, use tree-sitter to find the full declaration range (not just the identifier).
2. **Transform**: Adjust any relative imports within the moved declaration to account for the new file location.
3. **Insert**: Write the declaration into the target file at the insertion point.
4. **Update importers**: Walk the `importsFrom` graph, compute new relative paths, modify import statements.
5. **Clean up source**: Remove the declaration from the original file. Remove the import if it was the only symbol imported from that source.

### 4.3 `addSymbol`

**Olog provides**: Module path, symbol name, symbol kind.

| Mutation | Mechanism |
|----------|-----------|
| Insert declaration stub in target module | At end of file, or after imports and before last `export` |
| Add required imports | Deduced from the stub's dependencies |

**Stub templates**:

```typescript
// kind: "function" →
export function <name>(): void {
  // TODO: implement
}

// kind: "class" →
export class <name> {
  // TODO: implement
}

// kind: "interface" →
export interface <name> {
  // TODO: define properties
}

// kind: "type" →
export type <name> = unknown;

// kind: "enum" →
export enum <name> {
  // TODO: add members
}

// kind: "method" → (needs a class context — usually accompanied by an addArrow memberOf)
<name>() {
  // TODO: implement
}
```

**Architectural decision**: `addSymbol` produces stubs by default. For real implementations, the render agent either delegates to an LLM subagent (see §7) or the plan includes an optional `body` parameter.

### 4.4 `removeSymbol`

**Olog provides**: Element ID, name, span, module.

| Mutation | Mechanism |
|----------|-----------|
| Delete declaration from source | Full declaration range from span (§5) |
| Remove dead imports | Follow `importsFrom` arrows; if the import statement is the sole import from that source, remove the entire import line; otherwise, remove just the symbol name |
| Report affected call sites | Follow `callerOf`/`calleeOf` arrows to find callers; produce a `warning` (not an auto-edit) listing files that will break |

**Important**: `removeSymbol` does NOT automatically remove call sites. Call sites that reference the removed symbol will become compilation errors. The render agent reports these as warnings for manual review.

### 4.5 `addArrow`

Most arrow additions are consequences of other edits. Only some arrow kinds have autonomous source-level meaning:

| Arrow kind | Source change |
|------------|---------------|
| `importsFrom` | Add or modify an import statement in the source module |
| `memberOf` | Move method declaration into class body (conceptually similar to move) |
| `definedIn` | No source change (structural metadata) |
| `inModule` | No source change (derived) |
| `locatedIn` | No source change (derived) |
| `callerOf` / `calleeOf` | No source change (consequence of a call already existing) |
| `calls` | Insert a call expression (rarely used standalone) |
| All others | No source change |

### 4.6 `removeArrow`

Reverse of `addArrow`:

| Arrow kind | Source change |
|------------|---------------|
| `importsFrom` | Remove or modify the import statement |
| `memberOf` | Move method out of class |
| All others | No source change |

## 5. Full Declaration Extraction

### The Gap

Current tree-sitter spans cover **only the identifier**, not the full declaration body. For example:

```
Element: module:src/tools/olog-reindex.ts:5:17:function:registerOlogReindex
  span: src/tools/olog-reindex.ts:5:17-5:36
  name: "registerOlogReindex"    ← only these characters
```

But for `move` and `removeSymbol`, we need the **entire declaration**: from `export function registerOlogReindex(` to the closing `}`.

### Solution: Runtime Tree-Sitter Re-Parse

At render time, for any operation needing the full declaration range, the render agent re-parses the target file with tree-sitter and walks up from the identifier node to find the enclosing declaration node:

```typescript
// packages/core/src/render/declaration.ts

function findEnclosingDeclaration(
  parser: Parser,
  source: string,
  identifierLine: number,   // 1-based
  identifierCol: number,     // 1-based
  kind: string               // "function", "class", etc.
): { startLine: number; startCol: number; endLine: number; endCol: number; text: string } | null {
  const tree = parser.parse(source)
  const rootNode = tree.rootNode
  
  // Walk the tree to find the node at (identifierLine-1, identifierCol-1)
  // (tree-sitter uses 0-based positions)
  const targetRow = identifierLine - 1
  const targetCol = identifierCol - 1
  
  // Walk up from the named node to find the enclosing declaration
  let node = rootNode.descendantForPosition(
    { row: targetRow, column: targetCol },
    { row: targetRow, column: targetCol + 1 }
  )
  
  // Walk up until we find a node of the right type
  const declarationTypes: Record<string, string[]> = {
    function: ['function_declaration', 'arrow_function'],
    method:   ['method_definition', 'abstract_method_signature'],
    class:    ['class_declaration'],
    interface:['interface_declaration'],
    type:     ['type_alias_declaration'],
    enum:     ['enum_declaration'],
  }
  
  const targetType = declarationTypes[kind] ?? []
  while (node && !targetType.includes(node.type)) {
    node = node.parent
  }
  
  if (!node) return null
  
  return {
    startLine: node.startPosition.row + 1,
    startCol:  node.startPosition.column + 1,
    endLine:   node.endPosition.row + 1,
    endCol:    node.endPosition.column + 1,
    text:      node.text,
  }
}
```

For import elements (`kind: "import"`), the entire import statement is the "declaration":

```typescript
function findImportStatement(
  source: string,
  importLine: number,  // 1-based line number from the import element's span
): { startLine: number; startCol: number; endLine: number; endCol: number; text: string } | null {
  const lines = source.split('\n')
  const line = lines[importLine - 1]
  if (!line) return null
  
  // Find the full import statement (may span multiple lines)
  let startLine = importLine
  let endLine = importLine
  let braceDepth = 0
  
  // Walk backwards for multi-line imports that start above
  // Walk forward for multi-line imports that end below
  // ... (handle { } delimited imports,bare imports)
  
  const text = lines.slice(startLine - 1, endLine).join('\n')
  return {
    startLine, startCol: 0,
    endLine, endCol: lines[endLine - 1].length,
    text,
  }
}
```

## 6. Import Statement Manipulation

Import manipulation is the single most common source-level side effect across all operations. It requires care because import statements have complex syntax.

### 6.1 Types of Import Edits

| Edit Type | Trigger | Description |
|-----------|---------|-------------|
| `AddImport` | `move` (target file), `addSymbol` (if it references symbols from other modules) | Insert a new import statement |
| `RemoveImport` | `removeSymbol` (if no other symbols from the same source) | Remove an import line entirely |
| `ModifyImport` | `rename` (imported name changed), `move` (source path changed) | Change a name or path within an existing import |

### 6.2 Import Parser

A lightweight parser that handles the 5 import forms:

```
1. import { A, B } from './module'              // named
2. import X from './module'                      // default
3. import * as X from './module'                // namespace
4. import './module'                             // side-effect
5. import { A as B } from './module'             // aliased
```

Plus `export` variants (`export { A } from './module'`, `export * from './module'`).

The parser should:
- Identify all import statements in a file (by line range)
- Parse each into a structured representation: `{ kind, names: [{original, alias?}], sourcePath, isType, lineNumber }`
- Support modification: add/remove names, change sourcePath, merge adjacent imports from the same source

### 6.3 Relative Path Computation

When `move` changes a module's location, all importers that referenced it need their import paths updated:

```typescript
function computeNewRelativePath(
  fromFile: string,    // e.g., "src/index.ts"
  oldModule: string,   // e.g., "src/tools/olog-query"
  newModule: string,   // e.g., "src/tools/query/olog-query"
): string {
  // 1. Resolve oldModule and newModule relative to fromFile's directory
  // 2. Compute the relative path from fromFile to newModule
  // 3. Preserve the existing extension convention (.js vs no extension)
  return relativePath
}
```

### 6.4 Insertion Point

When adding an import, find the correct insertion point:
1. After the last existing import statement in the file
2. Preserve blank-line separation between import groups (external vs internal)
3. If no imports exist, insert at the top of the file (after any `#!/usr/bin/env` shebang or `//` license headers)

## 7. LLM Delegation for Body Text

For `addSymbol` operations that need implementation (not just stubs), or for `move` operations where the moved declaration's internal imports need adjustment, the render agent can delegate to an LLM subagent.

### 7.1 Delegation Protocol

```typescript
interface DelegationRequest {
  task: 'write_function_body' | 'write_test' | 'rewrite_body' | 'write_migration'
  target: string           // element ID in the olog
  brief: {
    signature: string       // the function/type signature from the plan
    structuralContext: {
      mustCall: string[]   // element IDs the body must call (from callerOf arrows)
      mustImplement: string[] // interfaces this implements (from implements arrows)
      usedBy: string[]     // callers (from calleeOf arrows)
      imports: string[]    // modules this file imports (from importsFrom arrows)
    }
    analogues: string[]    // element IDs of similar existing implementations
    acceptanceCriteria: string[]
  }
  toolScope: string[]     // e.g., ["read", "write", "edit"]
  timeoutMs: number
}
```

### 7.2 Default Behavior

**Without LLM delegation** (the default), `addSymbol` produces minimal stubs. The agent calling `olog_apply` can then follow up with manual edits or a separate delegation step.

**With LLM delegation**, the render agent calls into the opencode subagent dispatch to generate the body. This is opt-in and controlled by a parameter to the `olog_apply` tool.

## 8. Verification Loop

After applying source edits, the render agent must verify that the source files now structurally match the olog state.

```typescript
async function verifyRender(
  store: OlogStore,
  projectRoot: string,
  affectedFiles: string[],
): Promise<{ match: boolean; discrepancies: string[] }> {
  // 1. Re-ingest only the affected files
  for (const file of affectedFiles) {
    const relativePath = relative(projectRoot, file)
    const source = await readFile(file, 'utf8')
    const parser = parserFor(file)
    const extracted = extractFromFile(parser, source, queryPath)
    const { elems, arrs } = processExtracted(relativePath, extracted)
    store.ingestFile(relativePath, elems, arrs, 'working')
  }
  
  // 2. For each plan operation, verify the olog now contains the expected state
  const discrepancies: string[] = []
  
  for (const op of plan.operations) {
    switch (op.kind) {
      case 'rename': {
        // The element should now have name === op.newName
        const elem = store.getElem(op.target)
        if (elem && elem.name !== op.newName) {
          discrepancies.push(`rename: expected name "${op.newName}", got "${elem.name}"`)
        }
        break
      }
      case 'move': {
        const elem = store.getElem(op.target)
        if (elem && elem.module !== op.newModule) {
          discrepancies.push(`move: expected module "${op.newModule}", got "${elem.module}"`)
        }
        break
      }
      case 'addSymbol': {
        // Element should exist by name in the target module
        const found = store.queryElements({
          kind: op.symbolKind,
          nameRegex: `^${op.name}$`,
          moduleRegex: `^${op.module}$`,
          limit: 1,
        })
        if (found.length === 0) {
          discrepancies.push(`addSymbol: "${op.name}" not found in "${op.module}" after render`)
        }
        break
      }
      case 'removeSymbol': {
        const elem = store.getElem(op.target)
        if (elem) {
          discrepancies.push(`removeSymbol: "${op.target}" still exists after render`)
        }
        break
      }
      // addArrow, removeArrow: verify via arrow existence
    }
  }
  
  return { match: discrepancies.length === 0, discrepancies }
}
```

## 9. File Structure

```
packages/core/src/render/
├── index.ts              # Public API: renderPlan(), applySourceEdits(), verifyRender()
├── expand.ts             # expand() — compound ops → atomic edits
├── localize.ts           # localize() — atomic edits → SourceEdit[] using spans + files
├── order.ts              # order() — topological sort + conflict detection per file
├── edit.ts               # SourceEdit type, applySourceEdits() — writes to disk
├── declaration.ts        # Full declaration extraction using tree-sitter at runtime
├── imports.ts            # Import statement parsing, modification, and insertion
├── paths.ts              # Relative path computation for module moves
├── strategies/
│   ├── rename.ts         # Strategy A: span-guided text replacement for renames
│   ├── move.ts           # Move: extract + insert + update imports + delete source
│   ├── add-symbol.ts     # AddSymbol: stub generation + import insertion
│   ├── remove-symbol.ts  # RemoveSymbol: deletion + dead import cleanup + caller warnings
│   ├── add-arrow.ts      # AddArrow: mostly no-op, handles importsFrom / memberOf
│   └── remove-arrow.ts   # RemoveArrow: inverse of add-arrow
└── verify.ts             # Re-ingest + structural diff against expected olog state

packages/mcp-server/src/tools/
└── olog-render.ts        # New MCP tool — preview source edits (dry-run)
```

## 10. MCP Tool: `olog_render`

A new MCP tool that previews the source edits a validated plan would produce, without commiting them to disk. This is the dry-run companion to `olog_apply`.

```typescript
server.registerTool('olog_render', {
  description: 'Preview the source-file edits that a validated plan would produce, without writing to disk. Returns the list of SourceEdits grouped by file.',
  inputSchema: z.object({
    planHash: z.string().describe('Hash of the validated plan to render'),
    strategy: z.enum(['span-guided', 'lsp']).default('span-guided').describe(
      'Rendering strategy: "span-guided" uses olog spans (always available), "lsp" delegates to LSP rename (when available)'
    ),
  }),
  // ...
})
```

Output format:

```json
{
  "edits": [
    {
      "filePath": "src/index.ts",
      "label": "rename: registerOlogDump → registerOlogDumpAll (declaration)",
      "oldText": "registerOlogDump",
      "newText": "registerOlogDumpAll",
      "startLine": 8,
      "startCol": 10,
      "endLine": 8,
      "endCol": 26
    },
    // ...
  ],
  "warnings": [
    "removeSymbol: callers of \"registerOlogDump\" in 2 files will need manual review"
  ],
  "affectedFiles": ["src/index.ts", "src/tools/olog-dump.ts"]
}
```

## 11. Modified `olog_apply` Flow

The current `olog_apply` tool only updates the SQLite database. After the render agent is built, `olog_apply` gains an optional `render: boolean` parameter (default `false` for backward compatibility):

- `render: false` — current behavior: update DB only, return `ChangeInstruction[]`
- `render: true` — update DB, then render source edits, apply them to disk, re-ingest affected files, verify, and return `SourceEdit[]` + verification result

The flow when `render: true`:

```
1. OlogStore.applyPlan(operations)       // DB mutation
2. renderPlan(context)                    // compute source edits
3. applySourceEdits(edits)                // write to disk
4. verifyRender(store, projectRoot, files) // re-ingest + diff
5. Return { applied, edits, warnings, verification }
```

If verification fails, the tool returns the discrepancies and suggests a rollback (the original file contents are captured before step 3).

## 12. Rollback

Every `applySourceEdits` call captures the original content of each affected file before making changes. If verification fails or the user requests a rollback:

```typescript
interface FileSnapshot {
  filePath: string
  originalContent: string
}

async function rollback(snapshots: FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    await writeFile(snapshot.filePath, snapshot.originalContent, 'utf8')
  }
}
```

## 13. Implementation Order

### Phase 1: Foundation (render pipeline core)
1. `edit.ts` — `SourceEdit` type, `applySourceEdits()`, file snapshots
2. `declaration.ts` — full declaration extraction via runtime tree-sitter
3. `imports.ts` — import statement parsing and modification
4. `paths.ts` — relative path computation

### Phase 2: Strategies (one operation at a time)
5. `strategies/rename.ts` — most common, best test surface
6. `strategies/remove-symbol.ts` — simplest after rename
7. `strategies/add-symbol.ts` — stub generation
8. `strategies/move.ts` — most complex, depends on all of the above
9. `strategies/add-arrow.ts` / `remove-arrow.ts` — mostly no-ops

### Phase 3: Pipeline wiring
10. `expand.ts` — compound operation expansion
11. `localize.ts` — atomic edit → SourceEdit conversion
12. `order.ts` — topological sort + conflict detection
13. `index.ts` — `renderPlan()` orchestrator

### Phase 4: Verification and MCP integration
14. `verify.ts` — re-ingest + diff
15. `olog-render.ts` — new MCP tool
16. `olog-apply.ts` — add `render` parameter
17. End-to-end tests with real TypeScript fixtures

### Phase 5: LSP integration (ceiling)
18. LSP client (from plan.md §5)
19. `strategies/rename.ts` — add LSP-guided path alongside span-guided
20. LSP-assisted move/rename verification

## 14. Testing Strategy

Each strategy should have unit tests against TypeScript fixtures:

```
packages/core/test/
└── render/
    ├── fixtures/
    │   ├── simple-rename.ts      # rename a function
    │   ├── cross-file-import.ts  # rename affects import in another file
    │   ├── move-target.ts        # target file for a move operation
    │   ├── move-source.ts        # source file for a move operation
    │   ├── add-symbol.ts         # file where we add a symbol
    │   └── remove-symbol.ts      # file where we remove a symbol
    ├── expand.test.ts
    ├── localize.test.ts
    ├── order.test.ts
    ├── rename.test.ts
    ├── move.test.ts
    ├── add-symbol.test.ts
    ├── remove-symbol.test.ts
    ├── imports.test.ts
    └── verify.test.ts
```

Each test:
1. Sets up an in-memory `OlogStore` with known elements and arrows
2. Creates a plan with specific operations
3. Calls `expand()` → `localize()` → `order()` → `applySourceEdits()`
4. Re-ingests the modified files
5. Asserts the olog state matches expectations