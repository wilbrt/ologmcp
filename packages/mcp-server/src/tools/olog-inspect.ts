import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore, SourceResolver, filePathFromSpan } from '@olog/core';

export function registerOlogInspect(server: McpServer, store: OlogStore, projectRoot: string): void {
  server.registerTool(
    'olog_inspect',
    {
      description:
        'Get detailed information about a specific element by ID, including all its outgoing and incoming arrows (connections to other elements) and the source snippet of its body read directly from the file at its stored span. Use this instead of reading raw source files to understand what a function does.',
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

        const outgoing = [...store.outgoing(id), ...store.outgoingDerived(id)];
        const incoming = store.incoming(id);

        const prov = store.getProvenance(id);
        const provenance = prov ? [prov] : [];

        const equations = store.getEquationsForObject(id);

        const allConstraints = store.getConstraints();
        const elemKind = element.kind;
        const elemModule = element.module ?? '';
        const constraints = allConstraints.filter(c => {
          if (!c.config || Object.keys(c.config).length === 0) return true;
          const configStr = JSON.stringify(c.config);
          return configStr.includes(elemKind) || configStr.includes(elemModule);
        });

        // Resolve source snippet from stored span
        let sourceSnippet: string | null = null;
        if (element.span) {
          const filePath = filePathFromSpan(element.span) ?? element.module ?? '';
          if (filePath) {
            const resolver = new SourceResolver(projectRoot);
            sourceSnippet = resolver.readFocused(filePath, element.span, 0, 0)
              ?? resolver.readSpan(filePath, element.span);
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { element, sourceSnippet, outgoing, incoming, provenance, equations, constraints },
                null,
                2
              ),
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
