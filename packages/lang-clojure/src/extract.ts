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

interface NsAliases {
  /** namespace alias → full Clojure namespace path (e.g. "fee-model" → "myapp.fee-model") */
  aliases: Map<string, string>;
  /** referred function name → full Clojure namespace path */
  refers: Map<string, string>;
}

/**
 * Walk the root node's top-level `(ns ...)` form and collect `:require` aliases
 * and `:refer` mappings so cross-module call arrows can be keyed correctly.
 */
function collectNsAliases(root: Node): NsAliases {
  const aliases = new Map<string, string>();
  const refers = new Map<string, string>();

  for (const top of root.namedChildren) {
    if (top.type !== 'list_lit') continue;
    const topVals = listValues(top);
    if (topVals[0]?.type !== 'sym_lit' || topVals[0].text !== 'ns') continue;

    for (let i = 2; i < topVals.length; i++) {
      const clause = topVals[i]!;
      if (clause.type !== 'list_lit') continue;
      const clauseVals = listValues(clause);
      if (clauseVals[0]?.type !== 'kwd_lit' || clauseVals[0].text !== ':require') continue;

      for (let j = 1; j < clauseVals.length; j++) {
        const dep = clauseVals[j]!;
        if (dep.type !== 'vec_lit') continue;
        const depVals = dep.childrenForFieldName('value');
        const nsPath = depVals[0];
        if (!nsPath || nsPath.type !== 'sym_lit') continue;
        const fullNs = nsPath.text;

        for (let k = 1; k < depVals.length - 1; k++) {
          const kw = depVals[k];
          if (!kw || kw.type !== 'kwd_lit') continue;
          if (kw.text === ':as') {
            const aliasNode = depVals[k + 1];
            if (aliasNode?.type === 'sym_lit') aliases.set(aliasNode.text, fullNs);
          } else if (kw.text === ':refer') {
            const referVec = depVals[k + 1];
            if (referVec?.type === 'vec_lit') {
              for (const fn of referVec.childrenForFieldName('value')) {
                if (fn.type === 'sym_lit') refers.set(fn.text, fullNs);
              }
            }
          }
        }
      }
    }
    break; // only one ns form per file
  }

  return { aliases, refers };
}

/** Convert a Clojure namespace path to the conventional file path suffix. */
function nsToFileSuffix(ns: string): string {
  return ns.replace(/\./g, '/').replace(/-/g, '_') + '.clj';
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

  const nsAliases = collectNsAliases(tree.rootNode);
  walkForDefinitions(tree.rootNode, elements, arrows);
  walkForCalls(tree.rootNode, elements, arrows, null, nsAliases);

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
  // schema.core (alias s/) equivalents
  's/defn', 's/defn-', 's/defschema', 's/defrecord', 's/defprotocol',
  's/def', 's/defonce',
]);

/**
 * Returns true if `sym` is a re-frame registration/dispatch form,
 * matching both bare (e.g. "reg-sub") and namespace-qualified forms
 * (e.g. "rf/reg-sub", "re-frame/reg-sub", "re-frame.core/reg-sub").
 */
function isReframeForm(sym: string, localName: string): boolean {
  return sym === localName || sym.endsWith('/' + localName);
}

/** Extract the re-frame keyword from a reg-sub/reg-event-* form's second value node. */
function reframeKeyword(vals: Node[]): string | null {
  const kw = vals[1];
  if (!kw) return null;
  // Keywords: ::name, :ns/name, :name
  if (kw.type === 'kwd_lit') return kw.text;
  return null;
}

/**
 * Collect `:<- [::sub]` input signal vectors from a reg-sub form.
 * Returns the keyword names of all input subscriptions.
 */
function collectInputSignals(vals: Node[]): string[] {
  const inputs: string[] = [];
  for (let i = 2; i < vals.length - 1; i++) {
    const kw = vals[i];
    const vec = vals[i + 1];
    if (kw?.type === 'kwd_lit' && kw.text === ':<-' && vec?.type === 'vec_lit') {
      const vecVals = vec.childrenForFieldName('value');
      const inputKw = vecVals[0];
      if (inputKw?.type === 'kwd_lit') inputs.push(inputKw.text);
    }
  }
  return inputs;
}

/**
 * Extract the dispatch/subscribe keyword from a call like (rf/dispatch [::event args...])
 * or (rf/subscribe [::sub]).
 */
function extractVectorKeyword(vals: Node[]): string | null {
  const vec = vals[1];
  if (!vec || vec.type !== 'vec_lit') return null;
  const vecVals = vec.childrenForFieldName('value');
  const kw = vecVals[0];
  if (kw?.type === 'kwd_lit') return kw.text;
  return null;
}

/**
 * Extract (:require ...) entries from a (ns ...) form and emit them as import elements.
 * Each [ns.path :as alias] vector becomes an import element with attrs.rawRequire set
 * to the Clojure require string so the delegation brief can format it correctly.
 */
