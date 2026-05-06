import Parser from 'tree-sitter';
import type { PropertyExtract } from '@olog/core';
import { formatSpan } from './extract.js';

/** Recursively collect all type_identifier descendants of a node. */
export function collectTypeIdentifiers(node: Parser.SyntaxNode): string[] {
  const result: string[] = [];
  if (node.type === 'type_identifier') {
    result.push(node.text);
  }
  for (const child of node.children) {
    result.push(...collectTypeIdentifiers(child));
  }
  return result;
}

/** Walk all descendants of a node (not the node itself), calling visitor on each. */
export function walkDescendants(node: Parser.SyntaxNode, visitor: (n: Parser.SyntaxNode) => void): void {
  for (const child of node.children) {
    visitor(child);
    walkDescendants(child, visitor);
  }
}

/** Extract a PropertyExtract from a property_signature or public_field_definition node. */
export function extractPropertyFromNode(
  node: Parser.SyntaxNode,
  parentName: string,
  parentKind: string,
): PropertyExtract | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = nameNode.text;
  const optional = node.children.some(c => c.type === '?');
  const isReadonly = node.children.some(c => c.type === 'readonly');
  const typeAnnotation = node.childForFieldName('type');
  const typeText = typeAnnotation ? typeAnnotation.text : '';
  const typeRefs = typeAnnotation ? collectTypeIdentifiers(typeAnnotation) : [];
  const span = formatSpan(nameNode);

  return { name, span, typeText, optional, readonly: isReadonly, typeRefs, parentName, parentKind };
}

/**
 * Extract property elements from all interface, type alias (object types), and class declarations
 * in a source file.
 */
export function extractPropertiesFromFile(
  parser: Parser,
  source: string,
  _moduleName: string,
): PropertyExtract[] {
  const tree = parser.parse(source);
  const result: PropertyExtract[] = [];

  walkDescendants(tree.rootNode, (node) => {
    if (node.type === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      const parentName = nameNode.text;
      const body = node.children.find(c => c.type === 'object_type');
      if (!body) return;
      for (const child of body.children) {
        if (child.type === 'property_signature') {
          const prop = extractPropertyFromNode(child, parentName, 'interface');
          if (prop) result.push(prop);
        }
      }
    } else if (node.type === 'type_alias_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      const parentName = nameNode.text;
      const typeNode = node.childForFieldName('type');
      if (!typeNode) return;
      if (typeNode.type === 'object_type') {
        for (const child of typeNode.children) {
          if (child.type === 'property_signature') {
            const prop = extractPropertyFromNode(child, parentName, 'type');
            if (prop) result.push(prop);
          }
        }
      }
    } else if (node.type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      const parentName = nameNode.text;
      const body = node.children.find(c => c.type === 'class_body');
      if (!body) return;
      for (const child of body.children) {
        if (child.type === 'public_field_definition') {
          const prop = extractPropertyFromNode(child, parentName, 'class');
          if (prop) result.push(prop);
        }
      }
      // Extract constructor parameter properties (e.g. private db: Database)
      for (const child of body.children) {
        if (child.type !== 'method_definition') continue;
        const methodName = child.childForFieldName('name');
        if (!methodName || methodName.text !== 'constructor') continue;
        const params = child.childForFieldName('parameters');
        if (!params) continue;
        for (const param of params.children) {
          if (param.type !== 'required_parameter' && param.type !== 'optional_parameter') continue;
          const hasAccessMod = param.children.some(c => c.type === 'accessibility_modifier');
          const isParamReadonly = param.children.some(c => c.type === 'readonly');
          if (!hasAccessMod && !isParamReadonly) continue;

          const patternNode = param.childForFieldName('pattern');
          if (!patternNode) continue;
          const paramNameNode = patternNode.type === 'identifier_pattern'
            ? (patternNode.childForFieldName('name') ?? patternNode)
            : patternNode;
          const name = paramNameNode.text;
          const optional = param.type === 'optional_parameter';

          // Build typeText including access modifier and readonly per acceptance criteria
          const typeParts: string[] = [];
          const accessMod = param.children.find(c => c.type === 'accessibility_modifier');
          if (accessMod) typeParts.push(accessMod.text);
          if (isParamReadonly) typeParts.push('readonly');
          const typeAnnotation = param.childForFieldName('type');
          if (typeAnnotation) {
            let typeStr = typeAnnotation.text;
            if (typeStr.startsWith(':')) typeStr = typeStr.slice(1).trim();
            typeParts.push(typeStr);
          }

          result.push({
            name,
            span: formatSpan(paramNameNode),
            typeText: typeParts.join(' '),
            optional,
            readonly: isParamReadonly,
            typeRefs: typeAnnotation ? collectTypeIdentifiers(typeAnnotation) : [],
            parentName,
            parentKind: 'class',
          });
        }
        break; // Only one constructor per class
      }
    }
  });

  if ('delete' in tree && typeof (tree as unknown as { delete?: unknown }).delete === 'function') {
    (tree as unknown as { delete: () => void }).delete();
  }

  return result;
}
