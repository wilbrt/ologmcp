import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore } from '@olog/core';
import { evaluateConstraints, evaluatePathEquations } from '@olog/core';
import type { Violation } from '@olog/core';
import type { PlanOperation } from '@olog/core';
import { loadPlan } from './olog-plan-store.js';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fuzzyFindElement(
  store: OlogStore,
  target: string,
): Array<{ id: string; name: string; module: string | null; kind: string }> {
  const namePart = target.split(':').pop() ?? '';
  if (!namePart) return [];
  const candidates = store.queryElements({ nameRegex: `^${escapeRegex(namePart)}$`, limit: 10 });
  return candidates.map(e => ({ id: e.id, name: e.name, module: e.module, kind: e.kind }));
}

function notFoundMessage(target: string, context: string, candidates: Array<{ id: string; name: string; module: string | null; kind: string }>): string {
  if (candidates.length === 1) {
    const c = candidates[0]!;
    return `${context}: element not found: "${target}". Did you mean "${c.id}" (${c.kind} "${c.name}" in ${c.module ?? '(root)'})?`;
  }
  if (candidates.length > 1) {
    const list = candidates.map(c => `  "${c.id}" (${c.kind} "${c.name}" in ${c.module ?? '(root)'})`).join('\n');
    return `${context}: element not found: "${target}". Candidates by name:\n${list}`;
  }
  return `${context}: element not found: "${target}"`;
}

interface ProjectedElem {
  id: string;
  kind: string;
  name: string;
  module: string | null;
}

/**
 * Simulates the store state after applying a plan's operations.
 * Used so that validation checks operate on the post-plan state rather than
 * the current store, avoiding false positives (e.g. addArrow whose src is
 * created by an earlier addSymbol) and false negatives (e.g. removeSymbol
 * whose arrows are also removed in the same plan).
 */
class ProjectedState {
  private readonly addedElems = new Map<string, ProjectedElem>();
  private readonly removedElemIds = new Set<string>();
  readonly renames = new Map<string, string>();
  readonly moves = new Map<string, string>();
  private readonly addedArrIds = new Set<string>();
  private readonly removedArrIds = new Set<string>();

  constructor(private readonly store: OlogStore, ops: PlanOperation[]) {
    for (const op of ops) {
      if (op.kind === 'addSymbol') {
        const id = `projected:${op.module}:${op.symbolKind}:${op.name}`;
        this.addedElems.set(id, { id, kind: op.symbolKind, name: op.name, module: op.module });
      } else if (op.kind === 'removeSymbol') {
        this.removedElemIds.add(op.target);
      } else if (op.kind === 'rename') {
        this.renames.set(op.target, op.newName);
      } else if (op.kind === 'move') {
        this.moves.set(op.target, op.newModule);
      } else if (op.kind === 'addArrow') {
        this.addedArrIds.add(`${op.src}:${op.arrowKind}:${op.dst}`);
      } else if (op.kind === 'removeArrow') {
        this.removedArrIds.add(op.arrowId);
      } else if (op.kind === 'rewrite_body') {
        // no projected state change — body rewrites don't alter the graph structure
      } else if (op.kind === 'addReexport') {
        const id = `projected:${op.module}:other:${op.name}`;
        this.addedElems.set(id, { id, kind: 'other', name: op.name, module: op.module });
      }
    }
  }

  elemExists(id: string): boolean {
    if (this.removedElemIds.has(id)) return false;
    if (this.addedElems.has(id)) return true;
    return this.store.getElem(id) !== null;
  }

  arrowExists(id: string): boolean {
    if (this.removedArrIds.has(id)) return false;
    if (this.addedArrIds.has(id)) return true;
    return this.store.getArr(id) !== null;
  }

  /** Returns IDs of arrows that will still reference elemId after the plan runs. */
  survivingArrowsFor(elemId: string): string[] {
    const fromStore = [
      ...this.store.outgoing(elemId),
      ...this.store.incoming(elemId),
    ]
      .filter(a => !this.removedArrIds.has(a.id))
      .map(a => a.id);

    const fromPlan = [...this.addedArrIds].filter(arrId => {
      const parts = arrId.split(':');
      return parts[0] === elemId || parts[parts.length - 1] === elemId;
    });

    return [...new Set([...fromStore, ...fromPlan])];
  }

  /**
   * Returns true if any element OTHER than excludeId will have the given name
   * in the given module after the plan runs.
   */
  nameConflicts(name: string, module: string | null, excludeId: string): boolean {
    const stored = this.store.queryElements({
      nameRegex: `^${escapeRegex(name)}$`,
      limit: 500,
    });
    for (const e of stored) {
      if (e.id === excludeId) continue;
      if (this.removedElemIds.has(e.id)) continue;
      const effectiveName = this.renames.get(e.id) ?? e.name;
      const effectiveModule = this.moves.get(e.id) ?? e.module;
      if (effectiveName === name && effectiveModule === module) return true;
    }
    for (const added of this.addedElems.values()) {
      if (added.id === excludeId) continue;
      if (added.name === name && added.module === module) return true;
    }
    return false;
  }
}

