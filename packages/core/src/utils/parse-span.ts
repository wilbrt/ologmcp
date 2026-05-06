/**
 * Shared span-parsing utilities.
 * Handles both "path:line:col-line:col" and "line:col-line:col" formats.
 */

/** Result of parsing a span string. */
export interface ParsedSpan {
  /** File path prefix, if the span included one. */
  filePath?: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/**
 * Parse a span string in either format:
 *   "relative/path:1:2-3:4"  → { filePath: "relative/path", startLine: 1, ... }
 *   "1:2-3:4"                → { startLine: 1, ... }
 */
export function parseSpan(span: string): ParsedSpan | null {
  // Try format with file path: "path/to/file:startLine:startCol-endLine:endCol"
  let m = span.match(/^(.+):(\d+):(\d+)-(\d+):(\d+)$/);
  if (m) {
    return {
      filePath: m[1],
      startLine: parseInt(m[2]!, 10),
      startCol: parseInt(m[3]!, 10),
      endLine: parseInt(m[4]!, 10),
      endCol: parseInt(m[5]!, 10),
    };
  }

  // Try format without file path: "startLine:startCol-endLine:endCol"
  m = span.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
  if (m) {
    return {
      startLine: parseInt(m[1]!, 10),
      startCol: parseInt(m[2]!, 10),
      endLine: parseInt(m[3]!, 10),
      endCol: parseInt(m[4]!, 10),
    };
  }

  return null;
}

/** Extract the file path prefix from a full span string. */
export function filePathFromSpan(span: string): string | null {
  const parsed = parseSpan(span);
  return parsed?.filePath ?? null;
}