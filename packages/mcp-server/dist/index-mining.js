#!/usr/bin/env node

// src/index-mining.ts
import { mkdirSync } from "fs";
import { join } from "path";
import { McpServer as McpServer4 } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// ../core/dist/index.js
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { randomUUID as randomUUID3 } from "crypto";
import { randomUUID } from "crypto";
import { randomUUID as randomUUID2 } from "crypto";
import { globSync } from "glob";
import { randomUUID as randomUUID5 } from "crypto";
import { createHash } from "crypto";
import { randomUUID as randomUUID6 } from "crypto";
var SessionStore = class {
  constructor(db, insertSQL, selectColumns, tableName, updateSQL) {
    this.db = db;
    this.insertStmt = db.prepare(insertSQL);
    this.getStmt = db.prepare(`SELECT ${selectColumns} FROM ${tableName} WHERE id = ?`);
    this.listStmt = db.prepare(`SELECT ${selectColumns} FROM ${tableName} ORDER BY created_at DESC`);
    this.updateStmt = db.prepare(updateSQL);
    this.deleteStmt = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
  }
  db;
  insertStmt;
  getStmt;
  listStmt;
  updateStmt;
  deleteStmt;
  get(id) {
    const row = this.getStmt.get(id);
    if (!row) return null;
    return this.rowToSession(row);
  }
  list() {
    const rows = this.listStmt.all();
    return rows.map((r) => this.rowToSession(r));
  }
  delete(id) {
    this.deleteStmt.run(id);
  }
};
var SELECT_COLUMNS = "id, status, scope_regex, candidates_json, equations_json, commit_sha, created_at, updated_at";
var DomainSessionStore = class extends SessionStore {
  constructor(db) {
    super(
      db,
      `INSERT INTO olog_domain_session (id, status, scope_regex, candidates_json, equations_json, commit_sha, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      SELECT_COLUMNS,
      "olog_domain_session",
      `UPDATE olog_domain_session SET status = ?, scope_regex = ?, candidates_json = ?, equations_json = ?, updated_at = ? WHERE id = ?`
    );
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
  create(data) {
    const id = randomUUID();
    const now = Date.now();
    this.insertStmt.run(id, "active", data.scopeRegex ?? null, JSON.stringify(data.candidates), JSON.stringify(data.equations), data.commitSha, now, now);
    return id;
  }
  update(id, data) {
    const current = this.get(id);
    if (!current) throw new Error(`Domain session not found: ${id}`);
    const merged = { ...current, ...data };
    this.updateStmt.run(merged.status, merged.scopeRegex, JSON.stringify(merged.candidates), JSON.stringify(merged.equations), Date.now(), id);
  }
};
var SELECT_COLUMNS2 = "id, status, scope_regex, candidates_json, commit_sha, created_at, updated_at";
var MotifSessionStore = class extends SessionStore {
  constructor(db) {
    super(
      db,
      `INSERT INTO olog_motif_session (id, status, scope_regex, candidates_json, commit_sha, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      SELECT_COLUMNS2,
      "olog_motif_session",
      `UPDATE olog_motif_session SET status = ?, scope_regex = ?, candidates_json = ?, updated_at = ? WHERE id = ?`
    );
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
  create(data) {
    const id = randomUUID2();
    const now = Date.now();
    this.insertStmt.run(id, "active", data.scopeRegex ?? null, JSON.stringify(data.candidates), data.commitSha, now, now);
    return id;
  }
  update(id, data) {
    const current = this.get(id);
    if (!current) throw new Error(`Motif session not found: ${id}`);
    const merged = { ...current, ...data };
    this.updateStmt.run(merged.status, merged.scopeRegex, JSON.stringify(merged.candidates), Date.now(), id);
  }
};
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
  insertWorkingSetStmt;
  insertWorkingSetElemStmt;
  insertWorkingSetArrStmt;
  getWorkingSetStmt;
  deleteWorkingSetStmt;
  insertWorkingSetNoteStmt;
  getWorkingSetNoteStmt;
  getWorkingSetNotesStmt;
  deleteWorkingSetNoteStmt;
  insertSyntheticArrStmt;
  getSyntheticArrsStmt;
  updateWorkingSetStatusStmt;
  resolveSyntheticArrStmt;
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
    const synArrCols = this.db.prepare("PRAGMA table_info(olog_ws_synthetic_arr)").all();
    if (!synArrCols.some((c) => c.name === "source")) {
      this.db.exec("ALTER TABLE olog_ws_synthetic_arr ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'");
    }
    const wsCols = this.db.prepare("PRAGMA table_info(olog_working_set)").all();
    if (!wsCols.some((c) => c.name === "status")) {
      this.db.exec("ALTER TABLE olog_working_set ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
    }
    const redundantKinds = ["inModule", "locatedIn", "contains", "imports"];
    for (const kind of redundantKinds) {
      this.db.prepare("DELETE FROM olog_arr WHERE kind = ?").run(kind);
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
    this.insertWorkingSetStmt = this.db.prepare(
      "INSERT INTO olog_working_set (id, name, plan_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    );
    this.insertWorkingSetElemStmt = this.db.prepare(
      "INSERT OR IGNORE INTO olog_working_set_elem (set_id, elem_id) VALUES (?, ?)"
    );
    this.insertWorkingSetArrStmt = this.db.prepare(
      "INSERT OR IGNORE INTO olog_working_set_arr (set_id, arr_id) VALUES (?, ?)"
    );
    this.getWorkingSetStmt = this.db.prepare(
      "SELECT id, name, plan_hash, created_at, updated_at FROM olog_working_set WHERE id = ?"
    );
    this.deleteWorkingSetStmt = this.db.prepare(
      "DELETE FROM olog_working_set WHERE id = ?"
    );
    this.insertWorkingSetNoteStmt = this.db.prepare(
      "INSERT OR REPLACE INTO olog_working_set_note (set_id, target_id, note, updated_at) VALUES (?, ?, ?, ?)"
    );
    this.getWorkingSetNoteStmt = this.db.prepare(
      "SELECT set_id, target_id, note, updated_at FROM olog_working_set_note WHERE set_id = ? AND target_id = ?"
    );
    this.getWorkingSetNotesStmt = this.db.prepare(
      "SELECT set_id, target_id, note, updated_at FROM olog_working_set_note WHERE set_id = ?"
    );
    this.deleteWorkingSetNoteStmt = this.db.prepare(
      "DELETE FROM olog_working_set_note WHERE set_id = ? AND target_id = ?"
    );
    this.insertSyntheticArrStmt = this.db.prepare(
      "INSERT OR IGNORE INTO olog_ws_synthetic_arr (set_id, id, kind, src_id, dst_id, note, source) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    this.getSyntheticArrsStmt = this.db.prepare(
      "SELECT id, kind, src_id, dst_id, note, source FROM olog_ws_synthetic_arr WHERE set_id = ?"
    );
    this.updateWorkingSetStatusStmt = this.db.prepare(
      "UPDATE olog_working_set SET status = ?, updated_at = ? WHERE id = ?"
    );
    this.resolveSyntheticArrStmt = this.db.prepare(
      "UPDATE olog_ws_synthetic_arr SET dst_id = ? WHERE id = ?"
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
  /** Derive virtual arrows that are no longer stored: inModule/locatedIn (≡ definedIn),
   *  contains (≡ inverse definedIn for files), imports (≡ inverse importsFrom for files). */
  outgoingDerived(elemId2) {
    const derived = [];
    const stored = this.outgoing(elemId2);
    for (const a of stored) {
      if (a.kind === "definedIn") {
        derived.push({ id: `${a.srcId}:inModule:${a.dstId}`, kind: "inModule", srcId: a.srcId, dstId: a.dstId, attrs: a.attrs });
        derived.push({ id: `${a.srcId}:locatedIn:${a.dstId}`, kind: "locatedIn", srcId: a.srcId, dstId: a.dstId, attrs: a.attrs });
      }
    }
    for (const a of this.incoming(elemId2)) {
      if (a.kind === "definedIn") {
        derived.push({ id: `${elemId2}:contains:${a.srcId}`, kind: "contains", srcId: elemId2, dstId: a.srcId, attrs: a.attrs });
      }
      if (a.kind === "importsFrom") {
        derived.push({ id: `${elemId2}:imports:${a.srcId}`, kind: "imports", srcId: elemId2, dstId: a.srcId, attrs: a.attrs });
      }
    }
    return derived;
  }
  getElemsByModule(module) {
    const rows = this.db.prepare(
      "SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE module = ?"
    ).all(module);
    return rows.map((r) => this.rowToElem(r));
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
            case "addReexport": {
              const id = `projected:${op.module}:other:${op.name}`;
              insertElem.run(id, "other", op.name, op.module, null, "{}");
              const moduleElems = this.db.prepare(
                "SELECT id FROM olog_elem WHERE module = ? LIMIT 1"
              ).all(op.module);
              const firstModuleElem = moduleElems[0];
              if (firstModuleElem) {
                const arrId = `${firstModuleElem.id}:references:${id}`;
                insertArr.run(arrId, "references", firstModuleElem.id, id, "{}");
              }
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
            case "amendType": {
              const elemRow = this.getElemStmt.get(op.target);
              if (!elemRow) {
                skipped++;
                errors.push(`Element not found: ${op.target}`);
                break;
              }
              const attrs = JSON.parse(elemRow.attrs);
              if (op.action === "addUnionMember") {
                if (!attrs[op.field]) {
                  attrs[op.field] = [];
                }
                if (Array.isArray(attrs[op.field])) {
                  attrs[op.field].push(op.value);
                }
              } else if (op.action === "addProperty") {
                attrs[op.field] = op.value;
              }
              this.db.prepare("UPDATE olog_elem SET attrs = ? WHERE id = ?").run(JSON.stringify(attrs), op.target);
              applied++;
              changes.push({
                path: elemRow.module ?? "",
                line: 0,
                column: 0,
                oldText: "",
                newText: `${op.field}: ${op.value}`
              });
              break;
            }
            default:
              skipped++;
              errors.push(`Unknown operation kind: ${op.kind}`);
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
  createWorkingSet(name, planHash) {
    const id = randomUUID3();
    const now = Date.now();
    this.insertWorkingSetStmt.run(id, name, planHash ?? null, now, now);
    return id;
  }
  addToWorkingSet(setId, elemIds, arrIds) {
    const now = Date.now();
    let elementsAdded = 0;
    let arrowsAdded = 0;
    const tx = this.db.transaction(() => {
      for (const elemId2 of elemIds) {
        const result = this.insertWorkingSetElemStmt.run(setId, elemId2);
        elementsAdded += result.changes;
      }
      for (const arrId of arrIds) {
        const result = this.insertWorkingSetArrStmt.run(setId, arrId);
        arrowsAdded += result.changes;
      }
      this.db.prepare("UPDATE olog_working_set SET updated_at = ? WHERE id = ?").run(now, setId);
    });
    tx();
    return { elementsAdded, arrowsAdded };
  }
  getWorkingSet(setId, includeAnnotations) {
    const row = this.getWorkingSetStmt.get(setId);
    if (!row) return null;
    const elemRows = this.db.prepare(
      "SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_working_set_elem ws JOIN olog_elem e ON e.id = ws.elem_id WHERE ws.set_id = ?"
    ).all(setId);
    const arrRows = this.db.prepare(
      "SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs FROM olog_working_set_arr ws JOIN olog_arr a ON a.id = ws.arr_id WHERE ws.set_id = ?"
    ).all(setId);
    const notes = includeAnnotations !== false ? this.getAnnotations(setId) : [];
    return {
      id: row.id,
      name: row.name,
      planHash: row.plan_hash,
      elements: elemRows.map((r) => this.rowToElem(r)),
      arrows: arrRows.map((r) => this.rowToArr(r)),
      notes
    };
  }
  listWorkingSets() {
    const rows = this.db.prepare(
      `SELECT ws.id, ws.name, ws.plan_hash, ws.updated_at,
        (SELECT COUNT(*) FROM olog_working_set_elem WHERE set_id = ws.id) AS element_count,
        (SELECT COUNT(*) FROM olog_working_set_arr WHERE set_id = ws.id) AS arrow_count
       FROM olog_working_set ws ORDER BY ws.updated_at DESC`
    ).all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      planHash: r.plan_hash,
      elementCount: r.element_count,
      arrowCount: r.arrow_count,
      updatedAt: r.updated_at
    }));
  }
  deleteWorkingSet(setId) {
    this.deleteWorkingSetStmt.run(setId);
  }
  pauseWorkingSet(setId) {
    this.updateWorkingSetStatusStmt.run("paused", Date.now(), setId);
  }
  resumeWorkingSet(setId) {
    this.updateWorkingSetStatusStmt.run("active", Date.now(), setId);
  }
  resolveSyntheticArrow(arrowId2, dstId) {
    const dstExists = this.db.prepare("SELECT 1 FROM olog_elem WHERE id = ? LIMIT 1").get(dstId);
    if (!dstExists) throw new Error(`resolveSyntheticArrow: dstId '${dstId}' not found in olog_elem`);
    const result = this.resolveSyntheticArrStmt.run(dstId, arrowId2);
    if (result.changes === 0) throw new Error(`resolveSyntheticArrow: arrow '${arrowId2}' not found`);
  }
  annotateWorkingSet(setId, targetId, note) {
    const now = Date.now();
    this.insertWorkingSetNoteStmt.run(setId, targetId, note, now);
    this.db.prepare("UPDATE olog_working_set SET updated_at = ? WHERE id = ?").run(now, setId);
    return { setId, targetId, note, updatedAt: now };
  }
  getAnnotations(setId, targetIds) {
    if (targetIds && targetIds.length > 0) {
      return targetIds.flatMap((tid) => {
        const row = this.getWorkingSetNoteStmt.get(setId, tid);
        return row ? [{ setId: row.set_id, targetId: row.target_id, note: row.note, updatedAt: row.updated_at }] : [];
      });
    }
    const rows = this.getWorkingSetNotesStmt.all(setId);
    return rows.map((r) => ({ setId: r.set_id, targetId: r.target_id, note: r.note, updatedAt: r.updated_at }));
  }
  deleteAnnotation(setId, targetId) {
    this.deleteWorkingSetNoteStmt.run(setId, targetId);
    this.db.prepare("UPDATE olog_working_set SET updated_at = ? WHERE id = ?").run(Date.now(), setId);
  }
  getWorkingSetElementIds(setId) {
    const rows = this.db.prepare(
      "SELECT elem_id FROM olog_working_set_elem WHERE set_id = ?"
    ).all(setId);
    return new Set(rows.map((r) => r.elem_id));
  }
  assertSyntheticArrow(setId, srcId, dstId, kind, source, note) {
    const srcExists = this.db.prepare("SELECT 1 FROM olog_elem WHERE id = ? LIMIT 1").get(srcId);
    if (!srcExists) throw new Error(`assertSyntheticArrow: srcId '${srcId}' not found in olog_elem`);
    const id = `syn:${randomUUID3()}`;
    this.insertSyntheticArrStmt.run(setId, id, kind, srcId, dstId ?? "", note ?? null, source);
    this.db.prepare("UPDATE olog_working_set SET updated_at = ? WHERE id = ?").run(Date.now(), setId);
    return id;
  }
  queryWorkingSetGraph(setId, opts) {
    const { kind, nameRegex, moduleRegex, arrows, direction = "out", includeAnnotations, source } = opts;
    let seedElems = this.db.prepare(
      "SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_working_set_elem ws JOIN olog_elem e ON e.id = ws.elem_id WHERE ws.set_id = ?"
    ).all(setId).map((r) => this.rowToElem(r));
    if (kind) seedElems = seedElems.filter((e) => e.kind === kind);
    if (nameRegex) {
      const re = new RegExp(nameRegex);
      seedElems = seedElems.filter((e) => re.test(e.name));
    }
    if (moduleRegex) {
      const re = new RegExp(moduleRegex);
      seedElems = seedElems.filter((e) => e.module != null && re.test(e.module));
    }
    const syntheticRows = this.getSyntheticArrsStmt.all(setId);
    const allSyntheticArrows = syntheticRows.map((r) => ({ id: r.id, setId, kind: r.kind, srcId: r.src_id, dstId: r.dst_id || null, note: r.note, source: r.source, synthetic: true }));
    const filteredSyntheticArrows = source ? allSyntheticArrows.filter((a) => a.source === source) : allSyntheticArrows;
    if (!arrows || arrows.length === 0) {
      const realArrows2 = this.db.prepare(
        "SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs FROM olog_working_set_arr ws JOIN olog_arr a ON a.id = ws.arr_id WHERE ws.set_id = ?"
      ).all(setId).map((r) => this.rowToArr(r));
      const result2 = { elements: seedElems, arrows: realArrows2, syntheticArrows: filteredSyntheticArrows };
      if (includeAnnotations) this._attachAnnotations(setId, result2);
      return result2;
    }
    const seedIds = seedElems.map((e) => e.id);
    if (seedIds.length === 0) return { elements: [], arrows: [], syntheticArrows: [] };
    const col = direction === "out" ? "src_id" : "dst_id";
    const neighborCol = direction === "out" ? "dst_id" : "src_id";
    const idPh = seedIds.map(() => "?").join(", ");
    const kindPh = arrows.map(() => "?").join(", ");
    const realRows = this.db.prepare(
      `SELECT id, kind, src_id, dst_id, attrs FROM olog_arr WHERE ${col} IN (${idPh}) AND kind IN (${kindPh})`
    ).all(...seedIds, ...arrows);
    const realArrows = realRows.map((r) => this.rowToArr(r));
    const synRows = this.db.prepare(
      `SELECT id, kind, src_id, dst_id, note, source FROM olog_ws_synthetic_arr WHERE set_id = ? AND ${col} IN (${idPh}) AND kind IN (${kindPh})`
    ).all(setId, ...seedIds, ...arrows);
    const syntheticArrows = synRows.filter((r) => !source || r.source === source).map((r) => ({ id: r.id, setId, kind: r.kind, srcId: r.src_id, dstId: r.dst_id || null, note: r.note, source: r.source, synthetic: true }));
    const neighborIds = [
      ...realRows.map((r) => r[neighborCol]),
      ...synRows.map((r) => r[neighborCol])
    ];
    const allElemIds = [.../* @__PURE__ */ new Set([...seedIds, ...neighborIds])];
    const elemPh = allElemIds.map(() => "?").join(", ");
    const allElems = this.db.prepare(
      `SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE id IN (${elemPh})`
    ).all(...allElemIds).map((r) => this.rowToElem(r));
    const result = { elements: allElems, arrows: realArrows, syntheticArrows };
    if (includeAnnotations) this._attachAnnotations(setId, result);
    return result;
  }
  _attachAnnotations(setId, graph) {
    const notes = this.getAnnotations(setId);
    const notesMap = new Map(notes.map((n) => [n.targetId, n.note]));
    graph.elements = graph.elements.map((e) => ({ ...e, annotation: notesMap.get(e.id) ?? null }));
    graph.arrows = graph.arrows.map((a) => ({ ...a, annotation: notesMap.get(a.id) ?? null }));
    graph.syntheticArrows = graph.syntheticArrows.map((s) => ({ ...s, annotation: notesMap.get(s.id) ?? null }));
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
var ONE_MB = 1024 * 1024;
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
function buildInMemoryGraph(store2) {
  const rawArrows = store2.loadAllArrows();
  const outgoing = /* @__PURE__ */ new Map();
  for (const { src_id, kind, dst_id } of rawArrows) {
    let list = outgoing.get(src_id);
    if (!list) {
      list = [];
      outgoing.set(src_id, list);
    }
    list.push({ kind, dstId: dst_id });
  }
  return { outgoing, elems: store2.loadElemMeta() };
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
function verifyInternalEquations(store2, group, options) {
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
  const equations = mineEquations(store2, {
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
function discoverMotifs(store2, options = {}) {
  const graph = buildInMemoryGraph(store2);
  const seedKinds = options.seedKinds ?? ["function", "class", "interface"];
  const depth = options.depth ?? 2;
  const minSupport = options.minSupport ?? 3;
  const mineEquationsFlag = options.mineEquations ?? true;
  const seedIds = [];
  for (const [id, elem] of graph.elems) {
    if (!seedKinds.includes(elem.kind)) continue;
    const module = store2.getElem(id)?.module ?? null;
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
      const seedElem = store2.getElem(ego.seedId);
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
    const equations = mineEquationsFlag ? verifyInternalEquations(store2, group, options.equationOptions) : [];
    const questions = [
      `This motif has ${group.support} instances with ${group.shape.arrows.length} arrow kinds. Consider naming them.`
    ];
    candidates.push({
      id: randomUUID5(),
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
  "exports",
  "references",
  "returns",
  "param",
  "typeof",
  "instanceof",
  "definedIn",
  "memberOf",
  "callerOf",
  "calleeOf",
  "importsFrom",
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
function mineEquations(store2, options = {}) {
  const opts = { ...DEFAULT_MINING_OPTIONS, ...options };
  let arrowKinds = opts.arrowKinds ?? getArrowKindsInUse(ALL_ARROW_KINDS, (k) => store2.hasArrowKind(k));
  if (opts.touchingElementKinds && opts.touchingElementKinds.length > 0) {
    const touchingKinds = store2.getArrowKindsForElementKinds(opts.touchingElementKinds);
    const touchingSet = new Set(touchingKinds);
    arrowKinds = arrowKinds.filter((k) => touchingSet.has(k));
  }
  const elementKinds = opts.elementKinds ?? DEFAULT_ELEMENT_KINDS;
  const paths = enumeratePaths(arrowKinds, opts.maxDepth);
  const graph = buildInMemoryGraph(store2);
  const allSeeds = [];
  for (const kind of elementKinds) {
    const elems = store2.queryElements({ kind, limit: opts.sampleSize });
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
function minePullbacks(store2, options = {}) {
  const codeIdToDomains = /* @__PURE__ */ new Map();
  for (const domElem of store2.queryElements({ kind: "domain", limit: 1e4 })) {
    for (const arr of store2.outgoing(domElem.id)) {
      if (arr.kind === "implementedAs") {
        const entry = { id: domElem.id, name: domElem.name };
        const existing = codeIdToDomains.get(arr.dstId);
        if (existing) {
          existing.push(entry);
        } else {
          codeIdToDomains.set(arr.dstId, [entry]);
        }
      }
    }
  }
  const candidates = [];
  for (const [codeId, domains] of codeIdToDomains) {
    if (domains.length < 2) continue;
    const codeElem = store2.getElem(codeId);
    if (!codeElem) continue;
    if (isExternalModule(codeElem.module, options.excludeModules)) continue;
    if (options.scopeRegex) {
      try {
        if (!new RegExp(options.scopeRegex).test(codeElem.module ?? "")) continue;
      } catch {
      }
    }
    const candidateId = randomUUID6();
    const proposedName = toNounPhraseFromName(codeElem.name);
    const proposedArrows = domains.map((domain) => ({
      id: randomUUID6(),
      name: `projects to ${domain.name}`,
      domainCandidateId: candidateId,
      codomainName: domain.name,
      codomainCandidateId: null,
      codomainExistingElemId: domain.id,
      total: true,
      source: "pullback",
      confidence: "tentative",
      status: "proposed"
    }));
    const bridgeArrow = {
      id: randomUUID6(),
      name: "implemented as",
      domainCandidateId: candidateId,
      codomainName: codeElem.name,
      codomainCandidateId: null,
      codomainExistingElemId: null,
      total: true,
      source: "pullback",
      confidence: "tentative",
      status: "proposed"
    };
    const domainNames = domains.map((d) => d.name);
    const question = `Is this a single responsibility \u2014 should ${domainNames.join(" and ")} share implementation?`;
    candidates.push({
      id: candidateId,
      codeElementId: codeId,
      proposedName,
      proposedArrows,
      bridgeArrow,
      questions: [question],
      status: "proposed"
    });
  }
  return candidates;
}
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
function getExistingDomainElementsByCodeId(store2) {
  const result = /* @__PURE__ */ new Map();
  const existingDomainElems = store2.queryElements({ kind: "domain", limit: 1e4 });
  for (const domElem of existingDomainElems) {
    const domOutgoing = store2.outgoing(domElem.id);
    for (const arr of domOutgoing) {
      if (arr.kind === "implementedAs") {
        result.set(arr.dstId, { id: domElem.id, name: domElem.name });
      }
    }
  }
  return result;
}
function discoverDomainCandidates(store2, options = {}) {
  const elements = [
    ...store2.queryElements({ kind: "interface", limit: 1e4 }),
    ...store2.queryElements({ kind: "type", limit: 1e4 }),
    ...store2.queryElements({ kind: "class", limit: 1e4 })
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
    const candidateId = randomUUID6();
    const bridgeArrow = {
      id: randomUUID6(),
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
  const existingDomainByCodeId = getExistingDomainElementsByCodeId(store2);
  for (const candidate of candidates) {
    const elem = store2.getElem(candidate.codeElementId);
    if (!elem) continue;
    const outgoing = store2.outgoing(candidate.codeElementId);
    const propertyArrows = outgoing.filter((a) => a.kind === "hasProperty");
    if (propertyArrows.length === 0 && elem.kind === "type") {
      candidate.questions.push(
        `"${elem.name}" appears to be a type alias. If it is a union of string literals, should it become a domain concept, or should each value be a separate domain object?`
      );
    }
    for (const propArrow of propertyArrows) {
      const propElem = store2.getElem(propArrow.dstId);
      if (!propElem) continue;
      const propAttrs = propElem.attrs;
      const typeText = propAttrs.typeText ?? "";
      const optional = propAttrs.optional === true;
      const isArray = typeText.includes("[]") || typeText.includes("Array<");
      const isRecord = typeText.includes("Record<") || typeText.startsWith("{") && !typeText.includes("null");
      const propName = propElem.name.includes(".") ? propElem.name.split(".").slice(1).join(".") : propElem.name;
      const propOutgoing = store2.outgoing(propArrow.dstId);
      const typeArrows = propOutgoing.filter((a) => a.kind === "hasType");
      for (const typeArrow of typeArrows) {
        const typeElem = store2.getElem(typeArrow.dstId);
        if (!typeElem) continue;
        const targetCandidate = codeIdToCandidate.get(typeArrow.dstId);
        const existingDomain = targetCandidate ? null : existingDomainByCodeId.get(typeArrow.dstId) ?? null;
        const total = !optional && !isArray;
        const proposal = {
          id: randomUUID6(),
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
      const targetElem = store2.getElem(structArrow.dstId);
      if (!targetElem) continue;
      const arrowName = structArrow.kind === "extends" ? "extends" : "implements";
      const proposal = {
        id: randomUUID6(),
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
function extendDomainByKan(store2, options = {}) {
  const maxDepth = options.maxDepth ?? 2;
  const codeIdToDomain = /* @__PURE__ */ new Map();
  for (const domElem of store2.queryElements({ kind: "domain", limit: 1e4 })) {
    for (const arr of store2.outgoing(domElem.id)) {
      if (arr.kind === "implementedAs") {
        const entry = { id: domElem.id, name: domElem.name };
        const existing = codeIdToDomain.get(arr.dstId);
        if (existing) {
          existing.push(entry);
        } else {
          codeIdToDomain.set(arr.dstId, [entry]);
        }
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
      const cid = randomUUID6();
      shell = {
        id: cid,
        codeElementId: codeId,
        proposedName: domainName,
        proposedArrows: [],
        bridgeArrow: {
          id: randomUUID6(),
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
      const cid = randomUUID6();
      cand = {
        id: cid,
        codeElementId: id,
        proposedName: toNounPhraseFromName(name),
        proposedArrows: [],
        bridgeArrow: {
          id: randomUUID6(),
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
      id: randomUUID6(),
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
  for (const [startCodeId, domains] of codeIdToDomain) {
    const startDomain = domains[0];
    const shell = getShell(startDomain.id, startDomain.name, startCodeId);
    if (domains.length > 1) {
      console.warn(`[extendDomainByKan] Code element ${startCodeId} has ${domains.length} domain labels; using first: ${startDomain.name}`);
    }
    const seedCodeIds = /* @__PURE__ */ new Set([startCodeId]);
    const startElem = store2.getElem(startCodeId);
    if (startElem && !WALKABLE_KINDS.has(startElem.kind)) {
      for (const arr of store2.incoming(startCodeId)) {
        if (arr.kind === "memberOf") seedCodeIds.add(arr.srcId);
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
      for (const arr of store2.outgoing(item.codeId)) {
        if (arr.kind !== "callerOf") continue;
        const calleeId = arr.dstId;
        if (visited.has(calleeId)) continue;
        visited.add(calleeId);
        const callee = store2.getElem(calleeId);
        if (!callee) continue;
        if (!WALKABLE_KINDS.has(callee.kind)) continue;
        if (isExternalModule(callee.module, options.excludeModules)) continue;
        const domainEntries = codeIdToDomain.get(calleeId);
        if (domainEntries) {
          const existingDomain = domainEntries[0];
          if (domainEntries.length > 1) {
            console.warn(`[extendDomainByKan] Code element ${calleeId} has ${domainEntries.length} domain labels; using first: ${existingDomain.name}`);
          }
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

// src/tools/olog-mine-equations.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
function registerOlogMineEquations(server2, store2) {
  server2.registerTool(
    "olog_mine_equations",
    {
      description: "Discover path equations that hold (or nearly hold) in the olog graph. Tests all possible commutativity conditions between arrow paths up to the specified depth. Returns equations ranked by coverage ratio. Coverage 1.0 means the equation holds for every element tested; lower values indicate near-invariants with counterexamples.",
      inputSchema: z.object({
        maxDepth: z.number().int().min(2).max(4).default(3).describe(
          "Maximum path length to explore. Depth 2 finds 2-arrow paths, depth 3 finds 3-arrow paths. Higher = slower but more thorough."
        ),
        minCoverage: z.number().min(0).max(1).default(1).describe(
          "Minimum coverage ratio to report. 1.0 = only strict invariants. 0.8 = near-invariants that hold for 80%+ of elements."
        ),
        maxResults: z.number().int().min(1).max(500).default(50).describe("Maximum number of equations to return."),
        arrowKinds: z.array(z.string()).optional().describe(
          "Restrict to these arrow kinds. Default: all arrow kinds in use."
        ),
        elementKinds: z.array(z.string()).optional().describe(
          "Restrict seed elements to these kinds. Default: function, method, class, interface, type, import, module, domain, property."
        ),
        touchingElementKinds: z.array(z.string()).optional().describe(
          'Restrict to arrow kinds that touch elements of these kinds (i.e., arrows whose source or destination element is of one of these kinds). Useful for focusing mining on domain-relevant arrows \u2014 e.g., passing ["domain"] will only consider arrows that connect to/from domain objects. Intersected with arrowKinds if both are specified.'
        ),
        maxCounterexamples: z.number().int().min(0).max(20).default(5).describe(
          "Maximum number of counterexamples to include per equation. Counterexamples show elements where the equation fails."
        ),
        sampleSize: z.number().int().min(10).max(500).default(100).describe(
          "Number of seed elements per kind to sample. Higher = more accurate but slower."
        )
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (params) => {
      try {
        const opts = {
          maxDepth: params.maxDepth,
          minCoverage: params.minCoverage,
          maxResults: params.maxResults,
          maxCounterexamples: params.maxCounterexamples,
          sampleSize: params.sampleSize
        };
        if (params.arrowKinds) {
          opts.arrowKinds = params.arrowKinds;
        }
        if (params.elementKinds) {
          opts.elementKinds = params.elementKinds;
        }
        if (params.touchingElementKinds) {
          opts.touchingElementKinds = params.touchingElementKinds;
        }
        const results = mineEquations(store2, opts);
        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    message: "No path equations found at the specified coverage threshold.",
                    suggestion: "Try lowering minCoverage to discover near-invariants, or increasing maxDepth to find longer-path equations."
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        const formatted = results.map((r) => ({
          equation: `${r.lhsPath.join(" \u2192 ")} = ${r.rhsPath.join(" \u2192 ")}`,
          domainKind: r.domainKind,
          coverage: `${(r.coverage * 100).toFixed(1)}%`,
          support: r.support,
          total: r.total,
          counterexamples: r.counterexamples.length > 0 ? r.counterexamples.map((c) => ({
            element: `${c.elementName} (${c.elementKind})`,
            lhsReaches: c.lhsResult,
            rhsReaches: c.rhsResult
          })) : void 0
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  totalEquations: results.length,
                  parameters: {
                    maxDepth: params.maxDepth,
                    minCoverage: params.minCoverage,
                    arrowKinds: params.arrowKinds ?? "(all in use)",
                    elementKinds: params.elementKinds ?? "(defaults)",
                    touchingElementKinds: params.touchingElementKinds ?? "(all)"
                  },
                  equations: formatted
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-domain-discover.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z2 } from "zod";
function registerOlogDomainDiscover(server2, store2) {
  server2.registerTool(
    "olog_domain_discover",
    {
      description: 'Domain modeling session tool. Two-phase workflow:\n\nPHASE 1 \u2014 type-driven discovery (action="start")\nReads interface/type/class elements and proposes domain concepts with arrows derived from field types (hasProperty\u2192hasType chains) and structural relationships (extends/implements). Scope with scopeRegex to focus on one layer at a time. Review with action="refine", then action="commit" to persist.\n\nPHASE 2 \u2014 call-graph propagation (action="extend")\nAfter at least one session has been committed, run action="extend" to execute a left Kan extension of the implementedAs functor along the call graph. Starting from every committed domain element, follows callerOf edges (up to maxDepth hops, default 2) and proposes:\n  \u2022 "calls" arrows between two already-labeled domain concepts (confidence=resolved)\n  \u2022 New domain candidates for unlabeled callees, each with a "calls" arrow from the nearest upstream domain concept (confidence=tentative)\nReturns a session with shells (existing concepts gaining new arrows) and newCandidates (unlabeled functions proposed for labeling). Review with action="refine", commit with action="commit". Repeat extend\u2192refine\u2192commit to grow coverage iteratively.\n\nRecommended workflow:\n  1. start (scopeRegex on core types) \u2192 refine \u2192 commit\n  2. extend \u2192 refine \u2192 commit   (repeat until call graph is covered)\n  3. start on a broader scope to pick up remaining types\n\nActions:\n- action="start": Begin a type-driven discovery session. Optional: scopeRegex, excludeModules. Returns sessionId, candidateCount, arrowCount, candidates with proposedNames, proposedArrows, bridgeArrows, and clarifyingQuestions.\n- action="extend": Run Kan extension from committed domain elements along the call graph. Optional: maxDepth (1\u20135, default 2), excludeModules. Returns sessionId, existingWithNewArrows, newCandidates count, shells list (existing domains + new arrows), newCandidates list.\n- action="refine": Accept/reject/rename candidates in a session. Required: sessionId, responses (array of {candidateId, status: "accepted"|"rejected"|"deferred", optional nameOverride, optional arrowOverrides: [{arrowId, status, optional newName, optional totalOverride}]}). Returns accepted/rejected/pending counts and remaining pendingCandidates.\n- action="commit": Write accepted candidates and arrows to the olog. Required: sessionId, provenance ({source: "manual"|"llm", commitSha, confidence: "resolved"|"unresolved"|"tentative"}). Returns addedObjects, reusedObjects, addedArrows, addedBridges.\n- action="list": List all sessions with status, candidateCount, commitSha, createdAt.\n- action="get": Get full session details. Required: sessionId.\n- action="mine_pullbacks": Discover pullback candidates \u2014 code elements with 2+ incoming implementedAs arrows indicate shared implementations that may represent domain pullbacks. Optional: scopeRegex, excludeModules. Returns sessionId, candidates.',
      inputSchema: z2.object({
        action: z2.enum(["start", "extend", "refine", "commit", "list", "get", "mine_pullbacks"]).describe(
          '"start" \u2014 type-driven discovery from interfaces/classes. "extend" \u2014 Kan extension: propagate committed labels along the call graph. "refine" \u2014 accept/reject/rename candidates in a session. "commit" \u2014 write accepted candidates to the olog. "list" \u2014 list all sessions. "get" \u2014 fetch a session by ID. "mine_pullbacks" \u2014 discover pullback candidates from shared implementations.'
        ),
        // start
        scopeRegex: z2.string().optional().describe('(start/mine_pullbacks) Regex to restrict discovery to matching module paths (e.g. "packages/core/src/ontology")'),
        excludeModules: z2.array(z2.string()).optional().describe("(start/extend/mine_pullbacks) Module path patterns to exclude from discovery"),
        maxDepth: z2.number().int().min(1).max(5).optional().describe("(extend) Maximum call-graph hops to follow from each labeled domain element. Default 2."),
        // refine, commit, get
        sessionId: z2.string().optional().describe("(refine/commit/get) Session ID returned by start"),
        // refine
        responses: z2.array(
          z2.object({
            candidateId: z2.string(),
            status: z2.enum(["accepted", "rejected", "deferred"]),
            nameOverride: z2.string().optional().describe("Override the proposed noun phrase name"),
            arrowOverrides: z2.array(
              z2.object({
                arrowId: z2.string(),
                status: z2.enum(["accepted", "rejected", "modified"]),
                newName: z2.string().optional(),
                totalOverride: z2.boolean().optional()
              })
            ).optional()
          })
        ).optional().describe("(refine) Array of candidate responses"),
        // commit
        provenance: z2.object({
          source: z2.enum(["manual", "llm"]),
          commitSha: z2.string(),
          confidence: z2.enum(["resolved", "unresolved", "tentative"])
        }).optional().describe("(commit) Provenance metadata")
      }),
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    async (params) => {
      try {
        if (params.action === "start") {
          const discoveryOpts = {
            ...params.scopeRegex !== void 0 && { scopeRegex: params.scopeRegex },
            ...params.excludeModules !== void 0 && { excludeModules: params.excludeModules }
          };
          const candidates = discoverDomainCandidates(store2, discoveryOpts);
          const sessionId = store2.sessions.create({
            ...params.scopeRegex !== void 0 && { scopeRegex: params.scopeRegex },
            candidates,
            equations: [],
            commitSha: store2.commitSha()
          });
          const allQuestions = [];
          for (const c of candidates) {
            allQuestions.push(...c.questions);
            for (const a of c.proposedArrows) {
              if (a.question) allQuestions.push(a.question);
            }
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sessionId,
                    candidateCount: candidates.length,
                    arrowCount: candidates.reduce((n, c) => n + c.proposedArrows.length, 0),
                    candidates: candidates.map((c) => ({
                      id: c.id,
                      proposedName: c.proposedName,
                      codeElement: c.codeElementId,
                      proposedArrows: c.proposedArrows.map((a) => ({
                        id: a.id,
                        name: a.name,
                        codomain: a.codomainName,
                        total: a.total,
                        confidence: a.confidence,
                        question: a.question
                      })),
                      bridgeArrow: { name: c.bridgeArrow.name, codomain: c.bridgeArrow.codomainName },
                      questions: c.questions,
                      status: c.status
                    })),
                    clarifyingQuestions: [...new Set(allQuestions)].slice(0, 10)
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        if (params.action === "mine_pullbacks") {
          const opts = {
            ...params.scopeRegex !== void 0 && { scopeRegex: params.scopeRegex },
            ...params.excludeModules !== void 0 && { excludeModules: params.excludeModules }
          };
          const candidates = minePullbacks(store2, opts);
          const sessionId = store2.sessions.create({
            ...params.scopeRegex !== void 0 && { scopeRegex: params.scopeRegex },
            candidates,
            equations: [],
            commitSha: store2.commitSha()
          });
          const allQuestions = [];
          for (const c of candidates) {
            allQuestions.push(...c.questions);
            for (const a of c.proposedArrows) {
              if (a.question) allQuestions.push(a.question);
            }
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sessionId,
                    candidateCount: candidates.length,
                    arrowCount: candidates.reduce((n, c) => n + c.proposedArrows.length, 0),
                    candidates: candidates.map((c) => ({
                      id: c.id,
                      proposedName: c.proposedName,
                      codeElement: c.codeElementId,
                      proposedArrows: c.proposedArrows.map((a) => ({
                        id: a.id,
                        name: a.name,
                        codomain: a.codomainName,
                        total: a.total,
                        confidence: a.confidence,
                        question: a.question
                      })),
                      bridgeArrow: { name: c.bridgeArrow.name, codomain: c.bridgeArrow.codomainName },
                      questions: c.questions,
                      status: c.status
                    })),
                    clarifyingQuestions: [...new Set(allQuestions)].slice(0, 10)
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        if (params.action === "extend") {
          const kanOpts = {
            ...params.maxDepth !== void 0 && { maxDepth: params.maxDepth },
            ...params.excludeModules !== void 0 && { excludeModules: params.excludeModules }
          };
          const candidates = extendDomainByKan(store2, kanOpts);
          if (candidates.length === 0) {
            return {
              content: [{ type: "text", text: JSON.stringify({ ok: false, error: 'No committed domain elements found. Run action="start" and commit a session first.' }, null, 2) }],
              isError: true
            };
          }
          const shells = candidates.filter((c) => c.status === "accepted");
          const newCands = candidates.filter((c) => c.status === "proposed");
          const sessionId = store2.sessions.create({
            candidates,
            equations: [],
            commitSha: store2.commitSha()
          });
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                sessionId,
                existingWithNewArrows: shells.length,
                newCandidatesCount: newCands.length,
                totalArrowsProposed: candidates.reduce((n, c) => n + c.proposedArrows.length, 0),
                shells: shells.map((s) => ({
                  id: s.id,
                  domainName: s.proposedName,
                  newArrows: s.proposedArrows.map((a) => ({ id: a.id, name: a.name, codomain: a.codomainName, confidence: a.confidence }))
                })),
                newCandidates: newCands.map((c) => ({
                  id: c.id,
                  proposedName: c.proposedName,
                  codeElement: c.codeElementId,
                  calledBy: c.proposedArrows.map((a) => a.codomainName),
                  questions: c.questions
                }))
              }, null, 2)
            }]
          };
        }
        if (params.action === "refine") {
          if (!params.sessionId) {
            return { content: [{ type: "text", text: 'sessionId is required for action="refine"' }], isError: true };
          }
          if (!params.responses) {
            return { content: [{ type: "text", text: 'responses is required for action="refine"' }], isError: true };
          }
          const session = store2.sessions.get(params.sessionId);
          if (!session) {
            return {
              content: [{ type: "text", text: `Session not found: ${params.sessionId}` }],
              isError: true
            };
          }
          for (const response of params.responses) {
            const candidate = session.candidates.find((c) => c.id === response.candidateId);
            if (!candidate) continue;
            candidate.status = response.status;
            if (response.nameOverride) {
              candidate.proposedName = response.nameOverride;
            }
            if (response.arrowOverrides) {
              for (const override of response.arrowOverrides) {
                const arrow = candidate.proposedArrows.find((a) => a.id === override.arrowId);
                if (!arrow) continue;
                arrow.status = override.status;
                if (override.newName) arrow.name = override.newName;
                if (override.totalOverride !== void 0) arrow.total = override.totalOverride;
              }
            }
          }
          const rejectedIds = new Set(
            session.candidates.filter((c) => c.status === "rejected").map((c) => c.id)
          );
          for (const candidate of session.candidates) {
            candidate.proposedArrows = candidate.proposedArrows.filter(
              (a) => !a.codomainCandidateId || !rejectedIds.has(a.codomainCandidateId)
            );
          }
          store2.sessions.update(params.sessionId, { candidates: session.candidates });
          const pending = session.candidates.filter((c) => c.status === "proposed");
          const accepted = session.candidates.filter((c) => c.status === "accepted");
          const rejected = session.candidates.filter((c) => c.status === "rejected");
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sessionId: params.sessionId,
                    summary: { accepted: accepted.length, rejected: rejected.length, pending: pending.length },
                    pendingCandidates: pending.map((c) => ({
                      id: c.id,
                      proposedName: c.proposedName,
                      questions: c.questions
                    }))
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        if (params.action === "commit") {
          if (!params.sessionId) {
            return { content: [{ type: "text", text: 'sessionId is required for action="commit"' }], isError: true };
          }
          if (!params.provenance) {
            return { content: [{ type: "text", text: 'provenance is required for action="commit"' }], isError: true };
          }
          const session = store2.sessions.get(params.sessionId);
          if (!session) {
            return {
              content: [{ type: "text", text: `Session not found: ${params.sessionId}` }],
              isError: true
            };
          }
          if (session.status !== "active") {
            return {
              content: [
                {
                  type: "text",
                  text: `Session is already ${session.status}`
                }
              ],
              isError: true
            };
          }
          const accepted = session.candidates.filter((c) => c.status === "accepted");
          if (accepted.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: 'No accepted candidates to commit. Use action="refine" to accept candidates first.'
                }
              ],
              isError: true
            };
          }
          const prov = {
            source: params.provenance.source,
            commitSha: params.provenance.commitSha,
            ingestedAt: Date.now(),
            confidence: params.provenance.confidence
          };
          const candidateToElemId = /* @__PURE__ */ new Map();
          let addedObjects = 0;
          let reusedObjects = 0;
          let addedArrows = 0;
          let addedBridges = 0;
          const existingDomainByCodeId = getExistingDomainElementsByCodeId(store2);
          for (const candidate of accepted) {
            const existing = existingDomainByCodeId.get(candidate.codeElementId);
            if (existing) {
              candidateToElemId.set(candidate.id, existing.id);
              reusedObjects++;
            } else {
              const elemId = `domain:${candidate.id}`;
              candidateToElemId.set(candidate.id, elemId);
              store2.addElement({
                id: elemId,
                kind: "domain",
                name: candidate.proposedName,
                module: null,
                span: null,
                attrs: { codeElementId: candidate.codeElementId }
              });
              store2.addProvenance(elemId, prov);
              addedObjects++;
            }
          }
          for (const candidate of accepted) {
            const srcId = candidateToElemId.get(candidate.id);
            const isNew = !existingDomainByCodeId.has(candidate.codeElementId);
            for (const arrow of candidate.proposedArrows) {
              if (arrow.status === "rejected") continue;
              let dstId;
              if (arrow.codomainCandidateId) {
                dstId = candidateToElemId.get(arrow.codomainCandidateId);
              }
              if (!dstId && arrow.codomainExistingElemId) {
                dstId = arrow.codomainExistingElemId;
              }
              if (!dstId) continue;
              const arrowId = `${srcId}:${arrow.name.replace(/\s+/g, "-")}:${dstId}`;
              store2.addArrow({
                id: arrowId,
                kind: "other",
                srcId,
                dstId,
                attrs: { name: arrow.name, total: arrow.total }
              });
              addedArrows++;
            }
            const bridgeArrow = candidate.bridgeArrow;
            if (bridgeArrow.status !== "rejected" && isNew) {
              const domElemId = candidateToElemId.get(candidate.id);
              const bridgeId = `${domElemId}:implementedAs:${candidate.codeElementId}`;
              store2.addArrow({
                id: bridgeId,
                kind: "implementedAs",
                srcId: domElemId,
                dstId: candidate.codeElementId,
                attrs: {}
              });
              addedBridges++;
            }
          }
          store2.sessions.update(params.sessionId, { status: "committed" });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sessionId: params.sessionId,
                    status: "committed",
                    addedObjects,
                    reusedObjects,
                    addedArrows,
                    addedBridges
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        if (params.action === "list") {
          const sessions = store2.sessions.list();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  sessions.map((s) => ({
                    id: s.id,
                    status: s.status,
                    scopeRegex: s.scopeRegex,
                    candidateCount: s.candidates.length,
                    commitSha: s.commitSha,
                    createdAt: new Date(s.createdAt).toISOString()
                  })),
                  null,
                  2
                )
              }
            ]
          };
        }
        if (params.action === "get") {
          if (!params.sessionId) {
            return { content: [{ type: "text", text: 'sessionId is required for action="get"' }], isError: true };
          }
          const session = store2.sessions.get(params.sessionId);
          if (!session) {
            return {
              content: [{ type: "text", text: `Session not found: ${params.sessionId}` }],
              isError: true
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(session, null, 2)
              }
            ]
          };
        }
        return {
          content: [{ type: "text", text: "Unknown action" }],
          isError: true
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-discover-motifs.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z3 } from "zod";
function registerOlogDiscoverMotifs(server2, store2) {
  server2.registerTool(
    "olog_discover_motifs",
    {
      description: 'Motif discovery session tool. Finds recurring structural patterns (motifs) in the olog graph by extracting ego-graphs around seed elements, grouping by shape similarity, and surfacing high-support patterns with optional internal equation mining.\n\nActions:\n- action="start": Begin a new discovery session. Optional: seedKinds (element kinds to use as seeds, default ["function","class","interface"]), depth (ego-graph expansion depth, default 2), arrowKinds (arrow kinds to follow during expansion), minSupport (minimum instance count, default 3), mineEquations (whether to mine internal equations, default true), scopeRegex (regex to restrict seeds to specific modules), excludeModules (module patterns to exclude). Returns sessionId, candidateCount, and the full list of candidates with proposedNames, shapes, support counts, instances, equations, and clarifying questions.\n- action="refine": Accept/reject/rename candidates. Required: sessionId (string, from start), responses (array of objects with candidateId, status ("accepted"|"rejected"|"deferred"), optional nameOverride string). Returns summary with accepted/rejected/pending counts and remaining pendingCandidates.\n- action="commit": Write accepted motif templates as domain elements to the olog. Required: sessionId, provenance (object with source: "manual"|"llm", commitSha: string, confidence: "resolved"|"unresolved"|"tentative"). Returns sessionId, status "committed", and addedTemplates count. At least one candidate must be accepted before committing.\n- action="list": List all motif discovery sessions. Returns array of session summaries.\n- action="get": Get details of a specific session. Required: sessionId. Returns the full session object including candidates and their status.',
      inputSchema: z3.object({
        action: z3.enum(["start", "refine", "commit", "list", "get"]).describe(
          'Action to perform: "start" begins a new session, "refine" accepts/rejects candidates, "commit" writes to the olog, "list" shows all sessions, "get" returns a session by ID.'
        ),
        // start
        seedKinds: z3.array(z3.string()).optional().describe('(start) Element kinds to use as seeds (default: ["function", "class", "interface"])'),
        depth: z3.number().optional().describe("(start) Ego-graph expansion depth (default: 2)"),
        arrowKinds: z3.array(z3.string()).optional().describe("(start) Arrow kinds to follow during expansion"),
        minSupport: z3.number().optional().describe("(start) Minimum support for a motif to be surfaced (default: 3)"),
        mineEquations: z3.boolean().optional().describe("(start) Whether to mine equations internal to each motif (default: true)"),
        scopeRegex: z3.string().optional().describe("(start) Regex to restrict seeds to specific modules"),
        excludeModules: z3.array(z3.string()).optional().describe("(start) Module patterns to exclude"),
        // refine, commit, get
        sessionId: z3.string().optional().describe("(refine/commit/get) Session ID returned by start"),
        // refine
        responses: z3.array(
          z3.object({
            candidateId: z3.string(),
            status: z3.enum(["accepted", "rejected", "deferred"]),
            nameOverride: z3.string().optional().describe("Override the proposed noun phrase name")
          })
        ).optional().describe("(refine) Array of candidate responses"),
        // commit
        provenance: z3.object({
          source: z3.enum(["manual", "llm"]),
          commitSha: z3.string(),
          confidence: z3.enum(["resolved", "unresolved", "tentative"])
        }).optional().describe("(commit) Provenance metadata")
      }),
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    async (params) => {
      try {
        if (params.action === "start") {
          const discoveryOpts = {
            ...params.seedKinds !== void 0 && { seedKinds: params.seedKinds },
            ...params.depth !== void 0 && { depth: params.depth },
            ...params.arrowKinds !== void 0 && { arrowKinds: params.arrowKinds },
            ...params.minSupport !== void 0 && { minSupport: params.minSupport },
            ...params.mineEquations !== void 0 && { mineEquations: params.mineEquations },
            ...params.scopeRegex !== void 0 && { scopeRegex: params.scopeRegex },
            ...params.excludeModules !== void 0 && { excludeModules: params.excludeModules }
          };
          const candidates = discoverMotifs(store2, discoveryOpts);
          const sessionId = store2.motifSessions.create({
            ...params.scopeRegex !== void 0 && { scopeRegex: params.scopeRegex },
            candidates,
            commitSha: store2.commitSha()
          });
          const allQuestions = [];
          for (const c of candidates) {
            allQuestions.push(...c.questions);
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sessionId,
                    candidateCount: candidates.length,
                    candidates: candidates.map((c) => ({
                      id: c.id,
                      proposedName: c.proposedName,
                      shape: {
                        hash: c.shape.hash,
                        objects: c.shape.objects,
                        arrows: c.shape.arrows
                      },
                      support: c.support,
                      instanceCount: c.instances.length,
                      equations: c.equations,
                      questions: c.questions,
                      status: c.status
                    })),
                    clarifyingQuestions: [...new Set(allQuestions)].slice(0, 10)
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        if (params.action === "refine") {
          if (!params.sessionId) {
            return { content: [{ type: "text", text: 'sessionId is required for action="refine"' }], isError: true };
          }
          if (!params.responses) {
            return { content: [{ type: "text", text: 'responses is required for action="refine"' }], isError: true };
          }
          const session = store2.motifSessions.get(params.sessionId);
          if (!session) {
            return {
              content: [{ type: "text", text: `Session not found: ${params.sessionId}` }],
              isError: true
            };
          }
          for (const response of params.responses) {
            const candidate = session.candidates.find((c) => c.id === response.candidateId);
            if (!candidate) continue;
            candidate.status = response.status;
            if (response.nameOverride) {
              candidate.proposedName = response.nameOverride;
            }
          }
          store2.motifSessions.update(params.sessionId, { candidates: session.candidates });
          const pending = session.candidates.filter((c) => c.status === "proposed");
          const accepted = session.candidates.filter((c) => c.status === "accepted");
          const rejected = session.candidates.filter((c) => c.status === "rejected");
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sessionId: params.sessionId,
                    summary: { accepted: accepted.length, rejected: rejected.length, pending: pending.length },
                    pendingCandidates: pending.map((c) => ({
                      id: c.id,
                      proposedName: c.proposedName,
                      questions: c.questions
                    }))
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        if (params.action === "commit") {
          if (!params.sessionId) {
            return { content: [{ type: "text", text: 'sessionId is required for action="commit"' }], isError: true };
          }
          if (!params.provenance) {
            return { content: [{ type: "text", text: 'provenance is required for action="commit"' }], isError: true };
          }
          const session = store2.motifSessions.get(params.sessionId);
          if (!session) {
            return {
              content: [{ type: "text", text: `Session not found: ${params.sessionId}` }],
              isError: true
            };
          }
          if (session.status !== "active") {
            return {
              content: [
                {
                  type: "text",
                  text: `Session is already ${session.status}`
                }
              ],
              isError: true
            };
          }
          const accepted = session.candidates.filter((c) => c.status === "accepted");
          if (accepted.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: 'No accepted candidates to commit. Use action="refine" to accept candidates first.'
                }
              ],
              isError: true
            };
          }
          const prov = {
            source: params.provenance.source,
            commitSha: params.provenance.commitSha,
            ingestedAt: Date.now(),
            confidence: params.provenance.confidence
          };
          let totalInstances = 0;
          for (const candidate of accepted) {
            const templateId = `motif:${candidate.id}`;
            store2.addMotifTemplate({
              id: templateId,
              name: candidate.proposedName,
              description: candidate.description,
              shape: candidate.shape,
              equations: candidate.equations,
              provenance: prov
            });
            for (let i = 0; i < candidate.instances.length; i++) {
              const instance = candidate.instances[i];
              if (!instance) continue;
              store2.addMotifInstance({
                id: `instance:${candidate.id}:${i}`,
                templateId,
                mappings: instance.mappings,
                provenance: prov
              });
              totalInstances++;
            }
          }
          store2.motifSessions.update(params.sessionId, { status: "committed" });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sessionId: params.sessionId,
                    status: "committed",
                    addedTemplates: accepted.length,
                    addedInstances: totalInstances
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        if (params.action === "list") {
          const sessions = store2.motifSessions.list();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  sessions.map((s) => ({
                    id: s.id,
                    status: s.status,
                    scopeRegex: s.scopeRegex,
                    candidateCount: s.candidates.length,
                    commitSha: s.commitSha,
                    createdAt: new Date(s.createdAt).toISOString()
                  })),
                  null,
                  2
                )
              }
            ]
          };
        }
        if (params.action === "get") {
          if (!params.sessionId) {
            return { content: [{ type: "text", text: 'sessionId is required for action="get"' }], isError: true };
          }
          const session = store2.motifSessions.get(params.sessionId);
          if (!session) {
            return {
              content: [{ type: "text", text: `Session not found: ${params.sessionId}` }],
              isError: true
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(session, null, 2)
              }
            ]
          };
        }
        return {
          content: [{ type: "text", text: "Unknown action" }],
          isError: true
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true
        };
      }
    }
  );
}

// src/index-mining.ts
var projectRoot = process.env.OLOG_ROOT || process.cwd();
var ologDir = join(projectRoot, ".olog");
try {
  mkdirSync(ologDir, { recursive: true });
} catch (err) {
  console.error(
    `[olog-mining] Failed to create ${ologDir}: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}
var dbPath = join(ologDir, "olog.sqlite");
var store = new OlogStore(dbPath);
var server = new McpServer4(
  { name: "olog-mining", version: "0.0.1" },
  {
    instructions: `Mining tools for the olog at ${projectRoot}. Reads the DB owned by the core olog server. Use domain=["domain"] in mine_equations to focus on domain elements.`,
    capabilities: { logging: {} }
  }
);
registerOlogMineEquations(server, store);
registerOlogDomainDiscover(server, store);
registerOlogDiscoverMotifs(server, store);
var transport = new StdioServerTransport();
await server.connect(transport);
console.error("[olog-mining] MCP server connected on stdio");
var cleanup = () => {
  try {
    store.close();
  } catch {
  }
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
//# sourceMappingURL=index-mining.js.map