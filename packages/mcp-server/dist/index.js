#!/usr/bin/env node

// src/index.ts
import { mkdirSync } from "fs";
import { join as join4 } from "path";
import { McpServer as McpServer13 } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// ../core/src/db.ts
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// ../core/src/domain/session.ts
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

// ../core/src/traverse.ts
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

// ../core/src/db.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var OlogStore = class {
  db;
  _sessions;
  getElemStmt;
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
  constructor(path2) {
    this.db = new Database(path2);
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
      "INSERT INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
    );
    this.insertProvStmt = this.db.prepare(
      "INSERT INTO olog_prov (elem_id, source, commit_sha, ingested_at, confidence) VALUES (?, ?, ?, ?, ?)"
    );
    this.hasArrowKindStmt = this.db.prepare(
      "SELECT 1 FROM olog_arr WHERE kind = ? LIMIT 1"
    );
    this._sessions = new DomainSessionStore(this.db);
  }
  get sessions() {
    return this._sessions;
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
      for (const a of manualArrs) {
        insertArr.run(a.id, a.kind, a.src_id, a.dst_id, a.attrs);
      }
      for (const p of manualProvs) {
        this.insertProvStmt.run(p.elem_id, p.source, p.commit_sha, p.ingested_at, p.confidence ?? "resolved");
      }
      updateMeta.run(sha);
    });
    tx();
    return elems.length;
  }
  getElem(id) {
    const row = this.getElemStmt.get(id);
    if (!row) return null;
    return this.rowToElem(row);
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
    const join5 = opts.minConfidence ? " INNER JOIN olog_prov p ON e.id = p.elem_id" : "";
    const sql = `SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_elem e${join5} ${where} ORDER BY e.module, e.name LIMIT ?`;
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

// ../core/src/constraints.ts
import { randomUUID as randomUUID2 } from "crypto";
var CONFIDENCE_RANK = {
  tentative: 0,
  unresolved: 1,
  resolved: 2
};
function evaluateConstraints(store2, _operations) {
  const violations = [];
  const constraints = store2.getConstraints();
  for (const constraint of constraints) {
    violations.push(...evaluateConstraint(store2, constraint));
  }
  return { valid: violations.length === 0, violations };
}
function evaluateConstraint(store2, constraint) {
  switch (constraint.kind) {
    case "existence":
      return evaluateExistence(store2, constraint);
    case "layering":
      return evaluateLayering(store2, constraint);
    case "monotonicity":
      return evaluateMonotonicity(store2, constraint);
    case "totality":
      return evaluateTotality(store2, constraint);
    default:
      return [];
  }
}
function evaluateExistence(store2, constraint) {
  const kind = constraint.config.kind;
  if (!kind) return [];
  const elements = store2.queryElements({ kind, limit: 1 });
  if (elements.length > 0) return [];
  return [
    {
      id: randomUUID2(),
      kind: "integrity",
      humanMessage: constraint.message ?? `Existence constraint "${constraint.name}" violated: no elements of kind "${kind}" exist`,
      involved: []
    }
  ];
}
function evaluateLayering(store2, constraint) {
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
  const allElems = store2.queryElements({ kind: "any", limit: 5e4 });
  for (const elem of allElems) {
    const srcLayer = layerIndexOf(elem.module);
    if (srcLayer === null) continue;
    const outgoing = store2.outgoing(elem.id);
    for (const arr of outgoing) {
      const dstElem = store2.getElem(arr.dstId);
      if (!dstElem) continue;
      const dstLayer = layerIndexOf(dstElem.module);
      if (dstLayer === null) continue;
      if (srcLayer < dstLayer) {
        violations.push({
          id: randomUUID2(),
          kind: "integrity",
          humanMessage: constraint.message ?? `Layering constraint "${constraint.name}" violated: "${elem.name}" (layer ${srcLayer}) references "${dstElem.name}" (layer ${dstLayer})`,
          involved: [elem.id, dstElem.id]
        });
      }
    }
  }
  return violations;
}
function evaluateMonotonicity(store2, constraint) {
  const violations = [];
  const allElems = store2.queryElements({ kind: "any", limit: 5e4 });
  for (const elem of allElems) {
    const srcProv = store2.getProvenance(elem.id);
    if (!srcProv) continue;
    const outgoing = store2.outgoing(elem.id);
    for (const arr of outgoing) {
      const dstProv = store2.getProvenance(arr.dstId);
      if (!dstProv) continue;
      if (CONFIDENCE_RANK[dstProv.confidence] > CONFIDENCE_RANK[srcProv.confidence]) {
        const dstElem = store2.getElem(arr.dstId);
        violations.push({
          id: randomUUID2(),
          kind: "integrity",
          humanMessage: constraint.message ?? `Monotonicity constraint "${constraint.name}" violated: "${elem.name}" (${srcProv.confidence}) \u2192 "${dstElem?.name ?? arr.dstId}" (${dstProv.confidence})`,
          involved: [elem.id, arr.dstId]
        });
      }
    }
  }
  return violations;
}
function evaluateTotality(store2, constraint) {
  const arrowKind = constraint.config.arrowKind;
  const domainKind = constraint.config.domainKind;
  if (!arrowKind || !domainKind) return [];
  const violations = [];
  const domainElems = store2.queryElements({ kind: domainKind, limit: 5e4 });
  for (const elem of domainElems) {
    const outgoing = store2.outgoing(elem.id);
    const matching = outgoing.filter((a) => a.kind === arrowKind);
    if (matching.length === 0) {
      violations.push({
        id: randomUUID2(),
        kind: "integrity",
        humanMessage: constraint.message ?? `Totality constraint "${constraint.name}" violated: "${elem.name}" has no outgoing "${arrowKind}" arrow`,
        involved: [elem.id]
      });
    } else if (matching.length > 1) {
      violations.push({
        id: randomUUID2(),
        kind: "integrity",
        humanMessage: constraint.message ?? `Totality constraint "${constraint.name}" violated: "${elem.name}" has ${matching.length} outgoing "${arrowKind}" arrows (expected exactly 1)`,
        involved: [elem.id, ...matching.map((a) => a.id)]
      });
    }
  }
  return violations;
}
function evaluatePathEquations(store2, _operations) {
  const violations = [];
  const equations = store2.getEquations();
  for (const eq of equations) {
    const result = evaluateEquation(eq, store2);
    if (!result.valid) {
      violations.push({
        id: randomUUID2(),
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
function evaluateEquation(eq, store2) {
  const lhsSrc = store2.getElem(eq.lhs.src);
  if (!lhsSrc) {
    return {
      valid: true,
      involved: [],
      message: `Equation "${eq.name}": source "${eq.lhs.src}" not in store, skipping`
    };
  }
  const rhsSrc = store2.getElem(eq.rhs.src);
  if (!rhsSrc) {
    return {
      valid: true,
      involved: [],
      message: `Equation "${eq.name}": source "${eq.rhs.src}" not in store, skipping`
    };
  }
  const lhsSchemaKind = isSchemaElement(lhsSrc);
  if (lhsSchemaKind) {
    return evaluateSchemaEquation(eq, store2, lhsSchemaKind);
  }
  return evaluateConcreteEquation(eq, store2, lhsSrc.id);
}
function evaluateSchemaEquation(eq, store2, schemaKind) {
  const concreteElems = store2.queryElements({ kind: schemaKind, limit: 5e4 });
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
    const result = evaluateConcreteEquation(eq, store2, elem.id);
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
function evaluateConcreteEquation(eq, store2, startId) {
  const lhsSteps = eq.lhs.arrows.map((kind) => ({
    kind,
    direction: "out"
  }));
  const rhsSteps = eq.rhs.arrows.map((kind) => ({
    kind,
    direction: "out"
  }));
  const lhsReached = followPath(store2, startId, lhsSteps);
  const rhsReached = followPath(store2, startId, rhsSteps);
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
function followPath(store2, startId, steps) {
  if (steps.length === 0) {
    const elem = store2.getElem(startId);
    return elem ? [elem] : [];
  }
  let currentIds = /* @__PURE__ */ new Set([startId]);
  for (const step of steps) {
    if (currentIds.size === 0) return [];
    const nextIds = /* @__PURE__ */ new Set();
    for (const id of currentIds) {
      const arrows = step.direction === "out" ? store2.outgoing(id) : store2.incoming(id);
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
    const elem = store2.getElem(id);
    if (elem) result.push(elem);
  }
  return result;
}

// ../core/src/equations.ts
function isNounPhrase(name) {
  const trimmed = name.trim();
  const withoutPrefix = trimmed.replace(/^(a|an|the)\s+/i, "");
  return /^[A-Z]/.test(withoutPrefix);
}
function validateEquation(eq, store2, proposedArrowKinds) {
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
    if (!store2.hasArrowKind(kind)) {
      errors.push(
        `Equation "${eq.name}": arrow kind "${kind}" does not exist in the database or concurrent proposal`
      );
    }
  }
  return { valid: errors.length === 0, errors };
}

// ../core/src/ingest/ids.ts
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

// ../core/src/ingest/project.ts
import { globSync } from "glob";
import { readFileSync as readFileSync2, statSync } from "fs";
import { resolve as resolve2, relative, basename, dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { execSync } from "child_process";

// ../core/src/ingest/treesitter.ts
import Parser from "tree-sitter";
import TS from "tree-sitter-typescript";
import fs from "fs";
import path from "path";
function formatSpan2(node) {
  const s = node.startPosition;
  const e = node.endPosition;
  return `${s.row + 1}:${s.column + 1}-${e.row + 1}:${e.column + 1}`;
}
function asKind(kind) {
  return kind;
}
function findContainingFunctionName(node) {
  let cur = node.parent;
  while (cur !== null) {
    switch (cur.type) {
      case "function_declaration":
      case "generator_function_declaration":
      case "method_definition": {
        const nameNode = cur.childForFieldName("name");
        if (nameNode) return nameNode.text;
        break;
      }
      case "arrow_function": {
        if (cur.parent?.type === "variable_declarator") {
          const varName = cur.parent.childForFieldName("name");
          if (varName) return varName.text;
        }
        break;
      }
      case "function_expression": {
        const nameNode = cur.childForFieldName("name");
        if (nameNode) return nameNode.text;
        if (cur.parent?.type === "variable_declarator") {
          const varName = cur.parent.childForFieldName("name");
          if (varName) return varName.text;
        }
        break;
      }
    }
    cur = cur.parent;
  }
  return null;
}
function parserFor(filename) {
  const parser = new Parser();
  const ext = path.extname(filename);
  switch (ext) {
    case ".ts":
    case ".mts":
    case ".cts":
      parser.setLanguage(TS.typescript);
      break;
    case ".tsx":
      parser.setLanguage(TS.tsx);
      break;
    default:
      throw new Error(`Unsupported file extension: ${ext}`);
  }
  return parser;
}
function extractFromFile(parser, source, queryPath) {
  const scmContent = fs.readFileSync(queryPath, "utf-8");
  const language = parser.getLanguage();
  const query = new Parser.Query(language, scmContent);
  const tree = parser.parse(source);
  if (tree.rootNode.hasError) {
    console.error("Warning: parse errors detected in source");
  }
  const elements = [];
  const arrows = [];
  for (const match of query.matches(tree.rootNode)) {
    const byName = /* @__PURE__ */ new Map();
    for (const cap of match.captures) {
      const arr = byName.get(cap.name);
      if (arr) {
        arr.push(cap);
      } else {
        byName.set(cap.name, [cap]);
      }
    }
    const first = (name) => {
      const arr = byName.get(name);
      return arr ? arr[0] : void 0;
    };
    for (const cap of byName.get("function.name") ?? []) {
      const n = cap.node;
      elements.push({ kind: "function", name: n.text, module: "", span: formatSpan2(n), attrs: {} });
    }
    for (const cap of byName.get("class.name") ?? []) {
      const n = cap.node;
      elements.push({ kind: "class", name: n.text, module: "", span: formatSpan2(n), attrs: {} });
    }
    for (const cap of byName.get("interface.name") ?? []) {
      const n = cap.node;
      elements.push({ kind: "interface", name: n.text, module: "", span: formatSpan2(n), attrs: {} });
    }
    for (const cap of byName.get("typealias.name") ?? []) {
      const n = cap.node;
      elements.push({ kind: "type", name: n.text, module: "", span: formatSpan2(n), attrs: {} });
    }
    for (const cap of byName.get("enum.name") ?? []) {
      const n = cap.node;
      elements.push({ kind: "enum", name: n.text, module: "", span: formatSpan2(n), attrs: {} });
    }
    for (const cap of byName.get("method.name") ?? []) {
      const n = cap.node;
      elements.push({ kind: "method", name: n.text, module: "", span: formatSpan2(n), attrs: {} });
    }
    for (const cap of byName.get("import.name") ?? []) {
      const n = cap.node;
      const sourceCap = first("import.source");
      const sourceModule = sourceCap ? sourceCap.node.text : "";
      elements.push({ kind: "import", name: n.text, module: "", span: formatSpan2(n), attrs: sourceModule ? { sourceModule } : {} });
    }
    if (first("import.default")) {
      const n = first("import.default").node;
      const sourceCap = first("import.source");
      const sourceModule = sourceCap ? sourceCap.node.text : "";
      elements.push({ kind: "import", name: n.text, module: "", span: formatSpan2(n), attrs: sourceModule ? { sourceModule } : {} });
    }
    if (first("import.namespace")) {
      const n = first("import.namespace").node;
      const sourceCap = first("import.source");
      const sourceModule = sourceCap ? sourceCap.node.text : "";
      elements.push({ kind: "import", name: n.text, module: "", span: formatSpan2(n), attrs: sourceModule ? { sourceModule } : {} });
    }
    for (const srcCap of ["import.source", "reexport.source", "require.source"]) {
      if (first(srcCap)) {
        const n = first(srcCap).node;
        arrows.push({ kind: "imports", srcModule: "", srcName: "", dstModule: n.text, dstName: "", attrs: {} });
      }
    }
    if (first("import.source")) {
      const moduleNode = first("import.source").node;
      const moduleStr = moduleNode.text;
      for (const impCap of byName.get("import.name") ?? []) {
        arrows.push({ kind: asKind("importsFrom"), srcModule: "", srcName: impCap.node.text, dstModule: moduleStr, dstName: "", attrs: { module: moduleStr } });
      }
      if (first("import.default")) {
        arrows.push({ kind: asKind("importsFrom"), srcModule: "", srcName: first("import.default").node.text, dstModule: moduleStr, dstName: "", attrs: { module: moduleStr } });
      }
      if (first("import.namespace")) {
        arrows.push({ kind: asKind("importsFrom"), srcModule: "", srcName: first("import.namespace").node.text, dstModule: moduleStr, dstName: "", attrs: { module: moduleStr } });
      }
    }
    if (first("call.callee")) {
      const calleeNode = first("call.callee").node;
      const callNode = first("call")?.node ?? first("call.member")?.node;
      const fnName = callNode ? findContainingFunctionName(callNode) : null;
      arrows.push({ kind: "calls", srcModule: "", srcName: fnName ?? "", dstModule: "", dstName: calleeNode.text, attrs: {} });
      if (fnName) {
        arrows.push({ kind: asKind("callerOf"), srcModule: "", srcName: fnName, dstModule: "", dstName: calleeNode.text, attrs: {} });
        arrows.push({ kind: asKind("calleeOf"), srcModule: "", srcName: calleeNode.text, dstModule: "", dstName: fnName, attrs: {} });
      }
    }
    if (first("call.method")) {
      const methodNode = first("call.method").node;
      const callNode = first("call.member")?.node ?? first("call")?.node;
      const fnName = callNode ? findContainingFunctionName(callNode) : null;
      arrows.push({ kind: "calls", srcModule: "", srcName: fnName ?? "", dstModule: "", dstName: methodNode.text, attrs: {} });
      if (fnName) {
        arrows.push({ kind: asKind("callerOf"), srcModule: "", srcName: fnName, dstModule: "", dstName: methodNode.text, attrs: {} });
        arrows.push({ kind: asKind("calleeOf"), srcModule: "", srcName: methodNode.text, dstModule: "", dstName: fnName, attrs: {} });
      }
    }
    if (first("new.ctor")) {
      const ctorNode = first("new.ctor").node;
      const newNode = first("new")?.node;
      const fnName = newNode ? findContainingFunctionName(newNode) : null;
      arrows.push({ kind: "calls", srcModule: "", srcName: fnName ?? "", dstModule: "", dstName: ctorNode.text, attrs: {} });
      if (fnName) {
        arrows.push({ kind: asKind("callerOf"), srcModule: "", srcName: fnName, dstModule: "", dstName: ctorNode.text, attrs: {} });
        arrows.push({ kind: asKind("calleeOf"), srcModule: "", srcName: ctorNode.text, dstModule: "", dstName: fnName, attrs: {} });
      }
    }
    if (first("memberof.method") && first("memberof.class")) {
      const methodNode = first("memberof.method").node;
      const classNode = first("memberof.class").node;
      arrows.push({ kind: asKind("memberOf"), srcModule: "", srcName: methodNode.text, dstModule: "", dstName: classNode.text, attrs: {} });
    }
  }
  if ("delete" in tree && typeof tree.delete === "function") {
    tree.delete();
  }
  return { elements, arrows };
}
function collectTypeIdentifiers(node) {
  const result = [];
  if (node.type === "type_identifier") {
    result.push(node.text);
  }
  for (const child of node.children) {
    result.push(...collectTypeIdentifiers(child));
  }
  return result;
}
function walkDescendants(node, visitor) {
  for (const child of node.children) {
    visitor(child);
    walkDescendants(child, visitor);
  }
}
function extractPropertyFromNode(node, parentName, parentKind) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const name = nameNode.text;
  const optional = node.children.some((c) => c.type === "?");
  const isReadonly = node.children.some((c) => c.type === "readonly");
  const typeAnnotation = node.childForFieldName("type");
  const typeText = typeAnnotation ? typeAnnotation.text : "";
  const typeRefs = typeAnnotation ? collectTypeIdentifiers(typeAnnotation) : [];
  const span = formatSpan2(nameNode);
  return { name, span, typeText, optional, readonly: isReadonly, typeRefs, parentName, parentKind };
}
function extractPropertiesFromFile(parser, source, _moduleName) {
  const tree = parser.parse(source);
  const result = [];
  walkDescendants(tree.rootNode, (node) => {
    if (node.type === "interface_declaration") {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) return;
      const parentName = nameNode.text;
      const body = node.children.find((c) => c.type === "object_type");
      if (!body) return;
      for (const child of body.children) {
        if (child.type === "property_signature") {
          const prop = extractPropertyFromNode(child, parentName, "interface");
          if (prop) result.push(prop);
        }
      }
    } else if (node.type === "type_alias_declaration") {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) return;
      const parentName = nameNode.text;
      const typeNode = node.childForFieldName("type");
      if (!typeNode) return;
      if (typeNode.type === "object_type") {
        for (const child of typeNode.children) {
          if (child.type === "property_signature") {
            const prop = extractPropertyFromNode(child, parentName, "type");
            if (prop) result.push(prop);
          }
        }
      }
    } else if (node.type === "class_declaration") {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) return;
      const parentName = nameNode.text;
      const body = node.children.find((c) => c.type === "class_body");
      if (!body) return;
      for (const child of body.children) {
        if (child.type === "public_field_definition") {
          const prop = extractPropertyFromNode(child, parentName, "class");
          if (prop) result.push(prop);
        }
      }
    }
  });
  if ("delete" in tree && typeof tree.delete === "function") {
    tree.delete();
  }
  return result;
}

// ../core/src/ingest/project.ts
var IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/.olog/**",
  "**/*.d.ts"
];
var ONE_MB = 1024 * 1024;
function resolveImportSpecifier(specifier, importingFileRelativePath) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return specifier;
  }
  const importingDir = dirname2(importingFileRelativePath);
  const joined = importingDir + "/" + specifier.replace(/^\.\//, "");
  const normalized = normalizePath(joined);
  return normalized.replace(/\.(js|cjs|mjs|jsx)$/, ".ts");
}
function normalizePath(path2) {
  const parts = path2.split("/");
  const result = [];
  for (const part of parts) {
    if (part === "..") {
      result.pop();
    } else if (part !== "." && part !== "") {
      result.push(part);
    }
  }
  return result.join("/");
}
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = dirname2(__filename2);
var TS_QUERY_PATH = resolve2(__dirname2, "queries", "ts.scm");
var TSX_QUERY_PATH = resolve2(__dirname2, "queries", "tsx.scm");
function discoverTsFiles(projectRoot2) {
  return globSync("**/*.{ts,tsx,mts,cts}", {
    cwd: projectRoot2,
    ignore: IGNORE_PATTERNS,
    absolute: true
  });
}
function ingestProject(projectRoot2, store2) {
  const start2 = Date.now();
  let head;
  try {
    head = execSync("git rev-parse HEAD", { cwd: projectRoot2, encoding: "utf8" }).trim();
  } catch {
    head = "nogit";
  }
  if (head !== "nogit" && store2.isFresh(head)) {
    return {
      filesProcessed: 0,
      elementsCreated: 0,
      arrowsCreated: 0,
      durationMs: Date.now() - start2
    };
  }
  const result = runIngestion(projectRoot2, store2, head);
  return { ...result, durationMs: Date.now() - start2 };
}
function reindexProject(projectRoot2, store2) {
  const start2 = Date.now();
  let head;
  try {
    head = execSync("git rev-parse HEAD", { cwd: projectRoot2, encoding: "utf8" }).trim();
  } catch {
    head = "nogit";
  }
  const result = runIngestion(projectRoot2, store2, head);
  return { ...result, durationMs: Date.now() - start2 };
}
function runIngestion(projectRoot2, store2, head) {
  const files = discoverTsFiles(projectRoot2);
  const elems = [];
  const arrs = [];
  let filesProcessed = 0;
  const createdModuleIds = /* @__PURE__ */ new Set();
  const filesToExtract = [];
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
    const relativePath = relative(projectRoot2, absolutePath);
    const parser = parserFor(absolutePath);
    const queryPath = absolutePath.endsWith(".tsx") ? TSX_QUERY_PATH : TS_QUERY_PATH;
    let extracted;
    try {
      extracted = extractFromFile(parser, source, queryPath);
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
        const resolvedModule = resolveImportSpecifier(rawModule, relativePath);
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
          const resolvedSourceModule = resolveImportSpecifier(sourceModule, relativePath);
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
      filesToExtract.push({ relativePath, source, parser, nameToId });
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
  for (const { relativePath, source, parser: fileParser, nameToId: fileNameToId } of filesToExtract) {
    let properties;
    try {
      properties = extractPropertiesFromFile(fileParser, source, relativePath);
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
  store2.ingestFull(elems, arrs, head);
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

// ../core/src/render/index.ts
import { readFileSync as readFileSync4 } from "fs";
import { join as join2 } from "path";

// ../core/src/render/edit.ts
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
async function applySourceEdits(edits, projectRoot2, readFile, writeFile) {
  const { readFile: fsReadFile, writeFile: fsWriteFile } = await import("fs/promises");
  const { join: join5 } = await import("path");
  const readFn = readFile ?? (async (p) => fsReadFile(join5(projectRoot2, p), "utf8"));
  const writeFn = writeFile ?? (async (p, c) => fsWriteFile(join5(projectRoot2, p), c, "utf8"));
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
async function rollback(snapshots, projectRoot2) {
  const { writeFile: fsWriteFile } = await import("fs/promises");
  const { join: join5 } = await import("path");
  for (const snapshot of snapshots) {
    try {
      await fsWriteFile(join5(projectRoot2, snapshot.filePath), snapshot.originalContent, "utf8");
    } catch {
    }
  }
}

// ../core/src/render/strategies/rename.ts
function computeRenameEdits(store2, elementId, newName, readFile) {
  let edits = [];
  const warnings = [];
  const elem = store2.getElem(elementId);
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
  const importElements = findImportReferences(store2, elem);
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
  const callSites = findCallReferences(store2, elem, elementId);
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
function findImportReferences(store2, elem) {
  const results = [];
  const candidates = store2.queryElements({ nameRegex: `^${escapeRegex(elem.name)}$`, kind: "import", limit: 500 });
  for (const candidate of candidates) {
    if (candidate.id === elem.id) continue;
    if (candidate.module === elem.module) continue;
    const incoming = store2.incoming(candidate.id);
    for (const arr of incoming) {
      if (arr.kind === "contains") {
        const outgoing = store2.outgoing(candidate.id);
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
function findCallReferences(store2, elem, elementId) {
  const results = [];
  const incoming = store2.incoming(elementId);
  for (const arr of incoming) {
    if (arr.kind === "callerOf" || arr.kind === "calleeOf") {
      const caller = store2.getElem(arr.srcId);
      if (caller) results.push(caller);
    }
  }
  const outgoing = store2.outgoing(elementId);
  for (const arr of outgoing) {
    if (arr.kind === "callerOf") {
      const callee = store2.getElem(arr.dstId);
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

// ../core/src/render/declaration.ts
import "tree-sitter";
import "fs";
import { resolve as resolve3, dirname as dirname3 } from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
var __filename3 = fileURLToPath3(import.meta.url);
var __dirname3 = dirname3(__filename3);
var TS_QUERY_PATH2 = resolve3(__dirname3, "..", "ingest", "queries", "ts.scm");
var TSX_QUERY_PATH2 = resolve3(__dirname3, "..", "ingest", "queries", "tsx.scm");
var DECLARATION_NODE_TYPES = {
  function: ["function_declaration", "arrow_function"],
  method: ["method_definition", "abstract_method_signature"],
  class: ["class_declaration"],
  interface: ["interface_declaration"],
  type: ["type_alias_declaration"],
  enum: ["enum_declaration"],
  const: ["variable_declarator"],
  var: ["variable_declarator"]
};
function findEnclosingDeclaration(source, filePath, identifierLine, identifierCol, kind) {
  const parser = parserFor(filePath);
  const tree = parser.parse(source);
  const targetRow = identifierLine - 1;
  const targetCol = identifierCol - 1;
  let node = tree.rootNode.descendantForPosition(
    { row: targetRow, column: targetCol },
    { row: targetRow, column: targetCol + 1 }
  );
  const targetTypes = DECLARATION_NODE_TYPES[kind] ?? [];
  while (node && !targetTypes.includes(node.type)) {
    node = node.parent;
  }
  if (!node) {
    if ("delete" in tree && typeof tree.delete === "function") {
      tree.delete();
    }
    return null;
  }
  const range = {
    startLine: node.startPosition.row + 1,
    startCol: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endCol: node.endPosition.column + 1,
    text: node.text
  };
  if ("delete" in tree && typeof tree.delete === "function") {
    tree.delete();
  }
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

// ../core/src/render/imports.ts
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

// ../core/src/render/strategies/remove-symbol.ts
function computeRemoveSymbolEdits(store2, elementId, readFile) {
  const edits = [];
  const warnings = [];
  const elem = store2.getElem(elementId);
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
      const fileElem = store2.getElem(`file:${elem.module}`);
      if (fileElem) {
        const contained = store2.outgoing(fileElem.id).filter((a) => a.kind === "contains").map((a) => store2.getElem(a.dstId)).filter((e) => e !== null && e.kind === "import");
        for (const imp of contained) {
          if (imp.name === elem.name || imp.id === elementId) continue;
          const incoming2 = store2.incoming(imp.id);
          const importsFrom = incoming2.filter((a) => a.kind === "imports");
        }
      }
    }
  }
  const incoming = store2.incoming(elementId);
  const callers = incoming.filter((a) => a.kind === "callerOf" || a.kind === "calleeOf").map((a) => {
    const otherId = a.srcId === elementId ? a.dstId : a.srcId;
    return store2.getElem(otherId);
  }).filter((e) => e !== null);
  for (const caller of callers) {
    warnings.push(
      `Call site in ${caller.module ?? "unknown"} will break: element "${caller.name}" references "${elem.name}"`
    );
  }
  return { edits, warnings };
}

// ../core/src/render/paths.ts
import { dirname as dirname4, relative as relative2 } from "path";
function computeRelativeImportPath(fromFile, toModule) {
  const fromDir = dirname4(fromFile);
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
  return moduleId + ".ts";
}

// ../core/src/render/strategies/add-symbol.ts
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
function computeAddSymbolEdits(store2, module, name, symbolKind, readFile) {
  const edits = [];
  const warnings = [];
  const templateFn = STUB_TEMPLATES[symbolKind];
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
    const insertLine = findImportInsertionPoint(source);
    const lines = source.split("\n");
    let insertPosition = insertLine;
    for (let i = insertLine; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "" || line.startsWith("//") || line.startsWith("/*")) continue;
      break;
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

// ../core/src/render/strategies/move.ts
function computeMoveEdits(store2, elementId, newModule, readFile) {
  const edits = [];
  const warnings = [];
  const elem = store2.getElem(elementId);
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
  const declarationRange = findEnclosingDeclaration(
    sourceContent,
    sourceModule,
    parsedSpan.startLine,
    parsedSpan.startCol,
    elem.kind
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
  const importElements = store2.queryElements({
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

// ../core/src/render/expand.ts
function expandOperation(store2, operation, readFile) {
  switch (operation.kind) {
    case "rename":
      return computeRenameEdits(store2, operation.target, operation.newName, readFile);
    case "move":
      return computeMoveEdits(store2, operation.target, operation.newModule, readFile);
    case "addSymbol":
      return computeAddSymbolEdits(store2, operation.module, operation.name, operation.symbolKind, readFile);
    case "removeSymbol":
      return computeRemoveSymbolEdits(store2, operation.target, readFile);
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
function expandAllOperations(store2, operations, readFile) {
  const allEdits = [];
  const allWarnings = [];
  for (const op of operations) {
    const result = expandOperation(store2, op, readFile);
    allEdits.push(...result.edits);
    allWarnings.push(...result.warnings);
  }
  return { edits: allEdits, warnings: allWarnings };
}

// ../core/src/render/order.ts
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

// ../core/src/render/index.ts
function renderPlan(store2, operations, projectRoot2) {
  const readFile = (filePath) => {
    try {
      return readFileSync4(join2(projectRoot2, filePath), "utf8");
    } catch {
      return null;
    }
  };
  const { edits, warnings } = expandAllOperations(store2, operations, readFile);
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

// ../core/src/delegate/context.ts
function gatherMustCall(store2, targetId) {
  const incoming = store2.incoming(targetId);
  const callerOfArrows = incoming.filter((a) => a.kind === "callerOf");
  const callees = [];
  for (const arrow of callerOfArrows) {
    const callSiteOutgoing = store2.outgoing(arrow.srcId);
    const calleeOfArrow = callSiteOutgoing.find((a) => a.kind === "calleeOf");
    if (calleeOfArrow) {
      const calleeElem = store2.getElem(calleeOfArrow.dstId);
      if (calleeElem) {
        callees.push({
          id: calleeElem.id,
          name: calleeElem.name,
          kind: calleeElem.kind,
          module: calleeElem.module,
          span: calleeElem.span,
          attrs: calleeElem.attrs
        });
      }
    }
  }
  return callees;
}
function gatherMustImplement(store2, targetId) {
  const outgoing = store2.outgoing(targetId);
  const implementsArrows = outgoing.filter((a) => a.kind === "implements");
  const interfaces = [];
  for (const arrow of implementsArrows) {
    const iface = store2.getElem(arrow.dstId);
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
  const incoming = store2.incoming(targetId);
  const implementsIncoming = incoming.filter((a) => a.kind === "implements");
  for (const arrow of implementsIncoming) {
    const iface = store2.getElem(arrow.srcId);
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
function gatherUsedBy(store2, targetId) {
  const incoming = store2.incoming(targetId);
  const calleeOfArrows = incoming.filter((a) => a.kind === "calleeOf");
  const callers = [];
  const seen = /* @__PURE__ */ new Set();
  for (const arrow of calleeOfArrows) {
    const callSiteOutgoing = store2.outgoing(arrow.srcId);
    const callerOfArrow = callSiteOutgoing.find((a) => a.kind === "callerOf");
    if (callerOfArrow) {
      const callerElem = store2.getElem(callerOfArrow.dstId);
      if (callerElem && !seen.has(callerElem.id)) {
        seen.add(callerElem.id);
        callers.push({
          id: callerElem.id,
          name: callerElem.name,
          kind: callerElem.kind,
          module: callerElem.module,
          span: callerElem.span
        });
      }
    }
  }
  return callers;
}
function gatherImports(store2, targetModule) {
  const imports = [];
  const moduleElems = store2.queryElements({
    kind: "import",
    moduleRegex: `^${escapeRegex2(targetModule)}$`,
    limit: 200
  });
  for (const imp of moduleElems) {
    const outgoing = store2.outgoing(imp.id);
    const importsFromArrow = outgoing.find((a) => a.kind === "importsFrom");
    imports.push({
      name: imp.name,
      sourceModule: importsFromArrow ? importsFromArrow.attrs?.sourceModule ?? null : null,
      targetModule: imp.module
    });
  }
  return imports;
}
function getModuleElement(store2, modulePath) {
  const results = store2.queryElements({
    kind: "module",
    nameRegex: `^${escapeRegex2(modulePath)}$`,
    limit: 1
  });
  return results[0] ?? null;
}
function getModuleFilePath(store2, modulePath) {
  const modElem = getModuleElement(store2, modulePath);
  if (!modElem) return null;
  const outgoing = store2.outgoing(modElem.id);
  const locatedIn = outgoing.find((a) => a.kind === "locatedIn");
  if (locatedIn) {
    const fileElem = store2.getElem(locatedIn.dstId);
    if (fileElem) return fileElem.name;
  }
  return modulePath;
}
function escapeRegex2(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ../core/src/delegate/resolve.ts
import { readFileSync as readFileSync5 } from "fs";
import { join as join3 } from "path";
var SourceResolver = class {
  constructor(projectRoot2) {
    this.projectRoot = projectRoot2;
  }
  projectRoot;
  fileCache = /* @__PURE__ */ new Map();
  readSpan(filePath, span) {
    const parsed = parseSpan2(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    const lines = source.split("\n");
    const start2 = Math.max(0, parsed.startLine - 1);
    const end = Math.min(lines.length, parsed.endLine);
    return lines.slice(start2, end).join("\n");
  }
  readContext(filePath, span, contextLines = 2) {
    const parsed = parseSpan2(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    const lines = source.split("\n");
    const start2 = Math.max(0, parsed.startLine - 1 - contextLines);
    const end = Math.min(lines.length, parsed.endLine + contextLines);
    return lines.slice(start2, end).join("\n");
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
    const range = findEnclosingDeclaration(
      source,
      filePath,
      parsed.startLine,
      parsed.startCol,
      kind
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
  const m = span.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
  if (!m) return null;
  return {
    startLine: parseInt(m[1], 10),
    startCol: parseInt(m[2], 10),
    endLine: parseInt(m[3], 10),
    endCol: parseInt(m[4], 10)
  };
}

// ../core/src/delegate/analogues.ts
function findAnalogues(store2, target, limit = 3) {
  const targetCallees = getCalleeSet(store2, target);
  const candidates = store2.queryElements({
    kind: target.kind,
    limit: 200
  });
  const scored = [];
  for (const candidate of candidates) {
    if (candidate.id === target.id) continue;
    if (candidate.module === target.module) continue;
    const candidateCallees = getCalleeSet(store2, candidate);
    const intersectionSize = countIntersection(targetCallees, candidateCallees);
    const unionSize = targetCallees.size + candidateCallees.size - intersectionSize;
    const similarity = unionSize === 0 ? 0 : intersectionSize / unionSize;
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
function getCalleeSet(store2, elem) {
  const result = /* @__PURE__ */ new Set();
  const incoming = store2.incoming(elem.id);
  const callerOfArrows = incoming.filter((a) => a.kind === "callerOf");
  for (const arrow of callerOfArrows) {
    const callSiteOutgoing = store2.outgoing(arrow.srcId);
    const calleeOfArrow = callSiteOutgoing.find((a) => a.kind === "calleeOf");
    if (calleeOfArrow) {
      result.add(calleeOfArrow.dstId);
    }
  }
  const directCalls = store2.outgoing(elem.id).filter((a) => a.kind === "calls");
  for (const arrow of directCalls) {
    result.add(arrow.dstId);
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

// ../core/src/delegate/index.ts
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
function assembleBrief(store2, projectRoot2, task, targetId, overrides, maxAnalogues = 3, snippetLines = 50, extraCriteria) {
  const target = store2.getElem(targetId);
  if (!target) {
    return { ok: false, error: `Element not found: ${targetId}` };
  }
  const targetModule = target.module;
  if (!targetModule) {
    return { ok: false, error: `Element has no module: ${targetId}` };
  }
  const resolver = new SourceResolver(projectRoot2);
  const filePath = getModuleFilePath(store2, targetModule) ?? localModuleToFilePath(targetModule);
  const targetSignature = resolver.readSignature(filePath, target.span ?? "", target.kind) ?? target.name;
  const targetDeclaration = resolver.readDeclaration(filePath, target.span ?? "", target.kind) ?? "";
  const bodyPlaceholder = extractBodyPlaceholder(targetDeclaration);
  const parsedSpan = target.span ? parseSpanSimple(target.span) : null;
  const mustCallEntries = overrides?.mustCall ? resolveElementList(store2, overrides.mustCall) : gatherMustCall(store2, targetId);
  const mustImplementEntries = overrides?.mustImplement ? resolveElementList(store2, overrides.mustImplement) : gatherMustImplement(store2, targetId);
  const usedByEntries = gatherUsedBy(store2, targetId);
  const importEntries = gatherImports(store2, targetModule);
  const analogueCandidates = overrides?.analogues ? resolveAnalogueList(store2, overrides.analogues) : findAnalogues(store2, target, maxAnalogues);
  const resolvedMustCall = mustCallEntries.map((entry) => {
    const entryFilePath = getModuleFilePath(store2, entry.module ?? "") ?? localModuleToFilePath(entry.module ?? "");
    return {
      name: entry.name,
      signature: resolver.readSignature(entryFilePath, entry.span ?? "", entry.kind) ?? entry.name,
      importStatement: resolver.computeImportStatement(entry.name, entry.module ?? "", targetModule),
      calleeBodySnippet: resolver.readBody(entryFilePath, entry.span ?? "", entry.kind, snippetLines) ?? ""
    };
  });
  const resolvedMustImplement = mustImplementEntries.map((entry) => {
    const entryFilePath = getModuleFilePath(store2, entry.module ?? "") ?? localModuleToFilePath(entry.module ?? "");
    return {
      name: entry.name,
      fullDeclaration: resolver.readDeclaration(entryFilePath, entry.span ?? "", entry.kind) ?? entry.name,
      importStatement: resolver.computeImportStatement(entry.name, entry.module ?? "", targetModule)
    };
  });
  const resolvedUsedBy = usedByEntries.map((entry) => {
    const entryFilePath = getModuleFilePath(store2, entry.module ?? "") ?? localModuleToFilePath(entry.module ?? "");
    const incoming = store2.incoming(targetId);
    const calleeOfArrows = incoming.filter((a) => a.kind === "calleeOf");
    let callSiteSnippet = "";
    for (const arrow of calleeOfArrows) {
      const csOutgoing = store2.outgoing(arrow.srcId);
      const callerOfArrow = csOutgoing.find((a) => a.kind === "callerOf");
      if (callerOfArrow?.dstId === entry.id) {
        const csElem = store2.getElem(arrow.srcId);
        if (csElem?.span) {
          callSiteSnippet = resolver.readContext(entryFilePath, csElem.span, 2) ?? "";
          break;
        }
      }
    }
    return {
      name: entry.name,
      callSiteSnippet
    };
  });
  const resolvedImports = importEntries.map((imp) => {
    if (imp.sourceModule) {
      return `import { ${imp.name} } from '${imp.sourceModule}'`;
    }
    return `import { ${imp.name} } from '...'`;
  });
  const resolvedAnalogues = analogueCandidates.map((candidate) => {
    const candidateFilePath = getModuleFilePath(store2, candidate.module ?? "") ?? localModuleToFilePath(candidate.module ?? "");
    const analogueCallees = getCalleeNames(store2, candidate.id);
    return {
      name: candidate.name,
      similarity: candidate.similarity,
      fullSource: resolver.readDeclaration(candidateFilePath, candidate.span ?? "", candidate.kind) ?? "",
      callees: analogueCallees,
      modulePath: candidate.module ?? ""
    };
  });
  const targetFileContent = resolver.readFileContent(filePath, 500) ?? "";
  const defaultCriteria = TASK_CRITERIA[task] ?? [];
  const acceptanceCriteria = [...defaultCriteria, ...extraCriteria ?? []];
  const commitSha = store2.commitSha();
  const provenanceConfidence = determineConfidence(store2, targetId);
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
    importsInTargetFile: resolver.readImportBlock(filePath),
    analogues: resolvedAnalogues,
    targetFileContent,
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
function resolveElementList(store2, ids) {
  const results = [];
  for (const id of ids) {
    const elem = store2.getElem(id);
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
function resolveAnalogueList(store2, ids) {
  const results = [];
  for (const id of ids) {
    const elem = store2.getElem(id);
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
function getCalleeNames(store2, elemId2) {
  const names = [];
  const incoming = store2.incoming(elemId2);
  const callerOfArrows = incoming.filter((a) => a.kind === "callerOf");
  for (const arrow of callerOfArrows) {
    const csOutgoing = store2.outgoing(arrow.srcId);
    const calleeOfArrow = csOutgoing.find((a) => a.kind === "calleeOf");
    if (calleeOfArrow) {
      const callee = store2.getElem(calleeOfArrow.dstId);
      if (callee) names.push(callee.name);
    }
  }
  return names;
}
function determineConfidence(store2, targetId) {
  const prov = store2.getProvenance(targetId);
  if (!prov) return "unresolved";
  if (prov.confidence === "resolved") return "resolved";
  return "mixed";
}
function localModuleToFilePath(modulePath) {
  return modulePath.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "") + ".ts";
}
function parseSpanSimple(span) {
  const m = span.match(/^(\d+):\d+-(\d+):\d+$/);
  if (!m) return null;
  return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
}

// ../core/src/mining/paths.ts
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

// ../core/src/mining/candidates.ts
function annotatePathKinds(paths, store2, elementKinds, sampleSize = 50) {
  const kindToIds = /* @__PURE__ */ new Map();
  for (const kind of elementKinds) {
    const elems = store2.queryElements({ kind, limit: sampleSize });
    kindToIds.set(kind, elems.map((e) => e.id));
  }
  for (const path2 of paths) {
    const steps = path2.arrows.map((kind) => ({
      kind,
      direction: "out"
    }));
    const domainKinds = [];
    const codomainKinds = /* @__PURE__ */ new Set();
    for (const [kind, ids] of kindToIds) {
      let anyReached = false;
      for (const id of ids) {
        const result = store2.traverse({ startId: id, steps });
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
    path2.domainKind = domainKinds.length === 1 ? domainKinds[0] : null;
    path2.codomainKind = codomainKinds.size > 0 ? Array.from(codomainKinds).sort().join(",") : null;
  }
  return paths;
}
function generateCandidatePairs(paths) {
  const pairs = [];
  const byDomain = /* @__PURE__ */ new Map();
  for (const path2 of paths) {
    if (!path2.domainKind) continue;
    const existing = byDomain.get(path2.domainKind) ?? [];
    existing.push(path2);
    byDomain.set(path2.domainKind, existing);
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

// ../core/src/mining/evaluate.ts
function evaluateEquationCandidate(store2, lhsPath, rhsPath, seedElements, maxCounterexamples = 5) {
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
    const lhsResult = store2.traverse({ startId: elem.id, steps: lhsSteps });
    const rhsResult = store2.traverse({ startId: elem.id, steps: rhsSteps });
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

// ../core/src/mining/index.ts
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
  annotatePathKinds(paths, store2, elementKinds, opts.sampleSize);
  const candidates = generateCandidatePairs(paths);
  const seedElements = [];
  for (const kind of elementKinds) {
    const elems = store2.queryElements({ kind, limit: opts.sampleSize });
    if (elems.length > 0) {
      seedElements.push({ kind, elements: elems });
    }
  }
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    const key = canonicalEquationKey(candidate.lhs, candidate.rhs);
    if (seen.has(key)) continue;
    seen.add(key);
    const allSeeds = [];
    for (const group of seedElements) {
      allSeeds.push(...group.elements);
    }
    const result = evaluateEquationCandidate(
      store2,
      candidate.lhs,
      candidate.rhs,
      allSeeds,
      opts.maxCounterexamples
    );
    if (result.total === 0) continue;
    if (result.coverage < opts.minCoverage) continue;
    results.push(result);
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

// ../core/src/domain/discover.ts
import { randomUUID as randomUUID3 } from "crypto";
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
    const candidateId = randomUUID3();
    const bridgeArrow = {
      id: randomUUID3(),
      name: "implemented as",
      domainCandidateId: candidateId,
      codomainName: elem.name,
      codomainCandidateId: null,
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
        const total = !optional && !isArray;
        const proposal = {
          id: randomUUID3(),
          name: `has ${propName}`,
          domainCandidateId: candidate.id,
          codomainName: targetCandidate?.proposedName ?? typeElem.name,
          codomainCandidateId: targetCandidate?.id ?? null,
          total,
          source: "field",
          confidence: targetCandidate ? "resolved" : "unresolved",
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
  }
  return candidates;
}

// src/tools/olog-query.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
function registerOlogQuery(server2, store2) {
  const elemKindEnum = [
    "file",
    "module",
    "symbol",
    "callsite",
    "import",
    "type",
    "interface",
    "class",
    "enum",
    "function",
    "method",
    "const",
    "var",
    "namespace",
    "property",
    "domain",
    "other"
  ];
  const arrowKindEnum = [
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
  const startByIdSchema = z.object({
    id: z.string().describe("Element ID to start from")
  });
  const startByFilterSchema = z.object({
    kind: z.enum(elemKindEnum).optional().describe("Element kind to filter by. Omit to match all kinds."),
    name: z.string().optional().describe(
      "Regex pattern matched against element name. Examples: '^handle', 'User', 'Button$'"
    ),
    module: z.string().optional().describe(
      "Regex pattern matched against module (relative file path). Examples: 'src/components', 'utils/'"
    )
  });
  server2.registerTool(
    "olog_query",
    {
      description: "Query the ontology log for structural elements matching filters, or traverse the graph via multi-hop arrow following. Returns elements with their kind, name, module (file path), and span (location). Traversal returns both reached elements and the arrows traversed.",
      inputSchema: z.object({
        start: z.union([startByIdSchema, startByFilterSchema]).optional().describe(
          "Start element specification: either an exact element ID, or a filter (kind/name/module) to find starting element(s). When omitted, falls back to the top-level kind/name/module parameters."
        ),
        kind: z.enum([
          "file",
          "module",
          "symbol",
          "callsite",
          "import",
          "type",
          "interface",
          "class",
          "enum",
          "function",
          "method",
          "const",
          "var",
          "namespace",
          "property",
          "domain",
          "any"
        ]).default("any").describe("Element kind to filter by. Use 'any' to match all kinds."),
        name: z.string().optional().describe(
          "Regex pattern matched against element name. Examples: '^handle', 'User', 'Button$'"
        ),
        module: z.string().optional().describe(
          "Regex pattern matched against module (relative file path). Examples: 'src/components', 'utils/'"
        ),
        arrows: z.array(z.enum(arrowKindEnum)).optional().describe(
          "Ordered array of arrow kinds to traverse multi-hop. When provided, the tool performs graph traversal instead of a simple filter query."
        ),
        direction: z.enum(["out", "in"]).default("out").describe(
          'Direction for all arrow hops in a traversal. "out" follows natural direction (src -> dst); "in" reverses it (dst -> src).'
        ),
        minConfidence: z.enum(["resolved", "unresolved", "tentative"]).optional().describe(
          "Minimum provenance confidence level. For filter queries, requires an exact match. For traversals, filters arrows by exact confidence match."
        ),
        limit: z.number().int().min(1).max(500).default(50).describe("Maximum number of results to return")
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (args) => {
      try {
        if (args.arrows && args.arrows.length > 0) {
          let startIds;
          if (args.start && "id" in args.start) {
            startIds = [args.start.id];
          } else {
            const filter2 = args.start && "kind" in args.start ? args.start : { kind: args.kind, name: args.name, module: args.module };
            const queryOpts = { limit: args.limit };
            if (filter2.kind && filter2.kind !== "any") {
              queryOpts.kind = filter2.kind;
            }
            if (filter2.name !== void 0) {
              queryOpts.nameRegex = filter2.name;
            }
            if (filter2.module !== void 0) {
              queryOpts.moduleRegex = filter2.module;
            }
            const elems = store2.queryElements(queryOpts);
            if (elems.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: "No elements found matching start criteria"
                  }
                ]
              };
            }
            startIds = elems.map((e) => e.id);
          }
          const steps = args.arrows.map((kind) => ({
            kind,
            direction: args.direction
          }));
          const allElements = /* @__PURE__ */ new Map();
          const allArrows = /* @__PURE__ */ new Map();
          for (const startId of startIds) {
            const traverseOpts = {
              startId,
              steps
            };
            if (args.minConfidence) {
              traverseOpts.minConfidence = args.minConfidence;
            }
            const result = store2.traverse(traverseOpts);
            for (const elem of result.elements) {
              allElements.set(elem.id, elem);
            }
            for (const arr of result.arrows) {
              allArrows.set(arr.id, arr);
            }
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    elements: Array.from(allElements.values()),
                    arrows: Array.from(allArrows.values())
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        if (args.start && "id" in args.start) {
          const elem = store2.getElem(args.start.id);
          if (!elem) {
            return {
              content: [
                {
                  type: "text",
                  text: "Element not found"
                }
              ]
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(elem, null, 2)
              }
            ]
          };
        }
        const filter = args.start && "kind" in args.start ? args.start : { kind: args.kind, name: args.name, module: args.module };
        const opts = { limit: args.limit };
        if (filter.kind && filter.kind !== "any") {
          opts.kind = filter.kind;
        }
        if (filter.name !== void 0) {
          opts.nameRegex = filter.name;
        }
        if (filter.module !== void 0) {
          opts.moduleRegex = filter.module;
        }
        let rows;
        if (args.minConfidence) {
          rows = store2.queryElementsWithConfidence({
            ...opts,
            minConfidence: args.minConfidence
          });
        } else {
          rows = store2.queryElements(opts);
        }
        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No elements found matching criteria"
              }
            ]
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(rows, null, 2)
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

// src/tools/olog-inspect.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z2 } from "zod";
function registerOlogInspect(server2, store2) {
  server2.registerTool(
    "olog_inspect",
    {
      description: "Get detailed information about a specific element by ID, including all its outgoing and incoming arrows (connections to other elements).",
      inputSchema: z2.object({
        id: z2.string().describe("Element ID to inspect. Get IDs from olog_query results.")
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ id }) => {
      try {
        const element = store2.getElem(id);
        if (!element) {
          return {
            content: [
              {
                type: "text",
                text: `Element not found: ${id}`
              }
            ],
            isError: true
          };
        }
        const outgoing = store2.outgoing(id);
        const incoming = store2.incoming(id);
        const prov = store2.getProvenance(id);
        const provenance = prov ? [prov] : [];
        const equations = store2.getEquationsForObject(id);
        const allConstraints = store2.getConstraints();
        const elemKind = element.kind;
        const elemModule = element.module ?? "";
        const constraints = allConstraints.filter((c) => {
          if (!c.config || Object.keys(c.config).length === 0) return true;
          const configStr = JSON.stringify(c.config);
          return configStr.includes(elemKind) || configStr.includes(elemModule);
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ element, outgoing, incoming, provenance, equations, constraints }, null, 2)
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

// src/tools/olog-dump.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z3 } from "zod";
function registerOlogDump(server2, store2) {
  server2.registerTool(
    "olog_dump",
    {
      description: "Get a summary overview of the ontology log: element counts by kind, arrow counts by kind, and total counts. Useful for understanding what the olog knows about the codebase.",
      inputSchema: z3.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async () => {
      try {
        const counts = store2.dumpCounts();
        const commitSha = store2.commitSha();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ commitSha, ...counts }, null, 2)
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

// src/tools/olog-reindex.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z4 } from "zod";
function registerOlogReindex(server2, store2, projectRoot2) {
  server2.registerTool(
    "olog_reindex",
    {
      description: "Force a full re-ingestion of the TypeScript codebase. Use this after code changes to refresh the structural model. This drops all existing elements and rebuilds from scratch.",
      inputSchema: z4.object({}),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false
      }
    },
    async () => {
      try {
        const result = reindexProject(projectRoot2, store2);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text", text: `Reindex failed: ${message}` }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-apply.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z6 } from "zod";

// src/tools/olog-plan.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z5 } from "zod";
import { createHash } from "crypto";
var operationSchema = z5.union([
  z5.object({
    kind: z5.literal("rename"),
    target: z5.string(),
    newName: z5.string()
  }),
  z5.object({
    kind: z5.literal("move"),
    target: z5.string(),
    newModule: z5.string()
  }),
  z5.object({
    kind: z5.literal("addSymbol"),
    module: z5.string(),
    name: z5.string(),
    symbolKind: z5.string()
  }),
  z5.object({
    kind: z5.literal("removeSymbol"),
    target: z5.string()
  }),
  z5.object({
    kind: z5.literal("addArrow"),
    arrowKind: z5.string(),
    src: z5.string(),
    dst: z5.string()
  }),
  z5.object({
    kind: z5.literal("removeArrow"),
    arrowId: z5.string()
  })
]);
var planStore = /* @__PURE__ */ new Map();
function registerOlogPlan(server2, store2) {
  server2.registerTool(
    "olog_plan",
    {
      description: "Describe a set of structural changes as a plan with invariants. The plan is stored in-memory keyed by its hash for later validation and application.",
      inputSchema: z5.object({
        operations: z5.array(operationSchema).describe("List of planned structural operations"),
        rationale: z5.string().describe("Human-readable rationale for the plan")
      }),
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    async ({ operations, rationale }) => {
      try {
        const hash = createHash("sha256").update(JSON.stringify(operations)).digest("hex");
        const targetElementIds = /* @__PURE__ */ new Set();
        const targetKinds = /* @__PURE__ */ new Set();
        const targetModules = /* @__PURE__ */ new Set();
        for (const op of operations) {
          switch (op.kind) {
            case "rename":
            case "move":
            case "removeSymbol":
              targetElementIds.add(op.target);
              break;
            case "addSymbol":
              targetModules.add(op.module);
              targetKinds.add(op.symbolKind);
              break;
            case "addArrow":
              targetElementIds.add(op.src);
              targetElementIds.add(op.dst);
              break;
            case "removeArrow":
              break;
          }
        }
        for (const id of targetElementIds) {
          const elem = store2.getElem(id);
          if (elem) {
            targetKinds.add(elem.kind);
            if (elem.module) {
              targetModules.add(elem.module);
            }
          }
        }
        const equationsById = /* @__PURE__ */ new Map();
        for (const id of targetElementIds) {
          for (const eq of store2.getEquationsForObject(id)) {
            equationsById.set(eq.id, eq);
          }
        }
        const constraintsById = /* @__PURE__ */ new Map();
        for (const constraint of store2.getConstraints()) {
          const configStr = JSON.stringify(constraint.config);
          let matched = false;
          for (const kind of targetKinds) {
            if (configStr.includes(kind)) {
              matched = true;
              break;
            }
          }
          if (!matched) {
            for (const mod of targetModules) {
              if (configStr.includes(mod)) {
                matched = true;
                break;
              }
            }
          }
          if (matched) {
            constraintsById.set(constraint.id, constraint);
          }
        }
        const invariants = {
          equations: Array.from(equationsById.values()),
          constraints: Array.from(constraintsById.values())
        };
        const plan = {
          operations,
          hash,
          rationale,
          invariants
        };
        planStore.set(hash, plan);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ok: true, plan: { operations, hash, invariants } },
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

// src/tools/olog-apply.ts
var planOperationSchema = z6.union([
  z6.object({ kind: z6.literal("rename"), target: z6.string(), newName: z6.string() }),
  z6.object({ kind: z6.literal("move"), target: z6.string(), newModule: z6.string() }),
  z6.object({ kind: z6.literal("addSymbol"), module: z6.string(), name: z6.string(), symbolKind: z6.string() }),
  z6.object({ kind: z6.literal("removeSymbol"), target: z6.string() }),
  z6.object({ kind: z6.literal("addArrow"), arrowKind: z6.string(), src: z6.string(), dst: z6.string() }),
  z6.object({ kind: z6.literal("removeArrow"), arrowId: z6.string() })
]);
var planSchema = z6.object({
  operations: z6.array(planOperationSchema),
  hash: z6.string(),
  rationale: z6.string()
});
function registerOlogApply(server2, store2, projectRoot2) {
  server2.registerTool(
    "olog_apply",
    {
      description: "Apply a validated plan to the olog graph. When render=true, also renders source-file edits and re-ingests. The plan must have been created by olog_plan and the hash must match.",
      inputSchema: z6.object({
        plan: planSchema.describe("The plan object to apply, including its hash."),
        planHash: z6.string().describe("The expected hash of the plan. Must match plan.hash."),
        render: z6.boolean().default(false).describe("When true, also render source-file edits and apply them to disk, then re-ingest.")
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false
      }
    },
    async ({ plan, planHash, render }) => {
      try {
        const storedPlan = planStore.get(planHash);
        if (!storedPlan) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, reason: "Plan not found" }, null, 2)
              }
            ]
          };
        }
        if (planHash !== plan.hash) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, reason: "Hash mismatch" }, null, 2)
              }
            ]
          };
        }
        const result = store2.applyPlan(plan.operations);
        if (!render || !projectRoot2) {
          if (result.errors.length > 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ ok: false, reason: result.errors.join("; ") }, null, 2)
                }
              ]
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: true,
                    summary: `Applied ${result.applied} operations, skipped ${result.skipped}`,
                    changes: result.changes
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        const renderResult = renderPlan(store2, plan.operations, projectRoot2);
        if (renderResult.edits.length > 0) {
          const applyResult = await applySourceEdits(renderResult.edits, projectRoot2);
          if (applyResult.errors.length > 0) {
            await rollback(applyResult.snapshots, projectRoot2);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: false,
                      reason: "Source edit errors, rolled back",
                      dbResult: result,
                      editErrors: applyResult.errors,
                      renderWarnings: renderResult.warnings
                    },
                    null,
                    2
                  )
                }
              ]
            };
          }
          try {
            reindexProject(projectRoot2, store2);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: true,
                      summary: `Applied ${result.applied} DB operations and ${applyResult.applied} source edits`,
                      dbChanges: result.changes,
                      sourceEdits: renderResult.edits.map((e) => ({
                        file: e.filePath,
                        label: e.label,
                        oldText: e.oldText,
                        newText: e.newText
                      })),
                      warnings: renderResult.warnings,
                      reingestWarning: `Re-ingest failed: ${msg}`
                    },
                    null,
                    2
                  )
                }
              ]
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: true,
                    summary: `Applied ${result.applied} DB operations and ${applyResult.applied} source edits`,
                    dbChanges: result.changes,
                    sourceEdits: renderResult.edits.map((e) => ({
                      file: e.filePath,
                      label: e.label,
                      oldText: e.oldText,
                      newText: e.newText
                    })),
                    warnings: renderResult.warnings,
                    affectedFiles: applyResult.affectedFiles
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  summary: `Applied ${result.applied} DB operations (no source edits needed)`,
                  dbChanges: result.changes,
                  warnings: renderResult.warnings
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
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, reason: message }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-validate.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z7 } from "zod";
function escapeRegex3(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function registerOlogValidate(server2, store2) {
  server2.registerTool(
    "olog_validate",
    {
      description: "Validate a plan against constraints. Returns {ok: true, plan} on success, or {ok: false, violations} on failure. Checks name uniqueness, referential integrity, path equations, and integrity constraints.",
      inputSchema: z7.object({
        planHash: z7.string().describe("Hash of the plan to validate (as returned by olog_plan)")
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ planHash }) => {
      try {
        const plan = planStore.get(planHash);
        if (!plan) {
          return {
            content: [
              {
                type: "text",
                text: `Plan not found: ${planHash}. Use olog_plan to create a plan first.`
              }
            ],
            isError: true
          };
        }
        const violations = [];
        for (const op of plan.operations) {
          if (op.kind === "rename") {
            const existing = store2.getElem(op.target);
            if (existing) {
              const candidates = store2.queryElements({
                nameRegex: `^${escapeRegex3(op.newName)}$`,
                limit: 100
              });
              const conflicting = candidates.filter(
                (e) => e.id !== op.target && e.name === op.newName && e.module === existing.module
              );
              if (conflicting.length > 0) {
                violations.push({
                  id: crypto.randomUUID(),
                  kind: "uniqueness",
                  humanMessage: `Rename would create duplicate: "${op.newName}" already exists in module "${existing.module ?? "(root)"}"`,
                  involved: [op.target, ...conflicting.map((e) => e.id)]
                });
              }
            }
          }
        }
        for (const op of plan.operations) {
          if (op.kind === "removeSymbol") {
            const outgoing = store2.outgoing(op.target);
            const incoming = store2.incoming(op.target);
            const allArrows = [...outgoing, ...incoming];
            if (allArrows.length > 0) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "referential",
                humanMessage: `Removing element "${op.target}" would orphan ${allArrows.length} arrow(s)`,
                involved: [op.target, ...allArrows.map((a) => a.id)]
              });
            }
          }
        }
        const equationResult = evaluatePathEquations(store2, plan.operations);
        violations.push(...equationResult.violations);
        const constraintResult = evaluateConstraints(store2, plan.operations);
        violations.push(...constraintResult.violations);
        if (violations.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: true, plan }, null, 2)
              }
            ]
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, violations }, null, 2)
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

// src/tools/olog-propose-schema.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z8 } from "zod";
import { randomUUID as randomUUID4 } from "crypto";
var objectSchema = z8.object({
  kind: z8.string().describe("Element kind"),
  name: z8.string().describe("Element name (noun phrase)"),
  module: z8.string().optional().describe("Optional module path")
});
var arrowSchema = z8.object({
  name: z8.string().describe("Arrow kind/name"),
  domain: z8.string().describe("Domain element name"),
  codomain: z8.string().describe("Codomain element name"),
  total: z8.boolean().describe("Whether this is a total function")
});
var pathSchema = z8.object({
  src: z8.string().describe("Source element ID or name"),
  tgt: z8.string().describe("Target element ID or name"),
  arrows: z8.array(z8.string()).describe("Sequence of arrow kinds")
});
var equationSchema = z8.object({
  id: z8.string(),
  name: z8.string(),
  humanMessage: z8.string(),
  lhs: pathSchema,
  rhs: pathSchema
});
var provenanceSchema = z8.object({
  source: z8.enum(["tree-sitter", "lsp", "manual", "heuristic", "other"]),
  commitSha: z8.string(),
  ingestedAt: z8.number().optional(),
  confidence: z8.enum(["resolved", "unresolved", "tentative"])
});
var STANDARD_KINDS = [
  "file",
  "module",
  "symbol",
  "callsite",
  "import",
  "type",
  "interface",
  "class",
  "enum",
  "function",
  "method",
  "const",
  "var",
  "namespace",
  "other"
];
function registerOlogProposeSchema(server2, store2) {
  server2.registerTool(
    "olog_propose_schema",
    {
      description: "Propose a new schema fragment to the olog. Validates noun phrases for objects, total-function semantics for arrows, and path equation composability. Stores accepted objects in olog_elem, arrows in olog_arr, equations in olog_equation, and provenance in olog_prov.",
      inputSchema: z8.object({
        objects: z8.array(objectSchema).optional().describe("Objects to add to the schema"),
        arrows: z8.array(arrowSchema).optional().describe("Arrows to add to the schema"),
        equations: z8.array(equationSchema).optional().describe("Path equations to add"),
        provenance: provenanceSchema.describe("Provenance metadata for all proposed items")
      }),
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    async ({ objects, arrows, equations, provenance }) => {
      try {
        const errors = [];
        const added = { objects: 0, arrows: 0, equations: 0 };
        const objectMap = /* @__PURE__ */ new Map();
        for (const obj of objects ?? []) {
          if (!isNounPhrase(obj.name)) {
            errors.push(
              `Object "${obj.name}" is not a valid noun phrase (must start with uppercase after optional "a"/"an"/"the")`
            );
          }
          objectMap.set(obj.name, obj);
        }
        const arrowList = [];
        const proposedArrowKinds = /* @__PURE__ */ new Set();
        for (const arrow of arrows ?? []) {
          if (!arrow.total) {
            errors.push(
              `Arrow "${arrow.name}" is not total. Many-valued relationships must be reified before proposing.`
            );
            continue;
          }
          const domainElems = store2.queryElements({ nameRegex: `^${arrow.domain}$`, limit: 1 });
          const domainExists = domainElems.length > 0 || objectMap.has(arrow.domain);
          if (!domainExists) {
            errors.push(`Arrow "${arrow.name}": domain "${arrow.domain}" does not exist`);
            continue;
          }
          const codomainElems = store2.queryElements({ nameRegex: `^${arrow.codomain}$`, limit: 1 });
          const codomainExists = codomainElems.length > 0 || objectMap.has(arrow.codomain);
          if (!codomainExists) {
            errors.push(`Arrow "${arrow.name}": codomain "${arrow.codomain}" does not exist`);
            continue;
          }
          arrowList.push(arrow);
          proposedArrowKinds.add(arrow.name);
        }
        for (const eq of equations ?? []) {
          const result = validateEquation(eq, store2, Array.from(proposedArrowKinds));
          errors.push(...result.errors);
        }
        if (errors.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, errors }, null, 2)
              }
            ]
          };
        }
        const createdElemIds = /* @__PURE__ */ new Map();
        for (const obj of objects ?? []) {
          const id = randomUUID4();
          createdElemIds.set(obj.name, id);
          const kind = STANDARD_KINDS.includes(obj.kind) ? obj.kind : "other";
          const elem = {
            id,
            kind,
            name: obj.name,
            module: obj.module ?? null,
            span: null,
            attrs: {}
          };
          store2.addElement(elem);
          store2.addProvenance(id, {
            source: provenance.source,
            commitSha: provenance.commitSha,
            ingestedAt: provenance.ingestedAt ?? Date.now(),
            confidence: provenance.confidence
          });
          added.objects++;
        }
        for (const arrow of arrowList) {
          const domainId = createdElemIds.get(arrow.domain) ?? store2.queryElements({ nameRegex: `^${arrow.domain}$`, limit: 1 })[0]?.id;
          const codomainId = createdElemIds.get(arrow.codomain) ?? store2.queryElements({ nameRegex: `^${arrow.codomain}$`, limit: 1 })[0]?.id;
          if (!domainId || !codomainId) {
            errors.push(`Arrow "${arrow.name}": failed to resolve domain/codomain IDs`);
            continue;
          }
          const arr = {
            id: arrowId(domainId, arrow.name, codomainId),
            kind: arrow.name,
            srcId: domainId,
            dstId: codomainId,
            attrs: {}
          };
          store2.addArrow(arr);
          added.arrows++;
        }
        if (errors.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, errors }, null, 2)
              }
            ]
          };
        }
        for (const eq of equations ?? []) {
          const eqWithProv = {
            id: eq.id,
            name: eq.name,
            humanMessage: eq.humanMessage,
            lhs: eq.lhs,
            rhs: eq.rhs,
            provenance: {
              source: provenance.source,
              commitSha: provenance.commitSha,
              ingestedAt: provenance.ingestedAt ?? Date.now(),
              confidence: provenance.confidence
            }
          };
          store2.addEquation(eqWithProv);
          added.equations++;
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, added }, null, 2)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, errors: [message] }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-render.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z9 } from "zod";
function registerOlogRender(server2, store2, projectRoot2) {
  server2.registerTool(
    "olog_render",
    {
      description: "Preview the source-file edits that a validated plan would produce, without writing to disk. Returns SourceEdits grouped by file, with warnings for operations needing manual review.",
      inputSchema: z9.object({
        planHash: z9.string().describe("Hash of the validated plan to render (as returned by olog_plan)")
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ planHash }) => {
      try {
        const plan = planStore.get(planHash);
        if (!plan) {
          return {
            content: [
              {
                type: "text",
                text: `Plan not found: ${planHash}. Use olog_plan to create a plan first.`
              }
            ],
            isError: true
          };
        }
        const result = renderPlan(store2, plan.operations, projectRoot2);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
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

// src/tools/olog-delegate.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z10 } from "zod";
var TASK_TYPES = [
  "write_function_body",
  "write_test",
  "write_migration",
  "rewrite_body",
  "write_documentation"
];
function registerOlogDelegate(server2, store2, projectRoot2) {
  server2.registerTool(
    "olog_delegate",
    {
      description: "Assemble a fully-resolved structural brief for a text-generation subagent. Traverses the olog to collect signatures, call graphs, interface contracts, import paths, and analogue source code. Returns a self-contained brief that requires NO further olog queries \u2014 designed for consumption by a smaller/cheaper model that will write the actual code.",
      inputSchema: z10.object({
        task: z10.enum(TASK_TYPES).describe(
          "The type of text-generation task."
        ),
        target: z10.string().describe(
          'Element ID of the target entity (e.g., "symbol:src/auth.verifyJwt"). Use olog_query or olog_inspect to find the ID.'
        ),
        contextOverrides: z10.object({
          mustCall: z10.array(z10.string()).optional().describe(
            "Element IDs the implementation must call. Replaces automatically derived context."
          ),
          mustImplement: z10.array(z10.string()).optional().describe(
            "Element IDs of interfaces this implementation must satisfy. Replaces derived context."
          ),
          analogues: z10.array(z10.string()).optional().describe(
            "Element IDs of similar existing implementations. Replaces automatic discovery."
          )
        }).optional().describe(
          "Manual overrides for structural context. When provided, these REPLACE the automatically derived values (not merge)."
        ),
        acceptanceCriteria: z10.array(z10.string()).optional().describe(
          "Additional acceptance criteria, merged with task-type defaults."
        ),
        maxAnalogues: z10.number().int().min(0).max(5).default(3).describe(
          "Maximum number of analogue implementations to include."
        ),
        snippetLines: z10.number().int().min(10).max(200).default(50).describe(
          "Maximum lines of source code per snippet."
        )
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ task, target, contextOverrides, acceptanceCriteria, maxAnalogues, snippetLines }) => {
      try {
        const overrides = contextOverrides ? {
          ...contextOverrides.mustCall ? { mustCall: contextOverrides.mustCall } : {},
          ...contextOverrides.mustImplement ? { mustImplement: contextOverrides.mustImplement } : {},
          ...contextOverrides.analogues ? { analogues: contextOverrides.analogues } : {}
        } : void 0;
        const result = assembleBrief(
          store2,
          projectRoot2,
          task,
          target,
          overrides,
          maxAnalogues,
          snippetLines,
          acceptanceCriteria
        );
        if ("ok" in result && result.ok === false) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2)
              }
            ],
            isError: true
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, error: message }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-mine-equations.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z11 } from "zod";
function registerOlogMineEquations(server2, store2) {
  server2.registerTool(
    "olog_mine_equations",
    {
      description: "Discover path equations that hold (or nearly hold) in the olog graph. Tests all possible commutativity conditions between arrow paths up to the specified depth. Returns equations ranked by coverage ratio. Coverage 1.0 means the equation holds for every element tested; lower values indicate near-invariants with counterexamples.",
      inputSchema: z11.object({
        maxDepth: z11.number().int().min(2).max(4).default(3).describe(
          "Maximum path length to explore. Depth 2 finds 2-arrow paths, depth 3 finds 3-arrow paths. Higher = slower but more thorough."
        ),
        minCoverage: z11.number().min(0).max(1).default(1).describe(
          "Minimum coverage ratio to report. 1.0 = only strict invariants. 0.8 = near-invariants that hold for 80%+ of elements."
        ),
        maxResults: z11.number().int().min(1).max(500).default(50).describe("Maximum number of equations to return."),
        arrowKinds: z11.array(z11.string()).optional().describe(
          "Restrict to these arrow kinds. Default: all arrow kinds in use."
        ),
        elementKinds: z11.array(z11.string()).optional().describe(
          "Restrict seed elements to these kinds. Default: function, method, class, interface, type, import, module, domain, property."
        ),
        touchingElementKinds: z11.array(z11.string()).optional().describe(
          'Restrict to arrow kinds that touch elements of these kinds (i.e., arrows whose source or destination element is of one of these kinds). Useful for focusing mining on domain-relevant arrows \u2014 e.g., passing ["domain"] will only consider arrows that connect to/from domain objects. Intersected with arrowKinds if both are specified.'
        ),
        maxCounterexamples: z11.number().int().min(0).max(20).default(5).describe(
          "Maximum number of counterexamples to include per equation. Counterexamples show elements where the equation fails."
        ),
        sampleSize: z11.number().int().min(10).max(500).default(100).describe(
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
import { z as z12 } from "zod";
function registerOlogDomainDiscover(server2, store2) {
  server2.registerTool(
    "olog_domain_discover",
    {
      description: `Domain modeling session tool. Discovers domain concepts from the olog's interface/type/class elements and allows iterative refinement and commitment to the olog. Use action="start" to begin a session, "refine" to accept/reject candidates, "commit" to write accepted domain objects and arrows to the olog.`,
      inputSchema: z12.discriminatedUnion("action", [
        z12.object({
          action: z12.literal("start"),
          scopeRegex: z12.string().optional().describe('Regex to restrict discovery to matching module paths (e.g. "packages/core/src/ontology")'),
          excludeModules: z12.array(z12.string()).optional().describe("Module path patterns to exclude from discovery")
        }),
        z12.object({
          action: z12.literal("refine"),
          sessionId: z12.string().describe("Session ID returned by start"),
          responses: z12.array(
            z12.object({
              candidateId: z12.string(),
              status: z12.enum(["accepted", "rejected", "deferred"]),
              nameOverride: z12.string().optional().describe("Override the proposed noun phrase name"),
              arrowOverrides: z12.array(
                z12.object({
                  arrowId: z12.string(),
                  status: z12.enum(["accepted", "rejected", "modified"]),
                  newName: z12.string().optional(),
                  totalOverride: z12.boolean().optional()
                })
              ).optional()
            })
          )
        }),
        z12.object({
          action: z12.literal("commit"),
          sessionId: z12.string().describe("Session ID returned by start"),
          provenance: z12.object({
            source: z12.enum(["manual", "llm"]),
            commitSha: z12.string(),
            confidence: z12.enum(["resolved", "unresolved", "tentative"])
          })
        }),
        z12.object({
          action: z12.literal("list")
        }),
        z12.object({
          action: z12.literal("get"),
          sessionId: z12.string()
        })
      ]),
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
        if (params.action === "refine") {
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
          let addedArrows = 0;
          let addedBridges = 0;
          for (const candidate of accepted) {
            const elemId2 = `domain:${candidate.id}`;
            candidateToElemId.set(candidate.id, elemId2);
            store2.addElement({
              id: elemId2,
              kind: "domain",
              name: candidate.proposedName,
              module: null,
              span: null,
              attrs: { codeElementId: candidate.codeElementId }
            });
            store2.addProvenance(elemId2, prov);
            addedObjects++;
          }
          for (const candidate of accepted) {
            const srcId = candidateToElemId.get(candidate.id);
            for (const arrow of candidate.proposedArrows) {
              if (arrow.status === "rejected") continue;
              let dstId;
              if (arrow.codomainCandidateId) {
                dstId = candidateToElemId.get(arrow.codomainCandidateId);
              }
              if (!dstId) continue;
              const arrowId2 = `${srcId}:${arrow.name.replace(/\s+/g, "-")}:${dstId}`;
              store2.addArrow({
                id: arrowId2,
                kind: "other",
                srcId,
                dstId,
                attrs: { name: arrow.name, total: arrow.total }
              });
              addedArrows++;
            }
            const bridgeArrow = candidate.bridgeArrow;
            if (bridgeArrow.status !== "rejected") {
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

// src/index.ts
var projectRoot = process.env.OLOG_ROOT || process.cwd();
var ologDir = join4(projectRoot, ".olog");
try {
  mkdirSync(ologDir, { recursive: true });
} catch (err) {
  console.error(
    `[olog] Failed to create ${ologDir}: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}
var dbPath = join4(ologDir, "olog.sqlite");
var store = new OlogStore(dbPath);
console.error(`[olog] Starting ingestion for ${projectRoot}...`);
var start = Date.now();
try {
  const result = ingestProject(projectRoot, store);
  console.error(
    `[olog] Ingestion complete in ${Date.now() - start}ms: ${result.filesProcessed} files, ${result.elementsCreated} elements, ${result.arrowsCreated} arrows`
  );
} catch (err) {
  console.error(
    `[olog] Ingestion failed: ${err instanceof Error ? err.message : String(err)}`
  );
  store.close();
  process.exit(1);
}
var server = new McpServer13(
  { name: "olog-mcp", version: "0.0.1" },
  {
    instructions: `This server provides a structural model (ontology log) of the TypeScript codebase at ${projectRoot}. Tools: olog_query (search/filter/traverse), olog_inspect (details+provenance), olog_dump (overview), olog_reindex (refresh), olog_propose_schema (extend schema), olog_plan (describe changes), olog_validate (check plans), olog_apply (execute plans), olog_render (preview source edits), olog_mine_equations (discover path equations), olog_domain_discover (domain modeling sessions: discover domain objects from code types, refine, and commit to olog). The name and module parameters accept JavaScript regex patterns.`,
    capabilities: { logging: {} }
  }
);
registerOlogQuery(server, store);
registerOlogInspect(server, store);
registerOlogDump(server, store);
registerOlogReindex(server, store, projectRoot);
registerOlogProposeSchema(server, store);
registerOlogPlan(server, store);
registerOlogValidate(server, store);
registerOlogApply(server, store, projectRoot);
registerOlogRender(server, store, projectRoot);
registerOlogDelegate(server, store, projectRoot);
registerOlogMineEquations(server, store);
registerOlogDomainDiscover(server, store);
var transport = new StdioServerTransport();
await server.connect(transport);
console.error("[olog] MCP server connected on stdio");
var cleanup = () => {
  try {
    store.close();
  } catch {
  }
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
//# sourceMappingURL=index.js.map