import Parser from 'tree-sitter';
import { LanguageAdapter, OlogKind, RawElement, RawArrow, PropertyExtract } from '@olog/core';
export { PropertyExtract } from '@olog/core';

/**
 * Load the tree-sitter-clojure grammar dynamically.
 * Call this before using createParser if tree-sitter-clojure is not a hard dependency.
 */
declare function init(): Promise<void>;
/**
 * Language adapter for Clojure (.clj, .cljs, .cljc) files.
 */
declare class ClojureAdapter implements LanguageAdapter {
    languageId: string;
    extensions: string[];
    globPattern: string;
    nodeTypeToKind: Record<string, OlogKind>;
    kindToNodeTypes: Record<string, string[]>;
    createParser(filename: string): Parser;
    queryPath(_filename: string): string;
    extractElements(parser: Parser, source: string, queryPath: string): {
        elements: RawElement[];
        arrows: RawArrow[];
    };
    extractProperties?(_parser: Parser, _source: string, _moduleName: string): PropertyExtract[];
    resolveImportSpecifier(specifier: string, _fromFile: string, _projectRoot: string): string | null;
}

/**
 * Extract semantic elements and arrows from Clojure source code.
 *
 * Strategy: Since tree-sitter-clojure has limited query support for
 * capturing defn/def/defmacro etc. by name, we use a combination of
 * .scm queries for structural patterns and programmatic extraction
 * as a fallback.
 */
declare function extractFromFile(parser: Parser, source: string, queryPath: string): {
    elements: RawElement[];
    arrows: RawArrow[];
};

export { ClojureAdapter, extractFromFile, init };
