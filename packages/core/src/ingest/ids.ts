/**
 * Deterministic ID generation helpers for AST element identification.
 * All functions are pure and produce consistent output for the same inputs.
 */

/**
 * Generates an element ID for a AST node.
 * Format: module:${module}:${line}:${col}:${kind}:${name}
 * Positions are 1-based (tree-sitter uses 0-based).
 */
export function elemId(
  module: string,
  line: number,
  col: number,
  kind: string,
  name: string
): string {
  return `module:${module}:${line}:${col}:${kind}:${name}`;
}

/**
 * Generates an arrow/edge ID between two elements.
 * Format: ${srcId}:${kind}:${dstId}
 */
export function arrowId(srcId: string, kind: string, dstId: string): string {
  return `${srcId}:${kind}:${dstId}`;
}

/**
 * Generates an ID for the file element itself.
 * Format: file:${relativePath}
 */
export function fileElemId(relativePath: string): string {
  return `file:${relativePath}`;
}

/**
 * Formats a source span as a location string.
 * Format: relativePath:startLine:startCol-endLine:endCol (all 1-based)
 */
export function formatSpanId(
  relativePath: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number
): string {
  return `${relativePath}:${startLine}:${startCol}-${endLine}:${endCol}`;
}