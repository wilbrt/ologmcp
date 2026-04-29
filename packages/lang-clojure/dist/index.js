// src/adapter.ts
import { Parser as Parser2, Language as Language2 } from "web-tree-sitter";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { readFileSync } from "fs";

// src/extract.ts
import { Query } from "web-tree-sitter";
import fs from "fs";
function asKind(kind) {
  return kind;
}
function formatSpan(node) {
  const s = node.startPosition;
  const e = node.endPosition;
  return `${s.row + 1}:${s.column + 1}-${e.row + 1}:${e.column + 1}`;
}
function extractFromFile(parser, source, queryPath) {
  const elements = [];
  const arrows = [];
  let query = null;
  const language = parser.language;
  if (language) {
    try {
      const scmContent = fs.readFileSync(queryPath, "utf-8");
      query = new Query(language, scmContent);
    } catch {
    }
  }
  const tree = parser.parse(source);
  if (!tree) return { elements, arrows };
  if (query) {
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
      if (first("function.name")) {
        const n = first("function.name").node;
        const spanNode = n.parent ?? n;
        elements.push({ kind: "function", name: n.text, module: "", span: formatSpan(spanNode), attrs: {} });
      }
      if (first("namespace.name")) {
        const n = first("namespace.name").node;
        const spanNode = n.parent ?? n;
        elements.push({ kind: "namespace", name: n.text, module: "", span: formatSpan(spanNode), attrs: {} });
      }
      if (first("variable.name")) {
        const n = first("variable.name").node;
        const spanNode = n.parent ?? n;
        elements.push({ kind: "const", name: n.text, module: "", span: formatSpan(spanNode), attrs: {} });
      }
      if (first("import.source")) {
        const n = first("import.source").node;
        arrows.push({ kind: "imports", srcModule: "", srcName: "", dstModule: n.text, dstName: "", attrs: {} });
        if (first("import.name")) {
          arrows.push({ kind: asKind("importsFrom"), srcModule: "", srcName: first("import.name").node.text, dstModule: n.text, dstName: "", attrs: { module: n.text } });
        }
      }
      if (first("call.callee")) {
        const n = first("call.callee").node;
        arrows.push({ kind: "calls", srcModule: "", srcName: "", dstModule: "", dstName: n.text, attrs: {} });
      }
    }
  }
  walkForDefinitions(tree.rootNode, elements);
  walkForCalls(tree.rootNode, elements, arrows, null);
  tree.delete();
  return { elements, arrows };
}
function listValues(node) {
  return node.childrenForFieldName("value");
}
var DEFINITION_FORMS = /* @__PURE__ */ new Set([
  "defn",
  "defn-",
  "defmacro",
  "defmethod",
  "defmulti",
  "defprotocol",
  "defrecord",
  "deftype",
  "def",
  "defonce",
  "ns",
  "declare"
]);
function walkForDefinitions(node, elements) {
  if (!node) return;
  if (node.type === "list_lit") {
    const vals = listValues(node);
    if (vals.length >= 2) {
      const first = vals[0];
      const second = vals[1];
      if (first?.type === "sym_lit" && second?.type === "sym_lit") {
        const sym = first.text;
        const name = second.text;
        switch (sym) {
          case "defn":
          case "defn-":
            if (!elements.find((e) => e.name === name && e.kind === "function"))
              elements.push({ kind: "function", name, module: "", span: formatSpan(node), attrs: {} });
            break;
          case "defmacro":
            if (!elements.find((e) => e.name === name && e.kind === "function"))
              elements.push({ kind: "function", name, module: "", span: formatSpan(node), attrs: { macro: true } });
            break;
          case "def":
            if (!elements.find((e) => e.name === name && e.kind === "const"))
              elements.push({ kind: "const", name, module: "", span: formatSpan(node), attrs: {} });
            break;
          case "defonce":
            if (!elements.find((e) => e.name === name && e.kind === "const"))
              elements.push({ kind: "const", name, module: "", span: formatSpan(node), attrs: { once: true } });
            break;
          case "defmethod":
            if (!elements.find((e) => e.name === name && e.kind === "method"))
              elements.push({ kind: "method", name, module: "", span: formatSpan(node), attrs: {} });
            break;
          case "ns":
            if (!elements.find((e) => e.name === name && e.kind === "namespace"))
              elements.push({ kind: "namespace", name, module: "", span: formatSpan(node), attrs: {} });
            break;
          case "defprotocol":
            if (!elements.find((e) => e.name === name && e.kind === "interface"))
              elements.push({ kind: "interface", name, module: "", span: formatSpan(node), attrs: {} });
            break;
          case "defrecord":
          case "deftype":
            if (!elements.find((e) => e.name === name && e.kind === "class"))
              elements.push({ kind: "class", name, module: "", span: formatSpan(node), attrs: {} });
            break;
        }
      }
    }
  }
  for (const child of node.namedChildren) {
    walkForDefinitions(child, elements);
  }
}
function walkForCalls(node, elements, arrows, enclosingFn) {
  if (!node) return;
  if (node.type === "list_lit") {
    const vals = listValues(node);
    if (vals.length >= 1) {
      const head = vals[0];
      if (head?.type === "sym_lit") {
        const sym = head.text;
        if ((sym === "defn" || sym === "defn-" || sym === "defmacro") && vals[1]?.type === "sym_lit") {
          const newFnName = vals[1].text;
          for (const child of node.namedChildren) {
            walkForCalls(child, elements, arrows, newFnName);
          }
          return;
        }
        if ((sym === "def" || sym === "defonce") && vals[1]?.type === "sym_lit") {
          const defName = vals[1].text;
          for (const child of node.namedChildren) {
            walkForCalls(child, elements, arrows, defName);
          }
          for (let i = 2; i < vals.length; i++) {
            walkForRefs(vals[i], arrows, defName);
          }
          return;
        }
        if (sym === "defmethod" && vals[1]?.type === "sym_lit") {
          const methodName = vals[1].text;
          for (const child of node.namedChildren) {
            walkForCalls(child, elements, arrows, methodName);
          }
          return;
        }
        if (sym === "throw" && enclosingFn) {
          collectThrowKeywords(node, elements, arrows, enclosingFn);
        }
        if (!DEFINITION_FORMS.has(sym) && enclosingFn) {
          arrows.push({ kind: "calls", srcModule: "", srcName: enclosingFn, dstModule: "", dstName: sym, attrs: {} });
          arrows.push({ kind: asKind("callerOf"), srcModule: "", srcName: enclosingFn, dstModule: "", dstName: sym, attrs: {} });
          arrows.push({ kind: asKind("calleeOf"), srcModule: "", srcName: sym, dstModule: "", dstName: enclosingFn, attrs: {} });
        }
      }
    }
  }
  for (const child of node.namedChildren) {
    walkForCalls(child, elements, arrows, enclosingFn);
  }
}
function walkForRefs(node, arrows, srcName) {
  if (!node) return;
  if (node.type === "list_lit") {
    const vals = listValues(node);
    for (let i = 1; i < vals.length; i++) {
      walkForRefs(vals[i], arrows, srcName);
    }
    return;
  }
  if (node.type === "sym_lit") {
    const sym = node.text;
    if (!DEFINITION_FORMS.has(sym) && sym !== srcName) {
      arrows.push({ kind: "references", srcModule: "", srcName, dstModule: "", dstName: sym, attrs: {} });
    }
    return;
  }
  for (const child of node.namedChildren) {
    walkForRefs(child, arrows, srcName);
  }
}
function collectThrowKeywords(throwNode, elements, arrows, enclosingFn) {
  function walk(n, isMapKey) {
    if (isMapKey) return;
    if (n.type === "kwd_lit") {
      const kwd = n.text;
      if (kwd.includes("/")) {
        if (!elements.find((e) => e.name === kwd && e.kind === "symbol")) {
          elements.push({ kind: "symbol", name: kwd, module: "", span: formatSpan(n), attrs: { errorKeyword: true } });
        }
        arrows.push({ kind: "throws", srcModule: "", srcName: enclosingFn, dstModule: "", dstName: kwd, attrs: {} });
      }
      return;
    }
    if (n.type === "map_lit") {
      const children = n.namedChildren;
      for (let i = 0; i < children.length; i++) {
        walk(children[i], i % 2 === 0);
      }
      return;
    }
    for (const child of n.namedChildren) walk(child, false);
  }
  for (const child of throwNode.namedChildren) walk(child, false);
}

