# Plan: Modular Tree-sitter Language Adapters

## Intent

Make the tree-sitter ingestion system modular so that new language grammars (e.g. Clojure) can be added as independent packages without modifying core. Currently, TypeScript-specific logic (parser creation, query files, node type mappings, property extraction, import resolution) is hardcoded across `treesitter.ts`, `project.ts`, and `render/declaration.ts`. This plan extracts that logic into a `LanguageAdapter` interface in core and two independent adapter packages — `@olog/lang-typescript` (migrating existing TS logic) and `@olog/lang-clojure` (new skeleton). Adapters are registered at runtime, so core never imports from language packages (no circular deps).

## Current State (TypeScript-only, all in core)

```
packages/core/src/ingest/
  project.ts          → discoverTsFiles(), runIngestion(), resolveImportSpecifier()
  treesitter.ts       → parserFor(), extractFromFile(), extractPropertiesFromFile(),
                         findContainingFunctionName(), PropertyExtract
  ids.ts              → language-agnostic: elemId(), arrowId(), fileElemId(), formatSpan()
  queries/
    ts.scm, tsx.scm   → TS/TSX tree-sitter query patterns

packages/core/src/render/
  declaration.ts      → DECLARATION_NODE_TYPES, findEnclosingDeclaration(),
                         findImportStatement(), extractDeclaration()
```

**Hardcoded TypeScript couplings:**

| Location | What's hardcoded |
|---|---|
| `treesitter.ts:75-93` | `parserFor()` maps `.ts/.tsx` → `TS.typescript`/`TS.tsx` |
| `treesitter.ts:39-64` | `findContainingFunctionName()` checks TS node types |
| `treesitter.ts:312-369` | `extractPropertiesFromFile()` checks `interface_declaration`, `class_declaration`, etc. |
| `project.ts:22` | `SUPPORTED_EXTENSIONS` is a flat list of TS/JS extensions |
| `project.ts:24-40` | `resolveImportSpecifier()` maps `.js/.jsx` → `.ts/.tsx` (TS-specific) |
| `project.ts:60-66` | `discoverTsFiles()` globs `**/*.{ts,tsx,mts,cts}` |
| `render/declaration.ts:20-29` | `DECLARATION_NODE_TYPES` maps TS node types → olog kinds |

## Target Architecture

```
packages/core/src/ingest/
  adapter.ts           → NEW: LanguageAdapter interface + AdapterRegistry
  project.ts           → REFACTORED: uses AdapterRegistry, no hardcoded TS logic
  ids.ts               → UNCHANGED (language-agnostic)
  treesitter.ts        → REMOVED (moved to @olog/lang-typescript)
  queries/ts.scm       → REMOVED (moved to @olog/lang-typescript)
  queries/tsx.scm      → REMOVED (moved to @olog/lang-typescript)

packages/core/src/render/
  declaration.ts       → REFACTORED: delegates to adapter from registry

packages/lang-typescript/          → NEW PACKAGE: @olog/lang-typescript
  src/
    index.ts            → exports TypeScriptAdapter
    adapter.ts          → TypeScriptAdapter implements LanguageAdapter
    extract.ts          → extractFromFile, findContainingFunctionName (from treesitter.ts)
    properties.ts       → extractPropertiesFromFile, PropertyExtract (from treesitter.ts)
    declaration.ts      → DECLARATION_NODE_TYPES mapping, findEnclosingDeclaration (from render/declaration.ts)
    queries/
      ts.scm            → from core/ingest/queries/ts.scm
      tsx.scm           → from core/ingest/queries/tsx.scm
  package.json          → depends on @olog/core, tree-sitter, tree-sitter-typescript

packages/lang-clojure/             → NEW PACKAGE: @olog/lang-clojure
  src/
    index.ts            → exports ClojureAdapter
    adapter.ts           → ClojureAdapter implements LanguageAdapter
    extract.ts           → Clojure-specific extraction (defn, defmacro, ns, def, etc.)
    queries/
      clj.scm            → Clojure tree-sitter queries
  package.json           → depends on @olog/core, tree-sitter, tree-sitter-clojure
```

## LanguageAdapter Interface

The adapter interface lives in `packages/core/src/ingest/adapter.ts` and defines:

