export type DelegationTask =
  | 'write_function_body'
  | 'write_test'
  | 'write_migration'
  | 'rewrite_body'
  | 'write_documentation';

export interface DelegationBrief {
  task: DelegationTask;

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
  }>;

  mustImplement: Array<{
    name: string;
    fullDeclaration: string;
    importStatement: string;
  }>;

  usedBy: Array<{
    name: string;
    callSiteSnippet: string;
  }>;

  importsInTargetFile: string[];

  analogues: Array<{
    name: string;
    similarity: number;
    fullSource: string;
    callees: string[];
    modulePath: string;
  }>;

  targetFileContent: string;

  acceptanceCriteria: string[];

  provenance: {
    ologCommitSha: string;
    confidence: 'resolved' | 'unresolved' | 'mixed';
    generatedAt: string;
  };
}

export interface ContextOverrides {
  mustCall?: string[];
  mustImplement?: string[];
  analogues?: string[];
}

import type { OlogStore } from '../db.js';
import type { OlogElem } from '../ontology.js';
import {
  gatherMustCall,
  gatherMustImplement,
  gatherUsedBy,
  gatherImports,
  getModuleFilePath,
  type MustCallEntry,
  type MustImplementEntry,
  type UsedByEntry,
} from './context.js';
import { SourceResolver } from './resolve.js';
import { findAnalogues, type AnalogueCandidate } from './analogues.js';

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
  overrides?: ContextOverrides,
  maxAnalogues: number = 3,
  snippetLines: number = 50,
  extraCriteria?: string[],
): DelegationBrief | { ok: false; error: string } {
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

  const analogueCandidates = overrides?.analogues
    ? resolveAnalogueList(store, overrides.analogues)
    : findAnalogues(store, target, maxAnalogues);

  const resolvedMustCall = mustCallEntries.map(entry => {
    const entryFilePath = getModuleFilePath(store, entry.module ?? '') ?? localModuleToFilePath(entry.module ?? '');
    return {
      name: entry.name,
      signature: resolver.readSignature(entryFilePath, entry.span ?? '', entry.kind) ?? entry.name,
      importStatement: resolver.computeImportStatement(entry.name, entry.module ?? '', targetModule),
      calleeBodySnippet: resolver.readBody(entryFilePath, entry.span ?? '', entry.kind, snippetLines) ?? '',
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

  const resolvedUsedBy = usedByEntries.map(entry => {
    const entryFilePath = getModuleFilePath(store, entry.module ?? '') ?? localModuleToFilePath(entry.module ?? '');
    const callSiteSnippet = entry.span ? resolver.readSpan(entryFilePath, entry.span) ?? '' : '';
    return { name: entry.name, callSiteSnippet };
  });

  const resolvedImports = importEntries.map(imp => {
    if (imp.sourceModule) {
      return `import { ${imp.name} } from '${imp.sourceModule}'`;
    }
    return `import { ${imp.name} } from '...'`;
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

  const targetFileContent = resolver.readFileContent(filePath, 500) ?? '';

  const defaultCriteria = TASK_CRITERIA[task] ?? [];
  const acceptanceCriteria = [...defaultCriteria, ...(extraCriteria ?? [])];

  const commitSha = store.commitSha();
  const provenanceConfidence = determineConfidence(store, targetId);

  return {
    task,
    target: {
      id: target.id,
      name: target.name,
      kind: target.kind,
      module: targetModule,
      signature: targetSignature,
      bodyPlaceholder: bodyPlaceholder,
      filePath,
      lineRange: parsedSpan ?? { start: 1, end: 1 },
    },
    mustCall: resolvedMustCall,
    mustImplement: resolvedMustImplement,
    usedBy: resolvedUsedBy,
    importsInTargetFile: resolver.readImportBlock(filePath),
    analogues: resolvedAnalogues,
    targetFileContent,
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
  const m = span.match(/^(\d+):\d+-(\d+):\d+$/);
  if (!m) return null;
  return { start: parseInt(m[1]!, 10), end: parseInt(m[2]!, 10) };
}