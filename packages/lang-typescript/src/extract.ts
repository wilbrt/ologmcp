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
 * Walk up the tree to find the nearest class_declaration ancestor
 * and return its name (or null if none found).
 */
export function findContainingClassName(
  node: Parser.SyntaxNode,
): string | null {
  let cur: Parser.SyntaxNode | null = node.parent;
  while (cur !== null) {
    if (cur.type === 'class_declaration') {
      const nameNode = cur.childForFieldName('name');
      if (nameNode) return nameNode.text;
    }
    cur = cur.parent;
  }
  return null;
}

/**
 * Walk up the tree to find the nearest function-like ancestor
 * and return its name (or null if at the top level).
 * For method_definitions inside a class_declaration, returns 'ClassName.methodName'.
 */
export function findContainingFunctionName(
  node: Parser.SyntaxNode,
): string | null {
  let cur: Parser.SyntaxNode | null = node.parent;
  while (cur !== null) {
    switch (cur.type) {
      case 'function_declaration':
      case 'generator_function_declaration': {
        const nameNode = cur.childForFieldName('name');
        if (nameNode) return nameNode.text;
        break;
      }
      case 'method_definition': {
        const nameNode = cur.childForFieldName('name');
        if (nameNode) {
          const className = findContainingClassName(cur);
          if (className) return `${className}.${nameNode.text}`;
          return nameNode.text;
        }
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
 *
 * When resolveImport is provided, cross-module callerOf/calleeOf arrows are enriched
 * with dstModule by resolving the callee against the file's import statements.
 */
export function extractFromFile(
  parser: Parser,
  source: string,
  queryPath: string,
  resolveImport?: (specifier: string) => string | null,
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

  function buildByName(match: Parser.QueryMatch): Map<string, Parser.QueryCapture[]> {
    const byName = new Map<string, Parser.QueryCapture[]>();
    for (const cap of match.captures) {
      const arr = byName.get(cap.name);
      if (arr) arr.push(cap);
      else byName.set(cap.name, [cap]);
    }
    return byName;
  }

  function first(byName: Map<string, Parser.QueryCapture[]>, name: string): Parser.QueryCapture | undefined {
    return byName.get(name)?.[0];
  }

  const allMatches = query.matches(tree.rootNode);

  // Pass 1: build localName → resolvedModule map from import statements
  // localName is the name used at call sites; resolvedModule is the file path suffix
  const importedNames = new Map<string, string>(); // localName → resolved file path
  if (resolveImport) {
    for (const match of allMatches) {
      const byName = buildByName(match);
      const sourceCap = first(byName, 'import.source');
      if (!sourceCap) continue;
      const resolved = resolveImport(sourceCap.node.text);
      if (!resolved) continue;

      // named imports: { foo } or { foo as bar } — local name is alias if present
      const names = byName.get('import.name') ?? [];
      const aliases = byName.get('import.alias') ?? [];
      for (let i = 0; i < names.length; i++) {
        const localName = aliases[i]?.node.text ?? names[i]!.node.text;
        importedNames.set(localName, resolved);
      }
      // default import: import foo from '...'
      const defCap = first(byName, 'import.default');
      if (defCap) importedNames.set(defCap.node.text, resolved);
      // namespace import: import * as ns from '...'
      const nsCap = first(byName, 'import.namespace');
      if (nsCap) importedNames.set(nsCap.node.text, resolved);
    }
  }

  // Pass 2: full extraction
  for (const match of allMatches) {
    const byName = buildByName(match);
    const _first = (name: string) => first(byName, name);

    for (const cap of byName.get('function.name') ?? []) {
      elements.push({ kind: 'function', name: cap.node.text, module: '', span: formatSpan(cap.node), attrs: {} });
    }

    for (const cap of byName.get('class.name') ?? []) {
      elements.push({ kind: 'class', name: cap.node.text, module: '', span: formatSpan(cap.node), attrs: {} });
    }

    // Handle class heritage (extends / implements)
    const heritageNode = _first('class.heritage')?.node;
    if (heritageNode) {
      const className = _first('class.name')?.node.text;
      if (className) {
        for (const child of heritageNode.children) {
          if (child.type === 'extends_clause') {
            const typeNode = child.namedChildren[0];
            if (typeNode) {
              const parentName = typeNode.type === 'type_identifier'
                ? typeNode.text
                : typeNode.childForFieldName('name')?.text;
              if (parentName) {
                arrows.push({ kind: asKind('extends'), srcModule: '', srcName: className, dstModule: '', dstName: parentName, attrs: {} });
              }
            }
          }
          if (child.type === 'implements_clause') {
            for (const typeNode of child.namedChildren) {
              const ifaceName = typeNode.type === 'type_identifier'
                ? typeNode.text
                : typeNode.childForFieldName('name')?.text;
              if (ifaceName) {
                arrows.push({ kind: asKind('implements'), srcModule: '', srcName: className, dstModule: '', dstName: ifaceName, attrs: {} });
              }
            }
          }
        }
      }
    }

    for (const cap of byName.get('interface.name') ?? []) {
      elements.push({ kind: 'interface', name: cap.node.text, module: '', span: formatSpan(cap.node), attrs: {} });
    }

    for (const cap of byName.get('typealias.name') ?? []) {
      elements.push({ kind: 'type', name: cap.node.text, module: '', span: formatSpan(cap.node), attrs: {} });
    }

    for (const cap of byName.get('enum.name') ?? []) {
      elements.push({ kind: 'enum', name: cap.node.text, module: '', span: formatSpan(cap.node), attrs: {} });
    }

    for (const cap of byName.get('method.name') ?? []) {
      // Use the full method_definition node span so rewrite_body can target the body.
      // Fall back to the name node for abstract method signatures which lack @method.
      const methodNode = first(byName, 'method')?.node ?? cap.node;
      elements.push({ kind: 'method', name: cap.node.text, module: '', span: formatSpan(methodNode), attrs: {} });
    }

    const importStmtNode = _first('import')?.node;
    const rawImport = importStmtNode?.text;

    if (_first('import.source')) {
      const sourceCap = _first('import.source')!;
      const sourceModule = sourceCap.node.text;
      const attrs = (key: string) => ({
        sourceModule,
        ...(rawImport ? { rawImport } : {}),
        ...(key ? { importedName: key } : {}),
      });

      const names = byName.get('import.name') ?? [];
      const aliases = byName.get('import.alias') ?? [];
      for (let i = 0; i < names.length; i++) {
        const originalName = names[i]!.node.text;
        const localName = aliases[i]?.node.text ?? originalName;
        elements.push({ kind: 'import', name: localName, module: '', span: formatSpan(names[i]!.node), attrs: attrs(originalName) });
        arrows.push({ kind: asKind('importsFrom'), srcModule: '', srcName: localName, dstModule: sourceModule, dstName: '', attrs: { module: sourceModule } });
      }

      const defCap = _first('import.default');
      if (defCap) {
        elements.push({ kind: 'import', name: defCap.node.text, module: '', span: formatSpan(defCap.node), attrs: attrs('default') });
        arrows.push({ kind: asKind('importsFrom'), srcModule: '', srcName: defCap.node.text, dstModule: sourceModule, dstName: '', attrs: { module: sourceModule } });
      }

      const nsCap = _first('import.namespace');
      if (nsCap) {
        elements.push({ kind: 'import', name: nsCap.node.text, module: '', span: formatSpan(nsCap.node), attrs: attrs('*') });
        arrows.push({ kind: asKind('importsFrom'), srcModule: '', srcName: nsCap.node.text, dstModule: sourceModule, dstName: '', attrs: { module: sourceModule } });
      }

    }

    if (_first('call.callee')) {
      const calleeNode = _first('call.callee')!.node;
      const calleeName = calleeNode.text;
      const callNode = _first('call')?.node ?? _first('call.member')?.node;
      const fnName = callNode ? findContainingFunctionName(callNode) : null;
      const dstModule = importedNames.get(calleeName) ?? '';
      arrows.push({ kind: 'calls', srcModule: '', srcName: fnName ?? '', dstModule, dstName: calleeName, attrs: {} });
      if (fnName) {
        arrows.push({ kind: asKind('callerOf'), srcModule: '', srcName: fnName, dstModule, dstName: calleeName, attrs: {} });
        arrows.push({ kind: asKind('calleeOf'), srcModule: dstModule, srcName: calleeName, dstModule: '', dstName: fnName, attrs: {} });
      }
    }

    if (_first('call.method')) {
      const methodNode = _first('call.method')!.node;
      const methodName = methodNode.text;
      const callNode = _first('call.member')?.node ?? _first('call')?.node;
      const fnName = callNode ? findContainingFunctionName(callNode) : null;
      const receiverNode = _first('call.receiver')?.node;
      const isThisReceiver = receiverNode?.text === 'this';
      // When receiver is 'this', compose ClassName.methodName so the resolver can find the method element
      const className = isThisReceiver ? findContainingClassName(callNode ?? methodNode) : null;
      const dstName = className ? `${className}.${methodName}` : methodName;
      // Methods are invoked on a receiver — don't resolve module from imports (it's on an object, not a bare name)
      // When receiver is 'this', dstModule stays '' — the method is in the same file and will be resolved by element ID
      arrows.push({ kind: 'calls', srcModule: '', srcName: fnName ?? '', dstModule: '', dstName, attrs: {} });
      if (fnName) {
        arrows.push({ kind: asKind('callerOf'), srcModule: '', srcName: fnName, dstModule: '', dstName, attrs: {} });
        arrows.push({ kind: asKind('calleeOf'), srcModule: '', srcName: dstName, dstModule: '', dstName: fnName, attrs: {} });
      }
    }

    if (_first('ref.self')) {
      const refSelfNode = _first('ref.self')!.node;
      // Skip if this member_expression is the function part of a call_expression
      // (those are handled by the call.member handler — this.prop() vs this.prop)
      const parentNode = refSelfNode.parent;
      if (!(parentNode?.type === 'call_expression' && parentNode.childForFieldName('function') === refSelfNode)) {
        const className = findContainingClassName(refSelfNode);
        if (className) {
          const propertyName = _first('ref.property')!.node.text;
          const fnName = findContainingFunctionName(refSelfNode);
          arrows.push({ kind: asKind('references'), srcModule: '', srcName: fnName ?? '', dstModule: '', dstName: `${className}.${propertyName}`, attrs: {} });
        }
      }
    }

    if (_first('new.ctor')) {
      const ctorNode = _first('new.ctor')!.node;
      const ctorName = ctorNode.text;
      const newNode = _first('new')?.node;
      const fnName = newNode ? findContainingFunctionName(newNode) : null;
      const dstModule = importedNames.get(ctorName) ?? '';
      arrows.push({ kind: 'calls', srcModule: '', srcName: fnName ?? '', dstModule, dstName: ctorName, attrs: {} });
      if (fnName) {
        arrows.push({ kind: asKind('callerOf'), srcModule: '', srcName: fnName, dstModule, dstName: ctorName, attrs: {} });
        arrows.push({ kind: asKind('calleeOf'), srcModule: dstModule, srcName: ctorName, dstModule: '', dstName: fnName, attrs: {} });
      }
    }

    if (_first('memberof.method') && _first('memberof.class')) {
      arrows.push({ kind: asKind('memberOf'), srcModule: '', srcName: _first('memberof.method')!.node.text, dstModule: '', dstName: _first('memberof.class')!.node.text, attrs: {} });
    }
  }

  if ('delete' in tree && typeof (tree as unknown as { delete?: unknown }).delete === 'function') {
    (tree as unknown as { delete: () => void }).delete();
  }

  return { elements, arrows };
}
