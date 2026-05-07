export type DelegationTask =
  | 'write_function_body'
  | 'write_test'
  | 'write_migration'
  | 'rewrite_body'
  | 'write_documentation';

export interface DelegationBrief {
  task: DelegationTask;
  rationale?: string;

  target: {
    id: string;
    name: string;
    kind: string;
    module: string;
    signature: string;
    bodyPlaceholder: string;
    filePath: string;
    lineRange: { start: number; end: number };
  };

  mustCall: Array<{
    name: string;
    signature: string;
    importStatement: string;
    calleeBodySnippet: string;
    calleeCallees: Array<{ name: string; module: string; snippet: string }>;
  }>;

  mustImplement: Array<{
    name: string;
    fullDeclaration: string;
    importStatement: string;
  }>;

  usedBy: Array<{
    name: string;
    callSiteSnippet?: string;
    fullDeclaration?: string;
  }>;

  importsInTargetFile: string[];

  /**
   * mustCall entries whose module is not imported in the target file.
   * Each entry carries the import statement needed to fix it.
   */
  missingImports: Array<{ name: string; module: string; suggestedImport: string }>;

  analogues: Array<{
    name: string;
    similarity: number;
    fullSource: string;
    callees: string[];
    modulePath: string;
  }>;

  targetFileContent: string;

  /**
   * Domain model context for this code element.
   * Null when no domain model has been built yet.
   */
  domainContext: {
    /** Domain concept(s) this element directly implements via implementedAs. */
    ownConcepts: Array<{
      id: string;
      name: string;
      /** Domain arrows involving this concept (excluding implementedAs). */
      arrows: Array<{ name: string; direction: 'outgoing' | 'incoming'; peerName: string }>;
    }>;
    /** Domain concepts reachable via callers/callees (Kan neighborhood). */
    neighborConcepts: Array<{
      name: string;
      via: 'caller' | 'callee';
      codeElementName: string;
    }>;
  } | null;

  acceptanceCriteria: string[];

  provenance: {
    ologCommitSha: string;
    confidence: 'resolved' | 'unresolved' | 'mixed';
    generatedAt: string;
  };

  /**
   * Working set ID for this delegation session. Present when olog_delegate was
   * called with a setId. The edit agent uses this to assert discoveredDependency
   * arrows back to the working set after editing.
   */
  setId?: string;
}

export interface ContextOverrides {
  mustCall?: string[];
  mustImplement?: string[];
  analogues?: string[];
  lineRange?: { start: number; end: number };
  skipAnalogues?: boolean;
  signatureChange?: boolean;
}

export interface AssembleBriefOptions {
  overrides?: ContextOverrides;
  maxAnalogues?: number;
  snippetLines?: number;
  extraCriteria?: string[];
  rationale?: string;
  setId?: string;
}

import type { OlogStore } from '../db.js';
import type { OlogElem } from '../ontology.js';
import {
  gatherMustCall,
  gatherMustImplement,
  gatherUsedBy,
  gatherImports,
  gatherDomainContext,
  getModuleFilePath,
  type MustCallEntry,
  type MustImplementEntry,
  type UsedByEntry,
} from './context.js';
import { SourceResolver } from './resolve.js';
import { findAnalogues, type AnalogueCandidate } from './analogues.js';
import { parseSpan } from '../utils/parse-span.js';

const TASK_CRITERIA: Record<DelegationTask, string[]> = {
  write_function_body: [
    'Must compile without type errors.',
    'Must call every function listed in mustCall.',
    'Must return a value matching the signature.',
    'Must not change the function signature or exports.',
    'Must follow the coding patterns in the provided analogues.',
  ],
  write_test: [
    'Must compile.',
    'Must import the target function.',
    'Must have at least one test case for each mustCall function.',
    'Must follow the test framework patterns in the analogues.',
    'Must be in a .test.ts or .spec.ts file.',
  ],
  write_migration: [
    'Must compile.',
    'Must be idempotent (safe to run twice).',
    'Must use the project\'s database client (see analogues).',
    'Must include both up and down migrations if the framework requires it.',
  ],
  rewrite_body: [
    'Must compile.',
    'Must preserve the existing signature and exports.',
    'Must call every function in mustCall.',
    'Must not introduce new dependencies not listed in the acceptance criteria.',
    'Must be strictly better than the current body per the criteria.',
  ],
  write_documentation: [
    'Must be valid JSDoc/TSDoc.',
    'Must document all parameters.',
    'Must include @returns with type.',
    'Must include at least one @example if any analogue has examples.',
    'Must describe thrown errors.',
  ],
};