function extractNsRequires(nsNode: Node, elements: RawElement[]): void {
  const vals = listValues(nsNode);
  for (let i = 2; i < vals.length; i++) {
    const clause = vals[i]!;
    if (clause.type !== 'list_lit') continue;
    const clauseVals = listValues(clause);
    if (clauseVals[0]?.type !== 'kwd_lit' || clauseVals[0].text !== ':require') continue;

    for (let j = 1; j < clauseVals.length; j++) {
      const dep = clauseVals[j]!;
      if (dep.type !== 'vec_lit') continue;
      const depVals = dep.childrenForFieldName('value');
      const nsPathNode = depVals[0];
      if (!nsPathNode || nsPathNode.type !== 'sym_lit') continue;
      const fullNs = nsPathNode.text;

      let alias = '';
      let rawRequire = `[${fullNs}]`;

      for (let k = 1; k < depVals.length - 1; k++) {
        const kw = depVals[k];
        if (!kw || kw.type !== 'kwd_lit') continue;
        if (kw.text === ':as') {
          const aliasNode = depVals[k + 1];
          if (aliasNode?.type === 'sym_lit') {
            alias = aliasNode.text;
            rawRequire = `[${fullNs} :as ${alias}]`;
          }
        } else if (kw.text === ':refer') {
          const referVec = depVals[k + 1];
          if (referVec?.type === 'vec_lit') {
            const fns = referVec.childrenForFieldName('value').map(n => n.text).join(' ');
            rawRequire = `[${fullNs} :refer [${fns}]]`;
          }
        }
      }

      if (!elements.find(e => e.kind === 'import' && e.attrs?.sourceModule === fullNs)) {
        elements.push({
          kind: 'import',
          name: alias || fullNs,
          module: '',
          span: formatSpan(dep),
          attrs: { sourceModule: fullNs, alias, rawRequire },
        });
      }
    }
  }
}

function walkForDefinitions(node: Node | null | undefined, elements: RawElement[], arrows: RawArrow[] = []): void {
  if (!node) return;
  if (node.type === 'list_lit') {
    const vals = listValues(node);
    if (vals.length >= 2) {
      const head = vals[0];

      // re-frame registration forms: keyword as second element
      if (head?.type === 'sym_lit') {
        const sym = head.text;
        const kwName = reframeKeyword(vals);
        if (kwName) {
          if (isReframeForm(sym, 'reg-sub')) {
            if (!elements.find(e => e.name === kwName && e.kind === 'const'))
              elements.push({ kind: 'const', name: kwName, module: '', span: formatSpan(node), attrs: { reframe: 'subscription' } });
            // :<- input signal arrows: subscription → input subscription
            for (const inputKw of collectInputSignals(vals)) {
              arrows.push({ kind: asKind('callerOf'), srcModule: '', srcName: kwName, dstModule: '', dstName: inputKw, attrs: {} });
              arrows.push({ kind: asKind('calleeOf'), srcModule: '', srcName: inputKw, dstModule: '', dstName: kwName, attrs: {} });
            }
          } else if (isReframeForm(sym, 'reg-event-db') || isReframeForm(sym, 'reg-event-fx')) {
            if (!elements.find(e => e.name === kwName && e.kind === 'const'))
              elements.push({ kind: 'const', name: kwName, module: '', span: formatSpan(node), attrs: { reframe: 'event' } });
          } else if (isReframeForm(sym, 'reg-fx')) {
            if (!elements.find(e => e.name === kwName && e.kind === 'const'))
              elements.push({ kind: 'const', name: kwName, module: '', span: formatSpan(node), attrs: { reframe: 'fx' } });
          } else if (isReframeForm(sym, 'reg-cofx')) {
            if (!elements.find(e => e.name === kwName && e.kind === 'const'))
              elements.push({ kind: 'const', name: kwName, module: '', span: formatSpan(node), attrs: { reframe: 'cofx' } });
          }
        }
      }

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
          case 'defonce':
            if (!elements.find(e => e.name === name && e.kind === 'const'))
              elements.push({ kind: 'const', name, module: '', span: formatSpan(node), attrs: { once: true } });
            break;
          case 'defmethod':
            if (!elements.find(e => e.name === name && e.kind === 'method'))
              elements.push({ kind: 'method', name, module: '', span: formatSpan(node), attrs: {} });
            break;
          case 'ns':
            if (!elements.find(e => e.name === name && e.kind === 'namespace'))
              elements.push({ kind: 'namespace', name, module: '', span: formatSpan(node), attrs: {} });
            extractNsRequires(node, elements);
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
          // schema.core (alias s/) forms
          case 's/defn':
          case 's/defn-':
            if (!elements.find(e => e.name === name && e.kind === 'function'))
              elements.push({ kind: 'function', name, module: '', span: formatSpan(node), attrs: { schema: true } });
            break;
          case 's/defschema':
            if (!elements.find(e => e.name === name && e.kind === 'type'))
              elements.push({ kind: 'type', name, module: '', span: formatSpan(node), attrs: { schema: true } });
            break;
          case 's/defrecord':
            if (!elements.find(e => e.name === name && e.kind === 'class'))
              elements.push({ kind: 'class', name, module: '', span: formatSpan(node), attrs: { schema: true } });
            break;
          case 's/defprotocol':
            if (!elements.find(e => e.name === name && e.kind === 'interface'))
              elements.push({ kind: 'interface', name, module: '', span: formatSpan(node), attrs: { schema: true } });
            break;
          case 's/def':
            if (!elements.find(e => e.name === name && e.kind === 'const'))
              elements.push({ kind: 'const', name, module: '', span: formatSpan(node), attrs: { schema: true } });
            break;
          case 's/defonce':
            if (!elements.find(e => e.name === name && e.kind === 'const'))
              elements.push({ kind: 'const', name, module: '', span: formatSpan(node), attrs: { schema: true, once: true } });
            break;
        }
      }
    }
  }

  for (const child of node.namedChildren) {
    walkForDefinitions(child, elements, arrows);
  }
}

