// src/adapter.ts
import Parser3 from "tree-sitter";
import TS from "tree-sitter-typescript";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// src/extract.ts
import Parser from "tree-sitter";
import fs from "fs";
function formatSpan(node) {
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
function extractFromFile(parser, source, queryPath, resolveImport) {
  const scmContent = fs.readFileSync(queryPath, "utf-8");
  const language = parser.getLanguage();
  const query = new Parser.Query(language, scmContent);
  const tree = parser.parse(source);
  if (tree.rootNode.hasError) {
    console.error("Warning: parse errors detected in source");
  }
  const elements = [];
  const arrows = [];
  function buildByName(match) {
    const byName = /* @__PURE__ */ new Map();
    for (const cap of match.captures) {
      const arr = byName.get(cap.name);
      if (arr) arr.push(cap);
      else byName.set(cap.name, [cap]);
    }
    return byName;
  }
  function first(byName, name) {
    return byName.get(name)?.[0];
  }
  const allMatches = query.matches(tree.rootNode);
  const importedNames = /* @__PURE__ */ new Map();
  if (resolveImport) {
    for (const match of allMatches) {
      const byName = buildByName(match);
      const sourceCap = first(byName, "import.source");
      if (!sourceCap) continue;
      const resolved = resolveImport(sourceCap.node.text);
      if (!resolved) continue;
      const names = byName.get("import.name") ?? [];
      const aliases = byName.get("import.alias") ?? [];
      for (let i = 0; i < names.length; i++) {
        const localName = aliases[i]?.node.text ?? names[i].node.text;
        importedNames.set(localName, resolved);
      }
      const defCap = first(byName, "import.default");
      if (defCap) importedNames.set(defCap.node.text, resolved);
      const nsCap = first(byName, "import.namespace");
      if (nsCap) importedNames.set(nsCap.node.text, resolved);
    }
  }
  for (const match of allMatches) {
    const byName = buildByName(match);
    const _first = (name) => first(byName, name);
    for (const cap of byName.get("function.name") ?? []) {
      elements.push({ kind: "function", name: cap.node.text, module: "", span: formatSpan(cap.node), attrs: {} });
    }
    for (const cap of byName.get("class.name") ?? []) {
      elements.push({ kind: "class", name: cap.node.text, module: "", span: formatSpan(cap.node), attrs: {} });
    }
    for (const cap of byName.get("interface.name") ?? []) {
      elements.push({ kind: "interface", name: cap.node.text, module: "", span: formatSpan(cap.node), attrs: {} });
    }
    for (const cap of byName.get("typealias.name") ?? []) {
      elements.push({ kind: "type", name: cap.node.text, module: "", span: formatSpan(cap.node), attrs: {} });
    }
    for (const cap of byName.get("enum.name") ?? []) {
      elements.push({ kind: "enum", name: cap.node.text, module: "", span: formatSpan(cap.node), attrs: {} });
    }
    for (const cap of byName.get("method.name") ?? []) {
      const methodNode = first(byName, "method")?.node ?? cap.node;
      elements.push({ kind: "method", name: cap.node.text, module: "", span: formatSpan(methodNode), attrs: {} });
    }
    const importStmtNode = _first("import")?.node;
    const rawImport = importStmtNode?.text;
    if (_first("import.source")) {
      const sourceCap = _first("import.source");
      const sourceModule = sourceCap.node.text;
      const attrs = (key) => ({
        sourceModule,
        ...rawImport ? { rawImport } : {},
        ...key ? { importedName: key } : {}
      });
      const names = byName.get("import.name") ?? [];
      const aliases = byName.get("import.alias") ?? [];
      for (let i = 0; i < names.length; i++) {
        const originalName = names[i].node.text;
        const localName = aliases[i]?.node.text ?? originalName;
        elements.push({ kind: "import", name: localName, module: "", span: formatSpan(names[i].node), attrs: attrs(originalName) });
        arrows.push({ kind: asKind("importsFrom"), srcModule: "", srcName: localName, dstModule: sourceModule, dstName: "", attrs: { module: sourceModule } });
      }
      const defCap = _first("import.default");
      if (defCap) {
        elements.push({ kind: "import", name: defCap.node.text, module: "", span: formatSpan(defCap.node), attrs: attrs("default") });
        arrows.push({ kind: asKind("importsFrom"), srcModule: "", srcName: defCap.node.text, dstModule: sourceModule, dstName: "", attrs: { module: sourceModule } });
      }
      const nsCap = _first("import.namespace");
      if (nsCap) {
        elements.push({ kind: "import", name: nsCap.node.text, module: "", span: formatSpan(nsCap.node), attrs: attrs("*") });
        arrows.push({ kind: asKind("importsFrom"), srcModule: "", srcName: nsCap.node.text, dstModule: sourceModule, dstName: "", attrs: { module: sourceModule } });
      }
    }
    if (_first("call.callee")) {
      const calleeNode = _first("call.callee").node;
      const calleeName = calleeNode.text;
      const callNode = _first("call")?.node ?? _first("call.member")?.node;
      const fnName = callNode ? findContainingFunctionName(callNode) : null;
      const dstModule = importedNames.get(calleeName) ?? "";
      arrows.push({ kind: "calls", srcModule: "", srcName: fnName ?? "", dstModule, dstName: calleeName, attrs: {} });
      if (fnName) {
        arrows.push({ kind: asKind("callerOf"), srcModule: "", srcName: fnName, dstModule, dstName: calleeName, attrs: {} });
        arrows.push({ kind: asKind("calleeOf"), srcModule: dstModule, srcName: calleeName, dstModule: "", dstName: fnName, attrs: {} });
      }
    }
    if (_first("call.method")) {
      const methodNode = _first("call.method").node;
      const methodName = methodNode.text;
      const callNode = _first("call.member")?.node ?? _first("call")?.node;
      const fnName = callNode ? findContainingFunctionName(callNode) : null;
      arrows.push({ kind: "calls", srcModule: "", srcName: fnName ?? "", dstModule: "", dstName: methodName, attrs: {} });
      if (fnName) {
        arrows.push({ kind: asKind("callerOf"), srcModule: "", srcName: fnName, dstModule: "", dstName: methodName, attrs: {} });
        arrows.push({ kind: asKind("calleeOf"), srcModule: "", srcName: methodName, dstModule: "", dstName: fnName, attrs: {} });
      }
    }
    if (_first("new.ctor")) {
      const ctorNode = _first("new.ctor").node;
      const ctorName = ctorNode.text;
      const newNode = _first("new")?.node;
      const fnName = newNode ? findContainingFunctionName(newNode) : null;
      const dstModule = importedNames.get(ctorName) ?? "";
      arrows.push({ kind: "calls", srcModule: "", srcName: fnName ?? "", dstModule, dstName: ctorName, attrs: {} });
      if (fnName) {
        arrows.push({ kind: asKind("callerOf"), srcModule: "", srcName: fnName, dstModule, dstName: ctorName, attrs: {} });
        arrows.push({ kind: asKind("calleeOf"), srcModule: dstModule, srcName: ctorName, dstModule: "", dstName: fnName, attrs: {} });
      }
    }
    if (_first("memberof.method") && _first("memberof.class")) {
      arrows.push({ kind: asKind("memberOf"), srcModule: "", srcName: _first("memberof.method").node.text, dstModule: "", dstName: _first("memberof.class").node.text, attrs: {} });
    }
  }
  if ("delete" in tree && typeof tree.delete === "function") {
    tree.delete();
  }
  return { elements, arrows };
}

// src/properties.ts
import "tree-sitter";
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
  const span = formatSpan(nameNode);
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

// src/adapter.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var TS_QUERY_PATH = resolve(__dirname, "queries", "ts.scm");
var TSX_QUERY_PATH = resolve(__dirname, "queries", "tsx.scm");
var NODE_TYPE_TO_KIND = {
  // These are not directly used by extractFromFile (which uses .scm captures),
  // but may be needed for future use.
};
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
var TS_CONFIG = {
  languageId: "typescript",
  extensions: [".ts", ".tsx", ".mts", ".cts"],
  globPattern: "**/*.{ts,tsx,mts,cts}",
  nodeTypeToKind: NODE_TYPE_TO_KIND,
  kindToNodeTypes: DECLARATION_NODE_TYPES
};
var TypeScriptAdapter = class {
  languageId = TS_CONFIG.languageId;
  extensions = TS_CONFIG.extensions;
  globPattern = TS_CONFIG.globPattern;
  nodeTypeToKind = TS_CONFIG.nodeTypeToKind;
  kindToNodeTypes = TS_CONFIG.kindToNodeTypes;
  createParser(filename) {
    const parser = new Parser3();
    const ext = filename.substring(filename.lastIndexOf("."));
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
  queryPath(filename) {
    const ext = filename.substring(filename.lastIndexOf("."));
    return ext === ".tsx" ? TSX_QUERY_PATH : TS_QUERY_PATH;
  }
  extractElements(parser, source, queryPath, fromFile, projectRoot) {
    const resolveImport = fromFile && projectRoot ? (specifier) => this.resolveImportSpecifier(specifier, fromFile, projectRoot) : void 0;
    return extractFromFile(parser, source, queryPath, resolveImport);
  }
  extractProperties(parser, source, moduleName) {
    return extractPropertiesFromFile(parser, source, moduleName);
  }
  resolveImportSpecifier(specifier, importingFileRelativePath, _projectRoot) {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
      return null;
    }
    const importingDir = dirname(importingFileRelativePath);
    const joined = importingDir + "/" + specifier.replace(/^\.\//, "");
    const normalized = normalizePath(joined);
    return normalized.replace(/\.(js|cjs|mjs|jsx)$/, ".ts");
  }
};
function normalizePath(path) {
  const parts = path.split("/");
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

// src/declaration.ts
import "tree-sitter";
var DECLARATION_NODE_TYPES2 = {
  function: ["function_declaration", "arrow_function"],
  method: ["method_definition", "abstract_method_signature"],
  class: ["class_declaration"],
  interface: ["interface_declaration"],
  type: ["type_alias_declaration"],
  enum: ["enum_declaration"],
  const: ["variable_declarator"],
  var: ["variable_declarator"]
};
function findEnclosingDeclaration(source, parser, identifierLine, identifierCol, kind) {
  const tree = parser.parse(source);
  const targetRow = identifierLine - 1;
  const targetCol = identifierCol - 1;
  let node = tree.rootNode.descendantForPosition(
    { row: targetRow, column: targetCol },
    { row: targetRow, column: targetCol + 1 }
  );
  const targetTypes = DECLARATION_NODE_TYPES2[kind] ?? [];
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
function extractDeclaration(source, parser, identifierLine, identifierCol, kind) {
  if (kind === "import") {
    const range2 = findImportStatement(source, identifierLine);
    return range2?.text ?? null;
  }
  const range = findEnclosingDeclaration(source, parser, identifierLine, identifierCol, kind);
  return range?.text ?? null;
}
export {
  DECLARATION_NODE_TYPES2 as DECLARATION_NODE_TYPES,
  TypeScriptAdapter,
  asKind,
  collectTypeIdentifiers,
  extractDeclaration,
  extractFromFile,
  extractPropertiesFromFile,
  extractPropertyFromNode,
  findEnclosingDeclaration,
  findImportStatement,
  formatSpan,
  walkDescendants
};
