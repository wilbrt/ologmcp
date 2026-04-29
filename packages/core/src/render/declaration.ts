import { readFileSync } from 'node:fs';
import type { AdapterRegistry, TreeSitterNode } from '../ingest/adapter.js';

export interface DeclarationRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  text: string;
}

/**
 * Find the full declaration range for an element, given its identifier
 * position and kind. Re-parses the source file with tree-sitter and
 * walks up from the identifier to find the enclosing declaration node.
 */
export function findEnclosingDeclaration(
  source: string,
  filePath: string,
  identifierLine: number,
  identifierCol: number,
  kind: string,
  registry: AdapterRegistry,
): DeclarationRange | null {
  const adapter = registry.getForFile(filePath);
  if (!adapter) return null;

  const parser = adapter.createParser(filePath);
  const targetTypes = adapter.kindToNodeTypes[kind] ?? [];

  const tree = parser.parse(source);

  const targetRow = identifierLine - 1;
  const targetCol = identifierCol - 1;

  let node: TreeSitterNode | null = tree.rootNode.descendantForPosition(
    { row: targetRow, column: targetCol },
    { row: targetRow, column: targetCol + 1 },
  );

  while (node && !targetTypes.includes(node.type)) {
    node = node.parent;
  }

  if (!node) {
    tree.delete?.();
    return null;
  }

  const range: DeclarationRange = {
    startLine: node.startPosition.row + 1,
    startCol: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endCol: node.endPosition.column + 1,
    text: node.text,
  };

  tree.delete?.();

  return range;
}

/**
 * Find an import statement line range given the line number of an import element.
 * Handles multi-line imports by scanning forward for the closing semicolon or newline.
 */
export function findImportStatement(
  source: string,
  startLine: number,
): DeclarationRange | null {
  const lines = source.split('\n');
  if (startLine < 1 || startLine > lines.length) return null;

  let beginLine = startLine - 1; // 0-based
  let endLine = beginLine;

  // Scan forward for the end of the import statement
  let braceDepth = 0;
  let foundFrom = false;

  for (let i = beginLine; i < lines.length; i++) {
    const line = lines[i]!;
    braceDepth += (line.match(/\{/g) || []).length;
    braceDepth -= (line.match(/\}/g) || []).length;
    if (line.includes(' from ')) foundFrom = true;

    if (foundFrom && braceDepth <= 0 && line.includes(';')) {
      endLine = i;
      break;
    }
    if (foundFrom && braceDepth <= 0 && i > beginLine) {
      endLine = i;
      break;
    }
    endLine = i;
  }

  const text = lines.slice(beginLine, endLine + 1).join('\n');
  const startCol = lines[beginLine]!.search(/\S/) + 1; // first non-whitespace

  return {
    startLine: beginLine + 1,
    startCol: startCol || 1,
    endLine: endLine + 1,
    endCol: lines[endLine]!.length + 1,
    text,
  };
}

/**
 * Extract the full declaration text for an element from its source file.
 * Returns the declaration text if found, or null.
 */
export function extractDeclaration(
  source: string,
  filePath: string,
  identifierLine: number,
  identifierCol: number,
  kind: string,
  registry: AdapterRegistry,
): string | null {
  if (kind === 'import') {
    const range = findImportStatement(source, identifierLine);
    return range?.text ?? null;
  }

  const range = findEnclosingDeclaration(source, filePath, identifierLine, identifierCol, kind, registry);
  return range?.text ?? null;
}