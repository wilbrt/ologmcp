import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore } from '@olog/core';

export function registerOlogInspect(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_inspect',
    {
      description:
        'Get detailed information about a specific element by ID, including all its outgoing and incoming arrows (connections to other elements).',
      inputSchema: z.object({
        id: z
          .string()
          .describe('Element ID to inspect. Get IDs from olog_query results.'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      try {
        const element = store.getElem(id);
        if (!element) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Element not found: ${id}`,
              },
            ],
            isError: true,
          };
        }

        const outgoing = store.outgoing(id);
        const incoming = store.incoming(id);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ element, outgoing, incoming }, null, 2),
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
