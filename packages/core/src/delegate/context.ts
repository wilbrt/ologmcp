/**
 * Olog traversal functions for assembling delegation context.
 *
 * These functions query the OlogStore to gather structural context
 * (mustCall, mustImplement, usedBy, imports) without reading any source
 * files. All results are element IDs, names, modules, and spans.
 */
import type { OlogStore } from '../db.js';
import type { OlogElem } from '../ontology.js';

export interface MustCallEntry {
  id: string;
  name: string;
  kind: string;
  module: string | null;
  span: string | null;
  attrs: Record<string, unknown>;
}

export interface MustImplementEntry {
  id: string;
  name: string;
  kind: string;
  module: string | null;
  span: string | null;
}

export interface UsedByEntry {
  id: string;
  name: string;
  kind: string;
  module: string | null;
  span: string | null;
}

export interface ImportEntry {
  name: string;
  sourceModule: string | null;
  targetModule: string | null;
}

export interface StructuralContext {
  mustCall: MustCallEntry[];
  mustImplement: MustImplementEntry[];
  usedBy: UsedByEntry[];
  imports: ImportEntry[];
}

/**
 * Gather mustCall: the functions/methods that `target` calls.
 *
 * Traversal: target --calleeOf--> CallSite, then each CallSite --callerOf--> Symbol
 * (the call site is in the target and points to the function being called).
 *
 * Wait — the arrow semantics:
 *   callerOf: CallSite --callerOf--> Symbol (the site is IN the caller function)
 *   calleeOf: CallSite --calleeOf--> Symbol (the site calls the callee function)
 *
 * So to find what `target` calls:
 *   Find CallSites where callerOf points to target → then follow calleeOf to the callee.
 */
export function gatherMustCall(store: OlogStore, targetId: string): MustCallEntry[] {
  // Find call sites where target is the caller (callerOf arrow pointing TO target means
  // the CallSite's callerOf arrow has dstId = targetId)
  const incoming = store.incoming(targetId);

  // Filter for callerOf arrows — these are CallSites that are IN the target function
  const callerOfArrows = incoming.filter(a => a.kind === 'callerOf');

  const callees: MustCallEntry[] = [];

  for (const arrow of callerOfArrows) {
    // arrow.srcId is the CallSite; follow its calleeOf arrow to get the callee symbol
    const callSiteOutgoing = store.outgoing(arrow.srcId);
    const calleeOfArrow = callSiteOutgoing.find(a => a.kind === 'calleeOf');

    if (calleeOfArrow) {
      const calleeElem = store.getElem(calleeOfArrow.dstId);
      if (calleeElem) {
        callees.push({
          id: calleeElem.id,
          name: calleeElem.name,
          kind: calleeElem.kind,
          module: calleeElem.module,
          span: calleeElem.span,
          attrs: calleeElem.attrs,
        });
      }
    }
  }

  return callees;
}

/**
 * Gather mustImplement: interfaces that `target` implements.
 *
 * Traversal: target --implements--> Interface
 * (checking incoming implements arrows where target is the srcId)
 */
export function gatherMustImplement(store: OlogStore, targetId: string): MustImplementEntry[] {
  const outgoing = store.outgoing(targetId);
  const implementsArrows = outgoing.filter(a => a.kind === 'implements');

  const interfaces: MustImplementEntry[] = [];
  for (const arrow of implementsArrows) {
    const iface = store.getElem(arrow.dstId);
    if (iface) {
      interfaces.push({
        id: iface.id,
        name: iface.name,
        kind: iface.kind,
        module: iface.module,
        span: iface.span,
      });
    }
  }

  // Also check incoming implements arrows (if the arrow direction is reversed)
  const incoming = store.incoming(targetId);
  const implementsIncoming = incoming.filter(a => a.kind === 'implements');
  for (const arrow of implementsIncoming) {
    const iface = store.getElem(arrow.srcId);
    if (iface) {
      interfaces.push({
        id: iface.id,
        name: iface.name,
        kind: iface.kind,
        module: iface.module,
        span: iface.span,
      });
    }
  }

  return interfaces;
}

/**
 * Gather usedBy: functions/methods that call `target`.
 *
 * Traversal: find CallSites whose calleeOf points to target,
 * then follow each CallSite's callerOf to find the caller.
 */
export function gatherUsedBy(store: OlogStore, targetId: string): UsedByEntry[] {
  // Find CallSites where calleeOf points to target (these sites call our target)
  const incoming = store.incoming(targetId);
  const calleeOfArrows = incoming.filter(a => a.kind === 'calleeOf');

  const callers: UsedByEntry[] = [];
  const seen = new Set<string>();

  for (const arrow of calleeOfArrows) {
    // arrow.srcId is the CallSite
    const callSiteOutgoing = store.outgoing(arrow.srcId);
    const callerOfArrow = callSiteOutgoing.find(a => a.kind === 'callerOf');

    if (callerOfArrow) {
      const callerElem = store.getElem(callerOfArrow.dstId);
      if (callerElem && !seen.has(callerElem.id)) {
        seen.add(callerElem.id);
        callers.push({
          id: callerElem.id,
          name: callerElem.name,
          kind: callerElem.kind,
          module: callerElem.module,
          span: callerElem.span,
        });
      }
    }
  }

  return callers;
}

/**
 * Gather imports: what the target's module imports.
 *
 * Find Import elements contained in the target's module, then follow
 * their importsFrom arrows to get source modules.
 */
export function gatherImports(store: OlogStore, targetModule: string): ImportEntry[] {
  const imports: ImportEntry[] = [];

  // Find import elements in this module
  const moduleElems = store.queryElements({
    kind: 'import',
    moduleRegex: `^${escapeRegex(targetModule)}$`,
    limit: 200,
  });

  for (const imp of moduleElems) {
    // Find importsFrom arrow from this import
    const outgoing = store.outgoing(imp.id);
    const importsFromArrow = outgoing.find(a => a.kind === 'importsFrom');

    imports.push({
      name: imp.name,
      sourceModule: importsFromArrow
        ? (importsFromArrow.attrs?.sourceModule as string | null) ?? null
        : null,
      targetModule: imp.module,
    });
  }

  return imports;
}

/**
 * Get the module element ID for a given module path.
 */
export function getModuleElement(store: OlogStore, modulePath: string): OlogElem | null {
  const results = store.queryElements({
    kind: 'module',
    nameRegex: `^${escapeRegex(modulePath)}$`,
    limit: 1,
  });
  return results[0] ?? null;
}

/**
 * Get the file path for a module by finding its locatedIn file element.
 */
export function getModuleFilePath(store: OlogStore, modulePath: string): string | null {
  const modElem = getModuleElement(store, modulePath);
  if (!modElem) return null;

  // Check if module has a locatedIn arrow to a file
  const outgoing = store.outgoing(modElem.id);
  const locatedIn = outgoing.find(a => a.kind === 'locatedIn');
  if (locatedIn) {
    const fileElem = store.getElem(locatedIn.dstId);
    if (fileElem) return fileElem.name;
  }

  // Fallback: use module name as file path
  return modulePath;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}