export function registerOlogValidate(server: McpServer, store: OlogStore, projectRoot: string): void {
  server.registerTool(
    'olog_validate',
    {
      description:
        'Validate a plan against constraints. Returns {ok: true, plan} on success, or {ok: false, violations} on failure. Checks name uniqueness, referential integrity, path equations, and integrity constraints. All checks operate on the projected post-plan state, not the current store.',
      inputSchema: z.object({
        planHash: z
          .string()
          .describe('Hash of the plan to validate (as returned by olog_plan)'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ planHash }) => {
      try {
        const plan = loadPlan(planHash, projectRoot);
        if (!plan) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Plan not found: ${planHash}. Use olog_plan to create a plan first.`,
              },
            ],
            isError: true,
          };
        }

        const violations: Violation[] = [];
        const ops = plan.operations;
        const projected = new ProjectedState(store, ops);

        for (const op of ops) {
          if (op.kind === 'rename') {
            const existing = store.getElem(op.target);
            if (existing) {
              const effectiveModule = projected['moves'].get(op.target) ?? existing.module;
              if (projected.nameConflicts(op.newName, effectiveModule, op.target)) {
                violations.push({
                  id: crypto.randomUUID(),
                  kind: 'uniqueness',
                  humanMessage: `rename: "${op.newName}" would conflict with an existing element in module "${effectiveModule ?? '(root)'}"`,
                  involved: [op.target],
                });
              }
            }
          }

          if (op.kind === 'move') {
            if (!projected.elemExists(op.target)) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'notFound',
                humanMessage: notFoundMessage(op.target, 'move', fuzzyFindElement(store, op.target)),
                involved: [op.target],
              });
            }
          }

          if (op.kind === 'addSymbol') {
            if (projected.nameConflicts(op.name, op.module, `projected:${op.module}:${op.symbolKind}:${op.name}`)) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'uniqueness',
                humanMessage: `addSymbol: "${op.name}" (${op.symbolKind}) would conflict with an existing element in "${op.module}"`,
                involved: [],
              });
            }
          }

          if (op.kind === 'removeSymbol') {
            const surviving = projected.survivingArrowsFor(op.target);
            if (surviving.length > 0) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'referential',
                humanMessage: `removeSymbol: "${op.target}" would still have ${surviving.length} arrow(s) after the plan runs`,
                involved: [op.target, ...surviving],
              });
            }
          }

          if (op.kind === 'addArrow') {
            if (!projected.elemExists(op.src)) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'notFound',
                humanMessage: notFoundMessage(op.src, 'addArrow src', fuzzyFindElement(store, op.src)),
                involved: [op.src],
              });
            }
            if (!projected.elemExists(op.dst)) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'notFound',
                humanMessage: notFoundMessage(op.dst, 'addArrow dst', fuzzyFindElement(store, op.dst)),
                involved: [op.dst],
              });
            }
          }

          if (op.kind === 'removeArrow') {
            if (!projected.arrowExists(op.arrowId)) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'notFound',
                humanMessage: `removeArrow: arrow not found: "${op.arrowId}"`,
                involved: [op.arrowId],
              });
            }
          }

          if (op.kind === 'rewrite_body') {
            const elem = store.getElem(op.target);
            if (!elem) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'notFound',
                humanMessage: notFoundMessage(op.target, 'rewrite_body', fuzzyFindElement(store, op.target)),
                involved: [op.target],
              });
            } else if (!elem.span) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'constraint',
                humanMessage: `rewrite_body: element "${elem.name}" has no span — cannot locate its source`,
                involved: [op.target],
              });
            }
            // Warn if a conflicting removeSymbol or rename targets the same element
            const conflicts = ops.filter(
              o => o !== op && (o.kind === 'removeSymbol' || o.kind === 'rename') && 'target' in o && o.target === op.target
            );
            for (const conflict of conflicts) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'constraint',
                humanMessage: `rewrite_body: conflicts with "${conflict.kind}" on the same element "${op.target}"`,
                involved: [op.target],
              });
            }
          }

          if (op.kind === 'amendType') {
            if (!projected.elemExists(op.target)) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'notFound',
                humanMessage: notFoundMessage(op.target, 'amendType', fuzzyFindElement(store, op.target)),
                involved: [op.target],
              });
            }
          }

          if (op.kind === 'addReexport') {
            const moduleExists = store.queryElements({
              moduleRegex: `^${escapeRegex(op.module)}$`,
              limit: 1,
            });
            if (moduleExists.length === 0) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'notFound',
                humanMessage: `addReexport: module not found: "${op.module}"`,
                involved: [],
              });
            } else if (projected.nameConflicts(op.name, op.module, '')) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'uniqueness',
                humanMessage: `addReexport: "${op.name}" would conflict with an existing element in "${op.module}"`,
                involved: [],
              });
            }
          }
        }

        const equationResult = evaluatePathEquations(store, ops);
        violations.push(...equationResult.violations);

        const constraintResult = evaluateConstraints(store, ops);
        violations.push(...constraintResult.violations);

        if (violations.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ ok: true, plan }, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: false, violations }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}