```typescript
import type { Parser } from 'tree-sitter';
import type { RawElement, RawArrow, OlogKind } from '../ontology.js';

export interface PropertyExtract {
  name: string;
  span: string;
  typeText: string;
  optional: boolean;
  readonly: boolean;
  typeRefs: string[];
  parentName: string;
  parentKind: string;
}

export interface LanguageAdapter {
  /** Unique language identifier (e.g. 'typescript', 'clojure') */
  languageId: string;

  /** File extensions this adapter handles, with leading dot (e.g. ['.ts', '.tsx', '.mts', '.cts']) */
  extensions: string[];

  /** Create a configured tree-sitter Parser for the given file */
  createParser(filename: string): Parser;

  /** Get the .scm query file path for a given source file */
  queryPath(filename: string): string;

  /** Extract raw elements and arrows from source via tree-sitter queries */
  extractElements(parser: Parser, source: string, queryPath: string): {
    elements: RawElement[];
    arrows: RawArrow[];
  };

  /** Extract properties (interface fields, class members, etc.) — optional */
  extractProperties?(parser: Parser, source: string, moduleName: string): PropertyExtract[];

  /** Find the containing function/method name for a position — optional */
  findContainingFunctionName?(node: Parser.SyntaxNode, row: number, col: number): string | null;

  /** Map a tree-sitter node type to a canonical olog element kind */
  nodeTypeToKind: Record<string, OlogKind>;

  /** Map an olog element kind to tree-sitter node types (reverse of nodeTypeToKind) */
  kindToNodeTypes: Record<string, string[]>;

  /** Resolve an import specifier to a file path — optional, falls back to generic resolution */
  resolveImportSpecifier?(importPath: string, fromFile: string, projectRoot: string): string | null;

  /** File discovery glob pattern for this language (e.g. '**/*.{ts,tsx,mts,cts}') */
  globPattern: string;
}

export class AdapterRegistry {
  private adapters: Map<string, LanguageAdapter> = new Map();
  private extensionMap: Map<string, LanguageAdapter> = new Map();

  register(adapter: LanguageAdapter): void;
  getForFile(filename: string): LanguageAdapter | null;
  allExtensions(): string[];
  allGlobPatterns(): string[];
  hasAdapter(languageId: string): boolean;
}
```

**Key design decisions:**
- Interface lives in core (since it references `RawElement`, `RawArrow`, `OlogKind`)
- Adapters are registered at runtime — core never imports from lang packages
- `PropertyExtract` moves from `treesitter.ts` into the adapter interface file
- `resolveImportSpecifier` is optional — each language has different module resolution rules
- `findContainingFunctionName` is optional — Clojure may define this differently or skip it
- Both `nodeTypeToKind` (for property extraction) and `kindToNodeTypes` (for declaration rendering) are required

## Invariants to preserve

1. **TypeScript ingestion must produce identical olog output** — after the refactoring, ingesting the same TS project should yield the same elements, arrows, and properties.
2. **All currently exported symbols from core must remain exported** — `PropertyExtract` and `parserFor` move to the adapter, but core must still re-export `PropertyExtract` from the adapter module for backward compatibility.
3. **The `runIngestion → discoverTsFiles → parserFor → extractFromFile → extractPropertiesFromFile` pipeline order must be preserved** — core's orchestration just dispatches to the adapter instead of hardcoded functions.
4. **`render/declaration.ts` functionality must be preserved** — `findEnclosingDeclaration` and `findImportStatement` must still work for TypeScript files via the adapter.
5. **The olog schema (element kinds, arrow kinds) must not change** — the adapter maps language-specific node types into the same `OlogKind` and `ArrowKind` values.

## Implementation slices

### Slice 1: Define LanguageAdapter interface + AdapterRegistry in core
**Target:** `packages/core/src/ingest/adapter.ts` (new file)
- Define `LanguageAdapter` interface
- Define `AdapterRegistry` class
- Define `PropertyExtract` interface (move from `treesitter.ts`)
- Export from `packages/core/src/index.ts`
- **No breaking changes** — additive only

