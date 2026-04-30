import type { RawElement, RawArrow, OlogKind } from '../ontology.js';

/**
 * Represents a property extracted from a structured declaration
 * (interface field, class member, etc.)
 */
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

/**
 * Minimal parser interface shared by tree-sitter bindings.
 * Both native `tree-sitter` and `web-tree-sitter` satisfy this.
 */
export interface TreeSitterParser {
  parse(input: string): {
    rootNode: TreeSitterNode;
    delete?(): void;
  };
}

/**
 * Minimal node interface shared by tree-sitter bindings.
 */
export interface TreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  parent: TreeSitterNode | null;
  namedChildren: TreeSitterNode[];
  childForFieldName(fieldName: string): TreeSitterNode | null;
  descendantForPosition(start: { row: number; column: number }, end: { row: number; column: number }): TreeSitterNode | null;
  hasError: boolean;
  walk(): TreeSitterCursor;
}

export interface TreeSitterCursor {
  nodeType: string;
  nodeText: string;
  nodeId: number;
  nodeIsNamed: boolean;
  nodeIsMissing: boolean;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  currentNode: TreeSitterNode;
  currentFieldName: string;
  gotoParent(): boolean;
  gotoFirstChild(): boolean;
  gotoNextSibling(): boolean;
}

/**
 * Minimal query interface shared by tree-sitter bindings.
 */
export interface TreeSitterQuery {
  matches(node: TreeSitterNode): TreeSitterQueryMatch[];
  captures(node: TreeSitterNode): TreeSitterQueryCapture[];
  delete(): void;
}

export interface TreeSitterQueryMatch {
  pattern: number;
  captures: TreeSitterQueryCapture[];
}

export interface TreeSitterQueryCapture {
  name: string;
  node: TreeSitterNode;
  text?: string;
}

/**
 * Language adapter interface — each supported language provides an
 * implementation that knows how to parse source files, extract elements
 * and arrows, and resolve imports for that language.
 */
export interface LanguageAdapter<ParserT = TreeSitterParser> {
  /** Unique language identifier (e.g. 'typescript', 'clojure') */
  languageId: string;

  /** File extensions this adapter handles, with leading dot */
  extensions: string[];

  /** Glob pattern for file discovery (e.g. 'any .ts, .tsx, .mts or .cts file') */
  globPattern: string;

  /** Create a configured tree-sitter Parser for the given file */
  createParser(filename: string): ParserT;

  /** Get the .scm query file path for a given source file */
  queryPath(filename: string): string;

  /** Extract raw elements and arrows from source via tree-sitter queries */
  extractElements(parser: ParserT, source: string, queryPath: string, fromFile?: string, projectRoot?: string): {
    elements: RawElement[];
    arrows: RawArrow[];
  };

  /** Map a tree-sitter node type to a canonical olog element kind */
  nodeTypeToKind: Record<string, OlogKind>;

  /** Map an olog element kind to tree-sitter node types (reverse mapping) */
  kindToNodeTypes: Record<string, string[]>;

  /** Extract properties (interface fields, class members, etc.) — optional */
  extractProperties?(parser: ParserT, source: string, moduleName: string): PropertyExtract[];

  /** Find the containing function/method name for a position — optional */
  findContainingFunctionName?(node: unknown, row: number, col: number): string | null;

  /** Resolve an import specifier to a file path — optional */
  resolveImportSpecifier?(importPath: string, fromFile: string, projectRoot: string): string | null;
}

/**
 * Registry of language adapters. Adapters are registered at runtime
 * and looked up by file extension.
 */
export class AdapterRegistry {
  private adapters: Map<string, LanguageAdapter> = new Map();
  private extensionMap: Map<string, LanguageAdapter> = new Map();

  /** Register a language adapter */
  register(adapter: LanguageAdapter): void {
    this.adapters.set(adapter.languageId, adapter);
    for (const ext of adapter.extensions) {
      this.extensionMap.set(ext, adapter);
    }
  }

  /** Look up the adapter for a given filename (by its extension) */
  getForFile(filename: string): LanguageAdapter | null {
    const ext = filename.substring(filename.lastIndexOf('.'));
    return this.extensionMap.get(ext) ?? null;
  }

  /** Get all registered file extensions across all adapters */
  allExtensions(): string[] {
    return Array.from(this.extensionMap.keys());
  }

  /** Get all glob patterns across all adapters */
  allGlobPatterns(): string[] {
    return Array.from(this.adapters.values()).map(a => a.globPattern);
  }

  /** Check if an adapter is registered for a given language id */
  hasAdapter(languageId: string): boolean {
    return this.adapters.has(languageId);
  }
}

/** Global default registry instance */
let defaultRegistry: AdapterRegistry | undefined = undefined;

/** Set the global default adapter registry (called during project ingestion setup) */
export function setDefaultRegistry(registry: AdapterRegistry): void {
  defaultRegistry = registry;
}

/** Get the global default adapter registry */
export function getDefaultRegistry(): AdapterRegistry | undefined {
  return defaultRegistry;
}