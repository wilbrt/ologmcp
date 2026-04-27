import Parser from 'tree-sitter';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LanguageAdapter, PropertyExtract } from '@olog/core';
import type { RawElement, RawArrow, OlogKind } from '@olog/core';
import { extractFromFile } from './extract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLJ_QUERY_PATH = resolve(__dirname, 'queries', 'clj.scm');

/** Map from olog element kind to Clojure tree-sitter node types. */
const KIND_TO_NODE_TYPES: Record<string, string[]> = {
  function: ['list'],
  method: ['list'],
  variable: ['list'],
  namespace: ['list'],
};

/** Cached grammar reference — loaded lazily via init(). */
let clojureGrammar: unknown = null;

/**
 * Load the tree-sitter-clojure grammar dynamically.
 * Call this before using createParser if tree-sitter-clojure is not a hard dependency.
 */
export async function init(): Promise<void> {
  if (clojureGrammar) return;
  try {
    const mod = await import('tree-sitter-clojure');
    clojureGrammar = mod.default ?? mod;
  } catch (_err) {
    throw new Error(
      'tree-sitter-clojure is not installed. Install it with: npm install tree-sitter-clojure\n' +
      'Note: this package requires a compatible Node.js version for native module compilation.'
    );
  }
}

/**
 * Language adapter for Clojure (.clj, .cljs, .cljc) files.
 */
export class ClojureAdapter implements LanguageAdapter {
  languageId = 'clojure';
  extensions = ['.clj', '.cljs', '.cljc'];
  globPattern = '**/*.{clj,cljs,cljc}';

  nodeTypeToKind: Record<string, OlogKind> = {
    // Clojure queries will set the kind directly via captures
    // This mapping is less relevant since we determine kind from the symbol name
  };

  kindToNodeTypes = KIND_TO_NODE_TYPES;

  createParser(filename: string): Parser {
    if (!clojureGrammar) {
      throw new Error(
        'Clojure grammar not loaded. Call init() first, or install tree-sitter-clojure.\n' +
        'See https://github.com/wilbrdt/ologmcp for details.'
      );
    }
    const parser = new Parser();
    parser.setLanguage(clojureGrammar as unknown as Parameters<Parser['setLanguage']>[0]);
    return parser;
  }

  queryPath(_filename: string): string {
    return CLJ_QUERY_PATH;
  }

  extractElements(parser: Parser, source: string, queryPath: string): {
    elements: RawElement[];
    arrows: RawArrow[];
  } {
    return extractFromFile(parser, source, queryPath);
  }

  // Clojure doesn't have TypeScript-style interface/class property extraction
  // This can be expanded later for defrecord/deftype fields
  extractProperties?(_parser: Parser, _source: string, _moduleName: string): PropertyExtract[] {
    return [];
  }

  resolveImportSpecifier(specifier: string, _fromFile: string, _projectRoot: string): string | null {
    // Clojure require specifiers like 'some.lib' map directly to file paths
    // e.g., some.lib → some/lib.clj
    if (!specifier || specifier.startsWith('/')) return null;
    return specifier.replace(/\./g, '/') + '.clj';
  }
}