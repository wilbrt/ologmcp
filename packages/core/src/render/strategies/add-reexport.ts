import { OlogStore } from '../../db.js';
import type { SourceEdit } from '../edit.js';
import { computeRelativeImportPath } from '../paths.js';

export function computeAddReexportEdits(
  store: OlogStore,
  module: string,
  name: string,
  fromModule: string,
  readFile: (path: string) => string | null,
): { edits: SourceEdit[]; warnings: string[] } {
  const edits: SourceEdit[] = [];
  const warnings: string[] = [];

  const relativePath = computeRelativeImportPath(module, fromModule);
  const reexportLine = `export { ${name} } from '${relativePath}';`;

  const source = readFile(module);
  if (source === null) {
    edits.push({
      filePath: module,
      label: `create barrel file with re-export: ${name}`,
      oldText: null,
      newText: reexportLine + '\n',
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 1,
    });
  } else {
    const lines = source.split('\n');
    let lastNonEmpty = lines.length - 1;
    while (lastNonEmpty > 0 && lines[lastNonEmpty]!.trim() === '') lastNonEmpty--;

    const insertLine = lastNonEmpty;

    edits.push({
      filePath: module,
      label: `add re-export: ${name}`,
      oldText: null,
      newText: '\n' + reexportLine,
      startLine: insertLine + 1,
      startCol: 1,
      endLine: insertLine + 1,
      endCol: 1,
    });
  }

  return { edits, warnings };
}
