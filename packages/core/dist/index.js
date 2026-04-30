// src/db.ts
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// src/domain/session.ts
import { randomUUID } from "crypto";
var DomainSessionStore = class {
  constructor(db) {
    this.db = db;
    this.insertStmt = this.db.prepare(
      `INSERT INTO olog_domain_session
         (id, status, scope_regex, candidates_json, equations_json, commit_sha, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.getStmt = this.db.prepare(
      `SELECT id, status, scope_regex, candidates_json, equations_json, commit_sha, created_at, updated_at
       FROM olog_domain_session WHERE id = ?`
    );
    this.listStmt = this.db.prepare(
      `SELECT id, status, scope_regex, candidates_json, equations_json, commit_sha, created_at, updated_at
       FROM olog_domain_session ORDER BY created_at DESC`
    );
    this.updateStmt = this.db.prepare(
      `UPDATE olog_domain_session
       SET status = ?, scope_regex = ?, candidates_json = ?, equations_json = ?, updated_at = ?
       WHERE id = ?`
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM olog_domain_session WHERE id = ?`);
  }
  db;
  insertStmt;
  getStmt;
  listStmt;
  updateStmt;
  deleteStmt;
  create(data) {
    const id = randomUUID();
    const now = Date.now();
    this.insertStmt.run(
      id,
      "active",
      data.scopeRegex ?? null,
      JSON.stringify(data.candidates),
      JSON.stringify(data.equations),
      data.commitSha,
      now,
      now
    );
    return id;
  }
  get(id) {
    const row = this.getStmt.get(id);
    if (!row) return null;
    return this.rowToSession(row);
  }
  list() {
    const rows = this.listStmt.all();
    return rows.map((r) => this.rowToSession(r));
  }
  update(id, data) {
    const current = this.get(id);
    if (!current) throw new Error(`Domain session not found: ${id}`);
    const merged = { ...current, ...data };
    this.updateStmt.run(
      merged.status,
      merged.scopeRegex,
      JSON.stringify(merged.candidates),
      JSON.stringify(merged.equations),
      Date.now(),
      id
    );
  }
  delete(id) {
    this.deleteStmt.run(id);
  }
  rowToSession(row) {
    return {
      id: row.id,
      status: row.status,
      scopeRegex: row.scope_regex,
      candidates: JSON.parse(row.candidates_json),
      equations: row.equations_json ? JSON.parse(row.equations_json) : [],
      commitSha: row.commit_sha,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
};

// src/mining/session.ts
import { randomUUID as randomUUID2 } from "crypto";
var MotifSessionStore = class {
  constructor(db) {
    this.db = db;
    this.insertStmt = this.db.prepare(
      `INSERT INTO olog_motif_session
         (id, status, scope_regex, candidates_json, commit_sha, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    this.getStmt = this.db.prepare(
      `SELECT id, status, scope_regex, candidates_json, commit_sha, created_at, updated_at
       FROM olog_motif_session WHERE id = ?`
    );
    this.listStmt = this.db.prepare(
      `SELECT id, status, scope_regex, candidates_json, commit_sha, created_at, updated_at
       FROM olog_motif_session ORDER BY created_at DESC`
    );
    this.updateStmt = this.db.prepare(
      `UPDATE olog_motif_session
       SET status = ?, scope_regex = ?, candidates_json = ?, updated_at = ?
       WHERE id = ?`
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM olog_motif_session WHERE id = ?`);
  }
  db;
  insertStmt;
  getStmt;
  listStmt;
  updateStmt;
  deleteStmt;
  create(data) {
    const id = randomUUID2();
    const now = Date.now();
    this.insertStmt.run(
      id,
      "active",
      data.scopeRegex ?? null,
      JSON.stringify(data.candidates),
      data.commitSha,
      now,
      now
    );
    return id;
  }
  get(id) {
    const row = this.getStmt.get(id);
    if (!row) return null;
    return this.rowToSession(row);
  }
  list() {
    const rows = this.listStmt.all();
    return rows.map((r) => this.rowToSession(r));
  }
  update(id, data) {
    const current = this.get(id);
    if (!current) throw new Error(`Motif session not found: ${id}`);
    const merged = { ...current, ...data };
    this.updateStmt.run(
      merged.status,
      merged.scopeRegex,
      JSON.stringify(merged.candidates),
      Date.now(),
      id
    );
  }
  delete(id) {
    this.deleteStmt.run(id);
  }
  rowToSession(row) {
    return {
      id: row.id,
      status: row.status,
      scopeRegex: row.scope_regex,
      candidates: JSON.parse(row.candidates_json),
      commitSha: row.commit_sha,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
};

// src/traverse.ts
function rowToElem(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    module: row.module,
    span: row.span,
    attrs: JSON.parse(row.attrs)
  };
}
function rowToArr(row) {
  return {
    id: row.id,
    kind: row.kind,
    srcId: row.src_id,
    dstId: row.dst_id,
    attrs: JSON.parse(row.attrs)
  };
}
function traverse(db, opts) {
  const { startId, steps, minConfidence } = opts;
  const currentIds = /* @__PURE__ */ new Set([startId]);
  const allReachedElements = /* @__PURE__ */ new Map();
  const allTraversedArrows = [];
  allReachedElements.set(startId, null);
  const confidenceJoin = minConfidence ? ` INNER JOIN olog_prov p ON a.src_id = p.elem_id` : "";
  const confidenceWhere = minConfidence ? " AND p.confidence = ?" : "";
  for (const step of steps) {
    if (currentIds.size === 0) break;
    const nextIds = /* @__PURE__ */ new Set();
    const placeholders = Array.from(currentIds).map(() => "?").join(",");
    let sql;
    if (step.direction === "out") {
      sql = `SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs${confidenceJoin}
             FROM olog_arr a${confidenceJoin}
             WHERE a.src_id IN (${placeholders}) AND a.kind = ?${confidenceWhere}`;
    } else {
      sql = `SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs${confidenceJoin}
             FROM olog_arr a${confidenceJoin}
             WHERE a.dst_id IN (${placeholders}) AND a.kind = ?${confidenceWhere}`;
    }
    const params = [...currentIds, step.kind];
    if (minConfidence) {
      params.push(minConfidence);
    }
    const rows = db.prepare(sql).all(...params);
    for (const row of rows) {
      const arr = rowToArr(row);
      allTraversedArrows.push(arr);
      const reachedId = step.direction === "out" ? row.dst_id : row.src_id;
      nextIds.add(reachedId);
      allReachedElements.set(reachedId, null);
    }
    currentIds.clear();
    for (const id of nextIds) {
      currentIds.add(id);
    }
  }
  const elemIds = Array.from(allReachedElements.keys());
  if (elemIds.length > 0) {
    const placeholders = elemIds.map(() => "?").join(",");
    const elemRows = db.prepare(
      `SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE id IN (${placeholders})`
    ).all(...elemIds);
    for (const row of elemRows) {
      allReachedElements.set(row.id, rowToElem(row));
    }
  }
  return {
    elements: Array.from(allReachedElements.values()).filter(Boolean),
    arrows: allTraversedArrows
  };
}

// src/db.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var OlogStore = class {
  db;
  _sessions;
  _motifSessions;
  getElemStmt;
  getArrStmt;
  outgoingStmt;
  incomingStmt;
  insertEquationStmt;
  getEquationsStmt;
  getEquationsForObjectStmt;
  insertConstraintStmt;
  getConstraintsStmt;
  getProvenanceStmt;
  insertElemStmt;
  insertArrStmt;
  insertProvStmt;
  hasArrowKindStmt;
  insertMotifTemplateStmt;
  insertMotifInstanceStmt;
  constructor(path) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    const versionResult = this.db.prepare("SELECT sqlite_version() as v").get();
    const version = versionResult?.v ?? "0.0.0";
    const parts = version.split(".").map(Number);
    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    if (major < 3 || major === 3 && minor < 37) {
      throw new Error(`SQLite version ${version} is too old. Need >= 3.37.0 for STRICT tables.`);
    }
    const schemaPath = resolve(__dirname, "schema.sql");
    const ddl = readFileSync(schemaPath, "utf8");
    this.db.exec(ddl);
    this.db.function("regexp", { deterministic: true }, (pattern, text) => {
      if (text == null) return 0;
      return new RegExp(pattern).test(text) ? 1 : 0;
    });
    const row = this.db.prepare("SELECT value FROM olog_meta WHERE key = 'commit_sha'").get();
    if (!row) {
      this.db.prepare("INSERT INTO olog_meta (key, value) VALUES ('commit_sha', '')").run();
    }
    const provCols = this.db.prepare("PRAGMA table_info(olog_prov)").all();
    if (!provCols.some((c) => c.name === "confidence")) {
      this.db.exec("ALTER TABLE olog_prov ADD COLUMN confidence TEXT NOT NULL DEFAULT 'resolved'");
    }
    const provTableDef = this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='olog_prov'"
    ).get()?.sql ?? "";
    if (provTableDef.includes("CHECK (source IN")) {
      this.db.exec(`CREATE TABLE olog_prov_new (
        elem_id      TEXT NOT NULL,
        source       TEXT NOT NULL,
        commit_sha   TEXT NOT NULL,
        ingested_at  INTEGER NOT NULL,
        confidence   TEXT NOT NULL DEFAULT 'resolved',
        PRIMARY KEY (elem_id, source, commit_sha),
        FOREIGN KEY (elem_id) REFERENCES olog_elem(id) ON DELETE CASCADE
      ) STRICT, WITHOUT ROWID`);
      this.db.exec("INSERT INTO olog_prov_new SELECT elem_id, source, commit_sha, ingested_at, confidence FROM olog_prov");
      this.db.exec("DROP TABLE olog_prov");
      this.db.exec("ALTER TABLE olog_prov_new RENAME TO olog_prov");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_prov_elem_id ON olog_prov(elem_id)");
    }
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
      `INSERT INTO olog_motif_template (id, name, description, shape_json, equations_json, provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    this.insertMotifInstanceStmt = this.db.prepare(
      `INSERT INTO olog_motif_instance (id, template_id, mappings_json, provenance_json, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    this._sessions = new DomainSessionStore(this.db);
    this._motifSessions = new MotifSessionStore(this.db);
  }
  get sessions() {
    return this._sessions;
  }
  get motifSessions() {
    return this._motifSessions;
  }
  commitSha() {
    const row = this.db.prepare("SELECT value FROM olog_meta WHERE key = 'commit_sha'").get();
    return row?.value ?? "";
  }
  isFresh(head) {
    return this.commitSha() === head;
  }
  ingestFull(elems, arrs, sha) {
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
      const manualElems = this.db.prepare(
        "SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source != 'tree-sitter'"
      ).all();
      const manualArrs = this.db.prepare(
        "SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs FROM olog_arr a WHERE a.src_id IN (SELECT e.id FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source != 'tree-sitter') OR a.dst_id IN (SELECT e.id FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source != 'tree-sitter')"
      ).all();
      const manualProvs = this.db.prepare(
        "SELECT elem_id, source, commit_sha, ingested_at, confidence FROM olog_prov WHERE source != 'tree-sitter'"
      ).all();
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
      const allElemIds = /* @__PURE__ */ new Set();
      for (const e of elems) allElemIds.add(e.id);
      for (const e of manualElems) allElemIds.add(e.id);
      for (const a of manualArrs) {
        if (allElemIds.has(a.src_id) && allElemIds.has(a.dst_id)) {
          insertArr.run(a.id, a.kind, a.src_id, a.dst_id, a.attrs);
        }
      }
      for (const p of manualProvs) {
        this.insertProvStmt.run(p.elem_id, p.source, p.commit_sha, p.ingested_at, p.confidence ?? "resolved");
      }
      updateMeta.run(sha);
    });
    tx();
    return elems.length;
  }
  /** Return the set of relative module paths that have at least one tree-sitter element. */
  getIngestedModules() {
    const rows = this.db.prepare(
      "SELECT DISTINCT e.module FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source = 'tree-sitter' AND e.module IS NOT NULL"
    ).all();
    return new Set(rows.map((r) => r.module));
  }
  /** Delete all tree-sitter elements for a given module (cascade removes arrows). */
  deleteModuleTreeSitterElements(module) {
    this.db.prepare(
      "DELETE FROM olog_elem WHERE module = ? AND id IN (SELECT elem_id FROM olog_prov WHERE source = 'tree-sitter')"
    ).run(module);
  }
  /** Return a map of element name → [ids] across all elements, for cross-file resolution. */
  getAllElemNameToIds() {
    const rows = this.db.prepare("SELECT id, name FROM olog_elem WHERE module IS NOT NULL").all();
    const result = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const arr = result.get(row.name) ?? [];
      arr.push(row.id);
      result.set(row.name, arr);
    }
    return result;
  }
  /** Return a map of element id → module for all elements with a module. */
  getAllElemIdToModule() {
    const rows = this.db.prepare("SELECT id, module FROM olog_elem WHERE module IS NOT NULL").all();
    const result = /* @__PURE__ */ new Map();
    for (const row of rows) result.set(row.id, row.module);
    return result;
  }
  /**
   * Insert elements and arrows for specific files without wiping the whole store.
   * Used by incremental ingestion. Arrows that reference non-existent elements are silently skipped.
   */
  ingestFile(elems, arrs, sha) {
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
        }
      }
      updateMeta.run(sha);
    });
    tx();
  }
  getElem(id) {
    const row = this.getElemStmt.get(id);
    if (!row) return null;
    return this.rowToElem(row);
  }
  getArr(id) {
    const row = this.getArrStmt.get(id);
    if (!row) return null;
    return this.rowToArr(row);
  }
  outgoing(srcId) {
    const rows = this.outgoingStmt.all(srcId);
    return rows.map((r) => this.rowToArr(r));
  }
  incoming(dstId) {
    const rows = this.incomingStmt.all(dstId);
    return rows.map((r) => this.rowToArr(r));
  }
  queryElements(opts) {
    const conditions = [];
    const params = [];
    if (opts.kind && opts.kind !== "any") {
      conditions.push("kind = ?");
      params.push(opts.kind);
    }
    if (opts.nameRegex) {
      conditions.push("name REGEXP ?");
      params.push(opts.nameRegex);
    }
    if (opts.moduleRegex) {
      conditions.push("module REGEXP ?");
      params.push(opts.moduleRegex);
    }
    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const sql = `SELECT id, kind, name, module, span, attrs FROM olog_elem ${where} ORDER BY module, name LIMIT ?`;
    params.push(opts.limit);
    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r) => this.rowToElem(r));
  }
  dumpCounts() {
    const elemRows = this.db.prepare("SELECT kind, COUNT(*) as count FROM olog_elem GROUP BY kind").all();
    const arrRows = this.db.prepare("SELECT kind, COUNT(*) as count FROM olog_arr GROUP BY kind").all();
    const totalElemRow = this.db.prepare("SELECT COUNT(*) as count FROM olog_elem").get();
    const totalArrRow = this.db.prepare("SELECT COUNT(*) as count FROM olog_arr").get();
    const elementCounts = {};
    for (const r of elemRows) {
      elementCounts[r.kind] = Number(r.count);
    }
    const arrowCounts = {};
    for (const r of arrRows) {
      arrowCounts[r.kind] = Number(r.count);
    }
    return {
      elementCounts,
      arrowCounts,
      totalElements: Number(totalElemRow?.count ?? 0),
      totalArrows: Number(totalArrRow?.count ?? 0)
    };
  }
  addEquation(eq) {
    this.insertEquationStmt.run(
      eq.id,
      eq.name,
      eq.humanMessage,
      JSON.stringify(eq.lhs),
      JSON.stringify(eq.rhs),
      eq.provenance ? JSON.stringify(eq.provenance) : null
    );
  }
  getEquations() {
    const rows = this.getEquationsStmt.all();
    return rows.map((r) => this.rowToEquation(r));
  }
  getEquationsForObject(objectId) {
    const pattern = `%${objectId}%`;
    const rows = this.getEquationsForObjectStmt.all(pattern, pattern);
    return rows.map((r) => this.rowToEquation(r));
  }
  addConstraint(constraint) {
    this.insertConstraintStmt.run(
      constraint.id,
      constraint.name,
      constraint.kind,
      constraint.message,
      JSON.stringify(constraint.config),
      constraint.provenance ? JSON.stringify(constraint.provenance) : null
    );
  }
  getConstraints() {
    const rows = this.getConstraintsStmt.all();
    return rows.map((r) => this.rowToConstraint(r));
  }
  addMotifTemplate(template) {
    this.insertMotifTemplateStmt.run(
      template.id,
      template.name,
      template.description,
      JSON.stringify(template.shape),
      JSON.stringify(template.equations),
      JSON.stringify(template.provenance),
      Date.now()
    );
  }
  getMotifTemplates() {
    const rows = this.db.prepare(
      "SELECT id, name, description, shape_json, equations_json, provenance_json, created_at FROM olog_motif_template"
    ).all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      shape: JSON.parse(r.shape_json),
      equations: r.equations_json ? JSON.parse(r.equations_json) : [],
      provenance: JSON.parse(r.provenance_json),
      createdAt: r.created_at
    }));
  }
  addMotifInstance(instance) {
    this.insertMotifInstanceStmt.run(
      instance.id,
      instance.templateId,
      JSON.stringify(instance.mappings),
      JSON.stringify(instance.provenance),
      Date.now()
    );
  }
  getMotifInstances(templateId) {
    const rows = this.db.prepare(
      "SELECT id, template_id, mappings_json, provenance_json, created_at FROM olog_motif_instance WHERE template_id = ?"
    ).all(templateId);
    return rows.map((r) => ({
      id: r.id,
      templateId: r.template_id,
      mappings: JSON.parse(r.mappings_json),
      provenance: JSON.parse(r.provenance_json),
      createdAt: r.created_at
    }));
  }
  traverse(opts) {
    return traverse(this.db, opts);
  }
  queryElementsWithConfidence(opts) {
    const conditions = [];
    const params = [];
    if (opts.kind && opts.kind !== "any") {
      conditions.push("e.kind = ?");
      params.push(opts.kind);
    }
    if (opts.nameRegex) {
      conditions.push("e.name REGEXP ?");
      params.push(opts.nameRegex);
    }
    if (opts.moduleRegex) {
      conditions.push("e.module REGEXP ?");
      params.push(opts.moduleRegex);
    }
    if (opts.minConfidence) {
      conditions.push("p.confidence = ?");
      params.push(opts.minConfidence);
    }
    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const join4 = opts.minConfidence ? " INNER JOIN olog_prov p ON e.id = p.elem_id" : "";
    const sql = `SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_elem e${join4} ${where} ORDER BY e.module, e.name LIMIT ?`;
    params.push(opts.limit);
    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r) => this.rowToElem(r));
  }
  getProvenance(elemId2) {
    const row = this.getProvenanceStmt.get(elemId2);
    if (!row) return null;
    return {
      source: row.source,
      commitSha: row.commit_sha,
      ingestedAt: row.ingested_at,
      confidence: row.confidence ?? "resolved"
    };
  }
  applyPlan(operations) {
    let applied = 0;
    let skipped = 0;
    const errors = [];
    const changes = [];
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
            case "rename": {
              const elem = this.getElem(op.target);
              if (!elem) {
                skipped++;
                errors.push(`Element not found: ${op.target}`);
                break;
              }
              updateElemName.run(op.newName, op.target);
              const arrowPattern = `%${op.target}%`;
              const affectedArrows = findArrowsByElem.all(arrowPattern);
              for (const arr of affectedArrows) {
                const oldId = arr.id;
                const newId = arr.id.replace(`:${elem.name}:`, `:${op.newName}:`);
                if (newId !== oldId) {
                  updateArrRefs.run(newId, arr.src_id, arr.dst_id, oldId);
                }
              }
              applied++;
              changes.push({
                path: elem.module ?? "",
                line: 0,
                column: 0,
                oldText: elem.name,
                newText: op.newName
              });
              break;
            }
            case "move": {
              const moveElem = this.getElem(op.target);
              if (!moveElem) {
                skipped++;
                errors.push(`Element not found: ${op.target}`);
                break;
              }
              updateElemModule.run(op.newModule, op.target);
              applied++;
              changes.push({
                path: moveElem.module ?? "",
                line: 0,
                column: 0,
                oldText: moveElem.module ?? "",
                newText: op.newModule
              });
              break;
            }
            case "addSymbol": {
              const id = `manual:${op.module}:0:0:${op.symbolKind}:${op.name}`;
              insertElem.run(id, op.symbolKind, op.name, op.module, null, "{}");
              applied++;
              changes.push({
                path: op.module,
                line: 0,
                column: 0,
                oldText: "",
                newText: op.name
              });
              break;
            }
            case "removeSymbol": {
              const remElem = this.getElem(op.target);
              if (!remElem) {
                skipped++;
                errors.push(`Element not found: ${op.target}`);
                break;
              }
              deleteElem.run(op.target);
              applied++;
              changes.push({
                path: remElem.module ?? "",
                line: 0,
                column: 0,
                oldText: remElem.name,
                newText: ""
              });
              break;
            }
            case "addArrow": {
              const aid = `${op.src}:${op.arrowKind}:${op.dst}`;
              insertArr.run(aid, op.arrowKind, op.src, op.dst, "{}");
              applied++;
              changes.push({
                path: "",
                line: 0,
                column: 0,
                oldText: "",
                newText: `${op.arrowKind}: ${op.src} -> ${op.dst}`
              });
              break;
            }
            case "removeArrow": {
              deleteArr.run(op.arrowId);
              applied++;
              changes.push({
                path: "",
                line: 0,
                column: 0,
                oldText: op.arrowId,
                newText: ""
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
  addElement(elem) {
    this.insertElemStmt.run(
      elem.id,
      elem.kind,
      elem.name,
      elem.module,
      elem.span,
      JSON.stringify(elem.attrs)
    );
  }
  addArrow(arr) {
    this.insertArrStmt.run(
      arr.id,
      arr.kind,
      arr.srcId,
      arr.dstId,
      JSON.stringify(arr.attrs)
    );
  }
  addProvenance(elemId2, prov) {
    this.insertProvStmt.run(
      elemId2,
      prov.source,
      prov.commitSha,
      prov.ingestedAt,
      prov.confidence
    );
  }
  hasArrowKind(kind) {
    const row = this.hasArrowKindStmt.get(kind);
    return !!row;
  }
  /**
   * Load every arrow as lightweight {src_id, kind, dst_id} rows.
   * Used to build the in-memory adjacency map for fast mining.
   */
  loadAllArrows() {
    return this.db.prepare("SELECT src_id, kind, dst_id FROM olog_arr").all();
  }
  /**
   * Load every element's id, kind, and name.
   * Used for kind annotation and counterexample names during mining.
   */
  loadElemMeta() {
    const rows = this.db.prepare("SELECT id, kind, name FROM olog_elem").all();
    const map = /* @__PURE__ */ new Map();
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
  getArrowKindsForElementKinds(elementKinds) {
    if (elementKinds.length === 0) return [];
    const placeholders = elementKinds.map(() => "?").join(",");
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
    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r) => r.kind);
  }
  close() {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
    this.db.close();
  }
  rowToElem(row) {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      module: row.module,
      span: row.span,
      attrs: JSON.parse(row.attrs)
    };
  }
  rowToArr(row) {
    return {
      id: row.id,
      kind: row.kind,
      srcId: row.src_id,
      dstId: row.dst_id,
      attrs: JSON.parse(row.attrs)
    };
  }
  rowToEquation(row) {
    return {
      id: row.id,
      name: row.name,
      humanMessage: row.human_message,
      lhs: JSON.parse(row.lhs_json),
      rhs: JSON.parse(row.rhs_json),
      provenance: row.provenance_json ? JSON.parse(row.provenance_json) : null
    };
  }
  rowToConstraint(row) {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      message: row.message,
      config: row.config_json ? JSON.parse(row.config_json) : {},
      provenance: row.provenance_json ? JSON.parse(row.provenance_json) : null
    };
  }
};

