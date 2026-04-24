#!/usr/bin/env node

// src/index.ts
import { mkdirSync } from "fs";
import { join } from "path";
import { McpServer as McpServer9 } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// ../core/src/db.ts
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

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
      "INSERT OR IGNORE INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
    );
    const insertProv = this.db.prepare(
      "INSERT INTO olog_prov (elem_id, source, commit_sha, ingested_at, confidence) VALUES (?, 'tree-sitter', ?, ?, 'resolved')"
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
    const join2 = opts.minConfidence ? " INNER JOIN olog_prov p ON e.id = p.elem_id" : "";
    const sql = `SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_elem e${join2} ${where} ORDER BY e.module, e.name LIMIT ?`;
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
import { randomUUID } from "crypto";
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
      id: randomUUID(),
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
          id: randomUUID(),
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
          id: randomUUID(),
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
        id: randomUUID(),
        kind: "integrity",
        humanMessage: constraint.message ?? `Totality constraint "${constraint.name}" violated: "${elem.name}" has no outgoing "${arrowKind}" arrow`,
        involved: [elem.id]
      });
    } else if (matching.length > 1) {
      violations.push({
        id: randomUUID(),
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
        id: randomUUID(),
        kind: "equation",
        humanMessage: result.message,
        involved: result.involved
      });
    }
  }
  return { valid: violations.length === 0, violations };
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
  const lhsSteps = eq.lhs.arrows.map((kind) => ({
    kind,
    direction: "out"
  }));
  const rhsSteps = eq.rhs.arrows.map((kind) => ({
    kind,
    direction: "out"
  }));
  const lhsReached = followPath(store2, eq.lhs.src, lhsSteps);
  const rhsReached = followPath(store2, eq.rhs.src, rhsSteps);
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
  let message = `Equation "${eq.name}" violated:`;
  if (lhsNames.length > 0) {
    message += ` LHS reaches [${lhsNames.join(", ")}] but RHS does not.`;
  }
  if (rhsNames.length > 0) {
    message += ` RHS reaches [${rhsNames.join(", ")}] but LHS does not.`;
  }
  return { valid: false, involved, message };
}
function followPath(store2, startId, steps) {
  if (steps.length === 0) {
    const elem = store2.getElem(startId);
    return elem ? [elem] : [];
  }
  const result = store2.traverse({ startId, steps });
  return result.elements;
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
        const moduleStr = rawArrow.attrs.module ?? rawArrow.dstModule;
        const moduleId = `module:${moduleStr}`;
        if (srcId) {
          if (!createdModuleIds.has(moduleId)) {
            createdModuleIds.add(moduleId);
            elems.push({
              id: moduleId,
              kind: "module",
              name: moduleStr,
              module: moduleStr,
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
          const moduleId = `module:${sourceModule}`;
          if (!createdModuleIds.has(moduleId)) {
            createdModuleIds.add(moduleId);
            elems.push({
              id: moduleId,
              kind: "module",
              name: sourceModule,
              module: sourceModule,
              span: null,
              attrs: "{}"
            });
          }
          const ifAid = arrowId(id, "importsFrom", moduleId);
          if (!seenArrowIds.has(ifAid)) {
            seenArrowIds.add(ifAid);
            arrs.push({ id: ifAid, kind: "importsFrom", src_id: id, dst_id: moduleId, attrs: JSON.stringify({ module: sourceModule }) });
          }
        }
      }
    }
    filesProcessed++;
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
function registerOlogApply(server2, store2) {
  server2.registerTool(
    "olog_apply",
    {
      description: "Apply a validated plan to the olog graph. The plan must have been created by olog_plan and the hash must match. Returns a summary of applied operations and change instructions.",
      inputSchema: z6.object({
        plan: planSchema.describe("The plan object to apply, including its hash."),
        planHash: z6.string().describe("The expected hash of the plan. Must match plan.hash.")
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false
      }
    },
    async ({ plan, planHash }) => {
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
function escapeRegex(str) {
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
                nameRegex: `^${escapeRegex(op.newName)}$`,
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
import { randomUUID as randomUUID2 } from "crypto";
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
          const id = randomUUID2();
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

// src/index.ts
var projectRoot = process.env.OLOG_ROOT || process.cwd();
var ologDir = join(projectRoot, ".olog");
try {
  mkdirSync(ologDir, { recursive: true });
} catch (err) {
  console.error(
    `[olog] Failed to create ${ologDir}: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}
var dbPath = join(ologDir, "olog.sqlite");
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
var server = new McpServer9(
  { name: "olog-mcp", version: "0.0.1" },
  {
    instructions: `This server provides a structural model (ontology log) of the TypeScript codebase at ${projectRoot}. Tools: olog_query (search/filter/traverse), olog_inspect (details+provenance), olog_dump (overview), olog_reindex (refresh), olog_propose_schema (extend schema), olog_plan (describe changes), olog_validate (check plans), olog_apply (execute plans). The name and module parameters accept JavaScript regex patterns.`,
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
registerOlogApply(server, store);
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