import type { SourceEdit } from './edit.js';

export interface ParsedImport {
  kind: 'named' | 'default' | 'namespace' | 'side-effect';
  names: Array<{ original: string; alias: string }>;
  sourcePath: string;
  isType: boolean;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  fullText: string;
}

const IMPORT_REGEX = /^import\s+(type\s+)?/;

export function parseImports(source: string): ParsedImport[] {
  const lines = source.split('\n');
  const imports: ParsedImport[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const match = line.match(IMPORT_REGEX);
    if (!match) {
      i++;
      continue;
    }

    const isType = match[1] !== undefined;
    let fullText = line;
    let endLine = i + 1;

    // Handle multi-line imports by finding the closing line
    if (!line.includes(' from ')) {
      while (endLine < lines.length && !lines[endLine]!.includes(' from ')) {
        endLine++;
      }
      if (endLine < lines.length) {
        endLine++;
        fullText = lines.slice(i, endLine).join('\n');
      }
    }

    const importInfo = parseSingleImport(fullText, i + 1);
    if (importInfo) {
      importInfo.isType = isType;
      if (endLine > i + 1) {
        importInfo.endLine = endLine;
        importInfo.endCol = lines[endLine - 1]!.length + 1;
      }
      imports.push(importInfo);
    }

    i = endLine;
  }

  return imports;
}

function parseSingleImport(text: string, lineNum: number): ParsedImport | null {
  const trimmed = text.trim();

  // namespace: import * as X from '...'
  const namespaceMatch = trimmed.match(/^import\s+(type\s+)?\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
  if (namespaceMatch) {
    const aliasName = namespaceMatch[2]!;
    return {
      kind: 'namespace',
      names: [{ original: aliasName, alias: aliasName }],
      sourcePath: namespaceMatch[3]!,
      isType: false,
      startLine: lineNum,
      startCol: 1,
      endLine: lineNum,
      endCol: trimmed.length + 1,
      fullText: text,
    };
  }

  // named: import { A, B as C } from '...'
  const namedMatch = trimmed.match(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/);
  if (namedMatch) {
    const namesStr = namedMatch[2]!;
    const sourcePath = namedMatch[3]!;
    const names = namesStr.split(',').map(s => {
      const part = s.trim();
      const asMatch = part.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        return { original: asMatch[1]!, alias: asMatch[2]! } as ParsedImport['names'][number];
      }
      return part ? ({ original: part, alias: part } as ParsedImport['names'][number]) : null;
    }).filter((n): n is ParsedImport['names'][number] => n !== null);

    return {
      kind: 'named',
      names,
      sourcePath,
      isType: false,
      startLine: lineNum,
      startCol: 1,
      endLine: lineNum,
      endCol: trimmed.length + 1,
      fullText: text,
    };
  }

  // default: import X from '...'
  const defaultMatch = trimmed.match(/^import\s+(type\s+)?(\w+)\s+from\s+['"]([^'"]+)['"]/);
  if (defaultMatch && !trimmed.includes('{')) {
    return {
      kind: 'default',
      names: [{ original: defaultMatch[2]!, alias: defaultMatch[2]! }],
      sourcePath: defaultMatch[3]!,
      isType: false,
      startLine: lineNum,
      startCol: 1,
      endLine: lineNum,
      endCol: trimmed.length + 1,
      fullText: text,
    };
  }

  // side-effect: import '...'
  const sideEffectMatch = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
  if (sideEffectMatch) {
    return {
      kind: 'side-effect',
      names: [],
      sourcePath: sideEffectMatch[1]!,
      isType: false,
      startLine: lineNum,
      startCol: 1,
      endLine: lineNum,
      endCol: trimmed.length + 1,
      fullText: text,
    };
  }

  return null;
}

export function findImportInsertionPoint(source: string): number {
  const lines = source.split('\n');
  let lastImportLine = -1;
  let firstCodeLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.startsWith('//') || line === '') continue;
    if (IMPORT_REGEX.test(line)) {
      lastImportLine = i;
    } else if (firstCodeLine === -1 && !line.startsWith('//')) {
      firstCodeLine = i;
    }
  }

  if (lastImportLine >= 0) {
    return lastImportLine + 1;
  }
  if (firstCodeLine >= 0) {
    return firstCodeLine;
  }
  return lines.length;
}

export function formatNamedImport(names: Array<{ original: string; alias: string }>, sourcePath: string, isType?: boolean): string {
  const typePrefix = isType ? 'type ' : '';
  const nameParts = names.map(n => n.alias !== n.original ? `${n.original} as ${n.alias}` : n.original);
  return `import ${typePrefix}{ ${nameParts.join(', ')} } from '${sourcePath}'`;
}

export function formatDefaultImport(name: string, sourcePath: string, isType?: boolean): string {
  const typePrefix = isType ? 'type ' : '';
  return `import ${typePrefix}${name} from '${sourcePath}'`;
}

export function formatNamespaceImport(name: string, sourcePath: string): string {
  return `import * as ${name} from '${sourcePath}'`;
}

export function mergeIntoExistingImport(existing: ParsedImport, newNames: string[]): ParsedImport {
  const allNames = [...existing.names];
  for (const name of newNames) {
    if (!allNames.some(n => n.original === name)) {
      allNames.push({ original: name, alias: name });
    }
  }
  return { ...existing, names: allNames };
}

export function removeNamesFromImport(existing: ParsedImport, namesToRemove: string[]): ParsedImport | null {
  const remaining = existing.names.filter(n => !namesToRemove.includes(n.original));
  if (remaining.length === 0) return null;
  return { ...existing, names: remaining };
}

export function createAddImportEdit(source: string, names: string[], sourcePath: string, isType?: boolean): SourceEdit | null {
  const insertionLine = findImportInsertionPoint(source);
  const importLine = formatNamedImport(names.map(n => ({ original: n, alias: n })), sourcePath, isType);

  const lines = source.split('\n');
  const insertLine = insertionLine;

  // Check if there's already an import from the same source
  const existing = parseImports(source);
  const matchingImport = existing.find(imp => imp.sourcePath === sourcePath && imp.kind === 'named');

  if (matchingImport) {
    // Merge into existing import
    const merged = mergeIntoExistingImport(matchingImport, names);
    const newImportText = formatNamedImport(merged.names, sourcePath, isType || merged.isType);
    return {
      filePath: '',
      label: `Merge import { ${names.join(', ')} } into existing import from '${sourcePath}'`,
      oldText: matchingImport.fullText.trim(),
      newText: newImportText,
      startLine: matchingImport.startLine,
      startCol: matchingImport.startCol,
      endLine: matchingImport.endLine,
      endCol: matchingImport.endCol,
    };
  }

  return {
    filePath: '',
    label: `Add import { ${names.join(', ')} } from '${sourcePath}'`,
    oldText: null,
    newText: importLine + '\n',
    startLine: insertLine + 1,
    startCol: 1,
    endLine: insertLine + 1,
    endCol: 1,
  };
}

export function createRemoveImportEdit(existing: ParsedImport): SourceEdit {
  return {
    filePath: '',
    label: `Remove import from '${existing.sourcePath}'`,
    oldText: existing.fullText,
    newText: '',
    startLine: existing.startLine,
    startCol: existing.startCol,
    endLine: existing.endLine,
    endCol: existing.endCol,
  };
}