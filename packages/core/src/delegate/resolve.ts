/**
 * Source resolution: reads files at specific spans to extract concrete text.
 * Reuses existing render/ingest functions — this is an orchestrator, not a reimplementation.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findEnclosingDeclaration, findImportStatement } from '../render/declaration.js';
import { parseImports } from '../render/imports.js';
import { computeRelativeImportPath, moduleToFilePath } from '../render/paths.js';
import { getDefaultRegistry } from '../ingest/adapter.js';
import { parseSpan } from '../utils/parse-span.js';

export { parseSpan, filePathFromSpan } from '../utils/parse-span.js';
export type { ParsedSpan } from '../utils/parse-span.js';

export class SourceResolver {
  private fileCache = new Map<string, string | null>();

  constructor(private projectRoot: string) {}

  readSpan(filePath: string, span: string): string | null {
    const parsed = parseSpan(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    const lines = source.split('\n');
    const start = Math.max(0, parsed.startLine - 1);
    const end = Math.min(lines.length, parsed.endLine);
    return lines.slice(start, end).join('\n');
  }

  readContext(filePath: string, span: string, contextLines: number = 2): string | null {
    const parsed = parseSpan(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    const lines = source.split('\n');
    const start = Math.max(0, parsed.startLine - 1 - contextLines);
    const end = Math.min(lines.length, parsed.endLine + contextLines);
    return lines.slice(start, end).join('\n');
  }

  readDeclaration(filePath: string, span: string, kind: string): string | null {
    const parsed = parseSpan(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;

    if (kind === 'import') {
      const range = findImportStatement(source, parsed.startLine);
      return range?.text ?? null;
    }

    const registry = getDefaultRegistry();
    if (!registry) return null;
    const range = findEnclosingDeclaration(
      source, filePath, parsed.startLine, parsed.startCol, kind, registry
    );
    return range?.text ?? null;
  }

  readSignature(filePath: string, span: string, kind: string): string | null {
    const declaration = this.readDeclaration(filePath, span, kind);
    if (!declaration) return null;

    const firstBrace = declaration.indexOf('{');
    const firstSemicolon = declaration.indexOf(';');

    if (firstBrace >= 0 && (firstSemicolon < 0 || firstBrace < firstSemicolon)) {
      return declaration.slice(0, firstBrace).trim();
    }
    if (firstSemicolon >= 0) {
      return declaration.slice(0, firstSemicolon + 1).trim();
    }
    const firstNewline = declaration.indexOf('\n');
    if (firstNewline >= 0) {
      return declaration.slice(0, firstNewline).trim();
    }
    return declaration.trim();
  }

  readBody(filePath: string, span: string, kind: string, maxLines: number = 50): string | null {
    const declaration = this.readDeclaration(filePath, span, kind);
    if (!declaration) return null;

    const firstBrace = declaration.indexOf('{');
    if (firstBrace < 0) return null;

    const body = declaration.slice(firstBrace);
    const lines = body.split('\n');
    if (lines.length <= maxLines) return body;
    return lines.slice(0, maxLines).join('\n') + '\n  // ... (truncated)';
  }

  readImportBlock(filePath: string): string[] {
    const source = this.readFile(filePath);
    if (source === null) return [];
    const imports = parseImports(source);
    return imports.map(imp => imp.fullText.trim());
  }

  computeImportStatement(symbolName: string, symbolModule: string, targetModule: string): string {
    const fromFile = moduleToFilePath(targetModule);
    const relativePath = computeRelativeImportPath(fromFile, symbolModule);
    return `import { ${symbolName} } from '${relativePath}'`;
  }

  readFileContent(filePath: string, maxLines: number = 500): string | null {
    const content = this.readFile(filePath);
    if (content === null) return null;
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;
    return lines.slice(0, maxLines).join('\n') + '\n// ... (truncated)';
  }

  /**
   * Read a window of source focused on a span: contextBefore lines above the
   * start of the span and contextAfter lines below the end, with an omission
   * comment if the file has content before the window.
   */
  readFocused(filePath: string, span: string, contextBefore: number = 25, contextAfter: number = 10): string | null {
    const parsed = parseSpan(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    const lines = source.split('\n');
    const start = Math.max(0, parsed.startLine - 1 - contextBefore);
    const end = Math.min(lines.length, parsed.endLine + contextAfter);
    const prefix = start > 0 ? `; ... (lines 1–${start} omitted)\n` : '';
    return prefix + lines.slice(start, end).join('\n');
  }

  private readFile(filePath: string): string | null {
    const cached = this.fileCache.get(filePath);
    if (cached !== undefined) return cached;

    try {
      const content = readFileSync(join(this.projectRoot, filePath), 'utf8');
      this.fileCache.set(filePath, content);
      return content;
    } catch {
      this.fileCache.set(filePath, null);
      return null;
    }
  }
}

