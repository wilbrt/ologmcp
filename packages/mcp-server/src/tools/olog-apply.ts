import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore, type PlanOperation } from '@olog/core';
import { planStore } from './olog-plan.js';

const planOperationSchema = z.union([
  z.object({ kind: z.literal('rename'), target: z.string(), newName: z.string() }),
  z.object({ kind: z.literal('move'), target: z.string(), newModule: z.string() }),
  z.object({ kind: z.literal('addSymbol'), module: z.string(), name: z.string(), symbolKind: z.string() }),
  z.object({ kind: z.literal('removeSymbol'), target: z.string() }),
  z.object({ kind: z.literal('addArrow'), arrowKind: z.string(), src: z.string(), dst: z.string() }),
  z.object({ kind: z.literal('removeArrow'), arrowId: z.string() }),
]);

const planSchema = z.object({
  operations: z.array(planOperationSchema),
  hash: z.string(),
  rationale: z.string(),
});

export function registerOlogApply(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_apply',
    {
      description:
        'Apply a validated plan to the olog graph. The plan must have been created by olog_plan and the hash must match. Returns a summary of applied operations and change instructions.',
      inputSchema: z.object({
        plan: planSchema.describe('The plan object to apply, including its hash.'),
        planHash: z.string().describe('The expected hash of the plan. Must match plan.hash.'),
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async ({ plan, planHash }) => {
      try {
        const storedPlan = planStore.get(planHash);
        if (!storedPlan) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ ok: false, reason: 'Plan not found' }, null, 2),
              },
            ],
          };
        }

        if (planHash !== plan.hash) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ ok: false, reason: 'Hash mismatch' }, null, 2),
              },
            ],
          };
        }

        const result = store.applyPlan(plan.operations as unknown as PlanOperation[]);

        if (result.errors.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ ok: false, reason: result.errors.join('; ') }, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  summary: `Applied ${result.applied} operations, skipped ${result.skipped}`,
                  changes: result.changes,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: false, reason: message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
