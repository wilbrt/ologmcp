import Parser from 'tree-sitter';
import fs from 'node:fs';
import type { RawElement, RawArrow, ArrowKind } from '@olog/core';

/** Format a node position as "startLine:startCol-endLine:endCol" (1-based). */
export function formatSpan(node: Parser.SyntaxNode): string {
  const s = node.startPosition;
  const e = node.endPosition;
  return `${s.row + 1}:${s.column + 1}-${e.row + 1}:${e.column + 1}`;
}

/** Cast a string to ArrowKind (temporary until schema expansion adds new kinds). */
export function asKind(kind: string): ArrowKind {
  return kind as ArrowKind;
}

/**
 * Walk up the tree to find the nearest function-like ancestor
 * and return its name (or null if at the top level).
 */
export function findContainingFunctionName(
  node: Parser.SyntaxNode,
): string | null {
  let cur: Parser.SyntaxNode | null = node.parent;
  while (cur !== null) {
    switch (cur.type) {
      case 'function_declaration':
      case 'generator_function_declaration':
      case 'method_definition': {
        const nameNode = cur.childForFieldName('name');
        if (nameNode) return nameNode.text;
        break;
      }
      case 'arrow_function': {
        if (cur.parent?.type === 'variable_declarator') {
          const varName = cur.parent.childForFieldName('name');
          if (varName) return varName.text;
        }
        break;
      }
      case 'function_expression': {
        const nameNode = cur.childForFieldName('name');
        if (nameNode) return nameNode.text;
        if (cur.parent?.type === 'variable_declarator') {
          const varName = cur.parent.childForFieldName('name');
          if (varName) return varName.text;
        }
        break;
      }
    }
    cur = cur.parent;
  }
  return null;
}

/**
 * Extract semantic elements and arrows from source code using a tree-sitter query.
 */