export function assembleBrief(
  store: OlogStore,
  projectRoot: string,
  task: DelegationTask,
  targetId: string,
  opts: AssembleBriefOptions = {},
): DelegationBrief | { ok: false; error: string } {
  const { overrides, maxAnalogues = 3, snippetLines = 50, extraCriteria, rationale, setId } = opts;
  const target = store.getElem(targetId);
  if (!target) {
    return { ok: false, error: `Element not found: ${targetId}` };
  }

  const targetModule = target.module;
  if (!targetModule) {
    return { ok: false, error: `Element has no module: ${targetId}` };
  }

  const resolver = new SourceResolver(projectRoot);
  const filePath = getModuleFilePath(store, targetModule) ?? localModuleToFilePath(targetModule);

  const targetSignature = resolver.readSignature(filePath, target.span ?? '', target.kind) ?? target.name;
  const targetDeclaration = resolver.readDeclaration(filePath, target.span ?? '', target.kind) ?? '';
  const bodyPlaceholder = extractBodyPlaceholder(targetDeclaration);

  const parsedSpan = target.span ? parseSpanSimple(target.span) : null;

  const mustCallEntries = overrides?.mustCall
    ? resolveElementList(store, overrides.mustCall)
    : gatherMustCall(store, targetId);

  const mustImplementEntries = overrides?.mustImplement
    ? resolveElementList(store, overrides.mustImplement)
    : gatherMustImplement(store, targetId);

  const usedByEntries = gatherUsedBy(store, targetId);
  const importEntries = gatherImports(store, targetModule);

  const shouldSkipAnalogues = overrides?.skipAnalogues === true || maxAnalogues === 0;
  const workingSetIds = setId ? store.getWorkingSetElementIds(setId) : undefined;
  const analogueCandidates = shouldSkipAnalogues
    ? []
    : overrides?.analogues
    ? resolveAnalogueList(store, overrides.analogues)
    : findAnalogues(store, target, maxAnalogues, workingSetIds);

  const resolvedMustCall = mustCallEntries.map(entry => {
    const entryFilePath = getModuleFilePath(store, entry.module ?? '') ?? localModuleToFilePath(entry.module ?? '');
    const calleeCallees = getDirectCallees(store, entry.id).slice(0, 5).flatMap(tc => {
      const tcFilePath = getModuleFilePath(store, tc.module ?? '') ?? localModuleToFilePath(tc.module ?? '');
      const snippet = resolver.readBody(tcFilePath, tc.span ?? '', tc.kind, Math.ceil(snippetLines / 2)) ?? '';
      if (!snippet) return [];
      return [{ name: tc.name, module: tc.module ?? '', snippet }];
    });
    return {
      name: entry.name,
      signature: resolver.readSignature(entryFilePath, entry.span ?? '', entry.kind) ?? entry.name,
      importStatement: resolver.computeImportStatement(entry.name, entry.module ?? '', targetModule),
      calleeBodySnippet: resolver.readBody(entryFilePath, entry.span ?? '', entry.kind, snippetLines) ?? '',
      calleeCallees,
    };
  });

  const resolvedMustImplement = mustImplementEntries.map(entry => {
    const entryFilePath = getModuleFilePath(store, entry.module ?? '') ?? localModuleToFilePath(entry.module ?? '');
    return {
      name: entry.name,
      fullDeclaration: resolver.readDeclaration(entryFilePath, entry.span ?? '', entry.kind) ?? entry.name,
      importStatement: resolver.computeImportStatement(entry.name, entry.module ?? '', targetModule),
    };
  });

  const resolvedUsedBy = usedByEntries.slice(0, overrides?.signatureChange ? 3 : undefined).map(entry => {
    const entryFilePath = getModuleFilePath(store, entry.module ?? '') ?? localModuleToFilePath(entry.module ?? '');
    if (overrides?.signatureChange) {
      return {
        name: entry.name,
        fullDeclaration: resolver.readDeclaration(entryFilePath, entry.span ?? '', entry.kind) ?? '',
      };
    }
    const callSiteSnippet = entry.span ? resolver.readSpan(entryFilePath, entry.span) ?? '' : '';
    return { name: entry.name, callSiteSnippet };
  });

  const resolvedImports = importEntries.map(imp => {
    if (imp.rawText) return imp.rawText;
    if (imp.sourceModule) return `import { ${imp.name} } from '${imp.sourceModule}'`;
    return `import { ${imp.name} } from '...'`;
  });

  // Detect which mustCall entries are not yet imported in the target file
  const importedModuleSuffixes = new Set(
    importEntries
      .map(imp => imp.sourceModule)
      .filter((m): m is string => !!m)
  );
  const missingImports = mustCallEntries
    .filter(entry => {
      if (!entry.module || entry.module === targetModule) return false;
      return ![...importedModuleSuffixes].some(
        im => im === entry.module || entry.module!.endsWith(im) || im.endsWith(entry.module!.split('/').pop() ?? '')
      );
    })
    .map(entry => {
      const entryFilePath = getModuleFilePath(store, entry.module ?? '') ?? localModuleToFilePath(entry.module ?? '');
      return {
        name: entry.name,
        module: entry.module ?? '',
        suggestedImport: resolver.computeImportStatement(entry.name, entry.module ?? '', targetModule),
      };
    });

  const resolvedAnalogues = analogueCandidates.map(candidate => {
    const candidateFilePath = getModuleFilePath(store, candidate.module ?? '') ?? localModuleToFilePath(candidate.module ?? '');
    const analogueCallees = getCalleeNames(store, candidate.id);
    return {
      name: candidate.name,
      similarity: candidate.similarity,
      fullSource: resolver.readDeclaration(candidateFilePath, candidate.span ?? '', candidate.kind) ?? '',
      callees: analogueCallees,
      modulePath: candidate.module ?? '',
    };
  });

  const targetSpan = overrides?.lineRange
    ? `${overrides.lineRange.start}:0-${overrides.lineRange.end}:0`
    : target.span ?? '';
  const targetFileContent = targetSpan
    ? resolver.readFocused(filePath, targetSpan, 30, 15) ?? resolver.readFileContent(filePath, 500) ?? ''
    : resolver.readFileContent(filePath, 500) ?? '';

  const domainContext = gatherDomainContext(store, targetId);

  const defaultCriteria = TASK_CRITERIA[task] ?? [];
  const acceptanceCriteria = [...defaultCriteria, ...(extraCriteria ?? [])];

  const commitSha = store.commitSha();
  const provenanceConfidence = determineConfidence(store, targetId);

  // Write brief structure into working set so planning agent can inspect decisions
  if (setId) {
    const elemIds = [
      targetId,
      ...mustCallEntries.map(e => e.id),
      ...mustImplementEntries.map(e => e.id),
      ...analogueCandidates.map(a => a.id),
    ];
    store.addToWorkingSet(setId, elemIds, []);
    for (const mc of mustCallEntries) {
      store.assertSyntheticArrow(setId, targetId, mc.id, 'shouldCall', 'orchestrate', `Required by ${task} brief`);
    }
    for (const mi of mustImplementEntries) {
      store.assertSyntheticArrow(setId, targetId, mi.id, 'shouldImplement', 'orchestrate');
    }
    for (const a of analogueCandidates) {
      store.assertSyntheticArrow(setId, targetId, a.id, 'analogueOf', 'orchestrate', `similarity=${a.similarity.toFixed(2)}`);
    }
  }

  return {
    task,
    ...(rationale !== undefined ? { rationale } : {}),
    ...(setId !== undefined ? { setId } : {}),
    target: {
      id: target.id,
      name: target.name,
      kind: target.kind,
      module: targetModule,
      signature: targetSignature,
      bodyPlaceholder: bodyPlaceholder,
      filePath,
      lineRange: overrides?.lineRange ?? parsedSpan ?? { start: 1, end: 1 },
    },
    mustCall: resolvedMustCall,
    mustImplement: resolvedMustImplement,
    usedBy: resolvedUsedBy,
    importsInTargetFile: resolvedImports.length > 0 ? resolvedImports : resolver.readImportBlock(filePath),
    analogues: resolvedAnalogues,
    targetFileContent,
    domainContext,
    missingImports,
    acceptanceCriteria,
    provenance: {
      ologCommitSha: commitSha,
      confidence: provenanceConfidence,
      generatedAt: new Date().toISOString(),
    },
  };
}

