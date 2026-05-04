import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore, renderPlan } from '@olog/core';
import { loadPlan } from './olog-plan-store.js';

export function registerOlogRender(server: McpServer, store: OlogStore, projectRoot: string): void {
  server.registerTool(
    'olog_render',
    {
      description:
        'Preview the source-file edits that a validated plan would produce, without writing to disk. Returns SourceEdits grouped by file, with warnings for operations needing manual review.',
      inputSchema: z.object({
        planHash: z.string().describe('Hash of the validated plan to render (as returned by olog_plan)'),
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

        const result = renderPlan(store, plan.operations, projectRoot);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
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
    }
  );
}