export function extractFromFile(
  parser: Parser,
  source: string,
  queryPath: string,
): { elements: RawElement[]; arrows: RawArrow[] } {
  const scmContent = fs.readFileSync(queryPath, 'utf-8');
  const language = parser.getLanguage();
  const query = new Parser.Query(language, scmContent);

  const tree = parser.parse(source);

  if (tree.rootNode.hasError) {
    console.error('Warning: parse errors detected in source');
  }

  const elements: RawElement[] = [];
  const arrows: RawArrow[] = [];

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

    for (const cap of byName.get('function.name') ?? []) {
      const n = cap.node;
      elements.push({ kind: 'function', name: n.text, module: '', span: formatSpan(n), attrs: {} });
    }

    for (const cap of byName.get('class.name') ?? []) {
      const n = cap.node;
      elements.push({ kind: 'class', name: n.text, module: '', span: formatSpan(n), attrs: {} });
    }

    for (const cap of byName.get('interface.name') ?? []) {
      const n = cap.node;
      elements.push({ kind: 'interface', name: n.text, module: '', span: formatSpan(n), attrs: {} });
    }

    for (const cap of byName.get('typealias.name') ?? []) {
      const n = cap.node;
      elements.push({ kind: 'type', name: n.text, module: '', span: formatSpan(n), attrs: {} });
    }

    for (const cap of byName.get('enum.name') ?? []) {
      const n = cap.node;
      elements.push({ kind: 'enum', name: n.text, module: '', span: formatSpan(n), attrs: {} });
    }

    for (const cap of byName.get('method.name') ?? []) {
      const n = cap.node;
      elements.push({ kind: 'method', name: n.text, module: '', span: formatSpan(n), attrs: {} });
    }

    for (const cap of byName.get('import.name') ?? []) {
      const n = cap.node;
      const sourceCap = first('import.source');
      const sourceModule = sourceCap ? sourceCap.node.text : '';
      elements.push({ kind: 'import', name: n.text, module: '', span: formatSpan(n), attrs: sourceModule ? { sourceModule } : {} });
    }

    if (first('import.default')) {
      const n = first('import.default')!.node;
      const sourceCap = first('import.source');
      const sourceModule = sourceCap ? sourceCap.node.text : '';
      elements.push({ kind: 'import', name: n.text, module: '', span: formatSpan(n), attrs: sourceModule ? { sourceModule } : {} });
    }

    if (first('import.namespace')) {
      const n = first('import.namespace')!.node;
      const sourceCap = first('import.source');
      const sourceModule = sourceCap ? sourceCap.node.text : '';
      elements.push({ kind: 'import', name: n.text, module: '', span: formatSpan(n), attrs: sourceModule ? { sourceModule } : {} });
    }

    for (const srcCap of ['import.source', 'reexport.source', 'require.source'] as const) {
      if (first(srcCap)) {
        const n = first(srcCap)!.node;
        arrows.push({ kind: 'imports', srcModule: '', srcName: '', dstModule: n.text, dstName: '', attrs: {} });
      }
    }

    if (first('import.source')) {
      const moduleNode = first('import.source')!.node;
      const moduleStr = moduleNode.text;
      for (const impCap of byName.get('import.name') ?? []) {
        arrows.push({ kind: asKind('importsFrom'), srcModule: '', srcName: impCap.node.text, dstModule: moduleStr, dstName: '', attrs: { module: moduleStr } });
      }
      if (first('import.default')) {
        arrows.push({ kind: asKind('importsFrom'), srcModule: '', srcName: first('import.default')!.node.text, dstModule: moduleStr, dstName: '', attrs: { module: moduleStr } });
      }
      if (first('import.namespace')) {
        arrows.push({ kind: asKind('importsFrom'), srcModule: '', srcName: first('import.namespace')!.node.text, dstModule: moduleStr, dstName: '', attrs: { module: moduleStr } });
      }
    }

    if (first('call.callee')) {
      const calleeNode = first('call.callee')!.node;
      const callNode = first('call')?.node ?? first('call.member')?.node;
      const fnName = callNode ? findContainingFunctionName(callNode) : null;
      arrows.push({ kind: 'calls', srcModule: '', srcName: fnName ?? '', dstModule: '', dstName: calleeNode.text, attrs: {} });
      if (fnName) {
        arrows.push({ kind: asKind('callerOf'), srcModule: '', srcName: fnName, dstModule: '', dstName: calleeNode.text, attrs: {} });
        arrows.push({ kind: asKind('calleeOf'), srcModule: '', srcName: calleeNode.text, dstModule: '', dstName: fnName, attrs: {} });
      }
    }

    if (first('call.method')) {
      const methodNode = first('call.method')!.node;
      const callNode = first('call.member')?.node ?? first('call')?.node;
      const fnName = callNode ? findContainingFunctionName(callNode) : null;
      arrows.push({ kind: 'calls', srcModule: '', srcName: fnName ?? '', dstModule: '', dstName: methodNode.text, attrs: {} });
      if (fnName) {
        arrows.push({ kind: asKind('callerOf'), srcModule: '', srcName: fnName, dstModule: '', dstName: methodNode.text, attrs: {} });
        arrows.push({ kind: asKind('calleeOf'), srcModule: '', srcName: methodNode.text, dstModule: '', dstName: fnName, attrs: {} });
      }
    }

    if (first('new.ctor')) {
      const ctorNode = first('new.ctor')!.node;
      const newNode = first('new')?.node;
      const fnName = newNode ? findContainingFunctionName(newNode) : null;
      arrows.push({ kind: 'calls', srcModule: '', srcName: fnName ?? '', dstModule: '', dstName: ctorNode.text, attrs: {} });
      if (fnName) {
        arrows.push({ kind: asKind('callerOf'), srcModule: '', srcName: fnName, dstModule: '', dstName: ctorNode.text, attrs: {} });
        arrows.push({ kind: asKind('calleeOf'), srcModule: '', srcName: ctorNode.text, dstModule: '', dstName: fnName, attrs: {} });
      }
    }

    if (first('memberof.method') && first('memberof.class')) {
      const methodNode = first('memberof.method')!.node;
      const classNode = first('memberof.class')!.node;
      arrows.push({ kind: asKind('memberOf'), srcModule: '', srcName: methodNode.text, dstModule: '', dstName: classNode.text, attrs: {} });
    }
  }

  if ('delete' in tree && typeof (tree as unknown as { delete?: unknown }).delete === 'function') {
    (tree as unknown as { delete: () => void }).delete();
  }

  return { elements, arrows };
}
