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

export function computeAddSymbolEdits(
  store: OlogStore,
  module: string,
  name: string,
  symbolKind: string,
  readFile: (path: string) => string | null,
): AddSymbolEdits {
  const edits: SourceEdit[] = [];
  const warnings: string[] = [];

  const templateFn = STUB_TEMPLATES[symbolKind];
  if (!templateFn) {
    warnings.push(`Unknown symbol kind: ${symbolKind}. No stub template available.`);
    return { edits, warnings };
  }

  const stubText = templateFn(name);

  // Find the insertion point
  const source = readFile(module);
  if (source === null) {
    // File doesn't exist yet — create it
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
    const insertLine = findImportInsertionPoint(source);
    // Insert after imports, at the start of the line after them
    // Find where to insert: after imports section + blank line
    const lines = source.split('\n');
    let insertPosition = insertLine;

    // Skip past the imports section to find a good insertion point
    for (let i = insertLine; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line === '' || line.startsWith('//') || line.startsWith('/*')) continue;
      break;
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