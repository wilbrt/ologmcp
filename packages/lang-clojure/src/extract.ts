import { Parser, Language, Query, Node } from 'web-tree-sitter';
import type { QueryCapture } from 'web-tree-sitter';
import fs from 'node:fs';
import type { RawElement, RawArrow, ArrowKind } from '@olog/core';

function asKind(kind: string): ArrowKind {
  return kind as ArrowKind;
}

function formatSpan(node: Node): string {
  const s = node.startPosition;
  const e = node.endPosition;
  return `${s.row + 1}:${s.column + 1}-${e.row + 1}:${e.column + 1}`;
}

export function extractFromFile(
  parser: Parser,
  source: string,
  queryPath: string,
): { elements: RawElement[]; arrows: RawArrow[] } {
  const elements: RawElement[] = [];
  const arrows: RawArrow[] = [];

  let query: Query | null = null;
  const language = parser.language;
  if (language) {
    try {
      const scmContent = fs.readFileSync(queryPath, 'utf-8');
      query = new Query(language, scmContent);
    } catch {
      // fall through to programmatic extraction
    }
  }

  const tree = parser.parse(source);
  if (!tree) return { elements, arrows };

  if (query) {
    for (const match of query.matches(tree.rootNode)) {
      const byName = new Map<string, QueryCapture[]>();
      for (const cap of match.captures) {
        const arr = byName.get(cap.name);
        if (arr) {
          arr.push(cap);
        } else {
          byName.set(cap.name, [cap]);
        }
      }

      const first = (name: string): QueryCapture | undefined => {
        const arr = byName.get(name);
        return arr ? arr[0] : undefined;
      };

      if (first('function.name')) {
        const n = first('function.name')!.node;
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

  tree.delete();

  return { elements, arrows };
}

/** Returns the direct value children of a list_lit (skipping metadata, open/close parens). */
function listValues(node: Node): Node[] {
  return node.childrenForFieldName('value');
}

const DEFINITION_FORMS = new Set([
  'defn', 'defn-', 'defmacro', 'defmethod', 'defmulti', 'defprotocol',
  'defrecord', 'deftype', 'def', 'defonce', 'ns', 'declare',
]);

function walkForDefinitions(node: Node | null | undefined, elements: RawElement[]): void {
  if (!node) return;
  if (node.type === 'list_lit') {
    const vals = listValues(node);
    if (vals.length >= 2) {
      const first = vals[0];
      const second = vals[1];
      if (first?.type === 'sym_lit' && second?.type === 'sym_lit') {
        const sym = first.text;
        const name = second.text;
        switch (sym) {
          case 'defn':
          case 'defn-':
            if (!elements.find(e => e.name === name && e.kind === 'function'))
              elements.push({ kind: 'function', name, module: '', span: formatSpan(node), attrs: {} });
            break;
          case 'defmacro':
            if (!elements.find(e => e.name === name && e.kind === 'function'))
              elements.push({ kind: 'function', name, module: '', span: formatSpan(node), attrs: { macro: true } });
            break;
          case 'def':
            if (!elements.find(e => e.name === name && e.kind === 'const'))
              elements.push({ kind: 'const', name, module: '', span: formatSpan(node), attrs: {} });
            break;
          case 'defmethod':
            if (!elements.find(e => e.name === name && e.kind === 'method'))
              elements.push({ kind: 'method', name, module: '', span: formatSpan(node), attrs: {} });
            break;
          case 'ns':
            if (!elements.find(e => e.name === name && e.kind === 'namespace'))
              elements.push({ kind: 'namespace', name, module: '', span: formatSpan(node), attrs: {} });
            break;
          case 'defprotocol':
            if (!elements.find(e => e.name === name && e.kind === 'interface'))
              elements.push({ kind: 'interface', name, module: '', span: formatSpan(node), attrs: {} });
            break;
          case 'defrecord':
          case 'deftype':
            if (!elements.find(e => e.name === name && e.kind === 'class'))
              elements.push({ kind: 'class', name, module: '', span: formatSpan(node), attrs: {} });
            break;
        }
      }
    }
  }

  for (const child of node.namedChildren) {
    walkForDefinitions(child, elements);
  }
}

function walkForCalls(node: Node | null | undefined, arrows: RawArrow[], enclosingFn: string | null): void {
  if (!node) return;
  if (node.type === 'list_lit') {
    const vals = listValues(node);
    if (vals.length >= 1) {
      const head = vals[0];
      if (head?.type === 'sym_lit') {
        const sym = head.text;
        if ((sym === 'defn' || sym === 'defn-' || sym === 'defmacro') && vals[1]?.type === 'sym_lit') {
          const newFnName = vals[1]!.text;
          for (const child of node.namedChildren) {
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
  }

  for (const child of node.namedChildren) {
    walkForCalls(child, arrows, enclosingFn);
  }
}
