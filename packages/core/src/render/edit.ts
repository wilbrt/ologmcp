/**
 * Core types and utilities for source-file editing.
 * SourceEdit positions are 1-based line/column to match tree-sitter span format.
 */

export interface SourceEdit {
  /** Relative path from project root (e.g. "src/tools/olog-query.ts") */
  filePath: string;
  /** Human-readable description of what this edit does */
  label: string;
  /** Text to find within the line/col range for verification. null means insert without matching. */
  oldText: string | null;
  /** Replacement text. Empty string means deletion. */
  newText: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface FileSnapshot {
  filePath: string;
  originalContent: string;
}

export interface SourceEditResult {
  applied: number;
  skipped: number;
  errors: string[];
  snapshots: FileSnapshot[];
  affectedFiles: string[];
}

/** Convert a 1-based (line, col) position to a 0-based character offset. */
export function offsetAt(source: string, line: number, col: number): number {
  let currentLine = 1;
  let offset = 0;
  while (currentLine < line && offset < source.length) {
    const nl = source.indexOf('\n', offset);
    if (nl < 0) return source.length;
    offset = nl + 1;
    currentLine++;
  }
  return Math.min(offset + col - 1, source.length);
}

/** Apply an ordered list of SourceEdits to a single source string. Sorts in reverse position order first. */
export function applyEditsToString(source: string, edits: SourceEdit[]): string {
  const sorted = [...edits].sort((a, b) => {
    if (a.startLine !== b.startLine) return b.startLine - a.startLine;
    return b.startCol - a.startCol;
  });

  let result = source;
  for (const edit of sorted) {
    const startOffset = offsetAt(result, edit.startLine, edit.startCol);
    const endOffset = offsetAt(result, edit.endLine, edit.endCol);

    if (startOffset > endOffset) {
      throw new Error(`Invalid edit range in ${edit.filePath}: start > end`);
    }

    if (edit.oldText !== null) {
      const actual = result.slice(startOffset, endOffset);
      if (actual !== edit.oldText) {
        throw new Error(
          `oldText mismatch at ${edit.filePath}:${edit.startLine}:${edit.startCol}: ` +
          `expected "${edit.oldText}", found "${actual}"`
        );
      }
    }

    result = result.slice(0, startOffset) + edit.newText + result.slice(endOffset);
  }

  return result;
}

/** Apply an array of SourceEdits to disk files. Groups by file, sorts within each file, applies atomically. */
export async function applySourceEdits(
  edits: SourceEdit[],
  projectRoot: string,
  readFile?: (path: string) => Promise<string>,
  writeFile?: (path: string, content: string) => Promise<void>,
): Promise<SourceEditResult> {
  const { readFile: fsReadFile, writeFile: fsWriteFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const readFn = readFile ?? (async (p: string) => fsReadFile(join(projectRoot, p), 'utf8'));
  const writeFn = writeFile ?? (async (p: string, c: string) => fsWriteFile(join(projectRoot, p), c, 'utf8'));

  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];
  const snapshots: FileSnapshot[] = [];
  const affectedFiles = new Set<string>();

  const byFile = new Map<string, SourceEdit[]>();
  for (const edit of edits) {
    const arr = byFile.get(edit.filePath) ?? [];
    arr.push(edit);
    byFile.set(edit.filePath, arr);
  }

  for (const [filePath, fileEdits] of byFile) {
    try {
      let content: string;
      try {
        content = await readFn(filePath);
      } catch {
        if (fileEdits.some(e => e.oldText !== null)) {
          skipped += fileEdits.length;
          errors.push(`File not found: ${filePath}`);
          continue;
        }
        content = '';
      }

      snapshots.push({ filePath, originalContent: content });

      try {
        const newContent = applyEditsToString(content, fileEdits);
        await writeFn(filePath, newContent);
        applied += fileEdits.length;
        affectedFiles.add(filePath);
      } catch (editErr) {
        const msg = editErr instanceof Error ? editErr.message : String(editErr);
        skipped += fileEdits.length;
        errors.push(`${filePath}: ${msg}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped += fileEdits.length;
      errors.push(`${filePath}: ${msg}`);
    }
  }

  return { applied, skipped, errors, snapshots, affectedFiles: Array.from(affectedFiles) };
}

/** Roll back files to their original content using snapshots. Best-effort — does not throw. */
export async function rollback(snapshots: FileSnapshot[], projectRoot: string): Promise<void> {
  const { writeFile: fsWriteFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  for (const snapshot of snapshots) {
    try {
      await fsWriteFile(join(projectRoot, snapshot.filePath), snapshot.originalContent, 'utf8');
    } catch {
      // best-effort
    }
  }
}