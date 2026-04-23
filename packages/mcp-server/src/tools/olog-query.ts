import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore } from '@olog/core';

export function registerOlogQuery(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_query',
    {
      description:
        'Query the ontology log for structural elements matching filters. Returns elements with their kind, name, module (file path), and span (location).',
      inputSchema: z.object({
        kind: z
          .enum([
            'file',
            'module',
            'symbol',
            'callsite',
            'import',
            'type',
            'interface',
            'class',
            'enum',
            'function',
            'method',
            'const',
            'var',
            'namespace',
            'any',
          ])
          .default('any')
          .describe("Element kind to filter by. Use 'any' to match all kinds."),
        name: z
          .string()
          .optional()
          .describe(
            "Regex pattern matched against element name. Examples: '^handle', 'User', 'Button$'"
          ),
        module: z
          .string()
          .optional()
          .describe(
            "Regex pattern matched against module (relative file path). Examples: 'src/components', 'utils/'"
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe('Maximum number of results to return'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ kind, name, module, limit }) => {
      try {
        const opts: { kind?: string; nameRegex?: string; moduleRegex?: string; limit: number } = {
          limit,
        };
        if (kind !== 'any') opts.kind = kind;
        if (name !== undefined) opts.nameRegex = name;
        if (module !== undefined) opts.moduleRegex = module;
        const rows = store.queryElements(opts);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No elements found matching criteria',
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(rows, null, 2),
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
