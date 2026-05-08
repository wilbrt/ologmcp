import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore } from '@olog/core';

export function registerOlogOverview(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_overview',
    {
      description:
        'Get a summary overview of the ontology log: element counts by kind, arrow counts by kind, total counts, and all domain elements (name+id). Call this first for orientation before querying or planning.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const counts = store.dumpCounts();
        const commitSha = store.commitSha();
        const domainElems = store.queryElements({ kind: 'domain', limit: 200 });
        const domainElements = domainElems.map(e => ({ id: e.id, name: e.name, module: e.module }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ commitSha, ...counts, domainElements }, null, 2),
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
