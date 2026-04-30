import { OlogStore } from '../../db.js';
import type { OlogElem, OlogArr } from '../../ontology.js';
import type { SourceEdit } from '../edit.js';
import { parseSpan } from './rename.js';
import { findImportStatement } from '../declaration.js';
import { parseImports } from '../imports.js';

export interface RemoveSymbolEdits {
  edits: SourceEdit[];
  warnings: string[];
}

export function computeRemoveSymbolEdits(
  store: OlogStore,
  elementId: string,
  readFile: (path: string) => string | null,
): RemoveSymbolEdits {
  const edits: SourceEdit[] = [];
  const warnings: string[] = [];

  const elem = store.getElem(elementId);
  if (!elem) {
    warnings.push(`Element not found: ${elementId}`);
    return { edits, warnings };
  }

  // 1. Delete the declaration from source
  if (elem.span && elem.kind !== 'import') {
    const parsedSpan = parseSpan(elem.span);
    if (parsedSpan) {
      // For a declaration, we need the full body range, not just the identifier.
      // As a first pass, we delete the line(s) the identifier is on.
      // TODO: Use declaration.ts for full body extraction.
      edits.push({
        filePath: elem.module ?? '',
        label: `remove declaration: ${elem.name}`,
        oldText: null, // Will be filled during localize
        newText: '',
        startLine: parsedSpan.startLine,
        startCol: 1,
        endLine: parsedSpan.endLine,
        endCol: parsedSpan.endCol,
      });
    }
  }

  // 2. Remove dead imports
  if (elem.kind === 'import') {
    const source = readFile(elem.module ?? '');
    if (source && elem.span) {
      const parsedSpan = parseSpan(elem.span);
      if (parsedSpan) {
        const importRange = findImportStatement(source, parsedSpan.startLine);
        if (importRange) {
          edits.push({
            filePath: elem.module ?? '',
            label: `remove import: ${elem.name}`,
            oldText: importRange.text,
            newText: '',
            startLine: importRange.startLine,
            startCol: importRange.startCol,
            endLine: importRange.endLine,
            endCol: importRange.endCol,
          });
        }
      }
    }
  }

  // 3. Report affected call sites
  const incoming = store.incoming(elementId);
  const callers = incoming
    .filter((a: OlogArr) => a.kind === 'callerOf' || a.kind === 'calleeOf')
    .map((a: OlogArr) => {
      const otherId = a.srcId === elementId ? a.dstId : a.srcId;
      return store.getElem(otherId);
    })
    .filter((e: OlogElem | null): e is OlogElem => e !== null);

  for (const caller of callers) {
    warnings.push(
      `Call site in ${caller.module ?? 'unknown'} will break: element "${caller.name}" references "${elem.name}"`
    );
  }

  return { edits, warnings };
}