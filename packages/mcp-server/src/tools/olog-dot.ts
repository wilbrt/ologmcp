import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore } from '@olog/core';

function dotId(name: string): string {
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function registerOlogDot(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_dot',
    {
      description:
        'Export domain objects and arrows as a Graphviz DOT graph. Returns a DOT string you can render with `dot -Tsvg` or paste into an online Graphviz renderer. By default includes only elements of kind "domain"; pass additionalKinds to widen the scope.',
      inputSchema: z.object({
        additionalKinds: z
          .array(z.string())
          .default([])
          .describe('Extra element kinds to include alongside "domain" elements (e.g. ["type", "interface"])'),
        nameRegex: z
          .string()
          .optional()
          .describe('Regex to filter element names (e.g. "^Order")'),
        moduleRegex: z
          .string()
          .optional()
          .describe('Regex to filter by module path'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ additionalKinds, nameRegex, moduleRegex }) => {
      try {
        const kinds = ['domain', ...additionalKinds];
        const allElems = kinds.flatMap((kind) =>
          store.queryElements({
            kind,
            ...(nameRegex !== undefined ? { nameRegex } : {}),
            ...(moduleRegex !== undefined ? { moduleRegex } : {}),
            limit: 10000,
          })
        );

        const elemIds = new Set(allElems.map((e) => e.id));
        const elemById = new Map(allElems.map((e) => [e.id, e]));

        const lines: string[] = ['digraph olog {', '  rankdir=LR;', '  node [shape=box];', ''];

        for (const elem of allElems) {
          const label = elem.module ? `${elem.name}\\n[${elem.module}]` : elem.name;
          lines.push(`  ${dotId(elem.id)} [label=${dotId(label)}];`);
        }

        lines.push('');

        const seenArrows = new Set<string>();
        for (const elem of allElems) {
          for (const arr of store.outgoing(elem.id)) {
            if (!elemIds.has(arr.dstId)) continue;
            if (seenArrows.has(arr.id)) continue;
            seenArrows.add(arr.id);
            lines.push(`  ${dotId(elem.id)} -> ${dotId(arr.dstId)} [label=${dotId(arr.kind)}];`);
          }
        }

        lines.push('}');

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
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
