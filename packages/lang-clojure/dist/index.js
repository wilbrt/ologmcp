// src/adapter.ts
import Parser2 from "tree-sitter";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// src/extract.ts
import Parser from "tree-sitter";
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
  try {
    const scmContent = fs.readFileSync(queryPath, "utf-8");
    const language = parser.getLanguage();
    query = new Parser.Query(language, scmContent);
  } catch {
  }
  const tree = parser.parse(source);
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
        elements.push({ kind: "function", name: n.text, module: "", span: formatSpan(n), attrs: {} });
      }
      if (first("namespace.name")) {
        const n = first("namespace.name").node;
        elements.push({ kind: "namespace", name: n.text, module: "", span: formatSpan(n), attrs: {} });
      }
      if (first("variable.name")) {
        const n = first("variable.name").node;
        elements.push({ kind: "const", name: n.text, module: "", span: formatSpan(n), attrs: {} });
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
  if ("delete" in tree && typeof tree.delete === "function") {
    tree.delete();
  }
  return { elements, arrows };
}
function walkForDefinitions(node, elements) {
  if (node.type === "list" && node.children.length >= 2) {
    const firstChild = node.children[0];
    const secondChild = node.children[1];
    if (firstChild?.type === "symbol" && secondChild?.type === "symbol") {
      const sym = firstChild.text;
      const name = secondChild.text;
      switch (sym) {
        case "defn":
        case "defn-":
          const existingFn = elements.find((e) => e.name === name && e.kind === "function");
          if (!existingFn) {
            elements.push({ kind: "function", name, module: "", span: formatSpan(secondChild), attrs: {} });
          }
          break;
        case "defmacro":
          const existingMacro = elements.find((e) => e.name === name && e.kind === "function");
          if (!existingMacro) {
            elements.push({ kind: "function", name, module: "", span: formatSpan(secondChild), attrs: { macro: true } });
          }
          break;
        case "def":
          const existingVar = elements.find((e) => e.name === name && e.kind === "const");
          if (!existingVar) {
            elements.push({ kind: "const", name, module: "", span: formatSpan(secondChild), attrs: {} });
          }
          break;
        case "defmethod":
          const existingMethod = elements.find((e) => e.name === name && e.kind === "method");
          if (!existingMethod) {
            elements.push({ kind: "method", name, module: "", span: formatSpan(secondChild), attrs: {} });
          }
          break;
        case "ns":
          const existingNs = elements.find((e) => e.name === name && e.kind === "namespace");
          if (!existingNs) {
            elements.push({ kind: "namespace", name, module: "", span: formatSpan(secondChild), attrs: {} });
          }
          break;
        case "defprotocol":
          const existingProto = elements.find((e) => e.name === name && e.kind === "interface");
          if (!existingProto) {
            elements.push({ kind: "interface", name, module: "", span: formatSpan(secondChild), attrs: {} });
          }
          break;
        case "defrecord":
        case "deftype":
          const existingRec = elements.find((e) => e.name === name && e.kind === "class");
          if (!existingRec) {
            elements.push({ kind: "class", name, module: "", span: formatSpan(secondChild), attrs: {} });
          }
          break;
      }
    }
  }
  for (const child of node.children) {
    walkForDefinitions(child, elements);
  }
}

// src/adapter.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var CLJ_QUERY_PATH = resolve(__dirname, "queries", "clj.scm");
var KIND_TO_NODE_TYPES = {
  function: ["list"],
  method: ["list"],
  variable: ["list"],
  namespace: ["list"]
};
var clojureGrammar = null;
async function init() {
  if (clojureGrammar) return;
  try {
    const mod = await import("tree-sitter-clojure");
    clojureGrammar = mod.default ?? mod;
  } catch (_err) {
    throw new Error(
      "tree-sitter-clojure is not installed. Install it with: npm install tree-sitter-clojure\nNote: this package requires a compatible Node.js version for native module compilation."
    );
  }
}
var ClojureAdapter = class {
  languageId = "clojure";
  extensions = [".clj", ".cljs", ".cljc"];
  globPattern = "**/*.{clj,cljs,cljc}";
  nodeTypeToKind = {
    // Clojure queries will set the kind directly via captures
    // This mapping is less relevant since we determine kind from the symbol name
  };
  kindToNodeTypes = KIND_TO_NODE_TYPES;
  createParser(filename) {
    if (!clojureGrammar) {
      throw new Error(
        "Clojure grammar not loaded. Call init() first, or install tree-sitter-clojure.\nSee https://github.com/wilbrdt/ologmcp for details."
      );
    }
    const parser = new Parser2();
    parser.setLanguage(clojureGrammar);
    return parser;
  }
  queryPath(_filename) {
    return CLJ_QUERY_PATH;
  }
  extractElements(parser, source, queryPath) {
    return extractFromFile(parser, source, queryPath);
  }
  // Clojure doesn't have TypeScript-style interface/class property extraction
  // This can be expanded later for defrecord/deftype fields
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
