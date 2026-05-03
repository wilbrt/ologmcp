import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OlogStore } from '../db.js';
import type { PlanOperation } from '../ontology.js';
import type { SourceEdit, ApplyResult } from './edit.js';
import { applySourceEdits, rollback } from './edit.js';
import { expandAllOperations } from './expand.js';
import { orderAndDetectConflicts } from './order.js';

export interface RenderResult {
  edits: SourceEdit[];
  warnings: string[];
  conflicts: Array<{
    edit1: SourceEdit;
    edit2: SourceEdit;
    message: string;
  }>;
  affectedFiles: string[];
}

export interface RenderAndApplyResult extends RenderResult {
  applyResult: ApplyResult | null;
  verificationDiscrepancies: string[];
}

export function renderPlan(
  store: OlogStore,
  operations: PlanOperation[],
  projectRoot: string,
): RenderResult {
  const readFile = (filePath: string): string | null => {
    try {
      return readFileSync(join(projectRoot, filePath), 'utf8');
    } catch {
      return null;
    }
  };

  const { edits, warnings } = expandAllOperations(store, operations, readFile);
  const { ordered, conflicts } = orderAndDetectConflicts(edits);

  // If there are conflicts, don't apply conflicting edits
  const conflictEditIds = new Set<string>();
  for (const conflict of conflicts) {
    conflictEditIds.add(`${conflict.edit1.filePath}:${conflict.edit1.startLine}:${conflict.edit1.startCol}`);
    conflictEditIds.add(`${conflict.edit2.filePath}:${conflict.edit2.startLine}:${conflict.edit2.startCol}`);
  }

  const safeEdits = conflicts.length > 0
    ? ordered.filter(e => !conflictEditIds.has(`${e.filePath}:${e.startLine}:${e.startCol}`))
    : ordered;

  const affectedFiles = [...new Set(safeEdits.map(e => e.filePath))];

  return {
    edits: safeEdits,
    warnings,
    conflicts,
    affectedFiles,
  };
}

/**
 * Render a plan and apply the edits to disk, then verify by re-ingesting.
 */
export async function renderAndApplyPlan(
  store: OlogStore,
  operations: PlanOperation[],
  projectRoot: string,
  reingestFn?: (projectRoot: string, store: OlogStore) => void,
): Promise<RenderAndApplyResult> {
  const renderResult = renderPlan(store, operations, projectRoot);

  if (renderResult.edits.length === 0) {
    return {
      ...renderResult,
      applyResult: null,
      verificationDiscrepancies: [],
    };
  }

  let applyResult: ApplyResult;
  try {
    applyResult = await applySourceEdits(renderResult.edits, projectRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    renderResult.warnings.push(`Failed to apply edits: ${msg}`);
    return {
      ...renderResult,
      applyResult: null,
      verificationDiscrepancies: [msg],
    };
  }

  // Re-ingest to verify
  let verificationDiscrepancies: string[] = [];
  if (reingestFn) {
    try {
      reingestFn(projectRoot, store);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      verificationDiscrepancies.push(`Re-ingestion failed: ${msg}`);
    }

    // Verify the plan operations took effect in the re-ingested olog
    for (const op of operations) {
      verificationDiscrepancies.push(...verifyOperation(store, op));
    }
  }

  return {
    ...renderResult,
    applyResult,
    verificationDiscrepancies,
  };
}

function verifyOperation(store: OlogStore, op: PlanOperation): string[] {
  const discrepancies: string[] = [];

  switch (op.kind) {
    case 'rename': {
      const elem = store.getElem(op.target);
      if (elem && elem.name !== op.newName) {
        discrepancies.push(`rename: expected name "${op.newName}", got "${elem.name}"`);
      }
      break;
    }
    case 'move': {
      const elem = store.getElem(op.target);
      if (elem && elem.module !== op.newModule) {
        discrepancies.push(`move: expected module "${op.newModule}", got "${elem.module}"`);
      }
      break;
    }
    case 'addSymbol': {
      const found = store.queryElements({
        kind: op.symbolKind,
        nameRegex: `^${op.name}$`,
        moduleRegex: `^${op.module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
        limit: 1,
      });
      if (found.length === 0) {
        discrepancies.push(`addSymbol: "${op.name}" not found in "${op.module}" after render`);
      }
      break;
    }
    case 'removeSymbol': {
      const elem = store.getElem(op.target);
      if (elem) {
        discrepancies.push(`removeSymbol: "${op.target}" still exists after render`);
      }
      break;
    }
    case 'addReexport': {
      const found = store.queryElements({
        kind: 'any',
        nameRegex: `^${op.name}$`,
        moduleRegex: `^${op.module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
        limit: 1,
      });
      if (found.length === 0) {
        discrepancies.push(`addReexport: "${op.name}" not found in "${op.module}" after render`);
      }
      break;
    }
    case 'amendType': {
      const elem = store.getElem(op.target);
      if (!elem) {
        discrepancies.push(`amendType: "${op.target}" does not exist after render`);
      }
      break;
    }
    case 'addArrow': {
      const srcElem = store.getElem(op.src);
      const dstElem = store.getElem(op.dst);
      if (!srcElem) {
        discrepancies.push(`addArrow: source element "${op.src}" does not exist after render`);
      }
      if (!dstElem) {
        discrepancies.push(`addArrow: destination element "${op.dst}" does not exist after render`);
      }
      break;
    }
    case 'removeArrow': {
      const arr = store.getArr(op.arrowId);
      if (arr) {
        discrepancies.push(`removeArrow: arrow "${op.arrowId}" still exists after render`);
      }
      break;
    }
  }

  return discrepancies;
}

export * from './edit.js';
export * from './expand.js';
export * from './order.js';
export * from './declaration.js';
export * from './imports.js';
export * from './paths.js';
export { computeRenameEdits, parseSpan } from './strategies/rename.js';
export { computeRemoveSymbolEdits } from './strategies/remove-symbol.js';
export { computeAddSymbolEdits } from './strategies/add-symbol.js';
export { computeMoveEdits } from './strategies/move.js';