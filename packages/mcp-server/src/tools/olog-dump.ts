import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore } from '@olog/core';

export function registerOlogDump(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_dump',
    {
      description:
        'Get a summary overview of the ontology log: element counts by kind, arrow counts by kind, and total counts. Useful for understanding what the olog knows about the codebase.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const counts = store.dumpCounts();
        const commitSha = store.commitSha();

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ commitSha, ...counts }, null, 2),
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