function extractBodyPlaceholder(declaration: string): string {
  const firstBrace = declaration.indexOf('{');
  if (firstBrace < 0) return '';
  const lastBrace = declaration.lastIndexOf('}');
  if (lastBrace < 0) return declaration.slice(firstBrace);
  return declaration.slice(firstBrace, lastBrace + 1);
}

function resolveElementList(store: OlogStore, ids: string[]): MustCallEntry[] | MustImplementEntry[] | UsedByEntry[] {
  const results: MustCallEntry[] = [];
  for (const id of ids) {
    const elem = store.getElem(id);
    if (elem) {
      results.push({
        id: elem.id,
        name: elem.name,
        kind: elem.kind,
        module: elem.module,
        span: elem.span,
        attrs: elem.attrs,
      });
    }
  }
  return results;
}

function resolveAnalogueList(store: OlogStore, ids: string[]): AnalogueCandidate[] {
  const results: AnalogueCandidate[] = [];
  for (const id of ids) {
    const elem = store.getElem(id);
    if (elem) {
      results.push({
        id: elem.id,
        name: elem.name,
        kind: elem.kind,
        module: elem.module,
        span: elem.span,
        similarity: 1.0, // manually overridden, max similarity
      });
    }
  }
  return results;
}

function getDirectCallees(store: OlogStore, elemId: string): Array<{ id: string; name: string; kind: string; module: string | null; span: string | null }> {
  const seen = new Set<string>();
  const results: Array<{ id: string; name: string; kind: string; module: string | null; span: string | null }> = [];
  for (const arrow of store.outgoing(elemId)) {
    if (arrow.kind === 'callerOf') {
      const callee = store.getElem(arrow.dstId);
      if (callee && !seen.has(callee.id)) {
        seen.add(callee.id);
        results.push({ id: callee.id, name: callee.name, kind: callee.kind, module: callee.module, span: callee.span });
      }
    }
  }
  return results;
}

function getCalleeNames(store: OlogStore, elemId: string): string[] {
  const names: string[] = [];
  const incoming = store.incoming(elemId);
  const callerOfArrows = incoming.filter(a => a.kind === 'callerOf');
  for (const arrow of callerOfArrows) {
    const csOutgoing = store.outgoing(arrow.srcId);
    const calleeOfArrow = csOutgoing.find(a => a.kind === 'calleeOf');
    if (calleeOfArrow) {
      const callee = store.getElem(calleeOfArrow.dstId);
      if (callee) names.push(callee.name);
    }
  }
  return names;
}

function determineConfidence(store: OlogStore, targetId: string): 'resolved' | 'unresolved' | 'mixed' {
  const prov = store.getProvenance(targetId);
  if (!prov) return 'unresolved';
  if (prov.confidence === 'resolved') return 'resolved';
  return 'mixed';
}

function localModuleToFilePath(modulePath: string): string {
  if (/\.\w+$/.test(modulePath)) return modulePath;
  return modulePath + '.ts';
}

function parseSpanSimple(span: string): { start: number; end: number } | null {
  const parsed = parseSpan(span);
  if (!parsed) return null;
  return { start: parsed.startLine, end: parsed.endLine };
}