import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { OlogElem, OlogArr } from './ontology.js';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class OlogStore {
  private db: Database.Database;
  private readonly getElemStmt: Database.Statement;
  private readonly outgoingStmt: Database.Statement;
  private readonly incomingStmt: Database.Statement;

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

    this.getElemStmt = this.db.prepare(
      "SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE id = ?"
    );
    this.outgoingStmt = this.db.prepare(
      "SELECT id, kind, src_id, dst_id, attrs FROM olog_arr WHERE src_id = ?"
    );
    this.incomingStmt = this.db.prepare(
      "SELECT id, kind, src_id, dst_id, attrs FROM olog_arr WHERE dst_id = ?"
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
      "INSERT INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
    );
    const insertProv = this.db.prepare(
      "INSERT INTO olog_prov (elem_id, source, commit_sha, ingested_at) VALUES (?, 'tree-sitter', ?, ?)"
    );
    const updateMeta = this.db.prepare(
      "INSERT INTO olog_meta (key, value) VALUES ('commit_sha', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );

    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM olog_elem").run();

      for (const e of elems) {
        insertElem.run(e.id, e.kind, e.name, e.module, e.span, e.attrs);
        insertProv.run(e.id, sha, Date.now());
      }

      for (const a of arrs) {
        insertArr.run(a.id, a.kind, a.src_id, a.dst_id, a.attrs);
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
}
