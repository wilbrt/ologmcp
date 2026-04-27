import { globSync } from 'glob';
import { readFileSync, statSync } from 'node:fs';
import { relative, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { OlogStore } from '../db.js';
import { elemId, arrowId, fileElemId, formatSpan } from './ids.js';
import type { IngestResult, RawElement, RawArrow } from '../ontology.js';
import { setDefaultRegistry, getDefaultRegistry } from './adapter.js';
import type { AdapterRegistry, LanguageAdapter } from './adapter.js';

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/.olog/**',
  '**/*.d.ts',
];

const ONE_MB = 1024 * 1024;

export function ingestProject(projectRoot: string, store: OlogStore, registry?: AdapterRegistry): IngestResult {
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

  const result = runIngestion(projectRoot, store, head, registry);
  return { ...result, durationMs: Date.now() - start };
}

export function reindexProject(projectRoot: string, store: OlogStore, registry?: AdapterRegistry): IngestResult {
  const start = Date.now();
  let head: string;
  try {
    head = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
  } catch {
    head = 'nogit';
  }

  const result = runIngestion(projectRoot, store, head, registry);
  return { ...result, durationMs: Date.now() - start };
}

interface IngestCounts {
  filesProcessed: number;
  elementsCreated: number;
  arrowsCreated: number;
}

interface FileForPropertyExtraction {
  relativePath: string;
  source: string;
  adapter: LanguageAdapter;
  nameToId: Map<string, string[]>;
}

function discoverFiles(projectRoot: string, registry: AdapterRegistry): string[] {
  const patterns = registry.allGlobPatterns();
  let allFiles: string[] = [];
  for (const pattern of patterns) {
    allFiles = allFiles.concat(globSync(pattern, {
      cwd: projectRoot,
      ignore: IGNORE_PATTERNS,
      absolute: true,
    }));
  }
  // Deduplicate
  return [...new Set(allFiles)];
}

