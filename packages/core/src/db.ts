import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type {
  OlogElem,
  OlogArr,
  PathEquation,
  Path,
  IntegrityConstraint,
  Provenance,
  ConfidenceLevel,
  PlanOperation,
  ApplyResult,
  ChangeInstruction,
} from './ontology.js';
import { traverse as traverseGraph, type TraverseOptions } from './traverse.js';

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

interface EquationRow {
  id: string;
  name: string;
  human_message: string;
  lhs_json: string;
  rhs_json: string;
  provenance_json: string | null;
}

interface ConstraintRow {
  id: string;
  name: string;
  kind: string;
  message: string | null;
  config_json: string | null;
  provenance_json: string | null;
}

interface ProvRow {
  elem_id: string;
  source: string;
  commit_sha: string;
  ingested_at: number;
  confidence: string | null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class OlogStore {
  private db: Database.Database;
  private readonly getElemStmt: Database.Statement;
  private readonly outgoingStmt: Database.Statement;
  private readonly incomingStmt: Database.Statement;
  private readonly insertEquationStmt: Database.Statement;
  private readonly getEquationsStmt: Database.Statement;
  private readonly getEquationsForObjectStmt: Database.Statement;
  private readonly insertConstraintStmt: Database.Statement;
  private readonly getConstraintsStmt: Database.Statement;
  private readonly getProvenanceStmt: Database.Statement;
  private readonly insertElemStmt: Database.Statement;
  private readonly insertArrStmt: Database.Statement;
  private readonly insertProvStmt: Database.Statement;
  private readonly hasArrowKindStmt: Database.Statement;

  constructor(path: string) {
    this.db = new Database(path);

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    const versionResult = this.db.prepare("SELECT sqlite_version() as v").get() as { v: string } | undefined;
    const version = versionResult?.v ?? '0.0.0';
    const parts = version.split('.').map(Number);
    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    if (major < 3 || (major === 3 && minor < 37)) {
      throw new Error(`SQLite version ${version} is too old. Need >= 3.37.0 for STRICT tables.`);
    }

    const schemaPath = resolve(__dirname, 'schema.sql');
    const ddl = readFileSync(schemaPath, 'utf8');
    this.db.exec(ddl);

    this.db.function('regexp', { deterministic: true }, (pattern: string, text: string | null) => {
      if (text == null) return 0;
      return new RegExp(pattern).test(text) ? 1 : 0;
    });

    const row = this.db.prepare("SELECT value FROM olog_meta WHERE key = 'commit_sha'").get() as { value: string } | undefined;
    if (!row) {
      this.db.prepare("INSERT INTO olog_meta (key, value) VALUES ('commit_sha', '')").run();
    }

    // Migrate: add confidence column to olog_prov if missing
    const provCols = this.db.prepare("PRAGMA table_info(olog_prov)").all() as Array<{ name: string }>;
    if (!provCols.some(c => c.name === 'confidence')) {
      this.db.exec("ALTER TABLE olog_prov ADD COLUMN confidence TEXT NOT NULL DEFAULT 'resolved' CHECK (confidence IN ('resolved','unresolved','tentative'))");
    }

    this.getElemStmt = this.db.prepare(
      "SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE id = ?"
    );
    this.outgoingStmt = this.db.prepare(
      "SELECT id, kind, src_id, dst_id, attrs FROM olog_arr WHERE src_id = ?"
    );
    this.incomingStmt = this.db.prepare(
      "SELECT id, kind, src_id, dst_id, attrs FROM olog_arr WHERE dst_id = ?"
    );
    this.insertEquationStmt = this.db.prepare(
      "INSERT INTO olog_equation (id, name, human_message, lhs_json, rhs_json, provenance_json) VALUES (?, ?, ?, ?, ?, ?)"
    );
    this.getEquationsStmt = this.db.prepare(
      "SELECT id, name, human_message, lhs_json, rhs_json, provenance_json FROM olog_equation"
    );
    this.getEquationsForObjectStmt = this.db.prepare(
      "SELECT id, name, human_message, lhs_json, rhs_json, provenance_json FROM olog_equation WHERE lhs_json LIKE ? OR rhs_json LIKE ?"
    );
    this.insertConstraintStmt = this.db.prepare(
      "INSERT INTO olog_constraint (id, name, kind, message, config_json, provenance_json) VALUES (?, ?, ?, ?, ?, ?)"
    );
    this.getConstraintsStmt = this.db.prepare(
      "SELECT id, name, kind, message, config_json, provenance_json FROM olog_constraint"
    );
    this.getProvenanceStmt = this.db.prepare(
      "SELECT elem_id, source, commit_sha, ingested_at, confidence FROM olog_prov WHERE elem_id = ?"
    );
    this.insertElemStmt = this.db.prepare(
      "INSERT INTO olog_elem (id, kind, name, module, span, attrs) VALUES (?, ?, ?, ?, ?, ?)"
    );
    this.insertArrStmt = this.db.prepare(
      "INSERT OR IGNORE INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
    );
    this.insertProvStmt = this.db.prepare(
      "INSERT INTO olog_prov (elem_id, source, commit_sha, ingested_at, confidence) VALUES (?, ?, ?, ?, ?)"
    );
    this.hasArrowKindStmt = this.db.prepare(
      "SELECT 1 FROM olog_arr WHERE kind = ? LIMIT 1"
    );
  }

  commitSha(): string {
    const row = this.db.prepare("SELECT value FROM olog_meta WHERE key = 'commit_sha'").get() as { value: string } | undefined;
    return row?.value ?? '';
  }

  isFresh(head: string): boolean {
    return this.commitSha() === head;
  }

  ingestFull(elems: ElemRow[], arrs: ArrRow[], sha: string): number {
    const insertElem = this.db.prepare(
      "INSERT INTO olog_elem (id, kind, name, module, span, attrs) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertArr = this.db.prepare(
      "INSERT OR IGNORE INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
    );
    const insertProv = this.db.prepare(
      "INSERT INTO olog_prov (elem_id, source, commit_sha, ingested_at, confidence) VALUES (?, 'tree-sitter', ?, ?, 'resolved')"
    );
    const updateMeta = this.db.prepare(
      "INSERT INTO olog_meta (key, value) VALUES ('commit_sha', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );

    const tx = this.db.transaction(() => {
      const manualElems = this.db.prepare(
        "SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source = 'manual'"
      ).all() as ElemRow[];

      const manualArrs = this.db.prepare(
        "SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs FROM olog_arr a WHERE a.src_id IN (SELECT e.id FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source = 'manual') OR a.dst_id IN (SELECT e.id FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source = 'manual')"
      ).all() as ArrRow[];

      const manualProvs = this.db.prepare(
        "SELECT elem_id, source, commit_sha, ingested_at, confidence FROM olog_prov WHERE source = 'manual'"
      ).all() as ProvRow[];

      this.db.prepare("DELETE FROM olog_elem").run();

      for (const e of elems) {
        insertElem.run(e.id, e.kind, e.name, e.module, e.span, e.attrs);
        insertProv.run(e.id, sha, Date.now());
      }

      for (const a of arrs) {
        insertArr.run(a.id, a.kind, a.src_id, a.dst_id, a.attrs);
      }

      for (const e of manualElems) {
        this.db.prepare(
          "INSERT OR IGNORE INTO olog_elem (id, kind, name, module, span, attrs) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(e.id, e.kind, e.name, e.module, e.span, e.attrs);
      }
      for (const a of manualArrs) {
        insertArr.run(a.id, a.kind, a.src_id, a.dst_id, a.attrs);
      }
      for (const p of manualProvs) {
        this.insertProvStmt.run(p.elem_id, p.source, p.commit_sha, p.ingested_at, p.confidence ?? 'resolved');
      }

      updateMeta.run(sha);
    });

    tx();
    return elems.length;
  }

  getElem(id: string): OlogElem | null {
    const row = this.getElemStmt.get(id) as ElemRow | undefined;
    if (!row) return null;
    return this.rowToElem(row);
  }

  outgoing(srcId: string): OlogArr[] {
    const rows = this.outgoingStmt.all(srcId) as ArrRow[];
    return rows.map(r => this.rowToArr(r));
  }

  incoming(dstId: string): OlogArr[] {
    const rows = this.incomingStmt.all(dstId) as ArrRow[];
    return rows.map(r => this.rowToArr(r));
  }

  queryElements(opts: { kind?: string; nameRegex?: string; moduleRegex?: string; limit: number }): OlogElem[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (opts.kind && opts.kind !== 'any') {
      conditions.push('kind = ?');
      params.push(opts.kind);
    }
    if (opts.nameRegex) {
      conditions.push('name REGEXP ?');
      params.push(opts.nameRegex);
    }
    if (opts.moduleRegex) {
      conditions.push('module REGEXP ?');
      params.push(opts.moduleRegex);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const sql = `SELECT id, kind, name, module, span, attrs FROM olog_elem ${where} ORDER BY module, name LIMIT ?`;
    params.push(opts.limit);

    const rows = this.db.prepare(sql).all(...params) as ElemRow[];
    return rows.map(r => this.rowToElem(r));
  }

  dumpCounts(): {
    elementCounts: Record<string, number>;
    arrowCounts: Record<string, number>;
    totalElements: number;
    totalArrows: number;
  } {
    const elemRows = this.db.prepare("SELECT kind, COUNT(*) as count FROM olog_elem GROUP BY kind").all() as Array<{ kind: string; count: number }>;
    const arrRows = this.db.prepare("SELECT kind, COUNT(*) as count FROM olog_arr GROUP BY kind").all() as Array<{ kind: string; count: number }>;
    const totalElemRow = this.db.prepare("SELECT COUNT(*) as count FROM olog_elem").get() as { count: number } | undefined;
    const totalArrRow = this.db.prepare("SELECT COUNT(*) as count FROM olog_arr").get() as { count: number } | undefined;

    const elementCounts: Record<string, number> = {};
    for (const r of elemRows) {
      elementCounts[r.kind] = Number(r.count);
    }

    const arrowCounts: Record<string, number> = {};
    for (const r of arrRows) {
      arrowCounts[r.kind] = Number(r.count);
    }

    return {
      elementCounts,
      arrowCounts,
      totalElements: Number(totalElemRow?.count ?? 0),
      totalArrows: Number(totalArrRow?.count ?? 0),
    };
  }

  addEquation(eq: PathEquation): void {
    this.insertEquationStmt.run(
      eq.id,
      eq.name,
      eq.humanMessage,
      JSON.stringify(eq.lhs),
      JSON.stringify(eq.rhs),
      eq.provenance ? JSON.stringify(eq.provenance) : null,
    );
  }

  getEquations(): PathEquation[] {
    const rows = this.getEquationsStmt.all() as EquationRow[];
    return rows.map(r => this.rowToEquation(r));
  }

  getEquationsForObject(objectId: string): PathEquation[] {
    const pattern = `%${objectId}%`;
    const rows = this.getEquationsForObjectStmt.all(pattern, pattern) as EquationRow[];
    return rows.map(r => this.rowToEquation(r));
  }

  addConstraint(constraint: IntegrityConstraint): void {
    this.insertConstraintStmt.run(
      constraint.id,
      constraint.name,
      constraint.kind,
      constraint.message,
      JSON.stringify(constraint.config),
      constraint.provenance ? JSON.stringify(constraint.provenance) : null,
    );
  }

  getConstraints(): IntegrityConstraint[] {
    const rows = this.getConstraintsStmt.all() as ConstraintRow[];
    return rows.map(r => this.rowToConstraint(r));
  }

  traverse(opts: TraverseOptions): { elements: OlogElem[]; arrows: OlogArr[] } {
    return traverseGraph(this.db, opts);
  }

  queryElementsWithConfidence(
    opts: { kind?: string; nameRegex?: string; moduleRegex?: string; minConfidence?: ConfidenceLevel; limit: number },
  ): OlogElem[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (opts.kind && opts.kind !== 'any') {
      conditions.push('e.kind = ?');
      params.push(opts.kind);
    }
    if (opts.nameRegex) {
      conditions.push('e.name REGEXP ?');
      params.push(opts.nameRegex);
    }
    if (opts.moduleRegex) {
      conditions.push('e.module REGEXP ?');
      params.push(opts.moduleRegex);
    }
    if (opts.minConfidence) {
      conditions.push('p.confidence = ?');
      params.push(opts.minConfidence);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const join = opts.minConfidence
      ? ' INNER JOIN olog_prov p ON e.id = p.elem_id'
      : '';
    const sql = `SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_elem e${join} ${where} ORDER BY e.module, e.name LIMIT ?`;
    params.push(opts.limit);

    const rows = this.db.prepare(sql).all(...params) as ElemRow[];
    return rows.map(r => this.rowToElem(r));
  }

  getProvenance(elemId: string): Provenance | null {
    const row = this.getProvenanceStmt.get(elemId) as ProvRow | undefined;
    if (!row) return null;
    return {
      source: row.source,
      commitSha: row.commit_sha,
      ingestedAt: row.ingested_at,
      confidence: (row.confidence ?? 'resolved') as ConfidenceLevel,
    };
  }

  applyPlan(operations: PlanOperation[]): ApplyResult {
    let applied = 0;
    let skipped = 0;
    const errors: string[] = [];
    const changes: ChangeInstruction[] = [];

    const updateElemName = this.db.prepare(
      "UPDATE olog_elem SET name = ? WHERE id = ?"
    );
    const updateArrRefs = this.db.prepare(
      "UPDATE olog_arr SET id = ?, src_id = ?, dst_id = ? WHERE id = ?"
    );
    const updateElemModule = this.db.prepare(
      "UPDATE olog_elem SET module = ? WHERE id = ?"
    );
    const insertElem = this.db.prepare(
      "INSERT INTO olog_elem (id, kind, name, module, span, attrs) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertArr = this.db.prepare(
      "INSERT OR IGNORE INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
    );
    const deleteElem = this.db.prepare(
      "DELETE FROM olog_elem WHERE id = ?"
    );
    const deleteArr = this.db.prepare(
      "DELETE FROM olog_arr WHERE id = ?"
    );
    const findArrowsByElem = this.db.prepare(
      "SELECT id, kind, src_id, dst_id, attrs FROM olog_arr WHERE id LIKE ?"
    );

    const tx = this.db.transaction(() => {
      for (const op of operations) {
        try {
          switch (op.kind) {
            case 'rename': {
              const elem = this.getElem(op.target);
              if (!elem) {
                skipped++;
                errors.push(`Element not found: ${op.target}`);
                break;
              }
              updateElemName.run(op.newName, op.target);
              const arrowPattern = `%${op.target}%`;
              const affectedArrows = findArrowsByElem.all(arrowPattern) as ArrRow[];
              for (const arr of affectedArrows) {
                const oldId = arr.id;
                const newId = arr.id.replace(`:${elem.name}:`, `:${op.newName}:`);
                if (newId !== oldId) {
                  updateArrRefs.run(newId, arr.src_id, arr.dst_id, oldId);
                }
              }
              applied++;
              changes.push({
                path: elem.module ?? '',
                line: 0,
                column: 0,
                oldText: elem.name,
                newText: op.newName,
              });
              break;
            }
            case 'move': {
              const moveElem = this.getElem(op.target);
              if (!moveElem) {
                skipped++;
                errors.push(`Element not found: ${op.target}`);
                break;
              }
              updateElemModule.run(op.newModule, op.target);
              applied++;
              changes.push({
                path: moveElem.module ?? '',
                line: 0,
                column: 0,
                oldText: moveElem.module ?? '',
                newText: op.newModule,
              });
              break;
            }
            case 'addSymbol': {
              const id = `manual:${op.module}:0:0:${op.symbolKind}:${op.name}`;
              insertElem.run(id, op.symbolKind, op.name, op.module, null, '{}');
              applied++;
              changes.push({
                path: op.module,
                line: 0,
                column: 0,
                oldText: '',
                newText: op.name,
              });
              break;
            }
            case 'removeSymbol': {
              const remElem = this.getElem(op.target);
              if (!remElem) {
                skipped++;
                errors.push(`Element not found: ${op.target}`);
                break;
              }
              deleteElem.run(op.target);
              applied++;
              changes.push({
                path: remElem.module ?? '',
                line: 0,
                column: 0,
                oldText: remElem.name,
                newText: '',
              });
              break;
            }
            case 'addArrow': {
              const aid = `${op.src}:${op.arrowKind}:${op.dst}`;
              insertArr.run(aid, op.arrowKind, op.src, op.dst, '{}');
              applied++;
              changes.push({
                path: '',
                line: 0,
                column: 0,
                oldText: '',
                newText: `${op.arrowKind}: ${op.src} -> ${op.dst}`,
              });
              break;
            }
            case 'removeArrow': {
              deleteArr.run(op.arrowId);
              applied++;
              changes.push({
                path: '',
                line: 0,
                column: 0,
                oldText: op.arrowId,
                newText: '',
              });
              break;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          skipped++;
          errors.push(`${op.kind}: ${msg}`);
        }
      }
    });

    tx();
    return { applied, skipped, errors, changes };
  }

  addElement(elem: OlogElem): void {
    this.insertElemStmt.run(
      elem.id,
      elem.kind,
      elem.name,
      elem.module,
      elem.span,
      JSON.stringify(elem.attrs),
    );
  }

  addArrow(arr: OlogArr): void {
    this.insertArrStmt.run(
      arr.id,
      arr.kind,
      arr.srcId,
      arr.dstId,
      JSON.stringify(arr.attrs),
    );
  }

  addProvenance(elemId: string, prov: Provenance): void {
    this.insertProvStmt.run(
      elemId,
      prov.source,
      prov.commitSha,
      prov.ingestedAt,
      prov.confidence,
    );
  }

  hasArrowKind(kind: string): boolean {
    const row = this.hasArrowKindStmt.get(kind) as { 1: number } | undefined;
    return !!row;
  }

  close(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.close();
  }

  private rowToElem(row: ElemRow): OlogElem {
    return {
      id: row.id,
      kind: row.kind as OlogElem['kind'],
      name: row.name,
      module: row.module,
      span: row.span,
      attrs: JSON.parse(row.attrs) as Record<string, unknown>,
    };
  }

  private rowToArr(row: ArrRow): OlogArr {
    return {
      id: row.id,
      kind: row.kind as OlogArr['kind'],
      srcId: row.src_id,
      dstId: row.dst_id,
      attrs: JSON.parse(row.attrs) as Record<string, unknown>,
    };
  }

  private rowToEquation(row: EquationRow): PathEquation {
    return {
      id: row.id,
      name: row.name,
      humanMessage: row.human_message,
      lhs: JSON.parse(row.lhs_json) as Path,
      rhs: JSON.parse(row.rhs_json) as Path,
      provenance: row.provenance_json ? JSON.parse(row.provenance_json) as Provenance : null,
    };
  }

  private rowToConstraint(row: ConstraintRow): IntegrityConstraint {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as IntegrityConstraint['kind'],
      message: row.message,
      config: row.config_json ? JSON.parse(row.config_json) as Record<string, unknown> : {},
      provenance: row.provenance_json ? JSON.parse(row.provenance_json) as Provenance : null,
    };
  }
}
