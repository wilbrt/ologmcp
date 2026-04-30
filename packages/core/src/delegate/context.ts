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
  /** Language-specific raw import text (e.g. "[myapp.fee-model :as fee-model]" for Clojure). */
  rawText?: string;
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
 * callerOf arrows are stored as caller→callee (direct function-to-function).
 * Outgoing callerOf from target gives all functions it calls.
 */
export function gatherMustCall(store: OlogStore, targetId: string): MustCallEntry[] {
  const outgoing = store.outgoing(targetId);
  const callerOfArrows = outgoing.filter(a => a.kind === 'callerOf');
  const callees: MustCallEntry[] = [];

  for (const arrow of callerOfArrows) {
    const callee = store.getElem(arrow.dstId);
    if (callee) {
      callees.push({
        id: callee.id,
        name: callee.name,
        kind: callee.kind,
        module: callee.module,
        span: callee.span,
        attrs: callee.attrs,
      });
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
 * callerOf arrows are stored as caller→callee (direct function-to-function).
 * Incoming callerOf to target means srcId is a function that calls target.
 */
export function gatherUsedBy(store: OlogStore, targetId: string): UsedByEntry[] {
  const incoming = store.incoming(targetId);
  const callerOfArrows = incoming.filter(a => a.kind === 'callerOf');
  const callers: UsedByEntry[] = [];
  const seen = new Set<string>();

  for (const arrow of callerOfArrows) {
    const caller = store.getElem(arrow.srcId);
    if (caller && !seen.has(caller.id)) {
      seen.add(caller.id);
      callers.push({
        id: caller.id,
        name: caller.name,
        kind: caller.kind,
        module: caller.module,
        span: caller.span,
      });
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
      ...(imp.attrs && (imp.attrs as Record<string, string>).rawRequire
        ? { rawText: (imp.attrs as Record<string, string>).rawRequire }
        : {}),
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

/**
 * Gather domain context for a code element: the domain concept(s) it implements
 * and the domain concepts reachable via its call neighborhood (Kan context).
 */
export function gatherDomainContext(store: OlogStore, targetId: string): DomainContext | null {
  // own concepts: domain elements with implementedAs → targetId
  const ownConcepts: DomainContext['ownConcepts'] = [];
  for (const arrow of store.incoming(targetId)) {
    if (arrow.kind !== 'implementedAs') continue;
    const domainElem = store.getElem(arrow.srcId);
    if (!domainElem || domainElem.kind !== 'domain') continue;

    const domainArrows: DomainContext['ownConcepts'][number]['arrows'] = [];
    for (const a of store.outgoing(domainElem.id)) {
      if (a.kind === 'implementedAs') continue;
      const peer = store.getElem(a.dstId);
      if (peer) domainArrows.push({ name: a.kind, direction: 'outgoing', peerName: peer.name });
    }
    for (const a of store.incoming(domainElem.id)) {
      if (a.kind === 'implementedAs') continue;
      const peer = store.getElem(a.srcId);
      if (peer && peer.kind === 'domain') domainArrows.push({ name: a.kind, direction: 'incoming', peerName: peer.name });
    }
    ownConcepts.push({ id: domainElem.id, name: domainElem.name, arrows: domainArrows });
  }

  // neighbor concepts from callers and callees
  const neighborConcepts: DomainContext['neighborConcepts'] = [];
  const seen = new Set<string>();

  const addNeighbor = (codeElemId: string, codeElemName: string, via: 'caller' | 'callee') => {
    for (const a of store.incoming(codeElemId)) {
      if (a.kind !== 'implementedAs') continue;
      const domainElem = store.getElem(a.srcId);
      if (!domainElem || domainElem.kind !== 'domain') continue;
      const key = `${via}:${domainElem.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        neighborConcepts.push({ name: domainElem.name, via, codeElementName: codeElemName });
      }
    }
  };

  for (const a of store.incoming(targetId)) {
    if (a.kind !== 'callerOf') continue;
    const caller = store.getElem(a.srcId);
    if (caller) addNeighbor(caller.id, caller.name, 'caller');
  }
  for (const a of store.outgoing(targetId)) {
    if (a.kind !== 'callerOf') continue;
    const callee = store.getElem(a.dstId);
    if (callee) addNeighbor(callee.id, callee.name, 'callee');
  }

  if (ownConcepts.length === 0 && neighborConcepts.length === 0) return null;
  return { ownConcepts, neighborConcepts };
}

export interface DomainContext {
  ownConcepts: Array<{
    id: string;
    name: string;
    arrows: Array<{ name: string; direction: 'outgoing' | 'incoming'; peerName: string }>;
  }>;
  neighborConcepts: Array<{
    name: string;
    via: 'caller' | 'callee';
    codeElementName: string;
  }>;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}