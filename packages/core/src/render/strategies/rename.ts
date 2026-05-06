import { OlogStore } from '../../db.js';
import type { OlogElem } from '../../ontology.js';
import type { SourceEdit } from '../edit.js';
import { parseSpan } from '../../utils/parse-span.js';
export { parseSpan };

export interface RenameEdits {
  edits: SourceEdit[];
  warnings: string[];
}

/**
 * Compute the source edits needed to rename an element.
 * Uses olog spans for the declaration site and olog arrows
 * (imports, importsFrom, callerOf, calleeOf) for reference sites.
 */
export function computeRenameEdits(
  store: OlogStore,
  elementId: string,
  newName: string,
  readFile: (path: string) => string | null,
): RenameEdits {
  let edits: SourceEdit[] = [];
  const warnings: string[] = [];

  const elem = store.getElem(elementId);
  if (!elem) {
    warnings.push(`Element not found: ${elementId}`);
    return { edits, warnings };
  }

  // 1. Rename at the declaration site
  if (elem.span) {
    const parsedSpan = parseSpan(elem.span);
    if (parsedSpan) {
      edits.push({
        filePath: elem.module ?? '',
        label: `rename declaration: ${elem.name} → ${newName}`,
        oldText: elem.name,
        newText: newName,
        startLine: parsedSpan.startLine,
        startCol: parsedSpan.startCol,
        endLine: parsedSpan.endLine,
        endCol: parsedSpan.endCol,
      });
    }
  }

  // 2. Rename at import sites in other files
  const importElements = findImportReferences(store, elem);

  for (const importElem of importElements) {
    if (importElem.span) {
      const parsedSpan = parseSpan(importElem.span);
      if (parsedSpan) {
        // The import element's span points to the imported name
        edits.push({
          filePath: importElem.module ?? '',
          label: `rename import: ${elem.name} → ${newName} in ${importElem.module}`,
          oldText: elem.name,
          newText: newName,
          startLine: parsedSpan.startLine,
          startCol: parsedSpan.startCol,
          endLine: parsedSpan.endLine,
          endCol: parsedSpan.endCol,
        });
      }
    }
  }

  // 3. Rename at call sites (callerOf/calleeOf arrows)
  const callSites = findCallReferences(store, elem, elementId);

  for (const callElem of callSites) {
    if (callElem.span) {
      const parsedSpan = parseSpan(callElem.span);
      if (parsedSpan) {
        edits.push({
          filePath: callElem.module ?? '',
          label: `rename reference: ${elem.name} → ${newName} in ${callElem.module}`,
          oldText: elem.name,
          newText: newName,
          startLine: parsedSpan.startLine,
          startCol: parsedSpan.startCol,
          endLine: parsedSpan.endLine,
          endCol: parsedSpan.endCol,
        });
      }
    }
  }

  // 4. Deduplicate edits by (filePath, startLine, startCol)
  const seen = new Set<string>();
  edits = edits.filter(e => {
    const key = `${e.filePath}:${e.startLine}:${e.startCol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { edits, warnings };
}

function findImportReferences(store: OlogStore, elem: OlogElem): OlogElem[] {
  const results: OlogElem[] = [];

  // Find import elements with the same name in other modules
  const candidates = store.queryElements({ nameRegex: `^${escapeRegex(elem.name)}$`, kind: 'import', limit: 500 });
  for (const candidate of candidates) {
    if (candidate.id === elem.id) continue;
    if (candidate.module === elem.module) continue;

    results.push(candidate);
  }

  return [...new Map(results.map(e => [e.id, e])).values()];
}

function findCallReferences(store: OlogStore, elem: OlogElem, elementId: string): OlogElem[] {
  const results: OlogElem[] = [];

  // Follow callerOf arrows (incoming means someone calls this element)
  const incoming = store.incoming(elementId);
  for (const arr of incoming) {
    if (arr.kind === 'callerOf' || arr.kind === 'calleeOf') {
      const caller = store.getElem(arr.srcId);
      if (caller) results.push(caller);
    }
  }

  // Also follow calls arrows pointing to this element or its import
  const outgoing = store.outgoing(elementId);
  for (const arr of outgoing) {
    if (arr.kind === 'callerOf') {
      const callee = store.getElem(arr.dstId);
      if (callee) results.push(callee);
    }
  }

  return [...new Map(results.map(e => [e.id, e])).values()];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

