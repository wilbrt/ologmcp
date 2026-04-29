import Parser from 'tree-sitter';
import fs from 'node:fs';
import type { RawElement, RawArrow, ArrowKind } from '@olog/core';

function asKind(kind: string): ArrowKind {
  return kind as ArrowKind;
}

/** Format a node position as "startLine:startCol-endLine:endCol" (1-based). */
function formatSpan(node: Parser.SyntaxNode): string {
  const s = node.startPosition;
  const e = node.endPosition;
  return `${s.row + 1}:${s.column + 1}-${e.row + 1}:${e.column + 1}`;
}

/**
 * Extract semantic elements and arrows from Clojure source code.
 */
export function extractFromFile(
  parser: Parser,
  source: string,
  queryPath: string,
): { elements: RawElement[]; arrows: RawArrow[] } {
  const elements: RawElement[] = [];
  const arrows: RawArrow[] = [];

  let query: Parser.Query | null = null;
  try {
    const scmContent = fs.readFileSync(queryPath, 'utf-8');
    const language = parser.getLanguage();
    query = new Parser.Query(language, scmContent);
  } catch {
    // fall through to programmatic extraction
  }

  const tree = parser.parse(source);

  if (query) {
    for (const match of query.matches(tree.rootNode)) {
      const byName = new Map<string, Parser.QueryCapture[]>();
      for (const cap of match.captures) {
        const arr = byName.get(cap.name);
        if (arr) {
          arr.push(cap);
        } else {
          byName.set(cap.name, [cap]);
        }
      }

      const first = (name: string): Parser.QueryCapture | undefined => {
        const arr = byName.get(name);
        return arr ? arr[0] : undefined;
      };

      if (first('function.name')) {
        const n = first('function.name')!.node;
        // Use the enclosing list node (the defn form) for the span, not just the name symbol
        const spanNode = n.parent ?? n;
        elements.push({ kind: 'function', name: n.text, module: '', span: formatSpan(spanNode), attrs: {} });
      }

      if (first('namespace.name')) {
        const n = first('namespace.name')!.node;
        const spanNode = n.parent ?? n;
        elements.push({ kind: 'namespace', name: n.text, module: '', span: formatSpan(spanNode), attrs: {} });
      }

      if (first('variable.name')) {
        const n = first('variable.name')!.node;
        const spanNode = n.parent ?? n;
        elements.push({ kind: 'const', name: n.text, module: '', span: formatSpan(spanNode), attrs: {} });
      }

      if (first('import.source')) {
        const n = first('import.source')!.node;
        arrows.push({ kind: 'imports', srcModule: '', srcName: '', dstModule: n.text, dstName: '', attrs: {} });
        if (first('import.name')) {
          arrows.push({ kind: asKind('importsFrom'), srcModule: '', srcName: first('import.name')!.node.text, dstModule: n.text, dstName: '', attrs: { module: n.text } });
        }
      }

      if (first('call.callee')) {
        const n = first('call.callee')!.node;
        arrows.push({ kind: 'calls', srcModule: '', srcName: '', dstModule: '', dstName: n.text, attrs: {} });
      }
    }
  }

  walkForDefinitions(tree.rootNode, elements);
  walkForCalls(tree.rootNode, arrows, null);

  if ('delete' in tree && typeof (tree as unknown as { delete?: unknown }).delete === 'function') {
    (tree as unknown as { delete: () => void }).delete();
  }

  return { elements, arrows };
}

/**
 * Programmatically walk the tree to find defn/def/ns/etc. forms.
 * Uses the enclosing list node span so the full function body is captured.
 */
function walkForDefinitions(node: Parser.SyntaxNode, elements: RawElement[]): void {
  if (node.type === 'list' && node.children.length >= 2) {
    const firstChild = node.children[0];
    const secondChild = node.children[1];

    if (firstChild?.type === 'symbol' && secondChild?.type === 'symbol') {
      const sym = firstChild.text;
      const name = secondChild.text;

      switch (sym) {
        case 'defn':
        case 'defn-': {
          const existingFn = elements.find(e => e.name === name && e.kind === 'function');
          if (!existingFn) {
            elements.push({ kind: 'function', name, module: '', span: formatSpan(node), attrs: {} });
          }
          break;
        }
        case 'defmacro': {
          const existingMacro = elements.find(e => e.name === name && e.kind === 'function');
          if (!existingMacro) {
            elements.push({ kind: 'function', name, module: '', span: formatSpan(node), attrs: { macro: true } });
          }
          break;
        }
        case 'def': {
          const existingVar = elements.find(e => e.name === name && e.kind === 'const');
          if (!existingVar) {
            elements.push({ kind: 'const', name, module: '', span: formatSpan(node), attrs: {} });
          }
          break;
        }
        case 'defmethod': {
          const existingMethod = elements.find(e => e.name === name && e.kind === 'method');
          if (!existingMethod) {
            elements.push({ kind: 'method', name, module: '', span: formatSpan(node), attrs: {} });
          }
          break;
        }
        case 'ns': {
          const existingNs = elements.find(e => e.name === name && e.kind === 'namespace');
          if (!existingNs) {
            elements.push({ kind: 'namespace', name, module: '', span: formatSpan(node), attrs: {} });
          }
          break;
        }
        case 'defprotocol': {
          const existingProto = elements.find(e => e.name === name && e.kind === 'interface');
          if (!existingProto) {
            elements.push({ kind: 'interface', name, module: '', span: formatSpan(node), attrs: {} });
          }
          break;
        }
        case 'defrecord':
        case 'deftype': {
          const existingRec = elements.find(e => e.name === name && e.kind === 'class');
          if (!existingRec) {
            elements.push({ kind: 'class', name, module: '', span: formatSpan(node), attrs: {} });
          }
          break;
        }
      }
    }
  }

  for (const child of node.children) {
    walkForDefinitions(child, elements);
  }
}

const DEFINITION_FORMS = new Set([
  'defn', 'defn-', 'defmacro', 'defmethod', 'defmulti', 'defprotocol',
  'defrecord', 'deftype', 'def', 'defonce', 'ns', 'declare',
]);

/**
 * Walk the tree to emit callerOf/calleeOf arrows for function calls.
 * Tracks the enclosing defn to attribute each call to its containing function.
 */
function walkForCalls(node: Parser.SyntaxNode, arrows: RawArrow[], enclosingFn: string | null): void {
  if (node.type === 'list' && node.children.length >= 1) {
    const firstChild = node.children[0];
    if (firstChild?.type === 'symbol') {
      const sym = firstChild.text;

      if ((sym === 'defn' || sym === 'defn-' || sym === 'defmacro') && node.children[1]?.type === 'symbol') {
        const newFnName = node.children[1]!.text;
        for (const child of node.children) {
          walkForCalls(child, arrows, newFnName);
        }
        return;
      }

      if (!DEFINITION_FORMS.has(sym) && enclosingFn) {
        arrows.push({ kind: 'calls', srcModule: '', srcName: enclosingFn, dstModule: '', dstName: sym, attrs: {} });
        arrows.push({ kind: asKind('callerOf'), srcModule: '', srcName: enclosingFn, dstModule: '', dstName: sym, attrs: {} });
        arrows.push({ kind: asKind('calleeOf'), srcModule: '', srcName: sym, dstModule: '', dstName: enclosingFn, attrs: {} });
      }
    }
  }

  for (const child of node.children) {
    walkForCalls(child, arrows, enclosingFn);
  }
}
