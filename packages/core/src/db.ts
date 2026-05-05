import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DomainSessionStore } from './domain/session.js';
import { MotifSessionStore } from './mining/session.js';
import type { MotifShape, MotifCandidate } from './mining/types.js';
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
  ArrowKind,
  WorkingSet,
  WorkingSetMeta,
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

interface MotifTemplateRow {
  id: string;
  name: string;
  description: string | null;
  shape_json: string;
  equations_json: string | null;
  provenance_json: string;
  created_at: number;
}

interface MotifInstanceRow {
  id: string;
  template_id: string;
  mappings_json: string;
  provenance_json: string;
  created_at: number;
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
  private readonly _sessions: DomainSessionStore;
  private readonly _motifSessions: MotifSessionStore;
  private readonly getElemStmt: Database.Statement;
  private readonly getArrStmt: Database.Statement;
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
  private readonly insertMotifTemplateStmt: Database.Statement;
  private readonly insertMotifInstanceStmt: Database.Statement;
  private readonly insertWorkingSetStmt: Database.Statement;
  private readonly insertWorkingSetElemStmt: Database.Statement;
  private readonly insertWorkingSetArrStmt: Database.Statement;
  private readonly getWorkingSetStmt: Database.Statement;
  private readonly deleteWorkingSetStmt: Database.Statement;

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
      this.db.exec("ALTER TABLE olog_prov ADD COLUMN confidence TEXT NOT NULL DEFAULT 'resolved'");
    }

    // Migrate: remove CHECK (source IN ...) from olog_prov to allow new source values like 'llm'
    const provTableDef = (this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='olog_prov'"
    ).get() as { sql: string } | undefined)?.sql ?? '';
    if (provTableDef.includes('CHECK (source IN')) {
      this.db.exec(`CREATE TABLE olog_prov_new (
        elem_id      TEXT NOT NULL,
        source       TEXT NOT NULL,
        commit_sha   TEXT NOT NULL,
        ingested_at  INTEGER NOT NULL,
        confidence   TEXT NOT NULL DEFAULT 'resolved',
        PRIMARY KEY (elem_id, source, commit_sha),
        FOREIGN KEY (elem_id) REFERENCES olog_elem(id) ON DELETE CASCADE
      ) STRICT, WITHOUT ROWID`);
      this.db.exec('INSERT INTO olog_prov_new SELECT elem_id, source, commit_sha, ingested_at, confidence FROM olog_prov');
      this.db.exec('DROP TABLE olog_prov');
      this.db.exec('ALTER TABLE olog_prov_new RENAME TO olog_prov');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_prov_elem_id ON olog_prov(elem_id)');
    }

    // Migrate: remove stored arrows that are now derived on-the-fly
    const redundantKinds = ['inModule', 'locatedIn', 'contains', 'imports'];
    for (const kind of redundantKinds) {
      this.db.prepare('DELETE FROM olog_arr WHERE kind = ?').run(kind);
    }

    // Motif discovery session table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS olog_motif_session (
        id              TEXT PRIMARY KEY,
        status          TEXT NOT NULL CHECK (status IN ('active', 'committed', 'abandoned')),
        scope_regex     TEXT,
        candidates_json TEXT NOT NULL CHECK (json_valid(candidates_json)),
        commit_sha      TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS ix_motif_session_status ON olog_motif_session(status);
    `);

    // Motif discovery template and instance tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS olog_motif_template (
        id              TEXT NOT NULL PRIMARY KEY,
        name            TEXT NOT NULL,
        description     TEXT,
        shape_json      TEXT NOT NULL CHECK (json_valid(shape_json)),
        equations_json  TEXT CHECK (json_valid(equations_json)),
        provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
        created_at      INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS olog_motif_instance (
        id              TEXT NOT NULL PRIMARY KEY,
        template_id     TEXT NOT NULL,
        mappings_json   TEXT NOT NULL CHECK (json_valid(mappings_json)),
        provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
        created_at      INTEGER NOT NULL,
        FOREIGN KEY (template_id) REFERENCES olog_motif_template(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS ix_motif_template_name ON olog_motif_template(name);
      CREATE INDEX IF NOT EXISTS ix_motif_instance_template ON olog_motif_instance(template_id);
    `);

    this.getElemStmt = this.db.prepare(
      "SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE id = ?"
    );
    this.getArrStmt = this.db.prepare(
      "SELECT id, kind, src_id, dst_id, attrs FROM olog_arr WHERE id = ?"
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
      "INSERT INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
    );
    this.insertProvStmt = this.db.prepare(
      "INSERT INTO olog_prov (elem_id, source, commit_sha, ingested_at, confidence) VALUES (?, ?, ?, ?, ?)"
    );
    this.hasArrowKindStmt = this.db.prepare(
      "SELECT 1 FROM olog_arr WHERE kind = ? LIMIT 1"
    );
    this.insertMotifTemplateStmt = this.db.prepare(
      `INSERT INTO olog_motif_template (id, name, description, shape_json, equations_json, provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertMotifInstanceStmt = this.db.prepare(
      `INSERT INTO olog_motif_instance (id, template_id, mappings_json, provenance_json, created_at) VALUES (?, ?, ?, ?, ?)`,
    );

    this.insertWorkingSetStmt = this.db.prepare(
      'INSERT INTO olog_working_set (id, name, plan_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    this.insertWorkingSetElemStmt = this.db.prepare(
      'INSERT OR IGNORE INTO olog_working_set_elem (set_id, elem_id) VALUES (?, ?)'
    );
    this.insertWorkingSetArrStmt = this.db.prepare(
      'INSERT OR IGNORE INTO olog_working_set_arr (set_id, arr_id) VALUES (?, ?)'
    );
    this.getWorkingSetStmt = this.db.prepare(
      'SELECT id, name, plan_hash, created_at, updated_at FROM olog_working_set WHERE id = ?'
    );
    this.deleteWorkingSetStmt = this.db.prepare(
      'DELETE FROM olog_working_set WHERE id = ?'
    );

    this._sessions = new DomainSessionStore(this.db);
    this._motifSessions = new MotifSessionStore(this.db);
  }

  get sessions(): DomainSessionStore {
    return this._sessions;
  }

  get motifSessions(): MotifSessionStore {
    return this._motifSessions;
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
      "INSERT INTO olog_prov (elem_id, source, commit_sha, ingested_at, confidence) VALUES (?, 'tree-sitter', ?, ?, 'resolved')"
    );
    const updateMeta = this.db.prepare(
      "INSERT INTO olog_meta (key, value) VALUES ('commit_sha', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );

    const tx = this.db.transaction(() => {
      // Preserve all non-tree-sitter elements (manual, llm, etc.) across re-indexing
      const manualElems = this.db.prepare(
        "SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source != 'tree-sitter'"
      ).all() as ElemRow[];

      const manualArrs = this.db.prepare(
        "SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs FROM olog_arr a WHERE a.src_id IN (SELECT e.id FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source != 'tree-sitter') OR a.dst_id IN (SELECT e.id FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source != 'tree-sitter')"
      ).all() as ArrRow[];

      const manualProvs = this.db.prepare(
        "SELECT elem_id, source, commit_sha, ingested_at, confidence FROM olog_prov WHERE source != 'tree-sitter'"
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

      // Build the set of all element IDs that will exist after this transaction,
      // so we can drop stale manual arrows whose endpoints shifted (e.g. line-number
      // based IDs that moved due to code edits).
      const allElemIds = new Set<string>();
      for (const e of elems) allElemIds.add(e.id);
      for (const e of manualElems) allElemIds.add(e.id);

      for (const a of manualArrs) {
        if (allElemIds.has(a.src_id) && allElemIds.has(a.dst_id)) {
          insertArr.run(a.id, a.kind, a.src_id, a.dst_id, a.attrs);
        }
      }
      for (const p of manualProvs) {
        this.insertProvStmt.run(p.elem_id, p.source, p.commit_sha, p.ingested_at, p.confidence ?? 'resolved');
      }

      updateMeta.run(sha);
    });

    tx();
    return elems.length;
  }

  /** Return the set of relative module paths that have at least one tree-sitter element. */
  getIngestedModules(): Set<string> {
    const rows = this.db.prepare(
      "SELECT DISTINCT e.module FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source = 'tree-sitter' AND e.module IS NOT NULL"
    ).all() as { module: string }[];
    return new Set(rows.map(r => r.module));
  }

  /** Delete all tree-sitter elements for a given module (cascade removes arrows). */
  deleteModuleTreeSitterElements(module: string): void {
    this.db.prepare(
      "DELETE FROM olog_elem WHERE module = ? AND id IN (SELECT elem_id FROM olog_prov WHERE source = 'tree-sitter')"
    ).run(module);
  }

  /** Return a map of element name → [ids] across all elements, for cross-file resolution. */
  getAllElemNameToIds(): Map<string, string[]> {
    const rows = this.db.prepare("SELECT id, name FROM olog_elem WHERE module IS NOT NULL").all() as { id: string; name: string }[];
    const result = new Map<string, string[]>();
    for (const row of rows) {
      const arr = result.get(row.name) ?? [];
      arr.push(row.id);
      result.set(row.name, arr);
    }
    return result;
  }

  /** Return a map of element id → module for all elements with a module. */
  getAllElemIdToModule(): Map<string, string> {
    const rows = this.db.prepare("SELECT id, module FROM olog_elem WHERE module IS NOT NULL").all() as { id: string; module: string }[];
    const result = new Map<string, string>();
    for (const row of rows) result.set(row.id, row.module);
    return result;
  }

  /**
   * Insert elements and arrows for specific files without wiping the whole store.
   * Used by incremental ingestion. Arrows that reference non-existent elements are silently skipped.
   */
  ingestFile(elems: ElemRow[], arrs: ArrRow[], sha: string): void {
    const insertElem = this.db.prepare(
      "INSERT OR IGNORE INTO olog_elem (id, kind, name, module, span, attrs) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertArr = this.db.prepare(
      "INSERT OR IGNORE INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
    );
    const insertProv = this.db.prepare(
      "INSERT OR IGNORE INTO olog_prov (elem_id, source, commit_sha, ingested_at, confidence) VALUES (?, 'tree-sitter', ?, ?, 'resolved')"
    );
    const updateMeta = this.db.prepare(
      "INSERT INTO olog_meta (key, value) VALUES ('commit_sha', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );

    const tx = this.db.transaction(() => {
      for (const e of elems) {
        insertElem.run(e.id, e.kind, e.name, e.module, e.span, e.attrs);
        insertProv.run(e.id, sha, Date.now());
      }
      for (const a of arrs) {
        try {
          insertArr.run(a.id, a.kind, a.src_id, a.dst_id, a.attrs);
        } catch {
          // FK violation: one endpoint not yet present — skipped, cross-file pass handles it
        }
      }
      updateMeta.run(sha);
    });
    tx();
  }

  getElem(id: string): OlogElem | null {
    const row = this.getElemStmt.get(id) as ElemRow | undefined;
    if (!row) return null;
    return this.rowToElem(row);
  }

  getArr(id: string): OlogArr | null {
    const row = this.getArrStmt.get(id) as ArrRow | undefined;
    if (!row) return null;
    return this.rowToArr(row);
  }

  outgoing(srcId: string): OlogArr[] {
    const rows = this.outgoingStmt.all(srcId) as ArrRow[];
    return rows.map(r => this.rowToArr(r));
  }

  incoming(dstId: string): OlogArr[] {
    const rows = this.incomingStmt.all(dstId) as ArrRow[];
    return rows.map(r => this.rowToArr(r));
  }

  /** Derive virtual arrows that are no longer stored: inModule/locatedIn (≡ definedIn),
   *  contains (≡ inverse definedIn for files), imports (≡ inverse importsFrom for files). */
  outgoingDerived(elemId: string): OlogArr[] {
    const derived: OlogArr[] = [];
    const stored = this.outgoing(elemId);
    for (const a of stored) {
      if (a.kind === 'definedIn') {
        derived.push({ id: `${a.srcId}:inModule:${a.dstId}`, kind: 'inModule' as ArrowKind, srcId: a.srcId, dstId: a.dstId, attrs: a.attrs });
        derived.push({ id: `${a.srcId}:locatedIn:${a.dstId}`, kind: 'locatedIn' as ArrowKind, srcId: a.srcId, dstId: a.dstId, attrs: a.attrs });
      }
    }
    for (const a of this.incoming(elemId)) {
      if (a.kind === 'definedIn') {
        derived.push({ id: `${elemId}:contains:${a.srcId}`, kind: 'contains' as ArrowKind, srcId: elemId, dstId: a.srcId, attrs: a.attrs });
      }
      if (a.kind === 'importsFrom') {
        derived.push({ id: `${elemId}:imports:${a.srcId}`, kind: 'imports' as ArrowKind, srcId: elemId, dstId: a.srcId, attrs: a.attrs });
      }
    }
    return derived;
  }

  getElemsByModule(module: string): OlogElem[] {
    const rows = this.db.prepare(
      'SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE module = ?'
    ).all(module) as ElemRow[];
    return rows.map(r => this.rowToElem(r));
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

  addMotifTemplate(template: {
    id: string;
    name: string;
    description: string;
    shape: MotifShape;
    equations: Array<{ lhsPath: string[]; rhsPath: string[]; coverage: number }>;
    provenance: { source: string; commitSha: string; confidence: string };
  }): void {
    this.insertMotifTemplateStmt.run(
      template.id,
      template.name,
      template.description,
      JSON.stringify(template.shape),
      JSON.stringify(template.equations),
      JSON.stringify(template.provenance),
      Date.now(),
    );
  }

  getMotifTemplates(): Array<{
    id: string;
    name: string;
    description: string;
    shape: MotifShape;
    equations: Array<{ lhsPath: string[]; rhsPath: string[]; coverage: number }>;
    provenance: { source: string; commitSha: string; confidence: string };
    createdAt: number;
  }> {
    const rows = this.db.prepare(
      'SELECT id, name, description, shape_json, equations_json, provenance_json, created_at FROM olog_motif_template',
    ).all() as MotifTemplateRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? '',
      shape: JSON.parse(r.shape_json) as MotifShape,
      equations: r.equations_json ? JSON.parse(r.equations_json) : [],
      provenance: JSON.parse(r.provenance_json),
      createdAt: r.created_at,
    }));
  }

  addMotifInstance(instance: {
    id: string;
    templateId: string;
    mappings: Record<string, string>;
    provenance: { source: string; commitSha: string; confidence: string };
  }): void {
    this.insertMotifInstanceStmt.run(
      instance.id,
      instance.templateId,
      JSON.stringify(instance.mappings),
      JSON.stringify(instance.provenance),
      Date.now(),
    );
  }

  getMotifInstances(templateId: string): Array<{
    id: string;
    templateId: string;
    mappings: Record<string, string>;
    provenance: { source: string; commitSha: string; confidence: string };
    createdAt: number;
  }> {
    const rows = this.db.prepare(
      'SELECT id, template_id, mappings_json, provenance_json, created_at FROM olog_motif_instance WHERE template_id = ?',
    ).all(templateId) as MotifInstanceRow[];
    return rows.map((r) => ({
      id: r.id,
      templateId: r.template_id,
      mappings: JSON.parse(r.mappings_json),
      provenance: JSON.parse(r.provenance_json),
      createdAt: r.created_at,
    }));
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
      "INSERT INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
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
            case 'addReexport': {
              const id = `projected:${op.module}:other:${op.name}`;
              insertElem.run(id, 'other', op.name, op.module, null, '{}');
              // Find the module element to create a references arrow from it
              const moduleElems = this.db.prepare(
                "SELECT id FROM olog_elem WHERE module = ? LIMIT 1"
              ).all(op.module) as Array<{ id: string }>;
              const firstModuleElem = moduleElems[0];
              if (firstModuleElem) {
                const arrId = `${firstModuleElem.id}:references:${id}`;
                insertArr.run(arrId, 'references', firstModuleElem.id, id, '{}');
              }
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
            case 'amendType': {
              const elemRow = this.getElemStmt.get(op.target) as ElemRow | undefined;
              if (!elemRow) {
                skipped++;
                errors.push(`Element not found: ${op.target}`);
                break;
              }
              const attrs = JSON.parse(elemRow.attrs) as Record<string, unknown>;
              if (op.action === 'addUnionMember') {
                if (!attrs[op.field]) {
                  attrs[op.field] = [];
                }
                if (Array.isArray(attrs[op.field])) {
                  (attrs[op.field] as string[]).push(op.value);
                }
              } else if (op.action === 'addProperty') {
                attrs[op.field] = op.value;
              }
              this.db.prepare("UPDATE olog_elem SET attrs = ? WHERE id = ?").run(JSON.stringify(attrs), op.target);
              applied++;
              changes.push({
                path: elemRow.module ?? '',
                line: 0,
                column: 0,
                oldText: '',
                newText: `${op.field}: ${op.value}`,
              });
              break;
            }
            default:
              skipped++;
              errors.push(`Unknown operation kind: ${(op as PlanOperation).kind}`);
              break;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(msg);
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

  /**
   * Load every arrow as lightweight {src_id, kind, dst_id} rows.
   * Used to build the in-memory adjacency map for fast mining.
   */
  loadAllArrows(): Array<{ src_id: string; kind: string; dst_id: string }> {
    return this.db
      .prepare('SELECT src_id, kind, dst_id FROM olog_arr')
      .all() as Array<{ src_id: string; kind: string; dst_id: string }>;
  }

  /**
   * Load every element's id, kind, and name.
   * Used for kind annotation and counterexample names during mining.
   */
  loadElemMeta(): Map<string, { kind: string; name: string }> {
    const rows = this.db
      .prepare('SELECT id, kind, name FROM olog_elem')
      .all() as Array<{ id: string; kind: string; name: string }>;
    const map = new Map<string, { kind: string; name: string }>();
    for (const r of rows) map.set(r.id, { kind: r.kind, name: r.name });
    return map;
  }

  /**
   * Get all distinct arrow kinds where either the source or destination element
   * is of one of the given element kinds.
   *
   * This is useful for mining: when you want to restrict path enumeration to
   * only arrow kinds that connect to domain objects (or any other element kind),
   * this method returns the relevant arrow kinds.
   *
   * @param elementKinds - Array of element kinds to filter by (e.g., ['domain'])
   * @returns Sorted array of distinct ArrowKind values
   */
  getArrowKindsForElementKinds(elementKinds: string[]): ArrowKind[] {
    if (elementKinds.length === 0) return [];

    const placeholders = elementKinds.map(() => '?').join(',');
    const sql = `
      SELECT DISTINCT a.kind
      FROM olog_arr a
      INNER JOIN olog_elem src ON a.src_id = src.id
      INNER JOIN olog_elem dst ON a.dst_id = dst.id
      WHERE src.kind IN (${placeholders})
         OR dst.kind IN (${placeholders})
      ORDER BY a.kind
    `;
    const params = [...elementKinds, ...elementKinds];
    const rows = this.db.prepare(sql).all(...params) as Array<{ kind: string }>;
    return rows.map((r) => r.kind as ArrowKind);
  }

  createWorkingSet(name: string, planHash?: string): string {
    const id = randomUUID();
    const now = Date.now();
    this.insertWorkingSetStmt.run(id, name, planHash ?? null, now, now);
    return id;
  }

  addToWorkingSet(setId: string, elemIds: string[], arrIds: string[]): { elementsAdded: number; arrowsAdded: number } {
    const now = Date.now();
    let elementsAdded = 0;
    let arrowsAdded = 0;
    const tx = this.db.transaction(() => {
      for (const elemId of elemIds) {
        const result = this.insertWorkingSetElemStmt.run(setId, elemId);
        elementsAdded += result.changes;
      }
      for (const arrId of arrIds) {
        const result = this.insertWorkingSetArrStmt.run(setId, arrId);
        arrowsAdded += result.changes;
      }
      this.db.prepare('UPDATE olog_working_set SET updated_at = ? WHERE id = ?').run(now, setId);
    });
    tx();
    return { elementsAdded, arrowsAdded };
  }

  getWorkingSet(setId: string): WorkingSet | null {
    const row = this.getWorkingSetStmt.get(setId) as { id: string; name: string; plan_hash: string | null; created_at: number; updated_at: number } | undefined;
    if (!row) return null;
    const elemRows = this.db.prepare(
      'SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_working_set_elem ws JOIN olog_elem e ON e.id = ws.elem_id WHERE ws.set_id = ?'
    ).all(setId) as ElemRow[];
    const arrRows = this.db.prepare(
      'SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs FROM olog_working_set_arr ws JOIN olog_arr a ON a.id = ws.arr_id WHERE ws.set_id = ?'
    ).all(setId) as ArrRow[];
    return {
      id: row.id,
      name: row.name,
      planHash: row.plan_hash,
      elements: elemRows.map(r => this.rowToElem(r)),
      arrows: arrRows.map(r => this.rowToArr(r)),
    };
  }

  listWorkingSets(): WorkingSetMeta[] {
    const rows = this.db.prepare(
      `SELECT ws.id, ws.name, ws.plan_hash, ws.updated_at,
        (SELECT COUNT(*) FROM olog_working_set_elem WHERE set_id = ws.id) AS element_count,
        (SELECT COUNT(*) FROM olog_working_set_arr WHERE set_id = ws.id) AS arrow_count
       FROM olog_working_set ws ORDER BY ws.updated_at DESC`
    ).all() as Array<{ id: string; name: string; plan_hash: string | null; updated_at: number; element_count: number; arrow_count: number }>;
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      planHash: r.plan_hash,
      elementCount: r.element_count,
      arrowCount: r.arrow_count,
      updatedAt: r.updated_at,
    }));
  }

  deleteWorkingSet(setId: string): void {
    this.deleteWorkingSetStmt.run(setId);
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
