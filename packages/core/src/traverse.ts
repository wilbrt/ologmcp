import type { OlogElem, OlogArr, ConfidenceLevel } from './ontology.js';
import type Database from 'better-sqlite3';

interface TraverseStep {
  kind: string;
  direction: 'in' | 'out';
}

export interface TraverseOptions {
  startId: string;
  steps: TraverseStep[];
  minConfidence?: ConfidenceLevel;
}

interface ElemRow {
  id: string;
  kind: string;
  name: string;
  module: string | null;
  span: string | null;
  attrs: string;
}

interface ArrRow {
  id: string;
  kind: string;
  src_id: string;
  dst_id: string;
  attrs: string;
}

function rowToElem(row: ElemRow): OlogElem {
  return {
    id: row.id,
    kind: row.kind as OlogElem['kind'],
    name: row.name,
    module: row.module,
    span: row.span,
    attrs: JSON.parse(row.attrs) as Record<string, unknown>,
  };
}

function rowToArr(row: ArrRow): OlogArr {
  return {
    id: row.id,
    kind: row.kind as OlogArr['kind'],
    srcId: row.src_id,
    dstId: row.dst_id,
    attrs: JSON.parse(row.attrs) as Record<string, unknown>,
  };
}

/**
 * Multi-hop graph traversal: start at an element, follow a sequence of
 * arrow-kind/direction steps, collecting all reached elements and the
 * arrows traversed. Optionally filter by minimum provenance confidence.
 */
export function traverse(
  db: Database.Database,
  opts: TraverseOptions,
): { elements: OlogElem[]; arrows: OlogArr[] } {
  const { startId, steps, minConfidence } = opts;

  const currentIds = new Set<string>([startId]);
  const allReachedElements = new Map<string, OlogElem>();
  const allTraversedArrows: OlogArr[] = [];

  allReachedElements.set(startId, null!);

  const confidenceJoin = minConfidence
    ? ` INNER JOIN olog_prov p ON a.src_id = p.elem_id`
    : '';
  const confidenceWhere = minConfidence
    ? ' AND p.confidence = ?'
    : '';

  for (const step of steps) {
    if (currentIds.size === 0) break;

    const nextIds = new Set<string>();
    const placeholders = Array.from(currentIds).map(() => '?').join(',');

    let sql: string;
    if (step.direction === 'out') {
      sql = `SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs${confidenceJoin}
             FROM olog_arr a${confidenceJoin}
             WHERE a.src_id IN (${placeholders}) AND a.kind = ?${confidenceWhere}`;
    } else {
      sql = `SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs${confidenceJoin}
             FROM olog_arr a${confidenceJoin}
             WHERE a.dst_id IN (${placeholders}) AND a.kind = ?${confidenceWhere}`;
    }

    const params: (string | number)[] = [...currentIds, step.kind];
    if (minConfidence) {
      params.push(minConfidence);
    }
    const rows = db.prepare(sql).all(...params) as ArrRow[];

    for (const row of rows) {
      const arr = rowToArr(row);
      allTraversedArrows.push(arr);
      const reachedId = step.direction === 'out' ? row.dst_id : row.src_id;
      nextIds.add(reachedId);
      allReachedElements.set(reachedId, null!);
    }

    currentIds.clear();
    for (const id of nextIds) {
      currentIds.add(id);
    }
  }

  const elemIds = Array.from(allReachedElements.keys());
  if (elemIds.length > 0) {
    const placeholders = elemIds.map(() => '?').join(',');
    const elemRows = db.prepare(
      `SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE id IN (${placeholders})`,
    ).all(...elemIds) as ElemRow[];

    for (const row of elemRows) {
      allReachedElements.set(row.id, rowToElem(row));
    }
  }

  return {
    elements: Array.from(allReachedElements.values()).filter(Boolean),
    arrows: allTraversedArrows,
  };
}