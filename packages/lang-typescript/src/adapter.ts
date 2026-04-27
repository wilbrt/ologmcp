import Parser from 'tree-sitter';
import TS from 'tree-sitter-typescript';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LanguageAdapter, PropertyExtract } from '@olog/core';
import type { RawElement, RawArrow, OlogKind } from '@olog/core';
import { extractFromFile } from './extract.js';
import { extractPropertiesFromFile } from './properties.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TS_QUERY_PATH = resolve(__dirname, 'queries', 'ts.scm');
const TSX_QUERY_PATH = resolve(__dirname, 'queries', 'tsx.scm');

/** Map from tree-sitter node types to olog element kinds (for query captures). */
const NODE_TYPE_TO_KIND: Record<string, OlogKind> = {
  // These are not directly used by extractFromFile (which uses .scm captures),
  // but may be needed for future use.
};

/** Map from olog element kind to tree-sitter node types (for declaration rendering). */
const DECLARATION_NODE_TYPES: Record<string, string[]> = {
  function: ['function_declaration', 'arrow_function'],
  method: ['method_definition', 'abstract_method_signature'],
  class: ['class_declaration'],
  interface: ['interface_declaration'],
  type: ['type_alias_declaration'],
  enum: ['enum_declaration'],
  const: ['variable_declarator'],
  var: ['variable_declarator'],
};

/**
 * Language adapter for TypeScript and TSX files.
 */
export class TypeScriptAdapter implements LanguageAdapter {
  languageId = 'typescript';
  extensions = ['.ts', '.tsx', '.mts', '.cts'];
  globPattern = '**/*.{ts,tsx,mts,cts}';

  nodeTypeToKind = NODE_TYPE_TO_KIND;
  kindToNodeTypes = DECLARATION_NODE_TYPES;

  createParser(filename: string): Parser {
    const parser = new Parser();
    const ext = filename.substring(filename.lastIndexOf('.'));

    switch (ext) {
      case '.ts':
      case '.mts':
      case '.cts':
        parser.setLanguage(TS.typescript);
        break;
      case '.tsx':
        parser.setLanguage(TS.tsx);
        break;
      default:
        throw new Error(`Unsupported file extension: ${ext}`);
    }

    return parser;
  }

  queryPath(filename: string): string {
    const ext = filename.substring(filename.lastIndexOf('.'));
    return ext === '.tsx' ? TSX_QUERY_PATH : TS_QUERY_PATH;
  }

  extractElements(parser: Parser, source: string, queryPath: string): {
    elements: RawElement[];
    arrows: RawArrow[];
  } {
    return extractFromFile(parser, source, queryPath);
  }

  extractProperties(parser: Parser, source: string, moduleName: string): PropertyExtract[] {
    return extractPropertiesFromFile(parser, source, moduleName);
  }

  resolveImportSpecifier(specifier: string, importingFileRelativePath: string, _projectRoot: string): string | null {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      return null;
    }

    const importingDir = dirname(importingFileRelativePath);
    const joined = importingDir + '/' + specifier.replace(/^\.\//, '');
    const normalized = normalizePath(joined);

    return normalized.replace(/\.(js|cjs|mjs|jsx)$/, '.ts');
  }
}

function normalizePath(path: string): string {
  const parts = path.split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      result.pop();
    } else if (part !== '.' && part !== '') {
      result.push(part);
    }
  }
  return result.join('/');
}
