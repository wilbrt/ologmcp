import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore } from '@olog/core';
import { evaluateConstraints, evaluatePathEquations } from '@olog/core';
import type { Violation } from '@olog/core';
import { planStore } from './olog-plan.js';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function registerOlogValidate(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_validate',
    {
      description:
        'Validate a plan against constraints. Returns {ok: true, plan} on success, or {ok: false, violations} on failure. Checks name uniqueness, referential integrity, path equations, and integrity constraints.',
      inputSchema: z.object({
        planHash: z
          .string()
          .describe('Hash of the plan to validate (as returned by olog_plan)'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ planHash }) => {
      try {
        const plan = planStore.get(planHash);
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

        for (const op of plan.operations) {
          if (op.kind === 'rename') {
            const existing = store.getElem(op.target);
            if (existing) {
              const candidates = store.queryElements({
                nameRegex: `^${escapeRegex(op.newName)}$`,
                limit: 100,
              });
              const conflicting = candidates.filter(
                (e) =>
                  e.id !== op.target &&
                  e.name === op.newName &&
                  e.module === existing.module,
              );
              if (conflicting.length > 0) {
                violations.push({
                  id: crypto.randomUUID(),
                  kind: 'uniqueness',
                  humanMessage: `Rename would create duplicate: "${op.newName}" already exists in module "${existing.module ?? '(root)'}"`,
                  involved: [op.target, ...conflicting.map((e) => e.id)],
                });
              }
            }
          }
        }

        for (const op of plan.operations) {
          if (op.kind === 'removeSymbol') {
            const outgoing = store.outgoing(op.target);
            const incoming = store.incoming(op.target);
            const allArrows = [...outgoing, ...incoming];
            if (allArrows.length > 0) {
              violations.push({
                id: crypto.randomUUID(),
                kind: 'referential',
                humanMessage: `Removing element "${op.target}" would orphan ${allArrows.length} arrow(s)`,
                involved: [op.target, ...allArrows.map((a) => a.id)],
              });
            }
          }
        }

        const equationResult = evaluatePathEquations(store, plan.operations as unknown as import('@olog/core').PlanOperation[]);
        violations.push(...equationResult.violations);

        const constraintResult = evaluateConstraints(store, plan.operations as unknown as import('@olog/core').PlanOperation[]);
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