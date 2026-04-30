import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore, reindexProject, ingestChangedFiles, getDefaultRegistry } from '@olog/core';

export function registerOlogReindex(
  server: McpServer,
  store: OlogStore,
  projectRoot: string
): void {
  server.registerTool(
    'olog_reindex',
    {
      description:
        'Refresh the structural model after code changes. ' +
        'mode="incremental" (default) processes only new and git-changed files — fast for routine use after editing. ' +
        'mode="full" drops and rebuilds everything from scratch — use when the olog seems stale or after large refactors.',
      inputSchema: z.object({
        mode: z
          .enum(['incremental', 'full'])
          .default('incremental')
          .describe(
            '"incremental" processes only new/changed files (fast). ' +
            '"full" wipes and rebuilds the entire index (slow but guaranteed fresh).'
          ),
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
      },
    },
    async ({ mode }) => {
      try {
        const registry = getDefaultRegistry();
        const result = mode === 'full'
          ? reindexProject(projectRoot, store, registry)
          : ingestChangedFiles(projectRoot, store, registry);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ mode, ...result }, null, 2),
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