/**
 * Walk tree recording call arrows. Enters all top-level definition forms
 * (defn, def, defonce, defmethod) and tracks the enclosing name as context
 * so calls/callerOf/calleeOf arrows are symmetrically populated for every form.
 */
function walkForCalls(
  node: Node | null | undefined,
  elements: RawElement[],
  arrows: RawArrow[],
  enclosingFn: string | null,
  nsAliases: NsAliases = { aliases: new Map(), refers: new Map() },
): void {
  if (!node) return;
  if (node.type === 'list_lit') {
    const vals = listValues(node);
    if (vals.length >= 1) {
      const head = vals[0];
      if (head?.type === 'sym_lit') {
        const sym = head.text;

        // defn / defmacro / s/defn: enter body with function name as context
        if ((sym === 'defn' || sym === 'defn-' || sym === 'defmacro' || sym === 's/defn' || sym === 's/defn-') && vals[1]?.type === 'sym_lit') {
          const newFnName = vals[1]!.text;
          for (const child of node.namedChildren) {
            walkForCalls(child, elements, arrows, newFnName, nsAliases);
          }
          return;
        }

        // def / defonce / s/def / s/defonce / s/defschema: enter value expression with def name as context;
        // also emit references for symbols in data (non-call-head) positions.
        if ((sym === 'def' || sym === 'defonce' || sym === 's/def' || sym === 's/defonce' || sym === 's/defschema') && vals[1]?.type === 'sym_lit') {
          const defName = vals[1]!.text;
          for (const child of node.namedChildren) {
            walkForCalls(child, elements, arrows, defName, nsAliases);
          }
          for (let i = 2; i < vals.length; i++) {
            walkForRefs(vals[i]!, arrows, defName);
          }
          return;
        }

        // defmethod: enter body with multi-method name as context
        if (sym === 'defmethod' && vals[1]?.type === 'sym_lit') {
          const methodName = vals[1]!.text;
          for (const child of node.namedChildren) {
            walkForCalls(child, elements, arrows, methodName, nsAliases);
          }
          return;
        }

        // s/defrecord / s/defprotocol: enter body with type name as context
        if ((sym === 's/defrecord' || sym === 's/defprotocol') && vals[1]?.type === 'sym_lit') {
          const typeName = vals[1]!.text;
          for (const child of node.namedChildren) {
            walkForCalls(child, elements, arrows, typeName, nsAliases);
          }
          return;
        }

        // re-frame reg-sub / reg-event-*: enter body with keyword as context
        if (isReframeForm(sym, 'reg-sub') || isReframeForm(sym, 'reg-event-db') || isReframeForm(sym, 'reg-event-fx')) {
          const kwName = reframeKeyword(vals);
          if (kwName) {
            for (const child of node.namedChildren) {
              walkForCalls(child, elements, arrows, kwName, nsAliases);
            }
            return;
          }
        }

        // throw: extract namespaced error keywords as throws arrows
        if (sym === 'throw' && enclosingFn) {
          collectThrowKeywords(node, elements, arrows, enclosingFn);
          // fall through to also walk children and record the throw call itself
        }

        // re-frame subscribe: (rf/subscribe [::sub-key ...]) → callerOf arrow to subscription element
        if (isReframeForm(sym, 'subscribe') && enclosingFn) {
          const kwName = extractVectorKeyword(vals);
          if (kwName) {
            arrows.push({ kind: 'calls', srcModule: '', srcName: enclosingFn, dstModule: '', dstName: kwName, attrs: {} });
            arrows.push({ kind: asKind('callerOf'), srcModule: '', srcName: enclosingFn, dstModule: '', dstName: kwName, attrs: {} });
            arrows.push({ kind: asKind('calleeOf'), srcModule: '', srcName: kwName, dstModule: '', dstName: enclosingFn, attrs: {} });
          }
        }

        // re-frame dispatch / dispatch-sync: (rf/dispatch [::event-key ...]) → callerOf arrow to event element
        if ((isReframeForm(sym, 'dispatch') || isReframeForm(sym, 'dispatch-sync')) && enclosingFn) {
          const kwName = extractVectorKeyword(vals);
          if (kwName) {
            arrows.push({ kind: 'calls', srcModule: '', srcName: enclosingFn, dstModule: '', dstName: kwName, attrs: {} });
            arrows.push({ kind: asKind('callerOf'), srcModule: '', srcName: enclosingFn, dstModule: '', dstName: kwName, attrs: {} });
            arrows.push({ kind: asKind('calleeOf'), srcModule: '', srcName: kwName, dstModule: '', dstName: enclosingFn, attrs: {} });
          }
        }

        if (!DEFINITION_FORMS.has(sym) && enclosingFn) {
          // Resolve cross-module calls: ns-alias/fn-name or :referred fn-name
          let dstName = sym;
          let dstModule = '';
          if (sym.includes('/')) {
            const slash = sym.indexOf('/');
            const alias = sym.slice(0, slash);
            const fn = sym.slice(slash + 1);
            const resolvedNs = nsAliases.aliases.get(alias);
            if (resolvedNs) {
              dstName = fn;
              dstModule = nsToFileSuffix(resolvedNs);
            }
          } else if (nsAliases.refers.has(sym)) {
            dstModule = nsToFileSuffix(nsAliases.refers.get(sym)!);
          }
          arrows.push({ kind: 'calls', srcModule: '', srcName: enclosingFn, dstModule, dstName, attrs: {} });
          arrows.push({ kind: asKind('callerOf'), srcModule: '', srcName: enclosingFn, dstModule, dstName, attrs: {} });
          arrows.push({ kind: asKind('calleeOf'), srcModule: dstModule, srcName: dstName, dstModule: '', dstName: enclosingFn, attrs: {} });
        }
      }
    }
  }

  for (const child of node.namedChildren) {
    walkForCalls(child, elements, arrows, enclosingFn, nsAliases);
  }
}

