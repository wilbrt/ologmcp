import type { SourceEdit } from './edit.js';

export interface Conflict {
  edit1: SourceEdit;
  edit2: SourceEdit;
  message: string;
}

export function orderAndDetectConflicts(edits: SourceEdit[]): {
  ordered: SourceEdit[];
  conflicts: Conflict[];
} {
  const conflicts: Conflict[] = [];

  // Sort edits per file, then merge
  const byFile = new Map<string, SourceEdit[]>();
  for (const edit of edits) {
    const arr = byFile.get(edit.filePath) ?? [];
    arr.push(edit);
    byFile.set(edit.filePath, arr);
  }

  // Within each file, check for overlapping ranges
  for (const [, fileEdits] of byFile) {
    for (let i = 0; i < fileEdits.length; i++) {
      for (let j = i + 1; j < fileEdits.length; j++) {
        const a = fileEdits[i]!;
        const b = fileEdits[j]!;

        if (rangesOverlap(a, b)) {
          conflicts.push({
            edit1: a,
            edit2: b,
            message: `Overlapping edits at ${a.filePath}:${a.startLine}:${a.startCol} and ${b.filePath}:${b.startLine}:${b.startCol}`,
          });
        }
      }
    }
  }

  // Sort globally: by file, then by position descending (end-of-file first)
  const ordered = [...edits].sort((a, b) => {
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    if (a.startLine !== b.startLine) return b.startLine - a.startLine;
    return b.startCol - a.startCol;
  });

  return { ordered, conflicts };
}

function rangesOverlap(a: SourceEdit, b: SourceEdit): boolean {
  if (a.filePath !== b.filePath) return false;

  // Convert to comparable positions
  const aStart = a.startLine * 10000 + a.startCol;
  const aEnd = a.endLine * 10000 + a.endCol;
  const bStart = b.startLine * 10000 + b.startCol;
  const bEnd = b.endLine * 10000 + b.endCol;

  return aStart < bEnd && bStart < aEnd;
}