import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore } from '@olog/core';

function dotId(name: string): string {
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function registerOlogDotDomain(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_dot_domain',
    {
      description:
        'Export the domain subgraph as Graphviz DOT for debugging the spec. Returns a DOT string renderable with `dot -Tsvg`. Scoped to "domain" elements only; pass setId to overlay the working-set synthetic arrows on top.',
      inputSchema: z.object({
        setId: z
          .string()
          .optional()
          .describe('Working set ID — when provided, synthetic arrows from that set are included in the graph'),
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
    async ({ setId, nameRegex, moduleRegex }) => {
      try {
        const allElems = store.queryElements({
          kind: 'domain',
          ...(nameRegex !== undefined ? { nameRegex } : {}),
          ...(moduleRegex !== undefined ? { moduleRegex } : {}),
          limit: 10000,
        });

        const elemIds = new Set(allElems.map((e) => e.id));

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

        if (setId) {
          const graph = store.queryWorkingSetGraph(setId, {});
          for (const arr of graph.syntheticArrows) {
            if (!arr.dstId) continue;
            const id = `syn_${arr.id}`;
            if (seenArrows.has(id)) continue;
            seenArrows.add(id);
            lines.push(`  ${dotId(arr.srcId)} -> ${dotId(arr.dstId)} [label=${dotId(arr.kind)} style=dashed color=blue];`);
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
