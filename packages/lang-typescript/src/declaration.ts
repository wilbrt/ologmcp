import Parser from 'tree-sitter';

/** Range and text for a declaration in source code. */
export interface DeclarationRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  text: string;
}

/** Map from olog element kind to tree-sitter node types for declaration rendering. */
export const DECLARATION_NODE_TYPES: Record<string, string[]> = {
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
 * Find the full declaration range for an element, given its identifier
 * position and kind. Re-parses the source file with tree-sitter and
 * walks up from the identifier to find the enclosing declaration node.
 */
export function findEnclosingDeclaration(
  source: string,
  parser: Parser,
  identifierLine: number,
  identifierCol: number,
  kind: string,
): DeclarationRange | null {
  const tree = parser.parse(source);

  const targetRow = identifierLine - 1;
  const targetCol = identifierCol - 1;

  let node: Parser.SyntaxNode | null = tree.rootNode.descendantForPosition(
    { row: targetRow, column: targetCol },
    { row: targetRow, column: targetCol + 1 },
  );

  const targetTypes = DECLARATION_NODE_TYPES[kind] ?? [];

  while (node && !targetTypes.includes(node.type)) {
    node = node.parent;
  }

  if (!node) {
    if ('delete' in tree && typeof (tree as unknown as { delete?: unknown }).delete === 'function') {
      (tree as unknown as { delete: () => void }).delete();
    }
    return null;
  }

  const range: DeclarationRange = {
    startLine: node.startPosition.row + 1,
    startCol: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endCol: node.endPosition.column + 1,
    text: node.text,
  };

  if ('delete' in tree && typeof (tree as unknown as { delete?: unknown }).delete === 'function') {
    (tree as unknown as { delete: () => void }).delete();
  }

  return range;
}

/**
 * Find an import statement line range given the line number of an import element.
 */
export function findImportStatement(
  source: string,
  startLine: number,
): DeclarationRange | null {
  const lines = source.split('\n');
  if (startLine < 1 || startLine > lines.length) return null;

  let beginLine = startLine - 1;
  let endLine = beginLine;

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
  const startCol = lines[beginLine]!.search(/\S/) + 1;

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
 */
export function extractDeclaration(
  source: string,
  parser: Parser,
  identifierLine: number,
  identifierCol: number,
  kind: string,
): string | null {
  if (kind === 'import') {
    const range = findImportStatement(source, identifierLine);
    return range?.text ?? null;
  }

  const range = findEnclosingDeclaration(source, parser, identifierLine, identifierCol, kind);
  return range?.text ?? null;
}
