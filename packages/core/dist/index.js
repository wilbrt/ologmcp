// src/db.ts
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

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
      const manualElems = this.db.prepare(
        "SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source = 'manual'"
      ).all();
      const manualArrs = this.db.prepare(
        "SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs FROM olog_arr a WHERE a.src_id IN (SELECT e.id FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source = 'manual') OR a.dst_id IN (SELECT e.id FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source = 'manual')"
      ).all();
      const manualProvs = this.db.prepare(
        "SELECT elem_id, source, commit_sha, ingested_at, confidence FROM olog_prov WHERE source = 'manual'"
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
    const join3 = opts.minConfidence ? " INNER JOIN olog_prov p ON e.id = p.elem_id" : "";
    const sql = `SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_elem e${join3} ${where} ORDER BY e.module, e.name LIMIT ?`;
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

// src/constraints.ts
import { randomUUID } from "crypto";
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
      id: randomUUID(),
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
function evaluatePathEquations(store, _operations) {
  const violations = [];
  const equations = store.getEquations();
  for (const eq of equations) {
    const result = evaluateEquation(eq, store);
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
function isSchemaElement(elem) {
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
import { resolve as resolve2, relative, basename, dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { execSync } from "child_process";

// src/ingest/treesitter.ts
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
function discoverTsFiles(projectRoot) {
  return globSync("**/*.{ts,tsx,mts,cts}", {
    cwd: projectRoot,
    ignore: IGNORE_PATTERNS,
    absolute: true
  });
}
function ingestProject(projectRoot, store) {
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
  const result = runIngestion(projectRoot, store, head);
  return { ...result, durationMs: Date.now() - start };
}
function reindexProject(projectRoot, store) {
  const start = Date.now();
  let head;
  try {
    head = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    head = "nogit";
  }
  const result = runIngestion(projectRoot, store, head);
  return { ...result, durationMs: Date.now() - start };
}
function runIngestion(projectRoot, store, head) {
  const files = discoverTsFiles(projectRoot);
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
    const relativePath = relative(projectRoot, absolutePath);
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
    filesProcessed++;
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
  const { join: join3 } = await import("path");
  const readFn = readFile ?? (async (p) => fsReadFile(join3(projectRoot, p), "utf8"));
  const writeFn = writeFile ?? (async (p, c) => fsWriteFile(join3(projectRoot, p), c, "utf8"));
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
  const { join: join3 } = await import("path");
  for (const snapshot of snapshots) {
    try {
      await fsWriteFile(join3(projectRoot, snapshot.filePath), snapshot.originalContent, "utf8");
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
function computeAddSymbolEdits(store, module, name, symbolKind, readFile) {
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
export {
  OlogStore,
  applyEditsToString,
  applySourceEdits,
  arrowId,
  discoverTsFiles,
  evaluateConstraints,
  evaluateEquation,
  evaluatePathEquations,
  ingestProject,
  isNounPhrase,
  offsetAt,
  reindexProject,
  renderAndApplyPlan,
  renderPlan,
  rollback,
  traverse,
  validateEquation
};
