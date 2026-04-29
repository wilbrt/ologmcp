import Parser from 'tree-sitter';
import { LanguageAdapter, OlogKind, RawElement, RawArrow, PropertyExtract, ArrowKind } from '@olog/core';
export { PropertyExtract } from '@olog/core';

/**
 * Language adapter for TypeScript and TSX files.
 */
declare class TypeScriptAdapter implements LanguageAdapter<Parser> {
    languageId: string;
    extensions: string[];
    globPattern: string;
    nodeTypeToKind: Record<string, OlogKind>;
    kindToNodeTypes: Record<string, string[]>;
    createParser(filename: string): Parser;
    queryPath(filename: string): string;
    extractElements(parser: Parser, source: string, queryPath: string): {
        elements: RawElement[];
        arrows: RawArrow[];
    };
    extractProperties(parser: Parser, source: string, moduleName: string): PropertyExtract[];
    resolveImportSpecifier(specifier: string, importingFileRelativePath: string, _projectRoot: string): string | null;
}

/** Format a node position as "startLine:startCol-endLine:endCol" (1-based). */
declare function formatSpan(node: Parser.SyntaxNode): string;
/** Cast a string to ArrowKind (temporary until schema expansion adds new kinds). */
declare function asKind(kind: string): ArrowKind;
/**
 * Extract semantic elements and arrows from source code using a tree-sitter query.
 */
declare function extractFromFile(parser: Parser, source: string, queryPath: string): {
    elements: RawElement[];
    arrows: RawArrow[];
};

/** Recursively collect all type_identifier descendants of a node. */
declare function collectTypeIdentifiers(node: Parser.SyntaxNode): string[];
/** Walk all descendants of a node (not the node itself), calling visitor on each. */
declare function walkDescendants(node: Parser.SyntaxNode, visitor: (n: Parser.SyntaxNode) => void): void;
/** Extract a PropertyExtract from a property_signature or public_field_definition node. */
declare function extractPropertyFromNode(node: Parser.SyntaxNode, parentName: string, parentKind: string): PropertyExtract | null;
/**
 * Extract property elements from all interface, type alias (object types), and class declarations
 * in a source file.
 */
declare function extractPropertiesFromFile(parser: Parser, source: string, _moduleName: string): PropertyExtract[];

/** Range and text for a declaration in source code. */
interface DeclarationRange {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
    text: string;
}
/** Map from olog element kind to tree-sitter node types for declaration rendering. */
declare const DECLARATION_NODE_TYPES: Record<string, string[]>;
/**
 * Find the full declaration range for an element, given its identifier
 * position and kind. Re-parses the source file with tree-sitter and
 * walks up from the identifier to find the enclosing declaration node.
 */
declare function findEnclosingDeclaration(source: string, parser: Parser, identifierLine: number, identifierCol: number, kind: string): DeclarationRange | null;
/**
 * Find an import statement line range given the line number of an import element.
 */
declare function findImportStatement(source: string, startLine: number): DeclarationRange | null;
/**
 * Extract the full declaration text for an element from its source file.
 */
declare function extractDeclaration(source: string, parser: Parser, identifierLine: number, identifierCol: number, kind: string): string | null;

export { DECLARATION_NODE_TYPES, TypeScriptAdapter, asKind, collectTypeIdentifiers, extractDeclaration, extractFromFile, extractPropertiesFromFile, extractPropertyFromNode, findEnclosingDeclaration, findImportStatement, formatSpan, walkDescendants };
