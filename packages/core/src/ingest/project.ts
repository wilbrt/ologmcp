import { globSync } from 'glob';
import { readFileSync, statSync } from 'node:fs';
import { resolve, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { OlogStore } from '../db.js';
import { parserFor, extractFromFile } from './treesitter.js';
import { elemId, arrowId, fileElemId, formatSpan } from './ids.js';
import type { IngestResult, RawElement, RawArrow } from '../ontology.js';

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/.olog/**',
  '**/*.d.ts',
];

const ONE_MB = 1024 * 1024;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TS_QUERY_PATH = resolve(__dirname, 'queries', 'ts.scm');
const TSX_QUERY_PATH = resolve(__dirname, 'queries', 'tsx.scm');

export function discoverTsFiles(projectRoot: string): string[] {
  return globSync('**/*.{ts,tsx,mts,cts}', {
    cwd: projectRoot,
    ignore: IGNORE_PATTERNS,
    absolute: true,
  });
}

export function ingestProject(projectRoot: string, store: OlogStore): IngestResult {
  const start = Date.now();
  let head: string;
  try {
    head = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
  } catch {
    head = 'nogit';
  }

  if (head !== 'nogit' && store.isFresh(head)) {
    return {
      filesProcessed: 0,
      elementsCreated: 0,
      arrowsCreated: 0,
      durationMs: Date.now() - start,
    };
  }

  const result = runIngestion(projectRoot, store, head);
  return { ...result, durationMs: Date.now() - start };
}

export function reindexProject(projectRoot: string, store: OlogStore): IngestResult {
  const start = Date.now();
  let head: string;
  try {
    head = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
  } catch {
    head = 'nogit';
  }

  const result = runIngestion(projectRoot, store, head);
  return { ...result, durationMs: Date.now() - start };
}

interface IngestCounts {
  filesProcessed: number;
  elementsCreated: number;
  arrowsCreated: number;
}

function runIngestion(projectRoot: string, store: OlogStore, head: string): IngestCounts {
  const files = discoverTsFiles(projectRoot);

  const elems: Array<{
    id: string;
    kind: string;
    name: string;
    module: string | null;
    span: string | null;
    attrs: string;
  }> = [];

  const arrs: Array<{
    id: string;
    kind: string;
    src_id: string;
    dst_id: string;
    attrs: string;
  }> = [];

  let filesProcessed = 0;

  for (const absolutePath of files) {
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch (err) {
      console.error(
        `[olog] Failed to stat ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    if (stats.size > ONE_MB) {
      console.error(`[olog] Skipping ${absolutePath}: file size ${stats.size} exceeds 1MB limit`);
      continue;
    }

    let source: string;
    try {
      source = readFileSync(absolutePath, 'utf8');
    } catch (err) {
      console.error(
        `[olog] Failed to read ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    const relativePath = relative(projectRoot, absolutePath);
    const parser = parserFor(absolutePath);
    const queryPath = absolutePath.endsWith('.tsx') ? TSX_QUERY_PATH : TS_QUERY_PATH;

    let extracted: { elements: RawElement[]; arrows: RawArrow[] };
    try {
      extracted = extractFromFile(parser, source, queryPath);
    } catch (err) {
      console.error(
        `[olog] Failed to extract from ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    const fileId = fileElemId(relativePath);
    elems.push({
      id: fileId,
      kind: 'file',
      name: basename(relativePath),
      module: relativePath,
      span: null,
      attrs: '{}',
    });

    const nameToId = new Map<string, string>();

    for (const rawElem of extracted.elements) {
      const coords = parseTreeSitterSpan(rawElem.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;
      const fullSpan = coords
        ? formatSpan(relativePath, coords.startLine, coords.startCol, coords.endLine, coords.endCol)
        : rawElem.span;

      const id = elemId(relativePath, line, col, rawElem.kind, rawElem.name);
      nameToId.set(rawElem.name, id);

      elems.push({
        id,
        kind: rawElem.kind,
        name: rawElem.name,
        module: relativePath,
        span: fullSpan,
        attrs: JSON.stringify(rawElem.attrs),
      });

      if (rawElem.kind !== 'file') {
        arrs.push({
          id: arrowId(fileId, 'contains', id),
          kind: 'contains',
          src_id: fileId,
          dst_id: id,
          attrs: '{}',
        });
      }
    }

    for (const rawArrow of extracted.arrows) {
      const srcId = nameToId.get(rawArrow.srcName);
      const dstId = nameToId.get(rawArrow.dstName);
      if (srcId && dstId) {
        arrs.push({
          id: arrowId(srcId, rawArrow.kind, dstId),
          kind: rawArrow.kind,
          src_id: srcId,
          dst_id: dstId,
          attrs: JSON.stringify(rawArrow.attrs),
        });
      }
    }

    for (const rawElem of extracted.elements) {
      if (rawElem.kind === 'import') {
        const coords = parseTreeSitterSpan(rawElem.span);
        const line = coords?.startLine ?? 1;
        const col = coords?.startCol ?? 1;
        const id = elemId(relativePath, line, col, rawElem.kind, rawElem.name);
        arrs.push({
          id: arrowId(fileId, 'imports', id),
          kind: 'imports',
          src_id: fileId,
          dst_id: id,
          attrs: '{}',
        });
      }
    }

    filesProcessed++;
  }

  store.ingestFull(elems, arrs, head);

  return {
    filesProcessed,
    elementsCreated: elems.length,
    arrowsCreated: arrs.length,
  };
}

function parseTreeSitterSpan(span: string): { startLine: number; startCol: number; endLine: number; endCol: number } | null {
  const m = span.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
  if (!m) return null;
  return {
    startLine: parseInt(m[1]!, 10),
    startCol: parseInt(m[2]!, 10),
    endLine: parseInt(m[3]!, 10),
    endCol: parseInt(m[4]!, 10),
  };
}