### Slice 2: Create @olog/lang-typescript package
**Target:** `packages/lang-typescript/` (new package)
- Set up `package.json`, `tsconfig.json`, `tsup.config.ts`
- Create `TypeScriptAdapter` implementing `LanguageAdapter`
- Move `extractFromFile`, `findContainingFunctionName` from `treesitter.ts` → `extract.ts`
- Move `extractPropertiesFromFile`, `PropertyExtract` usage → `properties.ts`
- Move `DECLARATION_NODE_TYPES`, `findEnclosingDeclaration`, `findImportStatement`, `extractDeclaration` → `declaration.ts`
- Copy `ts.scm`, `tsx.scm` → `queries/`
- **No breaking changes yet** — core still uses old code

### Slice 3: Refactor core to use AdapterRegistry
**Target:** `packages/core/src/ingest/project.ts`, `packages/core/src/render/declaration.ts`
- `project.ts`: Replace `SUPPORTED_EXTENSIONS` with `registry.allExtensions()`
- `project.ts`: Replace `discoverTsFiles()` glob pattern with aggregated patterns from registry
- `project.ts`: Replace `parserFor(filename)` → `registry.getForFile(filename).createParser(filename)`
- `project.ts`: Replace `extractFromFile(...)` → `adapter.extractElements(...)`
- `project.ts`: Replace `extractPropertiesFromFile(...)` → `adapter.extractProperties?.(...)`
- `project.ts`: Replace `resolveImportSpecifier(...)` → `adapter.resolveImportSpecifier?.(...)`
- `project.ts`: Make `ingestProject`/`reindexProject` accept an `AdapterRegistry` parameter (or use a module-level setter)
- `render/declaration.ts`: Replace `parserFor(filename)` → registry lookup
- `render/declaration.ts`: Replace `DECLARATION_NODE_TYPES` → adapter's `kindToNodeTypes`
- Remove `packages/core/src/ingest/treesitter.ts` (all code moved to lang-typescript)
- Remove `packages/core/src/ingest/queries/ts.scm` and `tsx.scm`
- Update `packages/core/package.json` to remove `tree-sitter-typescript` dependency

### Slice 4: Wire up TypeScript adapter registration
**Target:** `packages/mcp-server/src/index.ts` (or a new registration module)
- Import `TypeScriptAdapter` from `@olog/lang-typescript`
- Create registry instance, register the TS adapter
- Pass registry to `ingestProject`/`reindexProject`
- Verify TS ingestion end-to-end produces identical output

### Slice 5: Create @olog/lang-clojure package (skeleton)
**Target:** `packages/lang-clojure/` (new package)
- Set up `package.json`, `tsconfig.json`, `tsup.config.ts`
- Add `tree-sitter-clojure` dependency
- Create `ClojureAdapter` implementing `LanguageAdapter`
- Implement `createParser()` using `tree-sitter-clojure`
- Define `extensions: ['.clj', '.cljs', '.cljc']`
- Write initial `clj.scm` query file for `defn`, `defmacro`, `ns`, `def`, `defn-`
- Define `nodeTypeToKind` and `kindToNodeTypes` mappings for Clojure node types
- Implement `extractElements()` for Clojure
- Leave `extractProperties` as no-op (Clojure doesn't have interface/class properties in the TS sense)
- Leave `resolveImportSpecifier` as no-op initially (Clojure's `require`/`use` in `ns` forms need separate handling)

## Acceptance criteria

1. `ingestProject` on the current codebase (a TS project) produces identical olog output before and after the refactoring
2. Adding a new language requires only: (a) creating a new package, (b) implementing `LanguageAdapter`, (c) calling `registry.register(adapter)` — no modifications to core
3. `@olog/core` has zero imports from `@olog/lang-typescript` or `@olog/lang-clojure`
4. `tree-sitter-typescript` is not in `@olog/core`'s dependencies
5. `@olog/lang-typescript` can be installed independently — `npm install @olog/lang-typescript` adds TS ingestion support
6. The Clojure adapter can parse `.clj` files and produce at least `function`, `method`, `namespace`, and `variable` elements with correct spans
7. All existing tests pass

## Validation status
- [ ] olog_plan created
- [ ] olog_validate passed
- [ ] Slices delegated
- [ ] olog_reindex run