import { globSync } from 'glob';
import { readFileSync, statSync } from 'node:fs';
import { relative, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { OlogStore } from '../db.js';
import { elemId, arrowId, fileElemId, formatSpanId } from './ids.js';
import { parseSpan } from '../utils/parse-span.js';
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

/**
 * Incremental ingestion: processes only files that are new or modified since the last index.
 * New files: present on disk but not yet in the olog.
 * Modified files: changed according to git since the stored commit SHA, or since uncommitted edits.
 * Does not touch unchanged files, so it is much faster on large codebases.
 */
export function ingestChangedFiles(projectRoot: string, store: OlogStore, registry?: AdapterRegistry): IngestResult {
  const start = Date.now();

  const effectiveRegistry = registry ?? getDefaultRegistry();
  if (!effectiveRegistry) throw new Error('No adapter registry available.');
  setDefaultRegistry(effectiveRegistry);

  let head: string;
  try {
    head = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
  } catch {
    head = 'nogit';
  }

  // Collect relative paths of changed files from git
  const gitChanged = new Set<string>();
  const storedSha = store.commitSha();
  try {
    if (storedSha && storedSha !== 'nogit' && storedSha !== head) {
      execSync(`git diff --name-only ${storedSha} ${head}`, { cwd: projectRoot, encoding: 'utf8' })
        .trim().split('\n').filter(Boolean).forEach(f => gitChanged.add(f));
    }
    // Uncommitted modifications
    execSync('git status --porcelain', { cwd: projectRoot, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .forEach(line => { const f = line.slice(3).trim(); if (f) gitChanged.add(f); });
  } catch { /* not a git repo — fall through, only new files will be found */ }

  const ingestedModules = store.getIngestedModules();
  const allFiles = discoverFiles(projectRoot, effectiveRegistry);

  // Files to process: new (not yet indexed) or git-changed
  const filesToProcess = allFiles.filter(abs => {
    const rel = relative(projectRoot, abs);
    return !ingestedModules.has(rel) || gitChanged.has(rel);
  });

  if (filesToProcess.length === 0) {
    return { filesProcessed: 0, elementsCreated: 0, arrowsCreated: 0, durationMs: Date.now() - start };
  }

  // Delete existing tree-sitter elements for modified files (new ones have nothing to delete)
  for (const abs of filesToProcess) {
    const rel = relative(projectRoot, abs);
    if (ingestedModules.has(rel)) store.deleteModuleTreeSitterElements(rel);
  }

  // --- Per-file extraction (mirrors runIngestion for the subset of files) ---
  type ElemRow = { id: string; kind: string; name: string; module: string | null; span: string | null; attrs: string };
  type ArrRow = { id: string; kind: string; src_id: string; dst_id: string; attrs: string };

  const elems: ElemRow[] = [];
  const arrs: ArrRow[] = [];
  const pendingCrossFileArrows: Array<{ kind: string; srcId: string; dstName: string; dstModuleSuffix: string; attrs: string }> = [];
  const newNameToIds = new Map<string, string[]>();
  const createdModuleIds = new Set<string>();
  let filesProcessed = 0;

  for (const absolutePath of filesToProcess) {
    const rel = relative(projectRoot, absolutePath);
    let stats; try { stats = statSync(absolutePath); } catch { continue; }
    if (stats.size > 1024 * 1024) continue;
    let source: string; try { source = readFileSync(absolutePath, 'utf8'); } catch { continue; }

    const adapter = effectiveRegistry.getForFile(absolutePath);
    if (!adapter) continue;

    let extracted: { elements: RawElement[]; arrows: RawArrow[] };
    try {
      extracted = adapter.extractElements(adapter.createParser(absolutePath), source, adapter.queryPath(absolutePath), rel, projectRoot);
    } catch (err) {
      console.error(`[olog] Failed to extract from ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const fileId = fileElemId(rel);
    elems.push({ id: fileId, kind: 'file', name: basename(rel), module: rel, span: null, attrs: '{}' });

    const fileNameToId = new Map<string, string[]>();
    const seenArrowIds = new Set<string>();

    for (const rawElem of extracted.elements) {
      const coords = parseSpan(rawElem.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;
      const fullSpan = coords ? formatSpanId(rel, coords.startLine, coords.startCol, coords.endLine, coords.endCol) : rawElem.span;
      const id = elemId(rel, line, col, rawElem.kind, rawElem.name);

      const fileExisting = fileNameToId.get(rawElem.name) ?? [];
      fileExisting.push(id);
      fileNameToId.set(rawElem.name, fileExisting);
      const globalExisting = newNameToIds.get(rawElem.name) ?? [];
      globalExisting.push(id);
      newNameToIds.set(rawElem.name, globalExisting);

      elems.push({ id, kind: rawElem.kind, name: rawElem.name, module: rel, span: fullSpan, attrs: JSON.stringify(rawElem.attrs) });
    }

    for (const rawArrow of extracted.arrows) {
      if ((rawArrow.kind as string) === 'importsFrom') {
        const srcId = (fileNameToId.get(rawArrow.srcName) ?? [])[0];
        const rawModule = (rawArrow.attrs as Record<string, string>).module ?? rawArrow.dstModule;
        const resolvedModule = adapter.resolveImportSpecifier
          ? adapter.resolveImportSpecifier(rawModule, rel, projectRoot) ?? rawModule
          : rawModule;
        const moduleId = `module:${resolvedModule}`;
        if (srcId) {
          if (!createdModuleIds.has(moduleId)) {
            createdModuleIds.add(moduleId);
            elems.push({ id: moduleId, kind: 'module', name: resolvedModule, module: resolvedModule, span: null, attrs: '{}' });
          }
          const aid = arrowId(srcId, 'importsFrom', moduleId);
          if (!seenArrowIds.has(aid)) { seenArrowIds.add(aid); arrs.push({ id: aid, kind: 'importsFrom', src_id: srcId, dst_id: moduleId, attrs: JSON.stringify(rawArrow.attrs) }); }
        }
      } else {
        const srcId = (fileNameToId.get(rawArrow.srcName) ?? [])[0];
        const dstId = (fileNameToId.get(rawArrow.dstName) ?? [])[0];
        if (srcId && dstId) {
          const aid = arrowId(srcId, rawArrow.kind, dstId);
          if (!seenArrowIds.has(aid)) { seenArrowIds.add(aid); arrs.push({ id: aid, kind: rawArrow.kind, src_id: srcId, dst_id: dstId, attrs: JSON.stringify(rawArrow.attrs) }); }
        } else if (srcId && !dstId && rawArrow.dstName) {
          pendingCrossFileArrows.push({ kind: rawArrow.kind, srcId, dstName: rawArrow.dstName, dstModuleSuffix: rawArrow.dstModule ?? '', attrs: JSON.stringify(rawArrow.attrs) });
        }
      }
    }

    filesProcessed++;
  }

  // Cross-file resolution: combine existing DB elements with newly extracted ones
  const globalNameToIds = store.getAllElemNameToIds();
  for (const [name, ids] of newNameToIds) {
    const existing = globalNameToIds.get(name) ?? [];
    for (const id of ids) if (!existing.includes(id)) existing.push(id);
    globalNameToIds.set(name, existing);
  }

  // Build id→module maps once for O(1) lookup during resolution
  const dbIdToModule = store.getAllElemIdToModule();
  const newElemIdToModule = new Map<string, string>();
  for (const e of elems) {
    if (e.module !== null && e.module !== undefined) newElemIdToModule.set(e.id, e.module);
  }

  const seenCrossIds = new Set<string>();
  for (const pending of pendingCrossFileArrows) {
    const candidates = globalNameToIds.get(pending.dstName) ?? [];
    let dstId: string | undefined;
    if (pending.dstModuleSuffix) {
      const matched = candidates.filter(id => {
        const mod = newElemIdToModule.get(id) ?? dbIdToModule.get(id);
        return mod?.endsWith(pending.dstModuleSuffix) ?? false;
      });
      if (matched.length === 1) dstId = matched[0];
    } else if (candidates.length === 1) {
      dstId = candidates[0];
    }
    if (dstId && dstId !== pending.srcId) {
      const aid = arrowId(pending.srcId, pending.kind, dstId);
      if (!seenCrossIds.has(aid)) {
        seenCrossIds.add(aid);
        arrs.push({ id: aid, kind: pending.kind, src_id: pending.srcId, dst_id: dstId, attrs: pending.attrs });
      }
    }
  }

  store.ingestFile(elems, arrs, head);

  return { filesProcessed, elementsCreated: elems.length, arrowsCreated: arrs.length, durationMs: Date.now() - start };
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

  // Pending cross-file arrows: emitted by adapters with dstModule hint but not resolvable within file scope.
  const pendingCrossFileArrows: Array<{
    kind: string;
    srcId: string;
    dstName: string;
    dstModuleSuffix: string; // file path suffix to match against element modules (may be '')
    attrs: string;
  }> = [];

  // Global name → element ID map, built after all files are processed.
  const globalNameToIds = new Map<string, string[]>();
  // Module (relativePath) → element IDs map for cross-module resolution.
  const moduleToIds = new Map<string, string[]>();

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
      extracted = adapter.extractElements(parser, source, queryPath, relativePath, projectRoot);
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
      const coords = parseSpan(rawElem.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;
      const fullSpan = coords
        ? formatSpanId(relativePath, coords.startLine, coords.startCol, coords.endLine, coords.endCol)
        : rawElem.span;

      const id = elemId(relativePath, line, col, rawElem.kind, rawElem.name);
      const existing = nameToId.get(rawElem.name) ?? [];
      existing.push(id);
      nameToId.set(rawElem.name, existing);
      elementIds.push({ id, kind: rawElem.kind });

      // Populate global maps for cross-file resolution
      const globalExisting = globalNameToIds.get(rawElem.name) ?? [];
      globalExisting.push(id);
      globalNameToIds.set(rawElem.name, globalExisting);
      const modExisting = moduleToIds.get(relativePath) ?? [];
      modExisting.push(id);
      moduleToIds.set(relativePath, modExisting);

      elems.push({
        id,
        kind: rawElem.kind,
        name: rawElem.name,
        module: relativePath,
        span: fullSpan,
        attrs: JSON.stringify(rawElem.attrs),
      });

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
        } else if (srcId && !dstId && rawArrow.dstName) {
          // Dst not found in this file — queue for cross-file resolution
          pendingCrossFileArrows.push({
            kind: rawArrow.kind,
            srcId,
            dstName: rawArrow.dstName,
            dstModuleSuffix: rawArrow.dstModule ?? '',
            attrs: JSON.stringify(rawArrow.attrs),
          });
        }
      }
    }

    for (const rawElem of extracted.elements) {
      if (rawElem.kind === 'import') {
        const coords = parseSpan(rawElem.span);
        const line = coords?.startLine ?? 1;
        const col = coords?.startCol ?? 1;
        const id = elemId(relativePath, line, col, rawElem.kind, rawElem.name);

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
      const coords = parseSpan(prop.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;

      const propId = elemId(relativePath, line, col, 'property', `${prop.parentName}.${prop.name}`);
      const fullSpan = coords
        ? formatSpanId(relativePath, coords.startLine, coords.startCol, coords.endLine, coords.endCol)
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

      // memberOf arrow: property → parent (reverse of hasProperty)
      const moId = arrowId(propId, 'memberOf', parentId);
      if (!seenPropArrowIds.has(moId)) {
        seenPropArrowIds.add(moId);
        arrs.push({ id: moId, kind: 'memberOf', src_id: propId, dst_id: parentId, attrs: '{}' });
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

  // --- Cross-file arrow resolution pass ---
  // Build an O(1) id→module map so the inner filter doesn't scan the entire elems array.
  const elemIdToModule = new Map<string, string>();
  for (const e of elems) {
    if (e.module !== null && e.module !== undefined) elemIdToModule.set(e.id, e.module);
  }

  const seenCrossFileArrowIds = new Set<string>();
  for (const pending of pendingCrossFileArrows) {
    const candidates = globalNameToIds.get(pending.dstName) ?? [];
    let dstId: string | undefined;

    if (pending.dstModuleSuffix) {
      const suffix = pending.dstModuleSuffix;
      const matched = candidates.filter(id => elemIdToModule.get(id)?.endsWith(suffix) ?? false);
      if (matched.length === 1) dstId = matched[0];
    } else if (candidates.length === 1) {
      dstId = candidates[0];
    }

    if (dstId && dstId !== pending.srcId) {
      const aid = arrowId(pending.srcId, pending.kind, dstId);
      if (!seenCrossFileArrowIds.has(aid)) {
        seenCrossFileArrowIds.add(aid);
        arrs.push({ id: aid, kind: pending.kind, src_id: pending.srcId, dst_id: dstId, attrs: pending.attrs });
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

