import { OlogStore } from '../../db.js';
import type { SourceEdit } from '../edit.js';
import { parseSpan } from '../../utils/parse-span.js';

export function computeAmendTypeEdits(
  store: OlogStore,
  target: string,
  field: string,
  action: 'addUnionMember' | 'addProperty',
  value: string,
  readFile: (path: string) => string | null,
): { edits: SourceEdit[]; warnings: string[] } {
  const edits: SourceEdit[] = [];
  const warnings: string[] = [];

  const elem = store.getElem(target);
  if (!elem) {
    warnings.push(`Element not found: ${target}`);
    return { edits, warnings };
  }

  if (!elem.span) {
    warnings.push(`Element has no span: ${target}`);
    return { edits, warnings };
  }

  const parsedSpan = parseSpan(elem.span);
  if (!parsedSpan) {
    warnings.push(`Failed to parse span: ${elem.span}`);
    return { edits, warnings };
  }

  const source = readFile(elem.module ?? '');
  if (source === null) {
    warnings.push(`Could not read file: ${elem.module}`);
    return { edits, warnings };
  }

  const lines = source.split('\n');

  if (action === 'addUnionMember') {
    // Find the line containing the type definition (from span startLine to endLine)
    const typeLine = lines[parsedSpan.startLine - 1] ?? '';
    const endLineContent = lines[parsedSpan.endLine - 1] ?? '';

    // Find insertion point: look for ; or = that ends the union type
    // The union body ends at the span's endLine, so search from endCol backwards
    const semicolonMatch = endLineContent.lastIndexOf(';', parsedSpan.endCol - 1);
    const equalsMatch = endLineContent.lastIndexOf('=', parsedSpan.endCol - 1);
    const insertPos = Math.max(semicolonMatch, equalsMatch);

    if (insertPos < 0) {
      warnings.push(`Could not find union termination for: ${target}`);
      return { edits, warnings };
    }

    // Determine if value is a string literal (quoted) or type reference (unquoted)
    const isStringLiteral = value.startsWith("'") || value.startsWith('"');
    const unionMember = isStringLiteral ? `| ${value}` : `| ${value}`;

    edits.push({
      filePath: elem.module ?? '',
      label: `add union member: ${value} to ${elem.name}`,
      oldText: endLineContent.slice(insertPos, insertPos + 1),
      newText: `${unionMember};`,
      startLine: parsedSpan.endLine,
      startCol: insertPos + 1,
      endLine: parsedSpan.endLine,
      endCol: insertPos + 2,
    });
  } else if (action === 'addProperty') {
    // Find the closing brace of the interface body
    const endLineContent = lines[parsedSpan.endLine - 1] ?? '';

    // Find the closing brace position
    const closingBracePos = endLineContent.lastIndexOf('}', parsedSpan.endCol - 1);

    if (closingBracePos < 0) {
      warnings.push(`Could not find interface closing brace for: ${target}`);
      return { edits, warnings };
    }

    // Determine indentation by looking at the line's leading whitespace
    const lineContent = lines[parsedSpan.startLine - 1] ?? '';
    const indentMatch = lineContent.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '  ';

    const newProperty = `\n${indent}${field}: unknown;`;

    edits.push({
      filePath: elem.module ?? '',
      label: `add property: ${field} to ${elem.name}`,
      oldText: '}',
      newText: newProperty + '\n}',
      startLine: parsedSpan.endLine,
      startCol: closingBracePos + 1,
      endLine: parsedSpan.endLine,
      endCol: closingBracePos + 2,
    });
  }

  return { edits, warnings };
}
