import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore, type PlanOperation, renderPlan, applySourceEdits, rollback, reindexProject, getDefaultRegistry } from '@olog/core';
import { loadPlan } from './olog-plan-store.js';

export function registerOlogApply(server: McpServer, store: OlogStore, projectRoot?: string): void {
  server.registerTool(
    'olog_apply',
    {
      description:
        'Apply a validated plan to the olog graph. When render=true, also renders source-file edits and re-ingests. The plan must have been created by olog_plan. Supports rename, move, addSymbol, removeSymbol, addArrow, removeArrow, addReexport, amendType, and rewrite_body operations.',
      inputSchema: z.object({
        planHash: z.string().describe('Hash of the plan to apply, as returned by olog_plan.'),
        render: z.boolean().default(false).describe('When true, also render source-file edits and apply them to disk, then re-ingest.'),
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async ({ planHash, render }) => {
      try {
        if (!projectRoot) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ ok: false, reason: 'projectRoot is required to load plans' }, null, 2),
              },
            ],
          };
        }
        const storedPlan = loadPlan(planHash, projectRoot);
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

        const allOps = storedPlan.operations;
        const mechanicalOps = allOps.filter(op => op.kind !== 'rewrite_body');
        const rewriteBodyOps = allOps.filter((op): op is Extract<PlanOperation, { kind: 'rewrite_body' }> => op.kind === 'rewrite_body');
        const pendingDelegations = rewriteBodyOps.map(op => ({
          target: op.target,
          task: 'rewrite_body',
          rationale: op.rationale,
        }));

        const result = store.applyPlan(allOps);

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
        const renderResult = renderPlan(store, mechanicalOps, projectRoot);

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
                      reindexed: true,
                      note: 'Element IDs may have shifted due to re-ingestion. Re-query elements before subsequent operations.',
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
                      pendingDelegations,
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
                    reindexed: true,
                    note: 'Element IDs may have shifted due to re-ingestion. Re-query elements before subsequent operations.',
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
                    pendingDelegations,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // No source edits needed
        reindexProject(projectRoot, store, getDefaultRegistry());
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  reindexed: true,
                  note: 'Element IDs may have shifted due to re-ingestion. Re-query elements before subsequent operations.',
                  summary: `Applied ${result.applied} DB operations (no source edits needed)`,
                  dbChanges: result.changes,
                  warnings: renderResult.warnings,
                  pendingDelegations,
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