/**
 * Walk a def/defonce value expression emitting `references` arrows for every
 * sym_lit found outside call-head position. This links signal/action maps and
 * other data constants to the defns they name as values.
 */
function walkForRefs(node: Node | null | undefined, arrows: RawArrow[], srcName: string): void {
  if (!node) return;

  if (node.type === 'list_lit') {
    const vals = listValues(node);
    // Skip position 0 (call head) — it generates a `calls` arrow, not a reference
    for (let i = 1; i < vals.length; i++) {
      walkForRefs(vals[i]!, arrows, srcName);
    }
    return;
  }

  if (node.type === 'sym_lit') {
    const sym = node.text;
    if (!DEFINITION_FORMS.has(sym) && sym !== srcName) {
      arrows.push({ kind: 'references', srcModule: '', srcName, dstModule: '', dstName: sym, attrs: {} });
    }
    return;
  }

  for (const child of node.namedChildren) {
    walkForRefs(child, arrows, srcName);
  }
}

/**
 * Walk a (throw ...) node and emit `throws` arrows for namespaced keywords
 * found in value positions (not map keys) inside it.
 * Creates a `symbol` element for each new keyword so the arrow resolves.
 */
function collectThrowKeywords(
  throwNode: Node,
  elements: RawElement[],
  arrows: RawArrow[],
  enclosingFn: string,
): void {
  function walk(n: Node, isMapKey: boolean): void {
    if (isMapKey) return; // skip map keys — they're schema labels, not error identifiers

    if (n.type === 'kwd_lit') {
      const kwd = n.text;
      if (kwd.includes('/')) {
        if (!elements.find(e => e.name === kwd && e.kind === 'symbol')) {
          elements.push({ kind: 'symbol', name: kwd, module: '', span: formatSpan(n), attrs: { errorKeyword: true } });
        }
        arrows.push({ kind: 'throws', srcModule: '', srcName: enclosingFn, dstModule: '', dstName: kwd, attrs: {} });
      }
      return;
    }

    if (n.type === 'map_lit') {
      // namedChildren alternate: key at even indices, value at odd indices
      const children = n.namedChildren;
      for (let i = 0; i < children.length; i++) {
        walk(children[i]!, i % 2 === 0);
      }
      return;
    }

    for (const child of n.namedChildren) walk(child, false);
  }
  for (const child of throwNode.namedChildren) walk(child, false);
}
