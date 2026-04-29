import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore, reindexProject, getDefaultRegistry } from '@olog/core';

export function registerOlogReindex(
  server: McpServer,
  store: OlogStore,
  projectRoot: string
): void {
  server.registerTool(
    'olog_reindex',
    {
      description:
        'Force a full re-ingestion of the codebase. Use this after code changes to refresh the structural model. This drops all existing elements and rebuilds from scratch.',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async () => {
      try {
        const result = reindexProject(projectRoot, store, getDefaultRegistry());
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
        const stack = err instanceof Error ? (err.stack ?? '') : '';
        return {
          content: [
            { type: 'text' as const, text: `Reindex failed: ${message}\n${stack}` },
          ],
          isError: true,
        };
      }
    }
  );
}
