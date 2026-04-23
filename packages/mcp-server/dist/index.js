#!/usr/bin/env node

// src/index.ts
import { mkdirSync } from "fs";
import { join } from "path";
import { McpServer as McpServer5 } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// ../core/src/db.ts
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var OlogStore = class {
  db;
  getElemStmt;
  outgoingStmt;
  incomingStmt;
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
};

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
function formatSpan(node) {
  const s = node.startPosition;
  const e = node.endPosition;
  return `${s.row + 1}:${s.column + 1}-${e.row + 1}:${e.column + 1}`;
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
      elements.push({ kind: "function", name: n.text, module: "", span: formatSpan(n), attrs: {} });
    }
    for (const cap of byName.get("class.name") ?? []) {
      const n = cap.node;
      elements.push({ kind: "class", name: n.text, module: "", span: formatSpan(n), attrs: {} });
    }
    for (const cap of byName.get("interface.name") ?? []) {
      const n = cap.node;
      elements.push({ kind: "interface", name: n.text, module: "", span: formatSpan(n), attrs: {} });
    }
    for (const cap of byName.get("typealias.name") ?? []) {
      const n = cap.node;
      elements.push({ kind: "type", name: n.text, module: "", span: formatSpan(n), attrs: {} });
    }
    for (const cap of byName.get("enum.name") ?? []) {
      const n = cap.node;
      elements.push({ kind: "enum", name: n.text, module: "", span: formatSpan(n), attrs: {} });
    }
    for (const cap of byName.get("method.name") ?? []) {
      const n = cap.node;
      elements.push({ kind: "method", name: n.text, module: "", span: formatSpan(n), attrs: {} });
    }
    for (const cap of byName.get("import.name") ?? []) {
      const n = cap.node;
      elements.push({ kind: "import", name: n.text, module: "", span: formatSpan(n), attrs: {} });
    }
    if (first("import.default")) {
      const n = first("import.default").node;
      elements.push({ kind: "import", name: n.text, module: "", span: formatSpan(n), attrs: {} });
    }
    if (first("import.namespace")) {
      const n = first("import.namespace").node;
      elements.push({ kind: "import", name: n.text, module: "", span: formatSpan(n), attrs: {} });
    }
    for (const srcCap of ["import.source", "reexport.source", "require.source"]) {
      if (first(srcCap)) {
        const n = first(srcCap).node;
        arrows.push({ kind: "imports", srcModule: "", srcName: "", dstModule: n.text, dstName: "", attrs: {} });
      }
    }
    if (first("call.callee")) {
      const calleeNode = first("call.callee").node;
      const callNode = first("call")?.node ?? first("call.member")?.node;
      const fnName = callNode ? findContainingFunctionName(callNode) : null;
      arrows.push({ kind: "calls", srcModule: "", srcName: fnName ?? "", dstModule: "", dstName: calleeNode.text, attrs: {} });
    }
    if (first("call.method")) {
      const methodNode = first("call.method").node;
      const callNode = first("call.member")?.node ?? first("call")?.node;
      const fnName = callNode ? findContainingFunctionName(callNode) : null;
      arrows.push({ kind: "calls", srcModule: "", srcName: fnName ?? "", dstModule: "", dstName: methodNode.text, attrs: {} });
    }
    if (first("new.ctor")) {
      const ctorNode = first("new.ctor").node;
      const newNode = first("new")?.node;
      const fnName = newNode ? findContainingFunctionName(newNode) : null;
      arrows.push({ kind: "calls", srcModule: "", srcName: fnName ?? "", dstModule: "", dstName: ctorNode.text, attrs: {} });
    }
  }
  if ("delete" in tree && typeof tree.delete === "function") {
    tree.delete();
  }
  return { elements, arrows };
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
function formatSpan2(relativePath, startLine, startCol, endLine, endCol) {
  return `${relativePath}:${startLine}:${startCol}-${endLine}:${endCol}`;
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
    for (const rawElem of extracted.elements) {
      const coords = parseTreeSitterSpan(rawElem.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;
      const fullSpan = coords ? formatSpan2(relativePath, coords.startLine, coords.startCol, coords.endLine, coords.endCol) : rawElem.span;
      const id = elemId(relativePath, line, col, rawElem.kind, rawElem.name);
      nameToId.set(rawElem.name, id);
      elems.push({
        id,
        kind: rawElem.kind,
        name: rawElem.name,
        module: relativePath,
        span: fullSpan,
        attrs: JSON.stringify(rawElem.attrs)
      });
      if (rawElem.kind !== "file") {
        arrs.push({
          id: arrowId(fileId, "contains", id),
          kind: "contains",
          src_id: fileId,
          dst_id: id,
          attrs: "{}"
        });
      }
    }
    for (const rawArrow of extracted.arrows) {
      const srcId = nameToId.get(rawArrow.srcName);
      const dstId = nameToId.get(rawArrow.dstName);
      if (srcId && dstId) {
        arrs.push({
          id: arrowId(srcId, rawArrow.kind, dstId),
          kind: rawArrow.kind,
          src_id: srcId,
          dst_id: dstId,
          attrs: JSON.stringify(rawArrow.attrs)
        });
      }
    }
    for (const rawElem of extracted.elements) {
      if (rawElem.kind === "import") {
        const coords = parseTreeSitterSpan(rawElem.span);
        const line = coords?.startLine ?? 1;
        const col = coords?.startCol ?? 1;
        const id = elemId(relativePath, line, col, rawElem.kind, rawElem.name);
        arrs.push({
          id: arrowId(fileId, "imports", id),
          kind: "imports",
          src_id: fileId,
          dst_id: id,
          attrs: "{}"
        });
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
  server2.registerTool(
    "olog_query",
    {
      description: "Query the ontology log for structural elements matching filters. Returns elements with their kind, name, module (file path), and span (location).",
      inputSchema: z.object({
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
        limit: z.number().int().min(1).max(500).default(50).describe("Maximum number of results to return")
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ kind, name, module, limit }) => {
      try {
        const opts = {
          limit
        };
        if (kind !== "any") opts.kind = kind;
        if (name !== void 0) opts.nameRegex = name;
        if (module !== void 0) opts.moduleRegex = module;
        const rows = store2.queryElements(opts);
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
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ element, outgoing, incoming }, null, 2)
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
var server = new McpServer5(
  { name: "olog-mcp", version: "0.0.1" },
  {
    instructions: `This server provides a structural model (ontology log) of the TypeScript codebase at ${projectRoot}. Use olog_query to search for elements by kind/name/module. Use olog_inspect to get details and connections for a specific element. Use olog_dump for an overview. Use olog_reindex to refresh after code changes. The name and module parameters in olog_query accept JavaScript regex patterns.`,
    capabilities: { logging: {} }
  }
);
registerOlogQuery(server, store);
registerOlogInspect(server, store);
registerOlogDump(server, store);
registerOlogReindex(server, store, projectRoot);
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