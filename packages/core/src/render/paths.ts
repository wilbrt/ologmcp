import { dirname, relative, join, normalize, sep } from 'node:path';

/**
 * Compute the relative import path from one module to another.
 * Produces a Node-style relative path starting with './', always using
 * forward slashes regardless of platform.
 */
export function computeRelativeImportPath(
  fromFile: string,
  toModule: string,
): string {
  const fromDir = dirname(fromFile);
  let rel = relative(fromDir, toModule);
  if (!rel.startsWith('.')) {
    rel = './' + rel;
  }
  return rel.replace(/\\/g, '/');
}

/**
 * Given a file path like "src/tools/olog-query.ts", produce the module
 * identifier used in imports: "src/tools/olog-query" (stripping the extension).
 */
export function filePathToModule(filePath: string): string {
  return filePath.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, '');
}

/**
 * Given a module identifier like "src/tools/olog-query", produce a
 * likely file path by appending ".ts". This is a heuristic — the
 * actual extension may differ.
 */
export function moduleToFilePath(moduleId: string): string {
  return moduleId + '.ts';
}

/**
 * Compute the new import path when a module moves from oldModule to newModule,
 * from the perspective of a file that imports it.
 *
 * oldModule and newModule are module identifiers (without extensions).
 * fromFile is a relative file path from the project root.
 */
export function computeNewImportPath(
  fromFile: string,
  oldModule: string,
  newModule: string,
): string {
  const oldPath = computeRelativeImportPath(fromFile, oldModule);
  const newPath = computeRelativeImportPath(fromFile, newModule);
  return newPath;
}

/**
 * Determine the import style used in a given import statement.
 * Returns 'named', 'default', 'namespace', or 'side-effect'.
 */
export function importStyle(importText: string): 'named' | 'default' | 'namespace' | 'side-effect' {
  const trimmed = importText.trim();
  if (/^import\s+\*\s+as\s+/.test(trimmed)) return 'namespace';
  if (/^import\s+\{/.test(trimmed)) return 'named';
  if (/^import\s+[a-zA-Z_$]/.test(trimmed)) return 'default';
  return 'side-effect';
}