import { OlogStore } from './db.js';
import type {
  PathEquation,
  PlanOperation,
  IntegrityConstraint,
  ConfidenceLevel,
  OlogElem,
} from './ontology.js';
import { randomUUID } from 'node:crypto';

export interface Violation {
  id: string;
  kind: string;
  humanMessage: string;
  involved: string[];
}

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  tentative: 0,
  unresolved: 1,
  resolved: 2,
};

export function evaluateConstraints(
  store: OlogStore,
  _operations: PlanOperation[],
): { valid: boolean; violations: Violation[] } {
  const violations: Violation[] = [];
  const constraints = store.getConstraints();

  for (const constraint of constraints) {
    violations.push(...evaluateConstraint(store, constraint));
  }

  return { valid: violations.length === 0, violations };
}

function evaluateConstraint(
  store: OlogStore,
  constraint: IntegrityConstraint,
): Violation[] {
  switch (constraint.kind) {
    case 'existence':
      return evaluateExistence(store, constraint);
    case 'layering':
      return evaluateLayering(store, constraint);
    case 'monotonicity':
      return evaluateMonotonicity(store, constraint);
    case 'totality':
      return evaluateTotality(store, constraint);
    default:
      return [];
  }
}

// existence: at least one element of the configured kind must exist
function evaluateExistence(
  store: OlogStore,
  constraint: IntegrityConstraint,
): Violation[] {
  const kind = constraint.config.kind as string | undefined;
  if (!kind) return [];

  const elements = store.queryElements({ kind, limit: 1 });
  if (elements.length > 0) return [];

  return [
    {
      id: randomUUID(),
      kind: 'integrity',
      humanMessage:
        constraint.message ??
        `Existence constraint "${constraint.name}" violated: no elements of kind "${kind}" exist`,
      involved: [],
    },
  ];
}

// layering: modules in lower layers must not reference modules in higher layers
function evaluateLayering(
  store: OlogStore,
  constraint: IntegrityConstraint,
): Violation[] {
  const rawLayers = constraint.config.layers as string[][] | undefined;
  if (!rawLayers || rawLayers.length === 0) return [];
  const layers: string[][] = rawLayers;

  const violations: Violation[] = [];

  function layerIndexOf(mod: string | null): number | null {
    if (mod == null) return null;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer) continue;
      for (const pattern of layer) {
        if (new RegExp(pattern).test(mod)) return i;
      }
    }
    return null;
  }

  const allElems = store.queryElements({ kind: 'any', limit: 50000 });
  for (const elem of allElems) {
    const srcLayer = layerIndexOf(elem.module);
    if (srcLayer === null) continue;

    const outgoing = store.outgoing(elem.id);
    for (const arr of outgoing) {
      const dstElem = store.getElem(arr.dstId);
      if (!dstElem) continue;
      const dstLayer = layerIndexOf(dstElem.module);
      if (dstLayer === null) continue;

      if (srcLayer < dstLayer) {
        violations.push({
          id: randomUUID(),
          kind: 'integrity',
          humanMessage:
            constraint.message ??
            `Layering constraint "${constraint.name}" violated: "${elem.name}" (layer ${srcLayer}) references "${dstElem.name}" (layer ${dstLayer})`,
          involved: [elem.id, dstElem.id],
        });
      }
    }
  }

  return violations;
}

// monotonicity: derived facts must not have higher confidence than their sources
function evaluateMonotonicity(
  store: OlogStore,
  constraint: IntegrityConstraint,
): Violation[] {
  const violations: Violation[] = [];

  const allElems = store.queryElements({ kind: 'any', limit: 50000 });
  for (const elem of allElems) {
    const srcProv = store.getProvenance(elem.id);
    if (!srcProv) continue;

    const outgoing = store.outgoing(elem.id);
    for (const arr of outgoing) {
      const dstProv = store.getProvenance(arr.dstId);
      if (!dstProv) continue;

      if (CONFIDENCE_RANK[dstProv.confidence] > CONFIDENCE_RANK[srcProv.confidence]) {
        const dstElem = store.getElem(arr.dstId);
        violations.push({
          id: randomUUID(),
          kind: 'integrity',
          humanMessage:
            constraint.message ??
            `Monotonicity constraint "${constraint.name}" violated: "${elem.name}" (${srcProv.confidence}) → "${dstElem?.name ?? arr.dstId}" (${dstProv.confidence})`,
          involved: [elem.id, arr.dstId],
        });
      }
    }
  }

  return violations;
}

// totality: every element of domainKind must have exactly one outgoing arrow of arrowKind
function evaluateTotality(
  store: OlogStore,
  constraint: IntegrityConstraint,
): Violation[] {
  const arrowKind = constraint.config.arrowKind as string | undefined;
  const domainKind = constraint.config.domainKind as string | undefined;
  if (!arrowKind || !domainKind) return [];

  const violations: Violation[] = [];
  const domainElems = store.queryElements({ kind: domainKind, limit: 50000 });

  for (const elem of domainElems) {
    const outgoing = store.outgoing(elem.id);
    const matching = outgoing.filter((a) => a.kind === arrowKind);

    if (matching.length === 0) {
      violations.push({
        id: randomUUID(),
        kind: 'integrity',
        humanMessage:
          constraint.message ??
          `Totality constraint "${constraint.name}" violated: "${elem.name}" has no outgoing "${arrowKind}" arrow`,
        involved: [elem.id],
      });
    } else if (matching.length > 1) {
      violations.push({
        id: randomUUID(),
        kind: 'integrity',
        humanMessage:
          constraint.message ??
          `Totality constraint "${constraint.name}" violated: "${elem.name}" has ${matching.length} outgoing "${arrowKind}" arrows (expected exactly 1)`,
        involved: [elem.id, ...matching.map((a) => a.id)],
      });
    }
  }

  return violations;
}

