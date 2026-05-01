import { OlogStore } from '../db.js';
import type { PlanOperation } from '../ontology.js';
import type { SourceEdit } from './edit.js';
import { computeRenameEdits } from './strategies/rename.js';
import { computeRemoveSymbolEdits } from './strategies/remove-symbol.js';
import { computeAddSymbolEdits } from './strategies/add-symbol.js';
import { computeMoveEdits } from './strategies/move.js';

export interface AtomicEdits {
  edits: SourceEdit[];
  warnings: string[];
}

export function expandOperation(
  store: OlogStore,
  operation: PlanOperation,
  readFile: (path: string) => string | null,
): AtomicEdits {
  switch (operation.kind) {
    case 'rename':
      return computeRenameEdits(store, operation.target, operation.newName, readFile);

    case 'move':
      return computeMoveEdits(store, operation.target, operation.newModule, readFile);

    case 'addSymbol':
      return computeAddSymbolEdits(store, operation.module, operation.name, operation.symbolKind, readFile);

    case 'removeSymbol':
      return computeRemoveSymbolEdits(store, operation.target, readFile);

    case 'addArrow': {
      // Most arrow additions are structural metadata that doesn't affect source files.
      // Only importsFrom and memberOf have source-level implications.
      // For now, these are no-ops at the source level.
      return { edits: [], warnings: [`addArrow: ${operation.arrowKind} arrows do not currently affect source files`] };
    }

    case 'removeArrow': {
      return { edits: [], warnings: [`removeArrow: arrow removal does not currently affect source files`] };
    }

    case 'rewrite_body':
      // Body rewrites are handled via olog_delegate + @edit, not the render pipeline.
      return { edits: [], warnings: [] };

    default:
      return { edits: [], warnings: [`Unknown operation kind: ${(operation as PlanOperation).kind}`] };
  }
}

export function expandAllOperations(
  store: OlogStore,
  operations: PlanOperation[],
  readFile: (path: string) => string | null,
): AtomicEdits {
  const allEdits: SourceEdit[] = [];
  const allWarnings: string[] = [];

  for (const op of operations) {
    const result = expandOperation(store, op, readFile);
    allEdits.push(...result.edits);
    allWarnings.push(...result.warnings);
  }

  return { edits: allEdits, warnings: allWarnings };
}