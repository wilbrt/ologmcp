import { OlogStore } from '../../db.js';
import type { SourceEdit } from '../edit.js';
import { findImportInsertionPoint, formatNamedImport } from '../imports.js';
import { filePathToModule } from '../paths.js';

export interface AddSymbolEdits {
  edits: SourceEdit[];
  warnings: string[];
}

const STUB_TEMPLATES: Record<string, (name: string) => string> = {
  function: (name) => `export function ${name}() {\n  // TODO: implement\n}\n`,
  method: (name) => `${name}() {\n    // TODO: implement\n  }\n`,
  class: (name) => `export class ${name} {\n  // TODO: implement\n}\n`,
  interface: (name) => `export interface ${name} {\n  // TODO: define properties\n}\n`,
  type: (name) => `export type ${name} = unknown;\n`,
  enum: (name) => `export enum ${name} {\n  // TODO: add members\n}\n`,
  const: (name) => `export const ${name} = undefined;\n`,
  var: (name) => `export var ${name}: unknown;\n`,
};

const CLJ_STUB_TEMPLATES: Record<string, (name: string) => string> = {
  function: (name) => `(defn ${name}\n  []\n  ;; TODO: implement\n  )\n`,
  method: (name) => `(defn ${name}\n  [this]\n  ;; TODO: implement\n  )\n`,
  class: (name) => `(defrecord ${name} []\n  ;; TODO: add protocol implementations\n  )\n`,
  interface: (name) => `(defprotocol ${name}\n  ;; TODO: define methods\n  )\n`,
  type: (name) => `(defrecord ${name} [])\n`,
  const: (name) => `(def ${name} nil)\n`,
  var: (name) => `(def ^:dynamic *${name}* nil)\n`,
};

function isClojureFile(path: string): boolean {
  return /\.(clj|cljs|cljc)$/.test(path);
}

export function computeAddSymbolEdits(
  store: OlogStore,
  module: string,
  name: string,
  symbolKind: string,
  readFile: (path: string) => string | null,
): AddSymbolEdits {
  const edits: SourceEdit[] = [];
  const warnings: string[] = [];

  const clojure = isClojureFile(module);
  const templates = clojure ? CLJ_STUB_TEMPLATES : STUB_TEMPLATES;
  const templateFn = templates[symbolKind];
  if (!templateFn) {
    warnings.push(`Unknown symbol kind: ${symbolKind}. No stub template available.`);
    return { edits, warnings };
  }

  const stubText = templateFn(name);

  const source = readFile(module);
  if (source === null) {
    edits.push({
      filePath: module,
      label: `create file and add symbol: ${name}`,
      oldText: null,
      newText: stubText,
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 1,
    });
  } else {
    // For Clojure, append after the last non-empty line to avoid inserting inside the ns form.
    // For TS/JS, insert after the import block.
    let insertLine: number;
    if (clojure) {
      const lines = source.split('\n');
      let lastNonEmpty = lines.length - 1;
      while (lastNonEmpty > 0 && lines[lastNonEmpty]!.trim() === '') lastNonEmpty--;
      insertLine = lastNonEmpty + 1;
    } else {
      insertLine = findImportInsertionPoint(source);
    }

    edits.push({
      filePath: module,
      label: `add symbol: ${symbolKind} ${name}`,
      oldText: null,
      newText: '\n' + stubText,
      startLine: insertLine + 1,
      startCol: 1,
      endLine: insertLine + 1,
      endCol: 1,
    });
  }

  return { edits, warnings };
}