function runIngestion(projectRoot: string, store: OlogStore, head: string, registry?: AdapterRegistry): IngestCounts {
  const effectiveRegistry = registry ?? getDefaultRegistry();
  if (!effectiveRegistry) {
    throw new Error('No adapter registry available. Register language adapters or pass a registry.');
  }
  // Set the global registry so other parts of the system can use it
  setDefaultRegistry(effectiveRegistry);

  const files = discoverFiles(projectRoot, effectiveRegistry);

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
  const createdModuleIds = new Set<string>();
  const filesToExtract: FileForPropertyExtraction[] = [];

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

    const adapter = effectiveRegistry.getForFile(absolutePath);
    if (!adapter) {
      console.error(`[olog] Skipping ${absolutePath}: no language adapter for extension`);
      continue;
    }

    const parser = adapter.createParser(absolutePath);
    const queryPath = adapter.queryPath(absolutePath);

    let extracted: { elements: RawElement[]; arrows: RawArrow[] };
    try {
      extracted = adapter.extractElements(parser, source, queryPath);
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

    const nameToId = new Map<string, string[]>();
    const seenArrowIds = new Set<string>();
    const elementIds: Array<{ id: string; kind: string }> = [];

    for (const rawElem of extracted.elements) {
      const coords = parseTreeSitterSpan(rawElem.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;
      const fullSpan = coords
        ? formatSpan(relativePath, coords.startLine, coords.startCol, coords.endLine, coords.endCol)
        : rawElem.span;

      const id = elemId(relativePath, line, col, rawElem.kind, rawElem.name);
      const existing = nameToId.get(rawElem.name) ?? [];
      existing.push(id);
      nameToId.set(rawElem.name, existing);
      elementIds.push({ id, kind: rawElem.kind });

      elems.push({
        id,
        kind: rawElem.kind,
        name: rawElem.name,
        module: relativePath,
        span: fullSpan,
        attrs: JSON.stringify(rawElem.attrs),
      });

      if (rawElem.kind !== 'file') {
        const aid = arrowId(fileId, 'contains', id);
        if (!seenArrowIds.has(aid)) {
          seenArrowIds.add(aid);
          arrs.push({
            id: aid,
            kind: 'contains',
            src_id: fileId,
            dst_id: id,
            attrs: '{}',
          });
        }
      }
    }

    // definedIn arrows — symbol definitions to their module (file)
    const definitionKinds = new Set(['function', 'class', 'interface', 'type', 'enum', 'method']);
    for (const { id, kind } of elementIds) {
      if (definitionKinds.has(kind)) {
        const aid = arrowId(id, 'definedIn', fileId);
        if (!seenArrowIds.has(aid)) {
          seenArrowIds.add(aid);
          arrs.push({ id: aid, kind: 'definedIn', src_id: id, dst_id: fileId, attrs: '{}' });
        }
      }
    }

    // inModule arrows — every element belongs to its module (file)
    for (const { id } of elementIds) {
      const aid = arrowId(id, 'inModule', fileId);
      if (!seenArrowIds.has(aid)) {
        seenArrowIds.add(aid);
        arrs.push({ id: aid, kind: 'inModule', src_id: id, dst_id: fileId, attrs: '{}' });
      }
    }

    // locatedIn arrows — every element is located in its containing file
    for (const { id } of elementIds) {
      const aid = arrowId(id, 'locatedIn', fileId);
      if (!seenArrowIds.has(aid)) {
        seenArrowIds.add(aid);
        arrs.push({ id: aid, kind: 'locatedIn', src_id: id, dst_id: fileId, attrs: '{}' });
      }
    }

    for (const rawArrow of extracted.arrows) {
      const arrowKindStr = rawArrow.kind as string;

      if (arrowKindStr === 'importsFrom') {
        const srcId = (nameToId.get(rawArrow.srcName) ?? [])[0];
        const rawModule = (rawArrow.attrs as Record<string, string>).module ?? rawArrow.dstModule;
        const resolvedModule = adapter.resolveImportSpecifier
          ? adapter.resolveImportSpecifier(rawModule, relativePath, projectRoot) ?? rawModule
          : rawModule;
        const moduleId = `module:${resolvedModule}`;

        if (srcId) {
          if (!createdModuleIds.has(moduleId)) {
            createdModuleIds.add(moduleId);
            elems.push({
              id: moduleId,
              kind: 'module',
              name: resolvedModule,
              module: resolvedModule,
              span: null,
              attrs: '{}',
            });
          }

          const aid = arrowId(srcId, 'importsFrom', moduleId);
          if (!seenArrowIds.has(aid)) {
            seenArrowIds.add(aid);
            arrs.push({ id: aid, kind: 'importsFrom', src_id: srcId, dst_id: moduleId, attrs: JSON.stringify(rawArrow.attrs) });
          }
        }
      } else {
        const srcId = (nameToId.get(rawArrow.srcName) ?? [])[0];
        const dstId = (nameToId.get(rawArrow.dstName) ?? [])[0];
        if (srcId && dstId) {
          const aid = arrowId(srcId, rawArrow.kind, dstId);
          if (!seenArrowIds.has(aid)) {
            seenArrowIds.add(aid);
            arrs.push({
              id: aid,
              kind: rawArrow.kind,
              src_id: srcId,
              dst_id: dstId,
              attrs: JSON.stringify(rawArrow.attrs),
            });
          }
        }
      }
    }

    for (const rawElem of extracted.elements) {
      if (rawElem.kind === 'import') {
        const coords = parseTreeSitterSpan(rawElem.span);
        const line = coords?.startLine ?? 1;
        const col = coords?.startCol ?? 1;
        const id = elemId(relativePath, line, col, rawElem.kind, rawElem.name);
        const aid = arrowId(fileId, 'imports', id);
        if (!seenArrowIds.has(aid)) {
          seenArrowIds.add(aid);
          arrs.push({
            id: aid,
            kind: 'imports',
            src_id: fileId,
            dst_id: id,
            attrs: '{}',
          });
        }

        const sourceModule = (rawElem.attrs as Record<string, string>).sourceModule;
        if (sourceModule) {
          const resolvedSourceModule = adapter.resolveImportSpecifier
            ? adapter.resolveImportSpecifier(sourceModule, relativePath, projectRoot) ?? sourceModule
            : sourceModule;
          const moduleId = `module:${resolvedSourceModule}`;
          if (!createdModuleIds.has(moduleId)) {
            createdModuleIds.add(moduleId);
            elems.push({
              id: moduleId,
              kind: 'module',
              name: resolvedSourceModule,
              module: resolvedSourceModule,
              span: null,
              attrs: '{}',
            });
          }
          const ifAid = arrowId(id, 'importsFrom', moduleId);
          if (!seenArrowIds.has(ifAid)) {
            seenArrowIds.add(ifAid);
            arrs.push({ id: ifAid, kind: 'importsFrom', src_id: id, dst_id: moduleId, attrs: JSON.stringify({ module: resolvedSourceModule }) });
          }
        }
      }
    }

    // Record files that may have interface/type/class properties to extract
    const hasStructuredTypes = extracted.elements.some(
      e => e.kind === 'interface' || e.kind === 'type' || e.kind === 'class',
    );
    if (hasStructuredTypes) {
      filesToExtract.push({ relativePath, source, adapter, nameToId });
    }

    filesProcessed++;
  }

  // --- Property extraction pass ---
  // Build a global name→id index for cross-file type resolution
  const globalNameToId = new Map<string, string>();
  for (const e of elems) {
    if (!globalNameToId.has(e.name)) {
      globalNameToId.set(e.name, e.id);
    }
  }

  const seenPropArrowIds = new Set<string>();

  for (const { relativePath, source, adapter: fileAdapter, nameToId: fileNameToId } of filesToExtract) {
    if (!fileAdapter.extractProperties) continue;

    let properties;
    try {
      const parser = fileAdapter.createParser(relativePath);
      properties = fileAdapter.extractProperties(parser, source, relativePath);
    } catch (err) {
      console.error(
        `[olog] Failed to extract properties from ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    for (const prop of properties) {
      const parentIds = fileNameToId.get(prop.parentName);
      const parentId = parentIds?.[0];
      if (!parentId) continue;

      // Parse span to get line/col
      const coords = parseTreeSitterSpan(prop.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;

      const propId = elemId(relativePath, line, col, 'property', `${prop.parentName}.${prop.name}`);
      const fullSpan = coords
        ? formatSpan(relativePath, coords.startLine, coords.startCol, coords.endLine, coords.endCol)
        : prop.span;

      elems.push({
        id: propId,
        kind: 'property',
        name: `${prop.parentName}.${prop.name}`,
        module: relativePath,
        span: fullSpan,
        attrs: JSON.stringify({ typeText: prop.typeText, optional: prop.optional, readonly: prop.readonly }),
      });

      // hasProperty arrow: parent → property
      const hpId = arrowId(parentId, 'hasProperty', propId);
      if (!seenPropArrowIds.has(hpId)) {
        seenPropArrowIds.add(hpId);
        arrs.push({ id: hpId, kind: 'hasProperty', src_id: parentId, dst_id: propId, attrs: '{}' });
      }

      // hasType arrows: property → referenced type element
      for (const typeRef of prop.typeRefs) {
        // Prefer same-file resolution
        const typeId = (fileNameToId.get(typeRef) ?? [])[0] ?? globalNameToId.get(typeRef);
        if (typeId && typeId !== propId) {
          const htId = arrowId(propId, 'hasType', typeId);
          if (!seenPropArrowIds.has(htId)) {
            seenPropArrowIds.add(htId);
            arrs.push({ id: htId, kind: 'hasType', src_id: propId, dst_id: typeId, attrs: '{}' });
          }
        }
      }
    }
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