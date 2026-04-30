import { Parser, Language } from 'web-tree-sitter';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { LanguageAdapter, PropertyExtract } from '@olog/core';
import type { RawElement, RawArrow, OlogKind } from '@olog/core';
import { extractFromFile } from './extract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const _require = createRequire(import.meta.url);

const CLJ_QUERY_PATH = resolve(__dirname, 'queries', 'clj.scm');
const CLJ_WASM_PATH = resolve(__dirname, 'tree-sitter-clojure.wasm');

const KIND_TO_NODE_TYPES: Record<string, string[]> = {
  function: ['list_lit'],
  method: ['list_lit'],
  variable: ['list_lit'],
  namespace: ['list_lit'],
};

let clojureLanguage: Language | null = null;
let parserInstance: Parser | null = null;

export async function init(): Promise<void> {
  if (clojureLanguage) return;

  try {
    await Parser.init();
  } catch {
    const webTreeSitterDir = dirname(_require.resolve('web-tree-sitter'));
    await Parser.init({
      locateFile: (name: string) => resolve(webTreeSitterDir, name),
    });
  }

  const wasmBytes = readFileSync(CLJ_WASM_PATH);
  clojureLanguage = await Language.load(wasmBytes);

  parserInstance = new Parser();
  parserInstance.setLanguage(clojureLanguage);
}

export class ClojureAdapter implements LanguageAdapter<Parser> {
  languageId = 'clojure';
  extensions = ['.clj', '.cljs', '.cljc'];
  globPattern = '**/*.{clj,cljs,cljc}';

  nodeTypeToKind: Record<string, OlogKind> = {};

  kindToNodeTypes = KIND_TO_NODE_TYPES;

  createParser(_filename: string): Parser {
    if (!parserInstance) {
      throw new Error('Clojure parser not initialized. Call init() first.');
    }
    return parserInstance;
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

  extractProperties?(_parser: Parser, _source: string, _moduleName: string): PropertyExtract[] {
    return [];
  }

  resolveImportSpecifier(specifier: string, _fromFile: string, _projectRoot: string): string | null {
    if (!specifier || specifier.startsWith('/')) return null;
    // Clojure convention: dots → slashes, hyphens → underscores
    return specifier.replace(/\./g, '/').replace(/-/g, '_') + '.clj';
  }
}
