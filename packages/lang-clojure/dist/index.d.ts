import { Parser } from 'web-tree-sitter';
import { LanguageAdapter, OlogKind, RawElement, RawArrow, PropertyExtract } from '@olog/core';
export { PropertyExtract } from '@olog/core';

declare function init(): Promise<void>;
declare class ClojureAdapter implements LanguageAdapter<Parser> {
    languageId: string;
    extensions: string[];
    globPattern: string;
    nodeTypeToKind: Record<string, OlogKind>;
    kindToNodeTypes: Record<string, string[]>;
    createParser(_filename: string): Parser;
    queryPath(_filename: string): string;
    extractElements(parser: Parser, source: string, queryPath: string): {
        elements: RawElement[];
        arrows: RawArrow[];
    };
    extractProperties?(_parser: Parser, _source: string, _moduleName: string): PropertyExtract[];
    resolveImportSpecifier(specifier: string, _fromFile: string, _projectRoot: string): string | null;
}

declare function extractFromFile(parser: Parser, source: string, queryPath: string): {
    elements: RawElement[];
    arrows: RawArrow[];
};

export { ClojureAdapter, extractFromFile, init };
