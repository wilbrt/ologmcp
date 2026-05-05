import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore, type OlogElem } from '@olog/core';

export function registerOlogWs(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_ws_open',
    {
      description: 'Open a new working set for the current planning session. Returns a setId to pass to olog_ws_add and olog_ws_query. Call once at the start of Phase 1.',
      inputSchema: z.object({
        name: z.string().describe('Human-readable name for this working set (e.g. "refactor-auth-plan")'),
        planHash: z.string().optional().describe('Plan hash to associate with this working set'),
      }),
      annotations: { idempotentHint: false },
    },
    async (args) => {
      try {
        const setId = store.createWorkingSet(args.name, args.planHash);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ setId }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'olog_ws_add',
    {
      description: 'Add elements and/or arrows to an open working set. Pass the IDs returned by olog_query, olog_inspect, or olog_explore. Deduplicates automatically.',
      inputSchema: z.object({
        setId: z.string().describe('Working set ID returned by olog_ws_open'),
        elementIds: z.array(z.string()).default([]).describe('Element IDs to add'),
        arrowIds: z.array(z.string()).default([]).describe('Arrow IDs to add'),
      }),
      annotations: { idempotentHint: true },
    },
    async (args) => {
      try {
        const result = store.addToWorkingSet(args.setId, args.elementIds, args.arrowIds);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'olog_ws_query',
    {
      description: 'Query the accumulated working set. Mirrors olog_query filters. Check this before calling olog_explore — if the element is already here, skip the explore call.',
      inputSchema: z.object({
        setId: z.string().describe('Working set ID'),
        kind: z.string().optional().describe('Filter by element kind'),
        nameRegex: z.string().optional().describe('Regex filter on element name'),
        moduleRegex: z.string().optional().describe('Regex filter on element module'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        const ws = store.getWorkingSet(args.setId);
        if (!ws) {
          return { content: [{ type: 'text' as const, text: `Working set "${args.setId}" not found` }], isError: true };
        }
        let elements: OlogElem[] = ws.elements;
        if (args.kind) elements = elements.filter((e: OlogElem) => e.kind === args.kind);
        if (args.nameRegex) { const re = new RegExp(args.nameRegex); elements = elements.filter((e: OlogElem) => re.test(e.name)); }
        if (args.moduleRegex) { const re = new RegExp(args.moduleRegex); elements = elements.filter((e: OlogElem) => e.module != null && re.test(e.module)); }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ elements, arrows: ws.arrows }, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'olog_ws_drop',
    {
      description: 'Delete a working set when the planning session is complete.',
      inputSchema: z.object({
        setId: z.string().describe('Working set ID to delete'),
      }),
      annotations: { idempotentHint: true },
    },
    async (args) => {
      try {
        store.deleteWorkingSet(args.setId);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );
}