// src/adapter.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var _require = createRequire(import.meta.url);
var CLJ_QUERY_PATH = resolve(__dirname, "queries", "clj.scm");
var CLJ_WASM_PATH = resolve(__dirname, "tree-sitter-clojure.wasm");
var KIND_TO_NODE_TYPES = {
  function: ["list_lit"],
  method: ["list_lit"],
  variable: ["list_lit"],
  namespace: ["list_lit"]
};
var clojureLanguage = null;
var parserInstance = null;
async function init() {
  if (clojureLanguage) return;
  try {
    await Parser2.init();
  } catch {
    const webTreeSitterDir = dirname(_require.resolve("web-tree-sitter"));
    await Parser2.init({
      locateFile: (name) => resolve(webTreeSitterDir, name)
    });
  }
  const wasmBytes = readFileSync(CLJ_WASM_PATH);
  clojureLanguage = await Language2.load(wasmBytes);
  parserInstance = new Parser2();
  parserInstance.setLanguage(clojureLanguage);
}
var ClojureAdapter = class {
  languageId = "clojure";
  extensions = [".clj", ".cljs", ".cljc"];
  globPattern = "**/*.{clj,cljs,cljc}";
  nodeTypeToKind = {};
  kindToNodeTypes = KIND_TO_NODE_TYPES;
  createParser(_filename) {
    if (!parserInstance) {
      throw new Error("Clojure parser not initialized. Call init() first.");
    }
    return parserInstance;
  }
  queryPath(_filename) {
    return CLJ_QUERY_PATH;
  }
  extractElements(parser, source, queryPath) {
    return extractFromFile(parser, source, queryPath);
  }
  extractProperties(_parser, _source, _moduleName) {
    return [];
  }
  resolveImportSpecifier(specifier, _fromFile, _projectRoot) {
    if (!specifier || specifier.startsWith("/")) return null;
    return specifier.replace(/\./g, "/") + ".clj";
  }
};
export {
  ClojureAdapter,
  extractFromFile,
  init
};