// src/constraints.ts
import { randomUUID as randomUUID3 } from "crypto";
var CONFIDENCE_RANK = {
  tentative: 0,
  unresolved: 1,
  resolved: 2
};
function evaluateConstraints(store, _operations) {
  const violations = [];
  const constraints = store.getConstraints();
  for (const constraint of constraints) {
    violations.push(...evaluateConstraint(store, constraint));
  }
  return { valid: violations.length === 0, violations };
}
function evaluateConstraint(store, constraint) {
  switch (constraint.kind) {
    case "existence":
      return evaluateExistence(store, constraint);
    case "layering":
      return evaluateLayering(store, constraint);
    case "monotonicity":
      return evaluateMonotonicity(store, constraint);
    case "totality":
      return evaluateTotality(store, constraint);
    default:
      return [];
  }
}
function evaluateExistence(store, constraint) {
  const kind = constraint.config.kind;
  if (!kind) return [];
  const elements = store.queryElements({ kind, limit: 1 });
  if (elements.length > 0) return [];
  return [
    {
      id: randomUUID3(),
      kind: "integrity",
      humanMessage: constraint.message ?? `Existence constraint "${constraint.name}" violated: no elements of kind "${kind}" exist`,
      involved: []
    }
  ];
}
function evaluateLayering(store, constraint) {
  const rawLayers = constraint.config.layers;
  if (!rawLayers || rawLayers.length === 0) return [];
  const layers = rawLayers;
  const violations = [];
  function layerIndexOf(mod) {
    if (mod == null) return null;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer) continue;
      for (const pattern of layer) {
        if (new RegExp(pattern).test(mod)) return i;
      }
    }
    return null;
  }
  const allElems = store.queryElements({ kind: "any", limit: 5e4 });
  for (const elem of allElems) {
    const srcLayer = layerIndexOf(elem.module);
    if (srcLayer === null) continue;
    const outgoing = store.outgoing(elem.id);
    for (const arr of outgoing) {
      const dstElem = store.getElem(arr.dstId);
      if (!dstElem) continue;
      const dstLayer = layerIndexOf(dstElem.module);
      if (dstLayer === null) continue;
      if (srcLayer < dstLayer) {
        violations.push({
          id: randomUUID3(),
          kind: "integrity",
          humanMessage: constraint.message ?? `Layering constraint "${constraint.name}" violated: "${elem.name}" (layer ${srcLayer}) references "${dstElem.name}" (layer ${dstLayer})`,
          involved: [elem.id, dstElem.id]
        });
      }
    }
  }
  return violations;
}
function evaluateMonotonicity(store, constraint) {
  const violations = [];
  const allElems = store.queryElements({ kind: "any", limit: 5e4 });
  for (const elem of allElems) {
    const srcProv = store.getProvenance(elem.id);
    if (!srcProv) continue;
    const outgoing = store.outgoing(elem.id);
    for (const arr of outgoing) {
      const dstProv = store.getProvenance(arr.dstId);
      if (!dstProv) continue;
      if (CONFIDENCE_RANK[dstProv.confidence] > CONFIDENCE_RANK[srcProv.confidence]) {
        const dstElem = store.getElem(arr.dstId);
        violations.push({
          id: randomUUID3(),
          kind: "integrity",
          humanMessage: constraint.message ?? `Monotonicity constraint "${constraint.name}" violated: "${elem.name}" (${srcProv.confidence}) \u2192 "${dstElem?.name ?? arr.dstId}" (${dstProv.confidence})`,
          involved: [elem.id, arr.dstId]
        });
      }
    }
  }
  return violations;
}
function evaluateTotality(store, constraint) {
  const arrowKind = constraint.config.arrowKind;
  const domainKind = constraint.config.domainKind;
  if (!arrowKind || !domainKind) return [];
  const violations = [];
  const domainElems = store.queryElements({ kind: domainKind, limit: 5e4 });
  for (const elem of domainElems) {
    const outgoing = store.outgoing(elem.id);
    const matching = outgoing.filter((a) => a.kind === arrowKind);
    if (matching.length === 0) {
      violations.push({
        id: randomUUID3(),
        kind: "integrity",
        humanMessage: constraint.message ?? `Totality constraint "${constraint.name}" violated: "${elem.name}" has no outgoing "${arrowKind}" arrow`,
        involved: [elem.id]
      });
    } else if (matching.length > 1) {
      violations.push({
        id: randomUUID3(),
        kind: "integrity",
        humanMessage: constraint.message ?? `Totality constraint "${constraint.name}" violated: "${elem.name}" has ${matching.length} outgoing "${arrowKind}" arrows (expected exactly 1)`,
        involved: [elem.id, ...matching.map((a) => a.id)]
      });
    }
  }
  return violations;
}
function evaluatePathEquations(store, _operations) {
  const violations = [];
  const equations = store.getEquations();
  for (const eq of equations) {
    const result = evaluateEquation(eq, store);
    if (!result.valid) {
      violations.push({
        id: randomUUID3(),
        kind: "equation",
        humanMessage: result.message,
        involved: result.involved
      });
    }
  }
  return { valid: violations.length === 0, violations };
}
function isSchemaElement(elem) {
  if (elem.kind === "domain") return "domain";
  if (elem.kind === "property") return "property";
  const schemaKind = elem.attrs?.schemaKind;
  if (typeof schemaKind === "string") return schemaKind;
  if (elem.kind === "other" && elem.module === null && elem.span === null) {
    const match = elem.name.match(/^(?:a|an)\s+(\S+)/);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}
function evaluateEquation(eq, store) {
  const lhsSrc = store.getElem(eq.lhs.src);
  if (!lhsSrc) {
    return {
      valid: true,
      involved: [],
      message: `Equation "${eq.name}": source "${eq.lhs.src}" not in store, skipping`
    };
  }
  const rhsSrc = store.getElem(eq.rhs.src);
  if (!rhsSrc) {
    return {
      valid: true,
      involved: [],
      message: `Equation "${eq.name}": source "${eq.rhs.src}" not in store, skipping`
    };
  }
  const lhsSchemaKind = isSchemaElement(lhsSrc);
  if (lhsSchemaKind) {
    return evaluateSchemaEquation(eq, store, lhsSchemaKind);
  }
  return evaluateConcreteEquation(eq, store, lhsSrc.id);
}
function evaluateSchemaEquation(eq, store, schemaKind) {
  const concreteElems = store.queryElements({ kind: schemaKind, limit: 5e4 });
  if (concreteElems.length === 0) {
    return {
      valid: true,
      involved: [],
      message: `Equation "${eq.name}": no concrete elements of kind "${schemaKind}" found; skipping schema-level check`
    };
  }
  const allInvolved = [];
  const allMessages = [];
  for (const elem of concreteElems) {
    const result = evaluateConcreteEquation(eq, store, elem.id);
    if (!result.valid) {
      allInvolved.push(...result.involved);
      allMessages.push(`  at "${elem.name}" (${elem.module ?? "unknown"}): ${result.message}`);
    }
  }
  if (allMessages.length === 0) {
    return { valid: true, involved: [], message: "" };
  }
  return {
    valid: false,
    involved: [...new Set(allInvolved)],
    message: `Equation "${eq.name}" violated for kind "${schemaKind}":
${allMessages.join("\n")}`
  };
}
function evaluateConcreteEquation(eq, store, startId) {
  const lhsSteps = eq.lhs.arrows.map((kind) => ({
    kind,
    direction: "out"
  }));
  const rhsSteps = eq.rhs.arrows.map((kind) => ({
    kind,
    direction: "out"
  }));
  const lhsReached = followPath(store, startId, lhsSteps);
  const rhsReached = followPath(store, startId, rhsSteps);
  const lhsIds = new Set(lhsReached.map((e) => e.id));
  const rhsIds = new Set(rhsReached.map((e) => e.id));
  const lhsOnly = [...lhsIds].filter((id) => !rhsIds.has(id));
  const rhsOnly = [...rhsIds].filter((id) => !lhsIds.has(id));
  if (lhsOnly.length === 0 && rhsOnly.length === 0) {
    return { valid: true, involved: [...lhsIds, ...rhsIds], message: "" };
  }
  const involved = [.../* @__PURE__ */ new Set([...lhsIds, ...rhsIds])];
  const lhsNames = lhsReached.filter((e) => !rhsIds.has(e.id)).map((e) => e.name);
  const rhsNames = rhsReached.filter((e) => !lhsIds.has(e.id)).map((e) => e.name);
  let message = "";
  if (lhsNames.length > 0) {
    message += `LHS reaches [${lhsNames.join(", ")}] but RHS does not.`;
  }
  if (rhsNames.length > 0) {
    message += `RHS reaches [${rhsNames.join(", ")}] but LHS does not.`;
  }
  return { valid: false, involved, message };
}
function followPath(store, startId, steps) {
  if (steps.length === 0) {
    const elem = store.getElem(startId);
    return elem ? [elem] : [];
  }
  let currentIds = /* @__PURE__ */ new Set([startId]);
  for (const step of steps) {
    if (currentIds.size === 0) return [];
    const nextIds = /* @__PURE__ */ new Set();
    for (const id of currentIds) {
      const arrows = step.direction === "out" ? store.outgoing(id) : store.incoming(id);
      for (const arr of arrows) {
        if (arr.kind !== step.kind) continue;
        const reachedId = step.direction === "out" ? arr.dstId : arr.srcId;
        nextIds.add(reachedId);
      }
    }
    currentIds = nextIds;
  }
  const result = [];
  for (const id of currentIds) {
    const elem = store.getElem(id);
    if (elem) result.push(elem);
  }
  return result;
}

// src/equations.ts
function isNounPhrase(name) {
  const trimmed = name.trim();
  const withoutPrefix = trimmed.replace(/^(a|an|the)\s+/i, "");
  return /^[A-Z]/.test(withoutPrefix);
}
function validateEquation(eq, store, proposedArrowKinds) {
  const errors = [];
  if (eq.lhs.src !== eq.rhs.src) {
    errors.push(
      `Equation "${eq.name}": lhs source (${eq.lhs.src}) does not match rhs source (${eq.rhs.src})`
    );
  }
  if (eq.lhs.tgt !== eq.rhs.tgt) {
    errors.push(
      `Equation "${eq.name}": lhs target (${eq.lhs.tgt}) does not match rhs target (${eq.rhs.tgt})`
    );
  }
  const proposedSet = new Set(proposedArrowKinds ?? []);
  const allArrowKinds = /* @__PURE__ */ new Set([...eq.lhs.arrows, ...eq.rhs.arrows]);
  for (const kind of allArrowKinds) {
    if (proposedSet.has(kind)) continue;
    if (!store.hasArrowKind(kind)) {
      errors.push(
        `Equation "${eq.name}": arrow kind "${kind}" does not exist in the database or concurrent proposal`
      );
    }
  }
  return { valid: errors.length === 0, errors };
}

// src/ingest/ids.ts
function elemId(module, line, col, kind, name) {
  return `module:${module}:${line}:${col}:${kind}:${name}`;
}
function arrowId(srcId, kind, dstId) {
  return `${srcId}:${kind}:${dstId}`;
}
function fileElemId(relativePath) {
  return `file:${relativePath}`;
}
function formatSpan(relativePath, startLine, startCol, endLine, endCol) {
  return `${relativePath}:${startLine}:${startCol}-${endLine}:${endCol}`;
}

// src/ingest/project.ts
import { globSync } from "glob";
import { readFileSync as readFileSync2, statSync } from "fs";
import { relative, basename } from "path";
import { execSync } from "child_process";

// src/ingest/adapter.ts
var AdapterRegistry = class {
  adapters = /* @__PURE__ */ new Map();
  extensionMap = /* @__PURE__ */ new Map();
  /** Register a language adapter */
  register(adapter) {
    this.adapters.set(adapter.languageId, adapter);
    for (const ext of adapter.extensions) {
      this.extensionMap.set(ext, adapter);
    }
  }
  /** Look up the adapter for a given filename (by its extension) */
  getForFile(filename) {
    const ext = filename.substring(filename.lastIndexOf("."));
    return this.extensionMap.get(ext) ?? null;
  }
  /** Get all registered file extensions across all adapters */
  allExtensions() {
    return Array.from(this.extensionMap.keys());
  }
  /** Get all glob patterns across all adapters */
  allGlobPatterns() {
    return Array.from(this.adapters.values()).map((a) => a.globPattern);
  }
  /** Check if an adapter is registered for a given language id */
  hasAdapter(languageId) {
    return this.adapters.has(languageId);
  }
};
var defaultRegistry = void 0;
function setDefaultRegistry(registry) {
  defaultRegistry = registry;
}
function getDefaultRegistry() {
  return defaultRegistry;
}

// src/ingest/project.ts
var IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/.olog/**",
  "**/*.d.ts"
];
var ONE_MB = 1024 * 1024;
function ingestProject(projectRoot, store, registry) {
  const start = Date.now();
  let head;
  try {
    head = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    head = "nogit";
  }
  if (head !== "nogit" && store.isFresh(head)) {
    return {
      filesProcessed: 0,
      elementsCreated: 0,
      arrowsCreated: 0,
      durationMs: Date.now() - start
    };
  }
  const result = runIngestion(projectRoot, store, head, registry);
  return { ...result, durationMs: Date.now() - start };
}
function ingestChangedFiles(projectRoot, store, registry) {
  const start = Date.now();
  const effectiveRegistry = registry ?? getDefaultRegistry();
  if (!effectiveRegistry) throw new Error("No adapter registry available.");
  setDefaultRegistry(effectiveRegistry);
  let head;
  try {
    head = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    head = "nogit";
  }
  const gitChanged = /* @__PURE__ */ new Set();
  const storedSha = store.commitSha();
  try {
    if (storedSha && storedSha !== "nogit" && storedSha !== head) {
      execSync(`git diff --name-only ${storedSha} ${head}`, { cwd: projectRoot, encoding: "utf8" }).trim().split("\n").filter(Boolean).forEach((f) => gitChanged.add(f));
    }
    execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8" }).trim().split("\n").filter(Boolean).forEach((line) => {
      const f = line.slice(3).trim();
      if (f) gitChanged.add(f);
    });
  } catch {
  }
  const ingestedModules = store.getIngestedModules();
  const allFiles = discoverFiles(projectRoot, effectiveRegistry);
  const filesToProcess = allFiles.filter((abs) => {
    const rel = relative(projectRoot, abs);
    return !ingestedModules.has(rel) || gitChanged.has(rel);
  });
  if (filesToProcess.length === 0) {
    return { filesProcessed: 0, elementsCreated: 0, arrowsCreated: 0, durationMs: Date.now() - start };
  }
  for (const abs of filesToProcess) {
    const rel = relative(projectRoot, abs);
    if (ingestedModules.has(rel)) store.deleteModuleTreeSitterElements(rel);
  }
  const elems = [];
  const arrs = [];
  const pendingCrossFileArrows = [];
  const newNameToIds = /* @__PURE__ */ new Map();
  const createdModuleIds = /* @__PURE__ */ new Set();
  let filesProcessed = 0;
  for (const absolutePath of filesToProcess) {
    const rel = relative(projectRoot, absolutePath);
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch {
      continue;
    }
    if (stats.size > 1024 * 1024) continue;
    let source;
    try {
      source = readFileSync2(absolutePath, "utf8");
    } catch {
      continue;
    }
    const adapter = effectiveRegistry.getForFile(absolutePath);
    if (!adapter) continue;
    let extracted;
    try {
      extracted = adapter.extractElements(adapter.createParser(absolutePath), source, adapter.queryPath(absolutePath), rel, projectRoot);
    } catch (err) {
      console.error(`[olog] Failed to extract from ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const fileId = fileElemId(rel);
    elems.push({ id: fileId, kind: "file", name: basename(rel), module: rel, span: null, attrs: "{}" });
    const fileNameToId = /* @__PURE__ */ new Map();
    const seenArrowIds = /* @__PURE__ */ new Set();
    for (const rawElem of extracted.elements) {
      const coords = parseTreeSitterSpan(rawElem.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;
      const fullSpan = coords ? formatSpan(rel, coords.startLine, coords.startCol, coords.endLine, coords.endCol) : rawElem.span;
      const id = elemId(rel, line, col, rawElem.kind, rawElem.name);
      const fileExisting = fileNameToId.get(rawElem.name) ?? [];
      fileExisting.push(id);
      fileNameToId.set(rawElem.name, fileExisting);
      const globalExisting = newNameToIds.get(rawElem.name) ?? [];
      globalExisting.push(id);
      newNameToIds.set(rawElem.name, globalExisting);
      elems.push({ id, kind: rawElem.kind, name: rawElem.name, module: rel, span: fullSpan, attrs: JSON.stringify(rawElem.attrs) });
      if (rawElem.kind !== "file") {
        const aid = arrowId(fileId, "contains", id);
        if (!seenArrowIds.has(aid)) {
          seenArrowIds.add(aid);
          arrs.push({ id: aid, kind: "contains", src_id: fileId, dst_id: id, attrs: "{}" });
        }
      }
    }
    for (const rawArrow of extracted.arrows) {
      if (rawArrow.kind === "importsFrom") {
        const srcId = (fileNameToId.get(rawArrow.srcName) ?? [])[0];
        const rawModule = rawArrow.attrs.module ?? rawArrow.dstModule;
        const resolvedModule = adapter.resolveImportSpecifier ? adapter.resolveImportSpecifier(rawModule, rel, projectRoot) ?? rawModule : rawModule;
        const moduleId = `module:${resolvedModule}`;
        if (srcId) {
          if (!createdModuleIds.has(moduleId)) {
            createdModuleIds.add(moduleId);
            elems.push({ id: moduleId, kind: "module", name: resolvedModule, module: resolvedModule, span: null, attrs: "{}" });
          }
          const aid = arrowId(srcId, "importsFrom", moduleId);
          if (!seenArrowIds.has(aid)) {
            seenArrowIds.add(aid);
            arrs.push({ id: aid, kind: "importsFrom", src_id: srcId, dst_id: moduleId, attrs: JSON.stringify(rawArrow.attrs) });
          }
        }
      } else {
        const srcId = (fileNameToId.get(rawArrow.srcName) ?? [])[0];
        const dstId = (fileNameToId.get(rawArrow.dstName) ?? [])[0];
        if (srcId && dstId) {
          const aid = arrowId(srcId, rawArrow.kind, dstId);
          if (!seenArrowIds.has(aid)) {
            seenArrowIds.add(aid);
            arrs.push({ id: aid, kind: rawArrow.kind, src_id: srcId, dst_id: dstId, attrs: JSON.stringify(rawArrow.attrs) });
          }
        } else if (srcId && !dstId && rawArrow.dstName) {
          pendingCrossFileArrows.push({ kind: rawArrow.kind, srcId, dstName: rawArrow.dstName, dstModuleSuffix: rawArrow.dstModule ?? "", attrs: JSON.stringify(rawArrow.attrs) });
        }
      }
    }
    filesProcessed++;
  }
  const globalNameToIds = store.getAllElemNameToIds();
  for (const [name, ids] of newNameToIds) {
    const existing = globalNameToIds.get(name) ?? [];
    for (const id of ids) if (!existing.includes(id)) existing.push(id);
    globalNameToIds.set(name, existing);
  }
  const dbIdToModule = store.getAllElemIdToModule();
  const newElemIdToModule = /* @__PURE__ */ new Map();
  for (const e of elems) {
    if (e.module !== null && e.module !== void 0) newElemIdToModule.set(e.id, e.module);
  }
  const seenCrossIds = /* @__PURE__ */ new Set();
  for (const pending of pendingCrossFileArrows) {
    const candidates = globalNameToIds.get(pending.dstName) ?? [];
    let dstId;
    if (pending.dstModuleSuffix) {
      const matched = candidates.filter((id) => {
        const mod = newElemIdToModule.get(id) ?? dbIdToModule.get(id);
        return mod?.endsWith(pending.dstModuleSuffix) ?? false;
      });
      if (matched.length === 1) dstId = matched[0];
    } else if (candidates.length === 1) {
      dstId = candidates[0];
    }
    if (dstId && dstId !== pending.srcId) {
      const aid = arrowId(pending.srcId, pending.kind, dstId);
      if (!seenCrossIds.has(aid)) {
        seenCrossIds.add(aid);
        arrs.push({ id: aid, kind: pending.kind, src_id: pending.srcId, dst_id: dstId, attrs: pending.attrs });
      }
    }
  }
  store.ingestFile(elems, arrs, head);
  return { filesProcessed, elementsCreated: elems.length, arrowsCreated: arrs.length, durationMs: Date.now() - start };
}
function reindexProject(projectRoot, store, registry) {
  const start = Date.now();
  let head;
  try {
    head = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    head = "nogit";
  }
  const result = runIngestion(projectRoot, store, head, registry);
  return { ...result, durationMs: Date.now() - start };
}
function discoverFiles(projectRoot, registry) {
  const patterns = registry.allGlobPatterns();
  let allFiles = [];
  for (const pattern of patterns) {
    allFiles = allFiles.concat(globSync(pattern, {
      cwd: projectRoot,
      ignore: IGNORE_PATTERNS,
      absolute: true
    }));
  }
  return [...new Set(allFiles)];
}
function runIngestion(projectRoot, store, head, registry) {
  const effectiveRegistry = registry ?? getDefaultRegistry();
  if (!effectiveRegistry) {
    throw new Error("No adapter registry available. Register language adapters or pass a registry.");
  }
  setDefaultRegistry(effectiveRegistry);
  const files = discoverFiles(projectRoot, effectiveRegistry);
  const elems = [];
  const arrs = [];
  let filesProcessed = 0;
  const createdModuleIds = /* @__PURE__ */ new Set();
  const filesToExtract = [];
  const pendingCrossFileArrows = [];
  const globalNameToIds = /* @__PURE__ */ new Map();
  const moduleToIds = /* @__PURE__ */ new Map();
  for (const absolutePath of files) {
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch (err) {
      console.error(
        `[olog] Failed to stat ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    if (stats.size > ONE_MB) {
      console.error(`[olog] Skipping ${absolutePath}: file size ${stats.size} exceeds 1MB limit`);
      continue;
    }
    let source;
    try {
      source = readFileSync2(absolutePath, "utf8");
    } catch (err) {
      console.error(
        `[olog] Failed to read ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    const relativePath = relative(projectRoot, absolutePath);
    const adapter = effectiveRegistry.getForFile(absolutePath);
    if (!adapter) {
      console.error(`[olog] Skipping ${absolutePath}: no language adapter for extension`);
      continue;
    }
    const parser = adapter.createParser(absolutePath);
    const queryPath = adapter.queryPath(absolutePath);
    let extracted;
    try {
      extracted = adapter.extractElements(parser, source, queryPath, relativePath, projectRoot);
    } catch (err) {
      console.error(
        `[olog] Failed to extract from ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    const fileId = fileElemId(relativePath);
    elems.push({
      id: fileId,
      kind: "file",
      name: basename(relativePath),
      module: relativePath,
      span: null,
      attrs: "{}"
    });
    const nameToId = /* @__PURE__ */ new Map();
    const seenArrowIds = /* @__PURE__ */ new Set();
    const elementIds = [];
    for (const rawElem of extracted.elements) {
      const coords = parseTreeSitterSpan(rawElem.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;
      const fullSpan = coords ? formatSpan(relativePath, coords.startLine, coords.startCol, coords.endLine, coords.endCol) : rawElem.span;
      const id = elemId(relativePath, line, col, rawElem.kind, rawElem.name);
      const existing = nameToId.get(rawElem.name) ?? [];
      existing.push(id);
      nameToId.set(rawElem.name, existing);
      elementIds.push({ id, kind: rawElem.kind });
      const globalExisting = globalNameToIds.get(rawElem.name) ?? [];
      globalExisting.push(id);
      globalNameToIds.set(rawElem.name, globalExisting);
      const modExisting = moduleToIds.get(relativePath) ?? [];
      modExisting.push(id);
      moduleToIds.set(relativePath, modExisting);
      elems.push({
        id,
        kind: rawElem.kind,
        name: rawElem.name,
        module: relativePath,
        span: fullSpan,
        attrs: JSON.stringify(rawElem.attrs)
      });
      if (rawElem.kind !== "file") {
        const aid = arrowId(fileId, "contains", id);
        if (!seenArrowIds.has(aid)) {
          seenArrowIds.add(aid);
          arrs.push({
            id: aid,
            kind: "contains",
            src_id: fileId,
            dst_id: id,
            attrs: "{}"
          });
        }
      }
    }
    const definitionKinds = /* @__PURE__ */ new Set(["function", "class", "interface", "type", "enum", "method"]);
    for (const { id, kind } of elementIds) {
      if (definitionKinds.has(kind)) {
        const aid = arrowId(id, "definedIn", fileId);
        if (!seenArrowIds.has(aid)) {
          seenArrowIds.add(aid);
          arrs.push({ id: aid, kind: "definedIn", src_id: id, dst_id: fileId, attrs: "{}" });
        }
      }
    }
    for (const { id } of elementIds) {
      const aid = arrowId(id, "inModule", fileId);
      if (!seenArrowIds.has(aid)) {
        seenArrowIds.add(aid);
        arrs.push({ id: aid, kind: "inModule", src_id: id, dst_id: fileId, attrs: "{}" });
      }
    }
    for (const { id } of elementIds) {
      const aid = arrowId(id, "locatedIn", fileId);
      if (!seenArrowIds.has(aid)) {
        seenArrowIds.add(aid);
        arrs.push({ id: aid, kind: "locatedIn", src_id: id, dst_id: fileId, attrs: "{}" });
      }
    }
    for (const rawArrow of extracted.arrows) {
      const arrowKindStr = rawArrow.kind;
      if (arrowKindStr === "importsFrom") {
        const srcId = (nameToId.get(rawArrow.srcName) ?? [])[0];
        const rawModule = rawArrow.attrs.module ?? rawArrow.dstModule;
        const resolvedModule = adapter.resolveImportSpecifier ? adapter.resolveImportSpecifier(rawModule, relativePath, projectRoot) ?? rawModule : rawModule;
        const moduleId = `module:${resolvedModule}`;
        if (srcId) {
          if (!createdModuleIds.has(moduleId)) {
            createdModuleIds.add(moduleId);
            elems.push({
              id: moduleId,
              kind: "module",
              name: resolvedModule,
              module: resolvedModule,
              span: null,
              attrs: "{}"
            });
          }
          const aid = arrowId(srcId, "importsFrom", moduleId);
          if (!seenArrowIds.has(aid)) {
            seenArrowIds.add(aid);
            arrs.push({ id: aid, kind: "importsFrom", src_id: srcId, dst_id: moduleId, attrs: JSON.stringify(rawArrow.attrs) });
          }
        }
      } else {
        const srcId = (nameToId.get(rawArrow.srcName) ?? [])[0];
        const dstId = (nameToId.get(rawArrow.dstName) ?? [])[0];
        if (srcId && dstId) {
          const aid = arrowId(srcId, rawArrow.kind, dstId);
          if (!seenArrowIds.has(aid)) {
            seenArrowIds.add(aid);
            arrs.push({
              id: aid,
              kind: rawArrow.kind,
              src_id: srcId,
              dst_id: dstId,
              attrs: JSON.stringify(rawArrow.attrs)
            });
          }
        } else if (srcId && !dstId && rawArrow.dstName) {
          pendingCrossFileArrows.push({
            kind: rawArrow.kind,
            srcId,
            dstName: rawArrow.dstName,
            dstModuleSuffix: rawArrow.dstModule ?? "",
            attrs: JSON.stringify(rawArrow.attrs)
          });
        }
      }
    }
    for (const rawElem of extracted.elements) {
      if (rawElem.kind === "import") {
        const coords = parseTreeSitterSpan(rawElem.span);
        const line = coords?.startLine ?? 1;
        const col = coords?.startCol ?? 1;
        const id = elemId(relativePath, line, col, rawElem.kind, rawElem.name);
        const aid = arrowId(fileId, "imports", id);
        if (!seenArrowIds.has(aid)) {
          seenArrowIds.add(aid);
          arrs.push({
            id: aid,
            kind: "imports",
            src_id: fileId,
            dst_id: id,
            attrs: "{}"
          });
        }
        const sourceModule = rawElem.attrs.sourceModule;
        if (sourceModule) {
          const resolvedSourceModule = adapter.resolveImportSpecifier ? adapter.resolveImportSpecifier(sourceModule, relativePath, projectRoot) ?? sourceModule : sourceModule;
          const moduleId = `module:${resolvedSourceModule}`;
          if (!createdModuleIds.has(moduleId)) {
            createdModuleIds.add(moduleId);
            elems.push({
              id: moduleId,
              kind: "module",
              name: resolvedSourceModule,
              module: resolvedSourceModule,
              span: null,
              attrs: "{}"
            });
          }
          const ifAid = arrowId(id, "importsFrom", moduleId);
          if (!seenArrowIds.has(ifAid)) {
            seenArrowIds.add(ifAid);
            arrs.push({ id: ifAid, kind: "importsFrom", src_id: id, dst_id: moduleId, attrs: JSON.stringify({ module: resolvedSourceModule }) });
          }
        }
      }
    }
    const hasStructuredTypes = extracted.elements.some(
      (e) => e.kind === "interface" || e.kind === "type" || e.kind === "class"
    );
    if (hasStructuredTypes) {
      filesToExtract.push({ relativePath, source, adapter, nameToId });
    }
    filesProcessed++;
  }
  const globalNameToId = /* @__PURE__ */ new Map();
  for (const e of elems) {
    if (!globalNameToId.has(e.name)) {
      globalNameToId.set(e.name, e.id);
    }
  }
  const seenPropArrowIds = /* @__PURE__ */ new Set();
  for (const { relativePath, source, adapter: fileAdapter, nameToId: fileNameToId } of filesToExtract) {
    if (!fileAdapter.extractProperties) continue;
    let properties;
    try {
      const parser = fileAdapter.createParser(relativePath);
      properties = fileAdapter.extractProperties(parser, source, relativePath);
    } catch (err) {
      console.error(
        `[olog] Failed to extract properties from ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    for (const prop of properties) {
      const parentIds = fileNameToId.get(prop.parentName);
      const parentId = parentIds?.[0];
      if (!parentId) continue;
      const coords = parseTreeSitterSpan(prop.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;
      const propId = elemId(relativePath, line, col, "property", `${prop.parentName}.${prop.name}`);
      const fullSpan = coords ? formatSpan(relativePath, coords.startLine, coords.startCol, coords.endLine, coords.endCol) : prop.span;
      elems.push({
        id: propId,
        kind: "property",
        name: `${prop.parentName}.${prop.name}`,
        module: relativePath,
        span: fullSpan,
        attrs: JSON.stringify({ typeText: prop.typeText, optional: prop.optional, readonly: prop.readonly })
      });
      const hpId = arrowId(parentId, "hasProperty", propId);
      if (!seenPropArrowIds.has(hpId)) {
        seenPropArrowIds.add(hpId);
        arrs.push({ id: hpId, kind: "hasProperty", src_id: parentId, dst_id: propId, attrs: "{}" });
      }
      for (const typeRef of prop.typeRefs) {
        const typeId = (fileNameToId.get(typeRef) ?? [])[0] ?? globalNameToId.get(typeRef);
        if (typeId && typeId !== propId) {
          const htId = arrowId(propId, "hasType", typeId);
          if (!seenPropArrowIds.has(htId)) {
            seenPropArrowIds.add(htId);
            arrs.push({ id: htId, kind: "hasType", src_id: propId, dst_id: typeId, attrs: "{}" });
          }
        }
      }
    }
  }
  const elemIdToModule = /* @__PURE__ */ new Map();
  for (const e of elems) {
    if (e.module !== null && e.module !== void 0) elemIdToModule.set(e.id, e.module);
  }
  const seenCrossFileArrowIds = /* @__PURE__ */ new Set();
  for (const pending of pendingCrossFileArrows) {
    const candidates = globalNameToIds.get(pending.dstName) ?? [];
    let dstId;
    if (pending.dstModuleSuffix) {
      const suffix = pending.dstModuleSuffix;
      const matched = candidates.filter((id) => elemIdToModule.get(id)?.endsWith(suffix) ?? false);
      if (matched.length === 1) dstId = matched[0];
    } else if (candidates.length === 1) {
      dstId = candidates[0];
    }
    if (dstId && dstId !== pending.srcId) {
      const aid = arrowId(pending.srcId, pending.kind, dstId);
      if (!seenCrossFileArrowIds.has(aid)) {
        seenCrossFileArrowIds.add(aid);
        arrs.push({ id: aid, kind: pending.kind, src_id: pending.srcId, dst_id: dstId, attrs: pending.attrs });
      }
    }
  }
  store.ingestFull(elems, arrs, head);
  return {
    filesProcessed,
    elementsCreated: elems.length,
    arrowsCreated: arrs.length
  };
}
function parseTreeSitterSpan(span) {
  const m = span.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
  if (!m) return null;
  return {
    startLine: parseInt(m[1], 10),
    startCol: parseInt(m[2], 10),
    endLine: parseInt(m[3], 10),
    endCol: parseInt(m[4], 10)
  };
}

// src/render/index.ts
import { readFileSync as readFileSync4 } from "fs";
import { join as join2 } from "path";

// src/render/edit.ts
function offsetAt(source, line, col) {
  let currentLine = 1;
  let offset = 0;
  while (currentLine < line && offset < source.length) {
    const nl = source.indexOf("\n", offset);
    if (nl < 0) return source.length;
    offset = nl + 1;
    currentLine++;
  }
  return Math.min(offset + col - 1, source.length);
}
function applyEditsToString(source, edits) {
  const sorted = [...edits].sort((a, b) => {
    if (a.startLine !== b.startLine) return b.startLine - a.startLine;
    return b.startCol - a.startCol;
  });
  let result = source;
  for (const edit of sorted) {
    const startOffset = offsetAt(result, edit.startLine, edit.startCol);
    const endOffset = offsetAt(result, edit.endLine, edit.endCol);
    if (startOffset > endOffset) {
      throw new Error(`Invalid edit range in ${edit.filePath}: start > end`);
    }
    if (edit.oldText !== null) {
      const actual = result.slice(startOffset, endOffset);
      if (actual !== edit.oldText) {
        throw new Error(
          `oldText mismatch at ${edit.filePath}:${edit.startLine}:${edit.startCol}: expected "${edit.oldText}", found "${actual}"`
        );
      }
    }
    result = result.slice(0, startOffset) + edit.newText + result.slice(endOffset);
  }
  return result;
}
async function applySourceEdits(edits, projectRoot, readFile, writeFile) {
  const { readFile: fsReadFile, writeFile: fsWriteFile } = await import("fs/promises");
  const { join: join4 } = await import("path");
  const readFn = readFile ?? (async (p) => fsReadFile(join4(projectRoot, p), "utf8"));
  const writeFn = writeFile ?? (async (p, c) => fsWriteFile(join4(projectRoot, p), c, "utf8"));
  let applied = 0;
  let skipped = 0;
  const errors = [];
  const snapshots = [];
  const affectedFiles = /* @__PURE__ */ new Set();
  const byFile = /* @__PURE__ */ new Map();
  for (const edit of edits) {
    const arr = byFile.get(edit.filePath) ?? [];
    arr.push(edit);
    byFile.set(edit.filePath, arr);
  }
  for (const [filePath, fileEdits] of byFile) {
    try {
      let content;
      try {
        content = await readFn(filePath);
      } catch {
        if (fileEdits.some((e) => e.oldText !== null)) {
          skipped += fileEdits.length;
          errors.push(`File not found: ${filePath}`);
          continue;
        }
        content = "";
      }
      snapshots.push({ filePath, originalContent: content });
      try {
        const newContent = applyEditsToString(content, fileEdits);
        await writeFn(filePath, newContent);
        applied += fileEdits.length;
        affectedFiles.add(filePath);
      } catch (editErr) {
        const msg = editErr instanceof Error ? editErr.message : String(editErr);
        skipped += fileEdits.length;
        errors.push(`${filePath}: ${msg}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped += fileEdits.length;
      errors.push(`${filePath}: ${msg}`);
    }
  }
  return { applied, skipped, errors, snapshots, affectedFiles: Array.from(affectedFiles) };
}
async function rollback(snapshots, projectRoot) {
  const { writeFile: fsWriteFile } = await import("fs/promises");
  const { join: join4 } = await import("path");
  for (const snapshot of snapshots) {
    try {
      await fsWriteFile(join4(projectRoot, snapshot.filePath), snapshot.originalContent, "utf8");
    } catch {
    }
  }
}

// src/render/strategies/rename.ts
function computeRenameEdits(store, elementId, newName, readFile) {
  let edits = [];
  const warnings = [];
  const elem = store.getElem(elementId);
  if (!elem) {
    warnings.push(`Element not found: ${elementId}`);
    return { edits, warnings };
  }
  if (elem.span) {
    const parsedSpan = parseSpan(elem.span);
    if (parsedSpan) {
      edits.push({
        filePath: elem.module ?? "",
        label: `rename declaration: ${elem.name} \u2192 ${newName}`,
        oldText: elem.name,
        newText: newName,
        startLine: parsedSpan.startLine,
        startCol: parsedSpan.startCol,
        endLine: parsedSpan.endLine,
        endCol: parsedSpan.endCol
      });
    }
  }
  const importElements = findImportReferences(store, elem);
  for (const importElem of importElements) {
    if (importElem.span) {
      const parsedSpan = parseSpan(importElem.span);
      if (parsedSpan) {
        edits.push({
          filePath: importElem.module ?? "",
          label: `rename import: ${elem.name} \u2192 ${newName} in ${importElem.module}`,
          oldText: elem.name,
          newText: newName,
          startLine: parsedSpan.startLine,
          startCol: parsedSpan.startCol,
          endLine: parsedSpan.endLine,
          endCol: parsedSpan.endCol
        });
      }
    }
  }
  const callSites = findCallReferences(store, elem, elementId);
  for (const callElem of callSites) {
    if (callElem.span) {
      const parsedSpan = parseSpan(callElem.span);
      if (parsedSpan) {
        edits.push({
          filePath: callElem.module ?? "",
          label: `rename reference: ${elem.name} \u2192 ${newName} in ${callElem.module}`,
          oldText: elem.name,
          newText: newName,
          startLine: parsedSpan.startLine,
          startCol: parsedSpan.startCol,
          endLine: parsedSpan.endLine,
          endCol: parsedSpan.endCol
        });
      }
    }
  }
  const seen = /* @__PURE__ */ new Set();
  edits = edits.filter((e) => {
    const key = `${e.filePath}:${e.startLine}:${e.startCol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { edits, warnings };
}
function findImportReferences(store, elem) {
  const results = [];
  const candidates = store.queryElements({ nameRegex: `^${escapeRegex(elem.name)}$`, kind: "import", limit: 500 });
  for (const candidate of candidates) {
    if (candidate.id === elem.id) continue;
    if (candidate.module === elem.module) continue;
    const incoming = store.incoming(candidate.id);
    for (const arr of incoming) {
      if (arr.kind === "contains") {
        const outgoing = store.outgoing(candidate.id);
        for (const oarr of outgoing) {
          if (oarr.kind === "importsFrom") {
            results.push(candidate);
          }
        }
      }
    }
    results.push(candidate);
  }
  return [...new Map(results.map((e) => [e.id, e])).values()];
}
function findCallReferences(store, elem, elementId) {
  const results = [];
  const incoming = store.incoming(elementId);
  for (const arr of incoming) {
    if (arr.kind === "callerOf" || arr.kind === "calleeOf") {
      const caller = store.getElem(arr.srcId);
      if (caller) results.push(caller);
    }
  }
  const outgoing = store.outgoing(elementId);
  for (const arr of outgoing) {
    if (arr.kind === "callerOf") {
      const callee = store.getElem(arr.dstId);
      if (callee) results.push(callee);
    }
  }
  return [...new Map(results.map((e) => [e.id, e])).values()];
}
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function parseSpan(span) {
  const m = span.match(/^([^:]+):(\d+):(\d+)-(\d+):(\d+)$/);
  if (!m) return null;
  return {
    startLine: parseInt(m[2], 10),
    startCol: parseInt(m[3], 10),
    endLine: parseInt(m[4], 10),
    endCol: parseInt(m[5], 10)
  };
}

// src/render/declaration.ts
import "fs";
function findEnclosingDeclaration(source, filePath, identifierLine, identifierCol, kind, registry) {
  const adapter = registry.getForFile(filePath);
  if (!adapter) return null;
  const parser = adapter.createParser(filePath);
  const targetTypes = adapter.kindToNodeTypes[kind] ?? [];
  const tree = parser.parse(source);
  const targetRow = identifierLine - 1;
  const targetCol = identifierCol - 1;
  let node = tree.rootNode.descendantForPosition(
    { row: targetRow, column: targetCol },
    { row: targetRow, column: targetCol + 1 }
  );
  while (node && !targetTypes.includes(node.type)) {
    node = node.parent;
  }
  if (!node) {
    tree.delete?.();
    return null;
  }
  const range = {
    startLine: node.startPosition.row + 1,
    startCol: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endCol: node.endPosition.column + 1,
    text: node.text
  };
  tree.delete?.();
  return range;
}
function findImportStatement(source, startLine) {
  const lines = source.split("\n");
  if (startLine < 1 || startLine > lines.length) return null;
  let beginLine = startLine - 1;
  let endLine = beginLine;
  let braceDepth = 0;
  let foundFrom = false;
  for (let i = beginLine; i < lines.length; i++) {
    const line = lines[i];
    braceDepth += (line.match(/\{/g) || []).length;
    braceDepth -= (line.match(/\}/g) || []).length;
    if (line.includes(" from ")) foundFrom = true;
    if (foundFrom && braceDepth <= 0 && line.includes(";")) {
      endLine = i;
      break;
    }
    if (foundFrom && braceDepth <= 0 && i > beginLine) {
      endLine = i;
      break;
    }
    endLine = i;
  }
  const text = lines.slice(beginLine, endLine + 1).join("\n");
  const startCol = lines[beginLine].search(/\S/) + 1;
  return {
    startLine: beginLine + 1,
    startCol: startCol || 1,
    endLine: endLine + 1,
    endCol: lines[endLine].length + 1,
    text
  };
}

// src/render/imports.ts
var IMPORT_REGEX = /^import\s+(type\s+)?/;
function parseImports(source) {
  const lines = source.split("\n");
  const imports = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(IMPORT_REGEX);
    if (!match) {
      i++;
      continue;
    }
    const isType = match[1] !== void 0;
    let fullText = line;
    let endLine = i + 1;
    if (!line.includes(" from ")) {
      while (endLine < lines.length && !lines[endLine].includes(" from ")) {
        endLine++;
      }
      if (endLine < lines.length) {
        endLine++;
        fullText = lines.slice(i, endLine).join("\n");
      }
    }
    const importInfo = parseSingleImport(fullText, i + 1);
    if (importInfo) {
      importInfo.isType = isType;
      if (endLine > i + 1) {
        importInfo.endLine = endLine;
        importInfo.endCol = lines[endLine - 1].length + 1;
      }
      imports.push(importInfo);
    }
    i = endLine;
  }
  return imports;
}
function parseSingleImport(text, lineNum) {
  const trimmed = text.trim();
  const namespaceMatch = trimmed.match(/^import\s+(type\s+)?\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
  if (namespaceMatch) {
    const aliasName = namespaceMatch[2];
    return {
      kind: "namespace",
      names: [{ original: aliasName, alias: aliasName }],
      sourcePath: namespaceMatch[3],
      isType: false,
      startLine: lineNum,
      startCol: 1,
      endLine: lineNum,
      endCol: trimmed.length + 1,
      fullText: text
    };
  }
  const namedMatch = trimmed.match(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/);
  if (namedMatch) {
    const namesStr = namedMatch[2];
    const sourcePath = namedMatch[3];
    const names = namesStr.split(",").map((s) => {
      const part = s.trim();
      const asMatch = part.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        return { original: asMatch[1], alias: asMatch[2] };
      }
      return part ? { original: part, alias: part } : null;
    }).filter((n) => n !== null);
    return {
      kind: "named",
      names,
      sourcePath,
      isType: false,
      startLine: lineNum,
      startCol: 1,
      endLine: lineNum,
      endCol: trimmed.length + 1,
      fullText: text
    };
  }
  const defaultMatch = trimmed.match(/^import\s+(type\s+)?(\w+)\s+from\s+['"]([^'"]+)['"]/);
  if (defaultMatch && !trimmed.includes("{")) {
    return {
      kind: "default",
      names: [{ original: defaultMatch[2], alias: defaultMatch[2] }],
      sourcePath: defaultMatch[3],
      isType: false,
      startLine: lineNum,
      startCol: 1,
      endLine: lineNum,
      endCol: trimmed.length + 1,
      fullText: text
    };
  }
  const sideEffectMatch = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
  if (sideEffectMatch) {
    return {
      kind: "side-effect",
      names: [],
      sourcePath: sideEffectMatch[1],
      isType: false,
      startLine: lineNum,
      startCol: 1,
      endLine: lineNum,
      endCol: trimmed.length + 1,
      fullText: text
    };
  }
  return null;
}
function findImportInsertionPoint(source) {
  const lines = source.split("\n");
  let lastImportLine = -1;
  let firstCodeLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("//") || line === "") continue;
    if (IMPORT_REGEX.test(line)) {
      lastImportLine = i;
    } else if (firstCodeLine === -1 && !line.startsWith("//")) {
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
function formatNamedImport(names, sourcePath, isType) {
  const typePrefix = isType ? "type " : "";
  const nameParts = names.map((n) => n.alias !== n.original ? `${n.original} as ${n.alias}` : n.original);
  return `import ${typePrefix}{ ${nameParts.join(", ")} } from '${sourcePath}'`;
}

// src/render/strategies/remove-symbol.ts
function computeRemoveSymbolEdits(store, elementId, readFile) {
  const edits = [];
  const warnings = [];
  const elem = store.getElem(elementId);
  if (!elem) {
    warnings.push(`Element not found: ${elementId}`);
    return { edits, warnings };
  }
  if (elem.span && elem.kind !== "import") {
    const parsedSpan = parseSpan(elem.span);
    if (parsedSpan) {
      edits.push({
        filePath: elem.module ?? "",
        label: `remove declaration: ${elem.name}`,
        oldText: null,
        // Will be filled during localize
        newText: "",
        startLine: parsedSpan.startLine,
        startCol: 1,
        endLine: parsedSpan.endLine,
        endCol: parsedSpan.endCol
      });
    }
  }
  if (elem.kind === "import") {
    const source = readFile(elem.module ?? "");
    if (source && elem.span) {
      const parsedSpan = parseSpan(elem.span);
      if (parsedSpan) {
        const importRange = findImportStatement(source, parsedSpan.startLine);
        if (importRange) {
          edits.push({
            filePath: elem.module ?? "",
            label: `remove import: ${elem.name}`,
            oldText: importRange.text,
            newText: "",
            startLine: importRange.startLine,
            startCol: importRange.startCol,
            endLine: importRange.endLine,
            endCol: importRange.endCol
          });
        }
      }
    }
  }
  if (elem.module && elem.kind !== "import") {
    const source = readFile(elem.module);
    if (source) {
      const fileElem = store.getElem(`file:${elem.module}`);
      if (fileElem) {
        const contained = store.outgoing(fileElem.id).filter((a) => a.kind === "contains").map((a) => store.getElem(a.dstId)).filter((e) => e !== null && e.kind === "import");
        for (const imp of contained) {
          if (imp.name === elem.name || imp.id === elementId) continue;
          const incoming2 = store.incoming(imp.id);
          const importsFrom = incoming2.filter((a) => a.kind === "imports");
        }
      }
    }
  }
  const incoming = store.incoming(elementId);
  const callers = incoming.filter((a) => a.kind === "callerOf" || a.kind === "calleeOf").map((a) => {
    const otherId = a.srcId === elementId ? a.dstId : a.srcId;
    return store.getElem(otherId);
  }).filter((e) => e !== null);
  for (const caller of callers) {
    warnings.push(
      `Call site in ${caller.module ?? "unknown"} will break: element "${caller.name}" references "${elem.name}"`
    );
  }
  return { edits, warnings };
}

// src/render/paths.ts
import { dirname as dirname2, relative as relative2 } from "path";
function computeRelativeImportPath(fromFile, toModule) {
  const fromDir = dirname2(fromFile);
  let rel = relative2(fromDir, toModule);
  if (!rel.startsWith(".")) {
    rel = "./" + rel;
  }
  return rel.replace(/\\/g, "/");
}
function filePathToModule(filePath) {
  return filePath.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "");
}
function moduleToFilePath(moduleId) {
  if (/\.\w+$/.test(moduleId)) return moduleId;
  return moduleId + ".ts";
}

// src/render/strategies/add-symbol.ts
var STUB_TEMPLATES = {
  function: (name) => `export function ${name}() {
  // TODO: implement
}
`,
  method: (name) => `${name}() {
    // TODO: implement
  }
`,
  class: (name) => `export class ${name} {
  // TODO: implement
}
`,
  interface: (name) => `export interface ${name} {
  // TODO: define properties
}
`,
  type: (name) => `export type ${name} = unknown;
`,
  enum: (name) => `export enum ${name} {
  // TODO: add members
}
`,
  const: (name) => `export const ${name} = undefined;
`,
  var: (name) => `export var ${name}: unknown;
`
};
var CLJ_STUB_TEMPLATES = {
  function: (name) => `(defn ${name}
  []
  ;; TODO: implement
  )
`,
  method: (name) => `(defn ${name}
  [this]
  ;; TODO: implement
  )
`,
  class: (name) => `(defrecord ${name} []
  ;; TODO: add protocol implementations
  )
`,
  interface: (name) => `(defprotocol ${name}
  ;; TODO: define methods
  )
`,
  type: (name) => `(defrecord ${name} [])
`,
  const: (name) => `(def ${name} nil)
`,
  var: (name) => `(def ^:dynamic *${name}* nil)
`
};
function isClojureFile(path) {
  return /\.(clj|cljs|cljc)$/.test(path);
}
function computeAddSymbolEdits(store, module, name, symbolKind, readFile) {
  const edits = [];
  const warnings = [];
  const clojure = isClojureFile(module);
  const templates = clojure ? CLJ_STUB_TEMPLATES : STUB_TEMPLATES;
  const templateFn = templates[symbolKind];
  if (!templateFn) {
    warnings.push(`Unknown symbol kind: ${symbolKind}. No stub template available.`);
    return { edits, warnings };
  }
  const stubText = templateFn(name);
  const source = readFile(module);
  if (source === null) {
    edits.push({
      filePath: module,
      label: `create file and add symbol: ${name}`,
      oldText: null,
      newText: stubText,
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 1
    });
  } else {
    let insertLine;
    if (clojure) {
      const lines = source.split("\n");
      let lastNonEmpty = lines.length - 1;
      while (lastNonEmpty > 0 && lines[lastNonEmpty].trim() === "") lastNonEmpty--;
      insertLine = lastNonEmpty + 1;
    } else {
      insertLine = findImportInsertionPoint(source);
    }
    edits.push({
      filePath: module,
      label: `add symbol: ${symbolKind} ${name}`,
      oldText: null,
      newText: "\n" + stubText,
      startLine: insertLine + 1,
      startCol: 1,
      endLine: insertLine + 1,
      endCol: 1
    });
  }
  return { edits, warnings };
}

// src/render/strategies/move.ts
function computeMoveEdits(store, elementId, newModule, readFile) {
  const edits = [];
  const warnings = [];
  const elem = store.getElem(elementId);
  if (!elem) {
    warnings.push(`Element not found: ${elementId}`);
    return { edits, warnings };
  }
  if (!elem.span || !elem.module) {
    warnings.push(`Element ${elementId} has no span or module`);
    return { edits, warnings };
  }
  const sourceModule = elem.module;
  const sourceContent = readFile(sourceModule);
  if (!sourceContent) {
    warnings.push(`Cannot read source file: ${sourceModule}`);
    return { edits, warnings };
  }
  const parsedSpan = parseSpan(elem.span);
  if (!parsedSpan) {
    warnings.push(`Cannot parse span: ${elem.span}`);
    return { edits, warnings };
  }
  const registry = getDefaultRegistry();
  if (!registry) {
    warnings.push(`No language adapter registry available for ${sourceModule}`);
    return { edits, warnings };
  }
  const declarationRange = findEnclosingDeclaration(
    sourceContent,
    sourceModule,
    parsedSpan.startLine,
    parsedSpan.startCol,
    elem.kind,
    registry
  );
  if (!declarationRange) {
    warnings.push(`Cannot find enclosing declaration for ${elem.name} in ${sourceModule}`);
    return { edits, warnings };
  }
  let declarationText = declarationRange.text;
  const oldModulePath = filePathToModule(sourceModule);
  const newModulePath = filePathToModule(newModule);
  const declImports = parseImports(declarationText);
  for (const imp of declImports) {
    if (imp.sourcePath.startsWith(".")) {
      const oldPath = imp.sourcePath;
      const targetModule = filePathToModule(imp.sourcePath.replace(/^\.\//, ""));
      const newPath = computeRelativeImportPath(newModule, imp.sourcePath);
      warnings.push(`Move may require updating import path: "${oldPath}" in moved declaration`);
    }
  }
  edits.push({
    filePath: sourceModule,
    label: `remove declaration: ${elem.name} from ${sourceModule}`,
    oldText: declarationText,
    newText: "",
    startLine: declarationRange.startLine,
    startCol: declarationRange.startCol,
    endLine: declarationRange.endLine,
    endCol: declarationRange.endCol
  });
  const targetContent = readFile(newModule);
  if (targetContent) {
    const insertLine = findImportInsertionPoint(targetContent);
    edits.push({
      filePath: newModule,
      label: `add declaration: ${elem.name} to ${newModule}`,
      oldText: null,
      newText: "\n" + declarationText + "\n",
      startLine: insertLine + 1,
      startCol: 1,
      endLine: insertLine + 1,
      endCol: 1
    });
    const targetImports = parseImports(targetContent);
    const importPath = computeRelativeImportPath(newModule, oldModulePath);
    const alreadyImports = targetImports.some((imp) => imp.sourcePath === importPath);
    if (!alreadyImports && declarationRange.text.includes("import ")) {
    }
  } else {
    edits.push({
      filePath: newModule,
      label: `create file and add declaration: ${elem.name}`,
      oldText: null,
      newText: declarationText + "\n",
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 1
    });
  }
  const importElements = store.queryElements({
    nameRegex: `^${elem.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    kind: "import",
    limit: 500
  });
  for (const imp of importElements) {
    if (imp.module === sourceModule || imp.module === newModule) continue;
    const impContent = readFile(imp.module ?? "");
    if (!impContent) continue;
    const fileImports = parseImports(impContent);
    for (const fileImp of fileImports) {
      if (fileImp.sourcePath.endsWith(filePathToModule(sourceModule).replace(/^\.\//, "")) || fileImp.sourcePath === computeRelativeImportPath(imp.module ?? "", filePathToModule(sourceModule))) {
        const newImportPath = computeRelativeImportPath(imp.module ?? "", filePathToModule(newModule));
        const newImportText = formatNamedImport(fileImp.names, newImportPath, fileImp.isType);
        edits.push({
          filePath: imp.module ?? "",
          label: `update import path: ${fileImp.sourcePath} \u2192 ${newImportPath}`,
          oldText: fileImp.fullText.trim(),
          newText: newImportText,
          startLine: fileImp.startLine,
          startCol: fileImp.startCol,
          endLine: fileImp.endLine,
          endCol: fileImp.endCol
        });
      }
    }
  }
  return { edits, warnings };
}

// src/render/expand.ts
function expandOperation(store, operation, readFile) {
  switch (operation.kind) {
    case "rename":
      return computeRenameEdits(store, operation.target, operation.newName, readFile);
    case "move":
      return computeMoveEdits(store, operation.target, operation.newModule, readFile);
    case "addSymbol":
      return computeAddSymbolEdits(store, operation.module, operation.name, operation.symbolKind, readFile);
    case "removeSymbol":
      return computeRemoveSymbolEdits(store, operation.target, readFile);
    case "addArrow": {
      return { edits: [], warnings: [`addArrow: ${operation.arrowKind} arrows do not currently affect source files`] };
    }
    case "removeArrow": {
      return { edits: [], warnings: [`removeArrow: arrow removal does not currently affect source files`] };
    }
    default:
      return { edits: [], warnings: [`Unknown operation kind: ${operation.kind}`] };
  }
}
function expandAllOperations(store, operations, readFile) {
  const allEdits = [];
  const allWarnings = [];
  for (const op of operations) {
    const result = expandOperation(store, op, readFile);
    allEdits.push(...result.edits);
    allWarnings.push(...result.warnings);
  }
  return { edits: allEdits, warnings: allWarnings };
}

// src/render/order.ts
function orderAndDetectConflicts(edits) {
  const conflicts = [];
  const byFile = /* @__PURE__ */ new Map();
  for (const edit of edits) {
    const arr = byFile.get(edit.filePath) ?? [];
    arr.push(edit);
    byFile.set(edit.filePath, arr);
  }
  for (const [, fileEdits] of byFile) {
    for (let i = 0; i < fileEdits.length; i++) {
      for (let j = i + 1; j < fileEdits.length; j++) {
        const a = fileEdits[i];
        const b = fileEdits[j];
        if (rangesOverlap(a, b)) {
          conflicts.push({
            edit1: a,
            edit2: b,
            message: `Overlapping edits at ${a.filePath}:${a.startLine}:${a.startCol} and ${b.filePath}:${b.startLine}:${b.startCol}`
          });
        }
      }
    }
  }
  const ordered = [...edits].sort((a, b) => {
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    if (a.startLine !== b.startLine) return b.startLine - a.startLine;
    return b.startCol - a.startCol;
  });
  return { ordered, conflicts };
}
function rangesOverlap(a, b) {
  if (a.filePath !== b.filePath) return false;
  const aStart = a.startLine * 1e4 + a.startCol;
  const aEnd = a.endLine * 1e4 + a.endCol;
  const bStart = b.startLine * 1e4 + b.startCol;
  const bEnd = b.endLine * 1e4 + b.endCol;
  return aStart < bEnd && bStart < aEnd;
}

// src/render/index.ts
function renderPlan(store, operations, projectRoot) {
  const readFile = (filePath) => {
    try {
      return readFileSync4(join2(projectRoot, filePath), "utf8");
    } catch {
      return null;
    }
  };
  const { edits, warnings } = expandAllOperations(store, operations, readFile);
  const { ordered, conflicts } = orderAndDetectConflicts(edits);
  const conflictEditIds = /* @__PURE__ */ new Set();
  for (const conflict of conflicts) {
    conflictEditIds.add(`${conflict.edit1.filePath}:${conflict.edit1.startLine}:${conflict.edit1.startCol}`);
    conflictEditIds.add(`${conflict.edit2.filePath}:${conflict.edit2.startLine}:${conflict.edit2.startCol}`);
  }
  const safeEdits = conflicts.length > 0 ? ordered.filter((e) => !conflictEditIds.has(`${e.filePath}:${e.startLine}:${e.startCol}`)) : ordered;
  const affectedFiles = [...new Set(safeEdits.map((e) => e.filePath))];
  return {
    edits: safeEdits,
    warnings,
    conflicts,
    affectedFiles
  };
}
async function renderAndApplyPlan(store, operations, projectRoot, reingestFn) {
  const renderResult = renderPlan(store, operations, projectRoot);
  if (renderResult.edits.length === 0) {
    return {
      ...renderResult,
      applyResult: null,
      verificationDiscrepancies: []
    };
  }
  let applyResult;
  try {
    applyResult = await applySourceEdits(renderResult.edits, projectRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    renderResult.warnings.push(`Failed to apply edits: ${msg}`);
    return {
      ...renderResult,
      applyResult: null,
      verificationDiscrepancies: [msg]
    };
  }
  let verificationDiscrepancies = [];
  if (reingestFn) {
    try {
      reingestFn(projectRoot, store);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      verificationDiscrepancies.push(`Re-ingestion failed: ${msg}`);
    }
    for (const op of operations) {
      verificationDiscrepancies.push(...verifyOperation(store, op));
    }
  }
  return {
    ...renderResult,
    applyResult,
    verificationDiscrepancies
  };
}
function verifyOperation(store, op) {
  const discrepancies = [];
  switch (op.kind) {
    case "rename": {
      const elem = store.getElem(op.target);
      if (elem && elem.name !== op.newName) {
        discrepancies.push(`rename: expected name "${op.newName}", got "${elem.name}"`);
      }
      break;
    }
    case "move": {
      const elem = store.getElem(op.target);
      if (elem && elem.module !== op.newModule) {
        discrepancies.push(`move: expected module "${op.newModule}", got "${elem.module}"`);
      }
      break;
    }
    case "addSymbol": {
      const found = store.queryElements({
        kind: op.symbolKind,
        nameRegex: `^${op.name}$`,
        moduleRegex: `^${op.module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        limit: 1
      });
      if (found.length === 0) {
        discrepancies.push(`addSymbol: "${op.name}" not found in "${op.module}" after render`);
      }
      break;
    }
    case "removeSymbol": {
      const elem = store.getElem(op.target);
      if (elem) {
        discrepancies.push(`removeSymbol: "${op.target}" still exists after render`);
      }
      break;
    }
  }
  return discrepancies;
}

// src/delegate/context.ts
function gatherMustCall(store, targetId) {
  const outgoing = store.outgoing(targetId);
  const callerOfArrows = outgoing.filter((a) => a.kind === "callerOf");
  const callees = [];
  for (const arrow of callerOfArrows) {
    const callee = store.getElem(arrow.dstId);
    if (callee) {
      callees.push({
        id: callee.id,
        name: callee.name,
        kind: callee.kind,
        module: callee.module,
        span: callee.span,
        attrs: callee.attrs
      });
    }
  }
  return callees;
}
function gatherMustImplement(store, targetId) {
  const outgoing = store.outgoing(targetId);
  const implementsArrows = outgoing.filter((a) => a.kind === "implements");
  const interfaces = [];
  for (const arrow of implementsArrows) {
    const iface = store.getElem(arrow.dstId);
    if (iface) {
      interfaces.push({
        id: iface.id,
        name: iface.name,
        kind: iface.kind,
        module: iface.module,
        span: iface.span
      });
    }
  }
  const incoming = store.incoming(targetId);
  const implementsIncoming = incoming.filter((a) => a.kind === "implements");
  for (const arrow of implementsIncoming) {
    const iface = store.getElem(arrow.srcId);
    if (iface) {
      interfaces.push({
        id: iface.id,
        name: iface.name,
        kind: iface.kind,
        module: iface.module,
        span: iface.span
      });
    }
  }
  return interfaces;
}
function gatherUsedBy(store, targetId) {
  const incoming = store.incoming(targetId);
  const callerOfArrows = incoming.filter((a) => a.kind === "callerOf");
  const callers = [];
  const seen = /* @__PURE__ */ new Set();
  for (const arrow of callerOfArrows) {
    const caller = store.getElem(arrow.srcId);
    if (caller && !seen.has(caller.id)) {
      seen.add(caller.id);
      callers.push({
        id: caller.id,
        name: caller.name,
        kind: caller.kind,
        module: caller.module,
        span: caller.span
      });
    }
  }
  return callers;
}
function gatherImports(store, targetModule) {
  const imports = [];
  const moduleElems = store.queryElements({
    kind: "import",
    moduleRegex: `^${escapeRegex2(targetModule)}$`,
    limit: 200
  });
  for (const imp of moduleElems) {
    const outgoing = store.outgoing(imp.id);
    const importsFromArrow = outgoing.find((a) => a.kind === "importsFrom");
    imports.push({
      name: imp.name,
      sourceModule: importsFromArrow ? importsFromArrow.attrs?.sourceModule ?? null : null,
      targetModule: imp.module,
      ...imp.attrs && imp.attrs.rawRequire ? { rawText: imp.attrs.rawRequire } : {}
    });
  }
  return imports;
}
function getModuleElement(store, modulePath) {
  const results = store.queryElements({
    kind: "module",
    nameRegex: `^${escapeRegex2(modulePath)}$`,
    limit: 1
  });
  return results[0] ?? null;
}
function getModuleFilePath(store, modulePath) {
  const modElem = getModuleElement(store, modulePath);
  if (!modElem) return null;
  const outgoing = store.outgoing(modElem.id);
  const locatedIn = outgoing.find((a) => a.kind === "locatedIn");
  if (locatedIn) {
    const fileElem = store.getElem(locatedIn.dstId);
    if (fileElem) return fileElem.name;
  }
  return modulePath;
}
function gatherDomainContext(store, targetId) {
  const ownConcepts = [];
  for (const arrow of store.incoming(targetId)) {
    if (arrow.kind !== "implementedAs") continue;
    const domainElem = store.getElem(arrow.srcId);
    if (!domainElem || domainElem.kind !== "domain") continue;
    const domainArrows = [];
    for (const a of store.outgoing(domainElem.id)) {
      if (a.kind === "implementedAs") continue;
      const peer = store.getElem(a.dstId);
      if (peer) domainArrows.push({ name: a.kind, direction: "outgoing", peerName: peer.name });
    }
    for (const a of store.incoming(domainElem.id)) {
      if (a.kind === "implementedAs") continue;
      const peer = store.getElem(a.srcId);
      if (peer && peer.kind === "domain") domainArrows.push({ name: a.kind, direction: "incoming", peerName: peer.name });
    }
    ownConcepts.push({ id: domainElem.id, name: domainElem.name, arrows: domainArrows });
  }
  const neighborConcepts = [];
  const seen = /* @__PURE__ */ new Set();
  const addNeighbor = (codeElemId, codeElemName, via) => {
    for (const a of store.incoming(codeElemId)) {
      if (a.kind !== "implementedAs") continue;
      const domainElem = store.getElem(a.srcId);
      if (!domainElem || domainElem.kind !== "domain") continue;
      const key = `${via}:${domainElem.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        neighborConcepts.push({ name: domainElem.name, via, codeElementName: codeElemName });
      }
    }
  };
  for (const a of store.incoming(targetId)) {
    if (a.kind !== "callerOf") continue;
    const caller = store.getElem(a.srcId);
    if (caller) addNeighbor(caller.id, caller.name, "caller");
  }
  for (const a of store.outgoing(targetId)) {
    if (a.kind !== "callerOf") continue;
    const callee = store.getElem(a.dstId);
    if (callee) addNeighbor(callee.id, callee.name, "callee");
  }
  if (ownConcepts.length === 0 && neighborConcepts.length === 0) return null;
  return { ownConcepts, neighborConcepts };
}
function escapeRegex2(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/delegate/resolve.ts
import { readFileSync as readFileSync5 } from "fs";
import { join as join3 } from "path";
var SourceResolver = class {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }
  projectRoot;
  fileCache = /* @__PURE__ */ new Map();
  readSpan(filePath, span) {
    const parsed = parseSpan2(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    const lines = source.split("\n");
    const start = Math.max(0, parsed.startLine - 1);
    const end = Math.min(lines.length, parsed.endLine);
    return lines.slice(start, end).join("\n");
  }
  readContext(filePath, span, contextLines = 2) {
    const parsed = parseSpan2(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    const lines = source.split("\n");
    const start = Math.max(0, parsed.startLine - 1 - contextLines);
    const end = Math.min(lines.length, parsed.endLine + contextLines);
    return lines.slice(start, end).join("\n");
  }
  readDeclaration(filePath, span, kind) {
    const parsed = parseSpan2(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    if (kind === "import") {
      const range2 = findImportStatement(source, parsed.startLine);
      return range2?.text ?? null;
    }
    const registry = getDefaultRegistry();
    if (!registry) return null;
    const range = findEnclosingDeclaration(
      source,
      filePath,
      parsed.startLine,
      parsed.startCol,
      kind,
      registry
    );
    return range?.text ?? null;
  }
  readSignature(filePath, span, kind) {
    const declaration = this.readDeclaration(filePath, span, kind);
    if (!declaration) return null;
    const firstBrace = declaration.indexOf("{");
    const firstSemicolon = declaration.indexOf(";");
    if (firstBrace >= 0 && (firstSemicolon < 0 || firstBrace < firstSemicolon)) {
      return declaration.slice(0, firstBrace).trim();
    }
    if (firstSemicolon >= 0) {
      return declaration.slice(0, firstSemicolon + 1).trim();
    }
    const firstNewline = declaration.indexOf("\n");
    if (firstNewline >= 0) {
      return declaration.slice(0, firstNewline).trim();
    }
    return declaration.trim();
  }
  readBody(filePath, span, kind, maxLines = 50) {
    const declaration = this.readDeclaration(filePath, span, kind);
    if (!declaration) return null;
    const firstBrace = declaration.indexOf("{");
    if (firstBrace < 0) return null;
    const body = declaration.slice(firstBrace);
    const lines = body.split("\n");
    if (lines.length <= maxLines) return body;
    return lines.slice(0, maxLines).join("\n") + "\n  // ... (truncated)";
  }
  readImportBlock(filePath) {
    const source = this.readFile(filePath);
    if (source === null) return [];
    const imports = parseImports(source);
    return imports.map((imp) => imp.fullText.trim());
  }
  computeImportStatement(symbolName, symbolModule, targetModule) {
    const fromFile = moduleToFilePath(targetModule);
    const relativePath = computeRelativeImportPath(fromFile, symbolModule);
    return `import { ${symbolName} } from '${relativePath}'`;
  }
  readFileContent(filePath, maxLines = 500) {
    const content = this.readFile(filePath);
    if (content === null) return null;
    const lines = content.split("\n");
    if (lines.length <= maxLines) return content;
    return lines.slice(0, maxLines).join("\n") + "\n// ... (truncated)";
  }
  /**
   * Read a window of source focused on a span: contextBefore lines above the
   * start of the span and contextAfter lines below the end, with an omission
   * comment if the file has content before the window.
   */
  readFocused(filePath, span, contextBefore = 25, contextAfter = 10) {
    const parsed = parseSpan2(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    const lines = source.split("\n");
    const start = Math.max(0, parsed.startLine - 1 - contextBefore);
    const end = Math.min(lines.length, parsed.endLine + contextAfter);
    const prefix = start > 0 ? `; ... (lines 1\u2013${start} omitted)
` : "";
    return prefix + lines.slice(start, end).join("\n");
  }
  readFile(filePath) {
    const cached = this.fileCache.get(filePath);
    if (cached !== void 0) return cached;
    try {
      const content = readFileSync5(join3(this.projectRoot, filePath), "utf8");
      this.fileCache.set(filePath, content);
      return content;
    } catch {
      this.fileCache.set(filePath, null);
      return null;
    }
  }
};
function parseSpan2(span) {
  const m = span.match(/(\d+):(\d+)-(\d+):(\d+)$/);
  if (!m) return null;
  return {
    startLine: parseInt(m[1], 10),
    startCol: parseInt(m[2], 10),
    endLine: parseInt(m[3], 10),
    endCol: parseInt(m[4], 10)
  };
}
function filePathFromSpan(span) {
  const m = span.match(/^(.+):\d+:\d+-\d+:\d+$/);
  return m ? m[1] : null;
}

// src/delegate/analogues.ts
function findAnalogues(store, target, limit = 3) {
  const targetCallees = getCalleeSet(store, target);
  const candidates = store.queryElements({
    kind: target.kind,
    limit: 200
  });
  const scored = [];
  for (const candidate of candidates) {
    if (candidate.id === target.id) continue;
    if (candidate.module === target.module) continue;
    const candidateCallees = getCalleeSet(store, candidate);
    const intersectionSize = countIntersection(targetCallees, candidateCallees);
    const unionSize = targetCallees.size + candidateCallees.size - intersectionSize;
    const calleeSimilarity = unionSize === 0 ? 0 : intersectionSize / unionSize;
    const nameSimilarity = candidate.name === target.name ? 0.5 : 0;
    const similarity = Math.max(calleeSimilarity, nameSimilarity);
    if (similarity > 0) {
      scored.push({
        id: candidate.id,
        name: candidate.name,
        kind: candidate.kind,
        module: candidate.module,
        span: candidate.span,
        similarity
      });
    }
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}
function getCalleeSet(store, elem) {
  const result = /* @__PURE__ */ new Set();
  const outgoing = store.outgoing(elem.id);
  for (const arrow of outgoing) {
    if (arrow.kind === "callerOf" || arrow.kind === "calls") {
      result.add(arrow.dstId);
    }
  }
  return result;
}
function countIntersection(a, b) {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count++;
  }
  return count;
}

// src/delegate/index.ts
var TASK_CRITERIA = {
  write_function_body: [
    "Must compile without type errors.",
    "Must call every function listed in mustCall.",
    "Must return a value matching the signature.",
    "Must not change the function signature or exports.",
    "Must follow the coding patterns in the provided analogues."
  ],
  write_test: [
    "Must compile.",
    "Must import the target function.",
    "Must have at least one test case for each mustCall function.",
    "Must follow the test framework patterns in the analogues.",
    "Must be in a .test.ts or .spec.ts file."
  ],
  write_migration: [
    "Must compile.",
    "Must be idempotent (safe to run twice).",
    "Must use the project's database client (see analogues).",
    "Must include both up and down migrations if the framework requires it."
  ],
  rewrite_body: [
    "Must compile.",
    "Must preserve the existing signature and exports.",
    "Must call every function in mustCall.",
    "Must not introduce new dependencies not listed in the acceptance criteria.",
    "Must be strictly better than the current body per the criteria."
  ],
  write_documentation: [
    "Must be valid JSDoc/TSDoc.",
    "Must document all parameters.",
    "Must include @returns with type.",
    "Must include at least one @example if any analogue has examples.",
    "Must describe thrown errors."
  ]
};
function assembleBrief(store, projectRoot, task, targetId, overrides, maxAnalogues = 3, snippetLines = 50, extraCriteria) {
  const target = store.getElem(targetId);
  if (!target) {
    return { ok: false, error: `Element not found: ${targetId}` };
  }
  const targetModule = target.module;
  if (!targetModule) {
    return { ok: false, error: `Element has no module: ${targetId}` };
  }
  const resolver = new SourceResolver(projectRoot);
  const filePath = getModuleFilePath(store, targetModule) ?? localModuleToFilePath(targetModule);
  const targetSignature = resolver.readSignature(filePath, target.span ?? "", target.kind) ?? target.name;
  const targetDeclaration = resolver.readDeclaration(filePath, target.span ?? "", target.kind) ?? "";
  const bodyPlaceholder = extractBodyPlaceholder(targetDeclaration);
  const parsedSpan = target.span ? parseSpanSimple(target.span) : null;
  const mustCallEntries = overrides?.mustCall ? resolveElementList(store, overrides.mustCall) : gatherMustCall(store, targetId);
  const mustImplementEntries = overrides?.mustImplement ? resolveElementList(store, overrides.mustImplement) : gatherMustImplement(store, targetId);
  const usedByEntries = gatherUsedBy(store, targetId);
  const importEntries = gatherImports(store, targetModule);
  const analogueCandidates = overrides?.analogues ? resolveAnalogueList(store, overrides.analogues) : findAnalogues(store, target, maxAnalogues);
  const resolvedMustCall = mustCallEntries.map((entry) => {
    const entryFilePath = getModuleFilePath(store, entry.module ?? "") ?? localModuleToFilePath(entry.module ?? "");
    const calleeCallees = getDirectCallees(store, entry.id).slice(0, 5).flatMap((tc) => {
      const tcFilePath = getModuleFilePath(store, tc.module ?? "") ?? localModuleToFilePath(tc.module ?? "");
      const snippet = resolver.readBody(tcFilePath, tc.span ?? "", tc.kind, Math.ceil(snippetLines / 2)) ?? "";
      if (!snippet) return [];
      return [{ name: tc.name, module: tc.module ?? "", snippet }];
    });
    return {
      name: entry.name,
      signature: resolver.readSignature(entryFilePath, entry.span ?? "", entry.kind) ?? entry.name,
      importStatement: resolver.computeImportStatement(entry.name, entry.module ?? "", targetModule),
      calleeBodySnippet: resolver.readBody(entryFilePath, entry.span ?? "", entry.kind, snippetLines) ?? "",
      calleeCallees
    };
  });
  const resolvedMustImplement = mustImplementEntries.map((entry) => {
    const entryFilePath = getModuleFilePath(store, entry.module ?? "") ?? localModuleToFilePath(entry.module ?? "");
    return {
      name: entry.name,
      fullDeclaration: resolver.readDeclaration(entryFilePath, entry.span ?? "", entry.kind) ?? entry.name,
      importStatement: resolver.computeImportStatement(entry.name, entry.module ?? "", targetModule)
    };
  });
  const resolvedUsedBy = usedByEntries.map((entry) => {
    const entryFilePath = getModuleFilePath(store, entry.module ?? "") ?? localModuleToFilePath(entry.module ?? "");
    const callSiteSnippet = entry.span ? resolver.readSpan(entryFilePath, entry.span) ?? "" : "";
    return { name: entry.name, callSiteSnippet };
  });
  const resolvedImports = importEntries.map((imp) => {
    if (imp.rawText) return imp.rawText;
    if (imp.sourceModule) return `import { ${imp.name} } from '${imp.sourceModule}'`;
    return `import { ${imp.name} } from '...'`;
  });
  const importedModuleSuffixes = new Set(
    importEntries.map((imp) => imp.sourceModule).filter((m) => !!m)
  );
  const missingImports = mustCallEntries.filter((entry) => {
    if (!entry.module || entry.module === targetModule) return false;
    return ![...importedModuleSuffixes].some(
      (im) => im === entry.module || entry.module.endsWith(im) || im.endsWith(entry.module.split("/").pop() ?? "")
    );
  }).map((entry) => {
    const entryFilePath = getModuleFilePath(store, entry.module ?? "") ?? localModuleToFilePath(entry.module ?? "");
    return {
      name: entry.name,
      module: entry.module ?? "",
      suggestedImport: resolver.computeImportStatement(entry.name, entry.module ?? "", targetModule)
    };
  });
  const resolvedAnalogues = analogueCandidates.map((candidate) => {
    const candidateFilePath = getModuleFilePath(store, candidate.module ?? "") ?? localModuleToFilePath(candidate.module ?? "");
    const analogueCallees = getCalleeNames(store, candidate.id);
    return {
      name: candidate.name,
      similarity: candidate.similarity,
      fullSource: resolver.readDeclaration(candidateFilePath, candidate.span ?? "", candidate.kind) ?? "",
      callees: analogueCallees,
      modulePath: candidate.module ?? ""
    };
  });
  const targetFileContent = target.span ? resolver.readFocused(filePath, target.span, 30, 15) ?? resolver.readFileContent(filePath, 500) ?? "" : resolver.readFileContent(filePath, 500) ?? "";
  const domainContext = gatherDomainContext(store, targetId);
  const defaultCriteria = TASK_CRITERIA[task] ?? [];
  const acceptanceCriteria = [...defaultCriteria, ...extraCriteria ?? []];
  const commitSha = store.commitSha();
  const provenanceConfidence = determineConfidence(store, targetId);
  return {
    task,
    target: {
      id: target.id,
      name: target.name,
      kind: target.kind,
      module: targetModule,
      signature: targetSignature,
      bodyPlaceholder,
      filePath,
      lineRange: parsedSpan ?? { start: 1, end: 1 }
    },
    mustCall: resolvedMustCall,
    mustImplement: resolvedMustImplement,
    usedBy: resolvedUsedBy,
    importsInTargetFile: resolvedImports.length > 0 ? resolvedImports : resolver.readImportBlock(filePath),
    analogues: resolvedAnalogues,
    targetFileContent,
    domainContext,
    missingImports,
    acceptanceCriteria,
    provenance: {
      ologCommitSha: commitSha,
      confidence: provenanceConfidence,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  };
}
function extractBodyPlaceholder(declaration) {
  const firstBrace = declaration.indexOf("{");
  if (firstBrace < 0) return "";
  const lastBrace = declaration.lastIndexOf("}");
  if (lastBrace < 0) return declaration.slice(firstBrace);
  return declaration.slice(firstBrace, lastBrace + 1);
}
function resolveElementList(store, ids) {
  const results = [];
  for (const id of ids) {
    const elem = store.getElem(id);
    if (elem) {
      results.push({
        id: elem.id,
        name: elem.name,
        kind: elem.kind,
        module: elem.module,
        span: elem.span,
        attrs: elem.attrs
      });
    }
  }
  return results;
}
function resolveAnalogueList(store, ids) {
  const results = [];
  for (const id of ids) {
    const elem = store.getElem(id);
    if (elem) {
      results.push({
        id: elem.id,
        name: elem.name,
        kind: elem.kind,
        module: elem.module,
        span: elem.span,
        similarity: 1
        // manually overridden, max similarity
      });
    }
  }
  return results;
}
function getDirectCallees(store, elemId2) {
  const seen = /* @__PURE__ */ new Set();
  const results = [];
  for (const arrow of store.outgoing(elemId2)) {
    if (arrow.kind === "callerOf") {
      const callee = store.getElem(arrow.dstId);
      if (callee && !seen.has(callee.id)) {
        seen.add(callee.id);
        results.push({ id: callee.id, name: callee.name, kind: callee.kind, module: callee.module, span: callee.span });
      }
    }
  }
  return results;
}
function getCalleeNames(store, elemId2) {
  const names = [];
  const incoming = store.incoming(elemId2);
  const callerOfArrows = incoming.filter((a) => a.kind === "callerOf");
  for (const arrow of callerOfArrows) {
    const csOutgoing = store.outgoing(arrow.srcId);
    const calleeOfArrow = csOutgoing.find((a) => a.kind === "calleeOf");
    if (calleeOfArrow) {
      const callee = store.getElem(calleeOfArrow.dstId);
      if (callee) names.push(callee.name);
    }
  }
  return names;
}
function determineConfidence(store, targetId) {
  const prov = store.getProvenance(targetId);
  if (!prov) return "unresolved";
  if (prov.confidence === "resolved") return "resolved";
  return "mixed";
}
function localModuleToFilePath(modulePath) {
  if (/\.\w+$/.test(modulePath)) return modulePath;
  return modulePath + ".ts";
}
function parseSpanSimple(span) {
  const m = span.match(/(\d+):\d+-(\d+):\d+$/);
  if (!m) return null;
  return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
}

// src/mining/paths.ts
function getArrowKindsInUse(allArrowKinds, hasArrowKind) {
  return allArrowKinds.filter((k) => hasArrowKind(k));
}
function enumeratePaths(arrowKinds, maxDepth) {
  const paths = [];
  for (const kind of arrowKinds) {
    paths.push({
      arrows: [kind],
      domainKind: null,
      codomainKind: null
    });
  }
  let currentDepthPaths = paths.slice();
  for (let depth = 2; depth <= maxDepth; depth++) {
    const nextDepthPaths = [];
    for (const existingPath of currentDepthPaths) {
      for (const kind of arrowKinds) {
        const lastArrow = existingPath.arrows[existingPath.arrows.length - 1];
        if (kind === lastArrow) continue;
        nextDepthPaths.push({
          arrows: [...existingPath.arrows, kind],
          domainKind: null,
          codomainKind: null
        });
      }
    }
    paths.push(...nextDepthPaths);
    currentDepthPaths = nextDepthPaths;
    if (paths.length > 1e4) break;
  }
  return paths;
}

// src/mining/candidates.ts
function annotatePathKinds(paths, store, elementKinds, sampleSize = 50) {
  const kindToIds = /* @__PURE__ */ new Map();
  for (const kind of elementKinds) {
    const elems = store.queryElements({ kind, limit: sampleSize });
    kindToIds.set(kind, elems.map((e) => e.id));
  }
  for (const path of paths) {
    const steps = path.arrows.map((kind) => ({
      kind,
      direction: "out"
    }));
    const domainKinds = [];
    const codomainKinds = /* @__PURE__ */ new Set();
    for (const [kind, ids] of kindToIds) {
      let anyReached = false;
      for (const id of ids) {
        const result = store.traverse({ startId: id, steps });
        if (result.elements.length > 0) {
          anyReached = true;
          for (const elem of result.elements) {
            codomainKinds.add(elem.kind);
          }
        }
      }
      if (anyReached) {
        domainKinds.push(kind);
      }
    }
    path.domainKind = domainKinds.length === 1 ? domainKinds[0] : null;
    path.codomainKind = codomainKinds.size > 0 ? Array.from(codomainKinds).sort().join(",") : null;
  }
  return paths;
}
function generateCandidatePairs(paths) {
  const pairs = [];
  const byDomain = /* @__PURE__ */ new Map();
  for (const path of paths) {
    if (!path.domainKind) continue;
    const existing = byDomain.get(path.domainKind) ?? [];
    existing.push(path);
    byDomain.set(path.domainKind, existing);
  }
  for (const [, domainPaths] of byDomain) {
    for (let i = 0; i < domainPaths.length; i++) {
      for (let j = i + 1; j < domainPaths.length; j++) {
        const lhs = domainPaths[i];
        const rhs = domainPaths[j];
        if (arrowsEqual(lhs.arrows, rhs.arrows)) continue;
        if (!lhs.codomainKind || !rhs.codomainKind) continue;
        const lhsCodomains = new Set(lhs.codomainKind.split(","));
        const rhsCodomains = new Set(rhs.codomainKind.split(","));
        const overlap = [...lhsCodomains].some((k) => rhsCodomains.has(k));
        if (!overlap) continue;
        pairs.push({
          lhs: [...lhs.arrows],
          rhs: [...rhs.arrows]
        });
      }
    }
  }
  const nullDomainPaths = paths.filter((p) => !p.domainKind);
  for (let i = 0; i < nullDomainPaths.length; i++) {
    for (let j = i + 1; j < nullDomainPaths.length; j++) {
      const lhs = nullDomainPaths[i];
      const rhs = nullDomainPaths[j];
      if (arrowsEqual(lhs.arrows, rhs.arrows)) continue;
      if (!lhs.codomainKind || !rhs.codomainKind) continue;
      const lhsCodomains = new Set(lhs.codomainKind.split(","));
      const rhsCodomains = new Set(rhs.codomainKind.split(","));
      const overlap = [...lhsCodomains].some((k) => rhsCodomains.has(k));
      if (!overlap) continue;
      pairs.push({
        lhs: [...lhs.arrows],
        rhs: [...rhs.arrows]
      });
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const pair of pairs) {
    const key = canonicalKey(pair.lhs, pair.rhs);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(pair);
    }
  }
  return deduped;
}
function arrowsEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
function canonicalKey(lhs, rhs) {
  const lhsKey = lhs.join("\u2192");
  const rhsKey = rhs.join("\u2192");
  if (lhsKey <= rhsKey) {
    return `${lhsKey}\u2261${rhsKey}`;
  }
  return `${rhsKey}\u2261${lhsKey}`;
}

// src/mining/evaluate.ts
function evaluateEquationCandidate(store, lhsPath, rhsPath, seedElements, maxCounterexamples = 5) {
  let support = 0;
  let total = 0;
  const counterexamples = [];
  const lhsSteps = lhsPath.map((kind) => ({
    kind,
    direction: "out"
  }));
  const rhsSteps = rhsPath.map((kind) => ({
    kind,
    direction: "out"
  }));
  const kindCounts = /* @__PURE__ */ new Map();
  for (const elem of seedElements) {
    kindCounts.set(elem.kind, (kindCounts.get(elem.kind) ?? 0) + 1);
  }
  let domainKind = "any";
  let maxCount = 0;
  for (const [kind, count] of kindCounts) {
    if (count > maxCount) {
      maxCount = count;
      domainKind = kind;
    }
  }
  for (const elem of seedElements) {
    const lhsResult = store.traverse({ startId: elem.id, steps: lhsSteps });
    const rhsResult = store.traverse({ startId: elem.id, steps: rhsSteps });
    if (lhsResult.elements.length === 0 && rhsResult.elements.length === 0) {
      continue;
    }
    if (lhsResult.elements.length === 0 || rhsResult.elements.length === 0) {
      total++;
      if (counterexamples.length < maxCounterexamples) {
        counterexamples.push({
          elementId: elem.id,
          elementName: elem.name,
          elementKind: elem.kind,
          lhsResult: lhsResult.elements.map((e) => e.name),
          rhsResult: rhsResult.elements.map((e) => e.name)
        });
      }
      continue;
    }
    total++;
    const lhsIds = new Set(lhsResult.elements.map((e) => e.id));
    const rhsIds = new Set(rhsResult.elements.map((e) => e.id));
    const lhsOnly = [...lhsIds].filter((id) => !rhsIds.has(id));
    const rhsOnly = [...rhsIds].filter((id) => !lhsIds.has(id));
    if (lhsOnly.length === 0 && rhsOnly.length === 0) {
      support++;
    } else {
      if (counterexamples.length < maxCounterexamples) {
        counterexamples.push({
          elementId: elem.id,
          elementName: elem.name,
          elementKind: elem.kind,
          lhsResult: lhsResult.elements.filter((e) => !rhsIds.has(e.id)).map((e) => e.name),
          rhsResult: rhsResult.elements.filter((e) => !lhsIds.has(e.id)).map((e) => e.name)
        });
      }
    }
  }
  const coverage = total > 0 ? support / total : 0;
  return {
    lhsPath,
    rhsPath,
    domainKind,
    support,
    total,
    coverage,
    counterexamples
  };
}

// src/mining/graph.ts
function buildInMemoryGraph(store) {
  const rawArrows = store.loadAllArrows();
  const outgoing = /* @__PURE__ */ new Map();
  for (const { src_id, kind, dst_id } of rawArrows) {
    let list = outgoing.get(src_id);
    if (!list) {
      list = [];
      outgoing.set(src_id, list);
    }
    list.push({ kind, dstId: dst_id });
  }
  return { outgoing, elems: store.loadElemMeta() };
}
function followPath2(graph, startId, arrowKinds) {
  let current = /* @__PURE__ */ new Set([startId]);
  for (const kind of arrowKinds) {
    const next = /* @__PURE__ */ new Set();
    for (const id of current) {
      for (const arr of graph.outgoing.get(id) ?? []) {
        if (arr.kind === kind) next.add(arr.dstId);
      }
    }
    current = next;
    if (current.size === 0) return current;
  }
  return current;
}
function pathKey(arrows) {
  return arrows.join("\u2192");
}
function precomputePathResults(graph, paths, seeds) {
  const cache = /* @__PURE__ */ new Map();
  const seenKeys = /* @__PURE__ */ new Set();
  for (const path of paths) {
    const key = pathKey(path.arrows);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const seedResults = /* @__PURE__ */ new Map();
    for (const seed of seeds) {
      const reached = followPath2(graph, seed.id, path.arrows);
      if (reached.size > 0) {
        seedResults.set(seed.id, reached);
      }
    }
    cache.set(key, seedResults);
  }
  return cache;
}

// src/mining/motifs.ts
import { randomUUID as randomUUID4 } from "crypto";

// src/mining/ego.ts
function extractEgoGraph(graph, seedId, depth, arrowKinds) {
  const seedElement = graph.elems.get(seedId);
  if (!seedElement) {
    throw new Error(`Seed element not found: ${seedId}`);
  }
  const elements = /* @__PURE__ */ new Map();
  elements.set(seedId, { id: seedId, kind: seedElement.kind, name: seedElement.name });
  const arrows = [];
  const visited = /* @__PURE__ */ new Set([seedId]);
  const queue = [{ id: seedId, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.depth >= depth) {
      continue;
    }
    const outgoing = graph.outgoing.get(current.id) ?? [];
    for (const arrow of outgoing) {
      if (arrowKinds && !arrowKinds.includes(arrow.kind)) {
        continue;
      }
      arrows.push({ srcId: current.id, kind: arrow.kind, dstId: arrow.dstId });
      if (!visited.has(arrow.dstId)) {
        visited.add(arrow.dstId);
        const destElem = graph.elems.get(arrow.dstId);
        if (destElem) {
          elements.set(arrow.dstId, {
            id: arrow.dstId,
            kind: destElem.kind,
            name: destElem.name
          });
          queue.push({ id: arrow.dstId, depth: current.depth + 1 });
        }
      }
    }
  }
  return {
    seedId,
    seedKind: seedElement.kind,
    elements,
    arrows
  };
}

// src/mining/shape.ts
import { createHash } from "crypto";
function shapeHash(shape) {
  const canonical = JSON.stringify({ objects: shape.objects, arrows: shape.arrows });
  return createHash("sha256").update(canonical).digest("hex");
}
function abstractToShape(ego) {
  const sortedElements = Array.from(ego.elements.values()).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });
  const roleMap = /* @__PURE__ */ new Map();
  const kindCounters = /* @__PURE__ */ new Map();
  for (const element of sortedElements) {
    const count = kindCounters.get(element.kind) ?? 0;
    roleMap.set(element.id, `${element.kind}_${count}`);
    kindCounters.set(element.kind, count + 1);
  }
  const objects = sortedElements.map((element) => ({
    role: roleMap.get(element.id),
    kind: element.kind
  }));
  const arrows = ego.arrows.map((arrow) => ({
    fromRole: roleMap.get(arrow.srcId),
    label: arrow.kind,
    toRole: roleMap.get(arrow.dstId)
  }));
  const sortedObjects = [...objects].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.role.localeCompare(b.role);
  });
  const sortedArrows = [...arrows].sort((a, b) => {
    if (a.fromRole !== b.fromRole) return a.fromRole.localeCompare(b.fromRole);
    if (a.label !== b.label) return a.label.localeCompare(b.label);
    return a.toRole.localeCompare(b.toRole);
  });
  const hash = shapeHash({ hash: "", objects: sortedObjects, arrows: sortedArrows });
  return { hash, objects: sortedObjects, arrows: sortedArrows };
}

// src/mining/group.ts
function groupEgoGraphs(egos, minSupport) {
  const groups = /* @__PURE__ */ new Map();
  for (const ego of egos) {
    const shape = abstractToShape(ego);
    const hash = shape.hash;
    if (!groups.has(hash)) {
      groups.set(hash, []);
    }
    groups.get(hash).push(ego);
  }
  const result = [];
  for (const [, instances] of groups) {
    if (instances.length >= minSupport) {
      const shape = abstractToShape(instances[0]);
      result.push({
        shape,
        instances,
        support: instances.length
      });
    }
  }
  result.sort((a, b) => b.support - a.support);
  return result;
}
function verifyInternalEquations(store, group, options) {
  const elementIds = /* @__PURE__ */ new Set();
  for (const instance of group.instances) {
    for (const id of instance.elements.keys()) {
      elementIds.add(id);
    }
  }
  const firstInstance = group.instances[0];
  if (!firstInstance) return [];
  const elementKinds = [
    ...new Set(
      [...elementIds].map((id) => firstInstance.elements.get(id)?.kind).filter((kind) => Boolean(kind))
    )
  ];
  const equations = mineEquations(store, {
    elementKinds,
    sampleSize: elementIds.size,
    minCoverage: 0.8,
    ...options
  });
  return equations.map((eq) => ({
    lhsPath: eq.lhsPath,
    rhsPath: eq.rhsPath,
    coverage: eq.coverage
  }));
}

// src/mining/motifs.ts
function discoverMotifs(store, options = {}) {
  const graph = buildInMemoryGraph(store);
  const seedKinds = options.seedKinds ?? ["function", "class", "interface"];
  const depth = options.depth ?? 2;
  const minSupport = options.minSupport ?? 3;
  const mineEquationsFlag = options.mineEquations ?? true;
  const seedIds = [];
  for (const [id, elem] of graph.elems) {
    if (!seedKinds.includes(elem.kind)) continue;
    const module = store.getElem(id)?.module ?? null;
    if (options.scopeRegex) {
      const regex = new RegExp(options.scopeRegex);
      if (!module || !regex.test(module)) continue;
    }
    if (options.excludeModules && options.excludeModules.length > 0) {
      if (module && options.excludeModules.some((pattern) => new RegExp(pattern).test(module))) {
        continue;
      }
    }
    seedIds.push(id);
  }
  const egos = [];
  for (const seedId of seedIds) {
    const ego = extractEgoGraph(graph, seedId, depth, options.arrowKinds);
    egos.push(ego);
  }
  const groups = groupEgoGraphs(egos, minSupport);
  const candidates = [];
  for (const group of groups) {
    const objectKinds = group.shape.objects.map((o) => o.kind).join("_");
    const arrowLabels = group.shape.arrows.map((a) => a.label).join("_");
    const proposedName = `Motif_${objectKinds}_${arrowLabels}`;
    const roleList = group.shape.objects.map((o) => o.role).join(", ");
    const description = `Recurring pattern with ${group.support} instances: ${roleList}`;
    const instances = group.instances.map((ego) => {
      const seedElem = store.getElem(ego.seedId);
      const module = seedElem?.module ?? null;
      const sortedElements = Array.from(ego.elements.values()).sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        return a.id.localeCompare(b.id);
      });
      const mappings = {};
      for (let i = 0; i < group.shape.objects.length; i++) {
        const shapeObj = group.shape.objects[i];
        const elem = sortedElements[i];
        mappings[shapeObj.role] = elem.id;
      }
      return {
        id: ego.seedId,
        mappings,
        module
      };
    });
    const equations = mineEquationsFlag ? verifyInternalEquations(store, group, options.equationOptions) : [];
    const questions = [
      `This motif has ${group.support} instances with ${group.shape.arrows.length} arrow kinds. Consider naming them.`
    ];
    candidates.push({
      id: randomUUID4(),
      shape: group.shape,
      proposedName,
      description,
      support: group.support,
      instances,
      equations,
      questions,
      status: "proposed"
    });
  }
  candidates.sort((a, b) => b.support - a.support);
  return candidates;
}

// src/mining/index.ts
var DEFAULT_MINING_OPTIONS = {
  maxDepth: 3,
  minCoverage: 1,
  maxResults: 50,
  maxCounterexamples: 5,
  sampleSize: 100
};
var ALL_ARROW_KINDS = [
  "extends",
  "implements",
  "calls",
  "imports",
  "exports",
  "references",
  "contains",
  "returns",
  "param",
  "typeof",
  "instanceof",
  "definedIn",
  "inModule",
  "memberOf",
  "callerOf",
  "calleeOf",
  "importsFrom",
  "locatedIn",
  "hasProperty",
  "hasType",
  "implementedAs",
  "other"
];
var DEFAULT_ELEMENT_KINDS = [
  "function",
  "method",
  "class",
  "interface",
  "type",
  "import",
  "module",
  "domain",
  "property"
];
function mineEquations(store, options = {}) {
  const opts = { ...DEFAULT_MINING_OPTIONS, ...options };
  let arrowKinds = opts.arrowKinds ?? getArrowKindsInUse(ALL_ARROW_KINDS, (k) => store.hasArrowKind(k));
  if (opts.touchingElementKinds && opts.touchingElementKinds.length > 0) {
    const touchingKinds = store.getArrowKindsForElementKinds(opts.touchingElementKinds);
    const touchingSet = new Set(touchingKinds);
    arrowKinds = arrowKinds.filter((k) => touchingSet.has(k));
  }
  const elementKinds = opts.elementKinds ?? DEFAULT_ELEMENT_KINDS;
  const paths = enumeratePaths(arrowKinds, opts.maxDepth);
  const graph = buildInMemoryGraph(store);
  const allSeeds = [];
  for (const kind of elementKinds) {
    const elems = store.queryElements({ kind, limit: opts.sampleSize });
    allSeeds.push(...elems);
  }
  const cache = precomputePathResults(graph, paths, allSeeds);
  const seedKindMap = new Map(allSeeds.map((e) => [e.id, e.kind]));
  for (const path of paths) {
    const key = pathKey(path.arrows);
    const seedResults = cache.get(key) ?? /* @__PURE__ */ new Map();
    const domainKinds = /* @__PURE__ */ new Set();
    const codomainKinds = /* @__PURE__ */ new Set();
    for (const [seedId, reached] of seedResults) {
      const dk = seedKindMap.get(seedId);
      if (dk) domainKinds.add(dk);
      for (const dstId of reached) {
        const ck = graph.elems.get(dstId)?.kind;
        if (ck) codomainKinds.add(ck);
      }
    }
    path.domainKind = domainKinds.size === 1 ? [...domainKinds][0] : null;
    path.codomainKind = codomainKinds.size > 0 ? [...codomainKinds].sort().join(",") : null;
  }
  const candidates = generateCandidatePairs(paths);
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    const key = canonicalEquationKey(candidate.lhs, candidate.rhs);
    if (seen.has(key)) continue;
    seen.add(key);
    const lhsKey = pathKey(candidate.lhs);
    const rhsKey = pathKey(candidate.rhs);
    const lhsResults = cache.get(lhsKey) ?? /* @__PURE__ */ new Map();
    const rhsResults = cache.get(rhsKey) ?? /* @__PURE__ */ new Map();
    let support = 0;
    let total = 0;
    const counterexamples = [];
    const kindCounts = /* @__PURE__ */ new Map();
    for (const seed of allSeeds) {
      const lhsReached = lhsResults.get(seed.id);
      const rhsReached = rhsResults.get(seed.id);
      if (!lhsReached && !rhsReached) continue;
      total++;
      kindCounts.set(seed.kind, (kindCounts.get(seed.kind) ?? 0) + 1);
      if (lhsReached && rhsReached) {
        let equal = lhsReached.size === rhsReached.size;
        if (equal) {
          for (const id of lhsReached) {
            if (!rhsReached.has(id)) {
              equal = false;
              break;
            }
          }
        }
        if (equal) {
          support++;
        } else if (counterexamples.length < opts.maxCounterexamples) {
          counterexamples.push({
            elementId: seed.id,
            elementName: seed.name,
            elementKind: seed.kind,
            lhsResult: [...lhsReached].filter((id) => !rhsReached.has(id)).map((id) => graph.elems.get(id)?.name ?? id),
            rhsResult: [...rhsReached].filter((id) => !lhsReached.has(id)).map((id) => graph.elems.get(id)?.name ?? id)
          });
        }
      } else if (counterexamples.length < opts.maxCounterexamples) {
        counterexamples.push({
          elementId: seed.id,
          elementName: seed.name,
          elementKind: seed.kind,
          lhsResult: lhsReached ? [...lhsReached].map((id) => graph.elems.get(id)?.name ?? id) : [],
          rhsResult: rhsReached ? [...rhsReached].map((id) => graph.elems.get(id)?.name ?? id) : []
        });
      }
    }
    if (total === 0) continue;
    const coverage = support / total;
    if (coverage < opts.minCoverage) continue;
    let domainKind = "any";
    let maxCount = 0;
    for (const [kind, count] of kindCounts) {
      if (count > maxCount) {
        maxCount = count;
        domainKind = kind;
      }
    }
    results.push({ lhsPath: candidate.lhs, rhsPath: candidate.rhs, domainKind, support, total, coverage, counterexamples });
    if (results.length >= opts.maxResults * 2) break;
  }
  results.sort((a, b) => {
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    return b.total - a.total;
  });
  const deduped = [];
  for (const result of results) {
    if (deduped.length >= opts.maxResults) break;
    let subsumed = false;
    for (const existing of deduped) {
      if (isSubsumedBy(result, existing)) {
        subsumed = true;
        break;
      }
    }
    if (!subsumed) {
      deduped.push(result);
    }
  }
  return deduped;
}
function isSubsumedBy(candidate, existing) {
  if (candidate.coverage !== existing.coverage) return false;
  const cLhs = candidate.lhsPath.join("\u2192");
  const cRhs = candidate.rhsPath.join("\u2192");
  const eLhs = existing.lhsPath.join("\u2192");
  const eRhs = existing.rhsPath.join("\u2192");
  const pairs = [
    [cLhs, cRhs],
    [eLhs, eRhs]
  ];
  if (cLhs.startsWith(eLhs + "\u2192") && cRhs.startsWith(eRhs + "\u2192") && cLhs.slice(eLhs.length) === cRhs.slice(eRhs.length)) {
    return true;
  }
  if (cLhs.endsWith("\u2192" + eLhs) && cRhs.endsWith("\u2192" + eRhs) && cLhs.slice(0, cLhs.length - eLhs.length) === cRhs.slice(0, cRhs.length - eRhs.length)) {
    return true;
  }
  return false;
}
function canonicalEquationKey(lhs, rhs) {
  const lhsKey = lhs.join("\u2192");
  const rhsKey = rhs.join("\u2192");
  if (lhsKey <= rhsKey) {
    return `${lhsKey}\u2261${rhsKey}`;
  }
  return `${rhsKey}\u2261${lhsKey}`;
}

// src/domain/discover.ts
import { randomUUID as randomUUID5 } from "crypto";
var ABBREV_MAP = {
  Elem: "Element",
  Arr: "Arrow",
  Prov: "Provenance",
  Val: "Value",
  Cfg: "Configuration",
  Msg: "Message",
  Err: "Error",
  Req: "Request",
  Res: "Response",
  Impl: "Implementation",
  Attr: "Attribute",
  Prop: "Property",
  Spec: "Specification",
  Ctor: "Constructor",
  Lhs: "Left-Hand Side",
  Rhs: "Right-Hand Side",
  Src: "Source",
  Dst: "Destination",
  Id: "ID"
};
function splitPascalCase(name) {
  const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return spaced.split(" ").filter((s) => s.length > 0);
}
function toNounPhrase(pascalName) {
  const words = splitPascalCase(pascalName).map((w) => ABBREV_MAP[w] ?? w);
  const noun = words.join(" ");
  const article = /^[aeiouAEIOU]/.test(noun) ? "an" : "a";
  return `${article} ${noun}`;
}
function toNounPhraseFromName(name) {
  const local = name.includes("/") ? name.split("/").pop() ?? name : name;
  if (local.includes("-")) {
    const words = local.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    const noun = words.join(" ");
    return (/^[aeiouAEIOU]/.test(noun) ? "an " : "a ") + noun;
  }
  if (local.includes("_")) {
    const words = local.split("_").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    const noun = words.join(" ");
    return (/^[aeiouAEIOU]/.test(noun) ? "an " : "a ") + noun;
  }
  return toNounPhrase(local.charAt(0).toUpperCase() + local.slice(1));
}
function isExternalModule(module, excludeModules) {
  if (module === null) return true;
  if (module.startsWith("node:")) return true;
  if (excludeModules) {
    for (const pattern of excludeModules) {
      if (new RegExp(pattern).test(module)) return true;
    }
  }
  return false;
}
function getExistingDomainElementsByCodeId(store) {
  const result = /* @__PURE__ */ new Map();
  const existingDomainElems = store.queryElements({ kind: "domain", limit: 1e4 });
  for (const domElem of existingDomainElems) {
    const domOutgoing = store.outgoing(domElem.id);
    for (const arr of domOutgoing) {
      if (arr.kind === "implementedAs") {
        result.set(arr.dstId, { id: domElem.id, name: domElem.name });
      }
    }
  }
  return result;
}
function discoverDomainCandidates(store, options = {}) {
  const elements = [
    ...store.queryElements({ kind: "interface", limit: 1e4 }),
    ...store.queryElements({ kind: "type", limit: 1e4 }),
    ...store.queryElements({ kind: "class", limit: 1e4 })
  ];
  const filtered = elements.filter((elem) => {
    if (isExternalModule(elem.module, options.excludeModules)) return false;
    if (options.scopeRegex) {
      try {
        if (!new RegExp(options.scopeRegex).test(elem.module ?? "")) return false;
      } catch {
      }
    }
    return true;
  });
  const candidates = filtered.map((elem) => {
    const candidateId = randomUUID5();
    const bridgeArrow = {
      id: randomUUID5(),
      name: "implemented as",
      domainCandidateId: candidateId,
      codomainName: elem.name,
      codomainCandidateId: null,
      codomainExistingElemId: null,
      total: true,
      source: "field",
      confidence: "resolved",
      status: "proposed"
    };
    return {
      id: candidateId,
      codeElementId: elem.id,
      proposedName: toNounPhrase(elem.name),
      proposedArrows: [],
      bridgeArrow,
      questions: [],
      status: "proposed"
    };
  });
  const codeIdToCandidate = /* @__PURE__ */ new Map();
  for (const c of candidates) {
    codeIdToCandidate.set(c.codeElementId, c);
  }
  const existingDomainByCodeId = getExistingDomainElementsByCodeId(store);
  for (const candidate of candidates) {
    const elem = store.getElem(candidate.codeElementId);
    if (!elem) continue;
    const outgoing = store.outgoing(candidate.codeElementId);
    const propertyArrows = outgoing.filter((a) => a.kind === "hasProperty");
    if (propertyArrows.length === 0 && elem.kind === "type") {
      candidate.questions.push(
        `"${elem.name}" appears to be a type alias. If it is a union of string literals, should it become a domain concept, or should each value be a separate domain object?`
      );
    }
    for (const propArrow of propertyArrows) {
      const propElem = store.getElem(propArrow.dstId);
      if (!propElem) continue;
      const propAttrs = propElem.attrs;
      const typeText = propAttrs.typeText ?? "";
      const optional = propAttrs.optional === true;
      const isArray = typeText.includes("[]") || typeText.includes("Array<");
      const isRecord = typeText.includes("Record<") || typeText.startsWith("{") && !typeText.includes("null");
      const propName = propElem.name.includes(".") ? propElem.name.split(".").slice(1).join(".") : propElem.name;
      const propOutgoing = store.outgoing(propArrow.dstId);
      const typeArrows = propOutgoing.filter((a) => a.kind === "hasType");
      for (const typeArrow of typeArrows) {
        const typeElem = store.getElem(typeArrow.dstId);
        if (!typeElem) continue;
        const targetCandidate = codeIdToCandidate.get(typeArrow.dstId);
        const existingDomain = targetCandidate ? null : existingDomainByCodeId.get(typeArrow.dstId) ?? null;
        const total = !optional && !isArray;
        const proposal = {
          id: randomUUID5(),
          name: `has ${propName}`,
          domainCandidateId: candidate.id,
          codomainName: targetCandidate?.proposedName ?? existingDomain?.name ?? typeElem.name,
          codomainCandidateId: targetCandidate?.id ?? null,
          codomainExistingElemId: existingDomain?.id ?? null,
          total,
          source: "field",
          confidence: targetCandidate || existingDomain ? "resolved" : "unresolved",
          status: "proposed"
        };
        if (optional) {
          proposal.question = `The field "${propName}" is optional (nullable). Is this arrow total (every ${candidate.proposedName} must have one) or partial?`;
        } else if (isArray) {
          proposal.question = `The field "${propName}" is an array. The arrow "has ${propName}" would be many-valued. Should ${typeElem.name} be reified with a back-reference?`;
        }
        candidate.proposedArrows.push(proposal);
      }
      if (typeArrows.length === 0 && isRecord) {
        candidate.questions.push(
          `The field "${propName}" has a generic container type ("${typeText}"). Should individual attributes be modeled as separate domain arrows?`
        );
      }
    }
    const structuralArrows = outgoing.filter((a) => a.kind === "extends" || a.kind === "implements");
    for (const structArrow of structuralArrows) {
      const targetCandidate = codeIdToCandidate.get(structArrow.dstId);
      const existingDomain = targetCandidate ? null : existingDomainByCodeId.get(structArrow.dstId) ?? null;
      if (!targetCandidate && !existingDomain) continue;
      const targetElem = store.getElem(structArrow.dstId);
      if (!targetElem) continue;
      const arrowName = structArrow.kind === "extends" ? "extends" : "implements";
      const proposal = {
        id: randomUUID5(),
        name: arrowName,
        domainCandidateId: candidate.id,
        codomainName: targetCandidate?.proposedName ?? existingDomain?.name ?? targetElem.name,
        codomainCandidateId: targetCandidate?.id ?? null,
        codomainExistingElemId: existingDomain?.id ?? null,
        total: true,
        source: structArrow.kind,
        confidence: "resolved",
        status: "proposed"
      };
      candidate.proposedArrows.push(proposal);
    }
  }
  return candidates;
}
var WALKABLE_KINDS = /* @__PURE__ */ new Set(["function", "method", "const"]);
function extendDomainByKan(store, options = {}) {
  const maxDepth = options.maxDepth ?? 2;
  const codeIdToDomain = /* @__PURE__ */ new Map();
  for (const domElem of store.queryElements({ kind: "domain", limit: 1e4 })) {
    for (const arr of store.outgoing(domElem.id)) {
      if (arr.kind === "implementedAs") {
        codeIdToDomain.set(arr.dstId, { id: domElem.id, name: domElem.name });
      }
    }
  }
  if (codeIdToDomain.size === 0) return [];
  const shellsByDomainId = /* @__PURE__ */ new Map();
  const newCandsByCodeId = /* @__PURE__ */ new Map();
  const seenArrows = /* @__PURE__ */ new Set();
  function getShell(domainId, domainName, codeId) {
    let shell = shellsByDomainId.get(domainId);
    if (!shell) {
      const cid = randomUUID5();
      shell = {
        id: cid,
        codeElementId: codeId,
        proposedName: domainName,
        proposedArrows: [],
        bridgeArrow: {
          id: randomUUID5(),
          name: "implemented as",
          domainCandidateId: cid,
          codomainName: domainName,
          codomainCandidateId: null,
          codomainExistingElemId: null,
          total: true,
          source: "kan_extension",
          confidence: "resolved",
          status: "proposed"
        },
        questions: [],
        status: "accepted"
        // existing element — auto-accept so its new arrows get written on commit
      };
      shellsByDomainId.set(domainId, shell);
    }
    return shell;
  }
  function getOrCreateNewCand(id, name, kind) {
    let cand = newCandsByCodeId.get(id);
    if (!cand) {
      const cid = randomUUID5();
      cand = {
        id: cid,
        codeElementId: id,
        proposedName: toNounPhraseFromName(name),
        proposedArrows: [],
        bridgeArrow: {
          id: randomUUID5(),
          name: "implemented as",
          domainCandidateId: cid,
          codomainName: name,
          codomainCandidateId: null,
          codomainExistingElemId: null,
          total: true,
          source: "kan_extension",
          confidence: "tentative",
          status: "proposed"
        },
        questions: [`Discovered via Kan extension from call graph. Is "${toNounPhraseFromName(name)}" a meaningful domain concept?`],
        status: "proposed"
      };
      newCandsByCodeId.set(id, cand);
    }
    return cand;
  }
  function proposeArrow(src, dstCandId, dstExistingId, dstName, confidence) {
    const key = `${src.id}:${dstCandId ?? dstExistingId}`;
    if (seenArrows.has(key)) return;
    seenArrows.add(key);
    src.proposedArrows.push({
      id: randomUUID5(),
      name: "calls",
      domainCandidateId: src.id,
      codomainName: dstName,
      codomainCandidateId: dstCandId,
      codomainExistingElemId: dstExistingId,
      total: false,
      source: "kan_extension",
      confidence,
      status: "proposed"
    });
  }
  for (const [startCodeId, startDomain] of codeIdToDomain) {
    const shell = getShell(startDomain.id, startDomain.name, startCodeId);
    const seedCodeIds = /* @__PURE__ */ new Set([startCodeId]);
    const startElem = store.getElem(startCodeId);
    if (startElem && !WALKABLE_KINDS.has(startElem.kind)) {
      for (const arr of store.incoming(startCodeId)) {
        if (arr.kind === "memberOf") seedCodeIds.add(arr.srcId);
      }
      for (const arr of store.outgoing(startCodeId)) {
        if (arr.kind === "contains") seedCodeIds.add(arr.dstId);
      }
    }
    const queue = [];
    for (const seedId of seedCodeIds) {
      queue.push({ codeId: seedId, domCand: shell, depth: 0 });
    }
    const visited = new Set(seedCodeIds);
    while (queue.length > 0) {
      const item = queue.shift();
      if (item.depth >= maxDepth) continue;
      for (const arr of store.outgoing(item.codeId)) {
        if (arr.kind !== "callerOf") continue;
        const calleeId = arr.dstId;
        if (visited.has(calleeId)) continue;
        visited.add(calleeId);
        const callee = store.getElem(calleeId);
        if (!callee) continue;
        if (!WALKABLE_KINDS.has(callee.kind)) continue;
        if (isExternalModule(callee.module, options.excludeModules)) continue;
        const existingDomain = codeIdToDomain.get(calleeId);
        if (existingDomain) {
          proposeArrow(item.domCand, null, existingDomain.id, existingDomain.name, "resolved");
          const calleeShell = getShell(existingDomain.id, existingDomain.name, calleeId);
          queue.push({ codeId: calleeId, domCand: calleeShell, depth: item.depth + 1 });
        } else {
          const newCand = getOrCreateNewCand(calleeId, callee.name, callee.kind);
          proposeArrow(item.domCand, newCand.id, null, newCand.proposedName, "tentative");
          queue.push({ codeId: calleeId, domCand: newCand, depth: item.depth + 1 });
        }
      }
    }
  }
  return [...shellsByDomainId.values(), ...newCandsByCodeId.values()];
}
export {
  AdapterRegistry,
  DomainSessionStore,
  MotifSessionStore,
  OlogStore,
  SourceResolver,
  abstractToShape,
  annotatePathKinds,
  applyEditsToString,
  applySourceEdits,
  arrowId,
  assembleBrief,
  discoverDomainCandidates,
  discoverMotifs,
  enumeratePaths,
  evaluateConstraints,
  evaluateEquation,
  evaluateEquationCandidate,
  evaluatePathEquations,
  extendDomainByKan,
  extractEgoGraph,
  filePathFromSpan,
  generateCandidatePairs,
  getArrowKindsInUse,
  getDefaultRegistry,
  getExistingDomainElementsByCodeId,
  groupEgoGraphs,
  ingestChangedFiles,
  ingestProject,
  isExternalModule,
  isNounPhrase,
  mineEquations,
  offsetAt,
  reindexProject,
  renderAndApplyPlan,
  renderPlan,
  rollback,
  setDefaultRegistry,
  shapeHash,
  toNounPhrase,
  toNounPhraseFromName,
  traverse,
  validateEquation,
  verifyInternalEquations
};
