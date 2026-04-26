import { createHash } from 'node:crypto';

import type { EgoGraph, MotifShape } from './types.js';

export function shapeHash(shape: MotifShape): string {
  const canonical = JSON.stringify({ objects: shape.objects, arrows: shape.arrows });
  return createHash('sha256').update(canonical).digest('hex');
}

export function abstractToShape(ego: EgoGraph): MotifShape {
  // Build role mapping: sort elements by (kind, id) for deterministic assignment
  const sortedElements = Array.from(ego.elements.values()).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });

  const roleMap = new Map<string, string>();
  const kindCounters = new Map<string, number>();

  for (const element of sortedElements) {
    const count = kindCounters.get(element.kind) ?? 0;
    roleMap.set(element.id, `${element.kind}_${count}`);
    kindCounters.set(element.kind, count + 1);
  }

  // Create object slots
  const objects = sortedElements.map(element => ({
    role: roleMap.get(element.id)!,
    kind: element.kind,
  }));

  // Create arrow slots using role mapping
  const arrows = ego.arrows.map(arrow => ({
    fromRole: roleMap.get(arrow.srcId)!,
    label: arrow.kind,
    toRole: roleMap.get(arrow.dstId)!,
  }));

  // Sort canonically: objects by (kind, role), arrows by (fromRole, label, toRole)
  const sortedObjects = [...objects].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.role.localeCompare(b.role);
  });

  const sortedArrows = [...arrows].sort((a, b) => {
    if (a.fromRole !== b.fromRole) return a.fromRole.localeCompare(b.fromRole);
    if (a.label !== b.label) return a.label.localeCompare(b.label);
    return a.toRole.localeCompare(b.toRole);
  });

  // Compute hash from canonical form
  const hash = shapeHash({ hash: '', objects: sortedObjects, arrows: sortedArrows });

  return { hash, objects: sortedObjects, arrows: sortedArrows };
}