export function evaluatePathEquations(
  store: OlogStore,
  _operations: PlanOperation[],
): { valid: boolean; violations: Violation[] } {
  const violations: Violation[] = [];
  const equations = store.getEquations();

  for (const eq of equations) {
    const result = evaluateEquation(eq, store);
    if (!result.valid) {
      violations.push({
        id: randomUUID(),
        kind: 'equation',
        humanMessage: result.message,
        involved: result.involved,
      });
    }
  }

  return { valid: violations.length === 0, violations };
}

function isSchemaElement(elem: OlogElem): string | null {
  const schemaKind = (elem.attrs as Record<string, unknown> | null)?.schemaKind;
  if (typeof schemaKind === 'string') return schemaKind;
  if (elem.kind === 'other' && elem.module === null && elem.span === null) {
    const match = elem.name.match(/^(?:a|an)\s+(\S+)/);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

export function evaluateEquation(
  eq: PathEquation,
  store: OlogStore,
): { valid: boolean; involved: string[]; message: string } {
  const lhsSrc = store.getElem(eq.lhs.src);
  if (!lhsSrc) {
    return {
      valid: true,
      involved: [],
      message: `Equation "${eq.name}": source "${eq.lhs.src}" not in store, skipping`,
    };
  }

  const rhsSrc = store.getElem(eq.rhs.src);
  if (!rhsSrc) {
    return {
      valid: true,
      involved: [],
      message: `Equation "${eq.name}": source "${eq.rhs.src}" not in store, skipping`,
    };
  }

  const lhsSchemaKind = isSchemaElement(lhsSrc);
  if (lhsSchemaKind) {
    return evaluateSchemaEquation(eq, store, lhsSchemaKind);
  }

  return evaluateConcreteEquation(eq, store, lhsSrc.id);
}

function evaluateSchemaEquation(
  eq: PathEquation,
  store: OlogStore,
  schemaKind: string,
): { valid: boolean; involved: string[]; message: string } {
  const concreteElems = store.queryElements({ kind: schemaKind, limit: 50000 });
  if (concreteElems.length === 0) {
    return {
      valid: true,
      involved: [],
      message: `Equation "${eq.name}": no concrete elements of kind "${schemaKind}" found; skipping schema-level check`,
    };
  }

  const allInvolved: string[] = [];
  const allMessages: string[] = [];

  for (const elem of concreteElems) {
    const result = evaluateConcreteEquation(eq, store, elem.id);
    if (!result.valid) {
      allInvolved.push(...result.involved);
      allMessages.push(`  at "${elem.name}" (${elem.module ?? 'unknown'}): ${result.message}`);
    }
  }

  if (allMessages.length === 0) {
    return { valid: true, involved: [], message: '' };
  }

  return {
    valid: false,
    involved: [...new Set(allInvolved)],
    message: `Equation "${eq.name}" violated for kind "${schemaKind}":\n${allMessages.join('\n')}`,
  };
}

function evaluateConcreteEquation(
  eq: PathEquation,
  store: OlogStore,
  startId: string,
): { valid: boolean; involved: string[]; message: string } {
  const lhsSteps = eq.lhs.arrows.map((kind) => ({
    kind,
    direction: 'out' as const,
  }));
  const rhsSteps = eq.rhs.arrows.map((kind) => ({
    kind,
    direction: 'out' as const,
  }));

  const lhsReached = followPath(store, startId, lhsSteps);
  const rhsReached = followPath(store, startId, rhsSteps);

  const lhsIds = new Set(lhsReached.map((e) => e.id));
  const rhsIds = new Set(rhsReached.map((e) => e.id));

  const lhsOnly = [...lhsIds].filter((id) => !rhsIds.has(id));
  const rhsOnly = [...rhsIds].filter((id) => !lhsIds.has(id));

  if (lhsOnly.length === 0 && rhsOnly.length === 0) {
    return { valid: true, involved: [...lhsIds, ...rhsIds], message: '' };
  }

  const involved = [...new Set([...lhsIds, ...rhsIds])];
  const lhsNames = lhsReached
    .filter((e) => !rhsIds.has(e.id))
    .map((e) => e.name);
  const rhsNames = rhsReached
    .filter((e) => !lhsIds.has(e.id))
    .map((e) => e.name);

  let message = '';
  if (lhsNames.length > 0) {
    message += `LHS reaches [${lhsNames.join(', ')}] but RHS does not.`;
  }
  if (rhsNames.length > 0) {
    message += `RHS reaches [${rhsNames.join(', ')}] but LHS does not.`;
  }

  return { valid: false, involved, message };
}

function followPath(
  store: OlogStore,
  startId: string,
  steps: Array<{ kind: string; direction: 'in' | 'out' }>,
): OlogElem[] {
  if (steps.length === 0) {
    const elem = store.getElem(startId);
    return elem ? [elem] : [];
  }

  let currentIds = new Set<string>([startId]);

  for (const step of steps) {
    if (currentIds.size === 0) return [];

    const nextIds = new Set<string>();
    for (const id of currentIds) {
      const arrows =
        step.direction === 'out'
          ? store.outgoing(id)
          : store.incoming(id);

      for (const arr of arrows) {
        if (arr.kind !== step.kind) continue;
        const reachedId = step.direction === 'out' ? arr.dstId : arr.srcId;
        nextIds.add(reachedId);
      }
    }

    currentIds = nextIds;
  }

  // Only the final-step elements are relevant for equation checking.
  const result: OlogElem[] = [];
  for (const id of currentIds) {
    const elem = store.getElem(id);
    if (elem) result.push(elem);
  }
  return result;
}