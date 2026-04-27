import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore, type PlanOperation, renderPlan, applySourceEdits, rollback, reindexProject, getDefaultRegistry } from '@olog/core';
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

export function registerOlogApply(server: McpServer, store: OlogStore, projectRoot?: string): void {
  server.registerTool(
    'olog_apply',
    {
      description:
        'Apply a validated plan to the olog graph. When render=true, also renders source-file edits and re-ingests. The plan must have been created by olog_plan and the hash must match.',
      inputSchema: z.object({
        plan: planSchema.describe('The plan object to apply, including its hash.'),
        planHash: z.string().describe('The expected hash of the plan. Must match plan.hash.'),
        render: z.boolean().default(false).describe('When true, also render source-file edits and apply them to disk, then re-ingest.'),
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async ({ plan, planHash, render }) => {
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

        if (!render || !projectRoot) {
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
        }

        // Render mode: compute source edits and apply them
        const renderResult = renderPlan(store, plan.operations as unknown as PlanOperation[], projectRoot);

        if (renderResult.edits.length > 0) {
          const applyResult = await applySourceEdits(renderResult.edits, projectRoot);

          if (applyResult.errors.length > 0) {
            // Roll back
            await rollback(applyResult.snapshots, projectRoot);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    {
                      ok: false,
                      reason: 'Source edit errors, rolled back',
                      dbResult: result,
                      editErrors: applyResult.errors,
                      renderWarnings: renderResult.warnings,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          // Re-ingest to verify
          try {
            reindexProject(projectRoot, store, getDefaultRegistry());
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    {
                      ok: true,
                      summary: `Applied ${result.applied} DB operations and ${applyResult.applied} source edits`,
                      dbChanges: result.changes,
                      sourceEdits: renderResult.edits.map(e => ({
                        file: e.filePath,
                        label: e.label,
                        oldText: e.oldText,
                        newText: e.newText,
                      })),
                      warnings: renderResult.warnings,
                      reingestWarning: `Re-ingest failed: ${msg}`,
                    },
                    null,
                    2
                  ),
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
                    summary: `Applied ${result.applied} DB operations and ${applyResult.applied} source edits`,
                    dbChanges: result.changes,
                    sourceEdits: renderResult.edits.map(e => ({
                      file: e.filePath,
                      label: e.label,
                      oldText: e.oldText,
                      newText: e.newText,
                    })),
                    warnings: renderResult.warnings,
                    affectedFiles: applyResult.affectedFiles,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // No source edits needed
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  summary: `Applied ${result.applied} DB operations (no source edits needed)`,
                  dbChanges: result.changes,
                  warnings: renderResult.warnings,
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
