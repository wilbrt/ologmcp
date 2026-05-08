import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore, type SyntheticArr } from '@olog/core';

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
      description: 'Query the working set as a graph. Without arrows/direction: returns accumulated elements, real arrows, and synthetic arrows. With arrows/direction: performs one-hop traversal from matching seed elements through both main olog arrows and synthetic arrows, returning the reachable subgraph. Synthetic arrows (synthetic: true) are inferences asserted by explore agents. Check this before calling olog_explore — skip the explore call if the element is already here.',
      inputSchema: z.object({
        setId: z.string().describe('Working set ID'),
        kind: z.string().optional().describe('Filter seed elements by kind'),
        nameRegex: z.string().optional().describe('Regex filter on element name'),
        moduleRegex: z.string().optional().describe('Regex filter on element module'),
        arrows: z.array(z.string()).optional().describe('Arrow kinds to follow for traversal (e.g. ["callerOf", "calls", "structurallyDependsOn"])'),
        direction: z.enum(['in', 'out']).optional().describe('Traversal direction: "out" follows arrows where seed is source, "in" follows arrows where seed is destination'),
        includeAnnotations: z.boolean().optional().describe('Include annotations on elements and arrows'),
        source: z.string().optional().describe('Filter synthetic arrows by source (e.g. "orient", "orchestrate", "implement", "elicit", "propose_functor", "legacy")'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        const graphOpts: Parameters<typeof store.queryWorkingSetGraph>[1] = {};
        if (args.kind !== undefined) graphOpts.kind = args.kind;
        if (args.nameRegex !== undefined) graphOpts.nameRegex = args.nameRegex;
        if (args.moduleRegex !== undefined) graphOpts.moduleRegex = args.moduleRegex;
        if (args.arrows !== undefined) graphOpts.arrows = args.arrows;
        if (args.direction !== undefined) graphOpts.direction = args.direction;
        if (args.includeAnnotations !== undefined) graphOpts.includeAnnotations = args.includeAnnotations;
        if (args.source !== undefined) graphOpts.source = args.source;
        const graph = store.queryWorkingSetGraph(args.setId, graphOpts);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(graph, null, 2) }],
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

  server.registerTool(
    'olog_ws_assert',
    {
      description: 'Assert a synthetic arrow into the working set — an inferred structural relationship not yet modeled as a real olog arrow. Use when you discover a relationship through querying (e.g. a de facto dependency, a gateway pattern, an unmodeled implementedAs) that would be lost if only stored in prose. Synthetic arrows appear in olog_ws_query traversal results with synthetic: true.',
      inputSchema: z.object({
        setId: z.string().describe('Working set ID'),
        srcId: z.string().describe('Source element ID (must exist in olog_elem)'),
        dstId: z.string().optional().describe('Destination element ID (must exist in olog_elem). Omit when the dependency was discovered but its olog element ID is unknown.'),
        kind: z.string().describe('Arrow kind — free-text, e.g. "structurallyDependsOn", "gatekeepedBy", "coordinatesWith", or a standard ArrowKind you verified empirically'),
        source: z.enum(['elicit', 'orient', 'orchestrate', 'implement', 'propose_functor', 'legacy']).describe('Which agent role asserted this arrow'),
        note: z.string().optional().describe('Explanation of why this relationship holds — what evidence supports this inference'),
      }),
      annotations: { idempotentHint: false },
    },
    async (args) => {
      try {
        const id = store.assertSyntheticArrow(args.setId, args.srcId, args.dstId, args.kind, args.source, args.note);
        const result: SyntheticArr = { id, setId: args.setId, kind: args.kind, srcId: args.srcId, dstId: args.dstId ?? null, note: args.note ?? null, source: args.source, synthetic: true };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'olog_ws_annotate',
    {
      description: 'Attach, update, or delete a note on a working set element or arrow. When delete is true, removes the annotation. Otherwise, upserts the note text (replaces any existing note for the same target).',
      inputSchema: z.object({
        setId: z.string().describe('Working set ID'),
        targetId: z.string().describe('ID of the element or arrow to annotate'),
        note: z.string().describe('Note text to attach'),
        delete: z.boolean().default(false).describe('When true, removes the annotation'),
      }),
      annotations: { idempotentHint: true },
    },
    async (args) => {
      try {
        if (args.delete) {
          store.deleteAnnotation(args.setId, args.targetId);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] };
        }
        const result = store.annotateWorkingSet(args.setId, args.targetId, args.note);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'olog_ws_pause',
    {
      description: 'Pause a working set to preserve it across a plan revision. A paused set is still queryable but signals that the orchestrator is mid-revision. Use instead of olog_ws_drop when a briefDelta arrives during execution.',
      inputSchema: z.object({
        setId: z.string().describe('Working set ID to pause'),
      }),
      annotations: { idempotentHint: true },
    },
    async (args) => {
      try {
        store.pauseWorkingSet(args.setId);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, status: 'paused' }) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'olog_ws_resume',
    {
      description: 'Resume a paused working set after a plan revision is confirmed. The set returns to active status and execution can continue.',
      inputSchema: z.object({
        setId: z.string().describe('Working set ID to resume'),
      }),
      annotations: { idempotentHint: true },
    },
    async (args) => {
      try {
        store.resumeWorkingSet(args.setId);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, status: 'active' }) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'olog_ws_resolve_synthetic',
    {
      description: 'Resolve a synthetic arrow whose dstId was unknown at assert time. Promotes the arrow from pending (dstId: null) to fully resolved by setting the destination element ID.',
      inputSchema: z.object({
        arrowId: z.string().describe('Synthetic arrow ID (returned by olog_ws_assert)'),
        dstId: z.string().describe('Destination element ID — must exist in olog_elem'),
      }),
      annotations: { idempotentHint: false },
    },
    async (args) => {
      try {
        store.resolveSyntheticArrow(args.arrowId, args.dstId);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, arrowId: args.arrowId, dstId: args.dstId }) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );
}

export function registerOlogWsAssertOnly(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_ws_assert',
    {
      description: 'Assert a synthetic arrow into the working set. Records a dependency discovered during implementation that was not listed in the DelegationBrief.',
      inputSchema: z.object({
        setId: z.string().describe('Working set ID from the DelegationBrief'),
        srcId: z.string().describe('Source element ID'),
        dstId: z.string().optional().describe('Destination element ID — omit if not in olog'),
        kind: z.string().describe('Arrow kind, e.g. "discoveredDependency"'),
        source: z.enum(['elicit', 'orient', 'orchestrate', 'implement', 'propose_functor', 'legacy']).describe('Which agent role asserted this arrow'),
        note: z.string().optional().describe('Why this dependency was needed'),
      }),
      annotations: { idempotentHint: false },
    },
    async (args) => {
      try {
        const id = store.assertSyntheticArrow(args.setId, args.srcId, args.dstId, args.kind, args.source, args.note);
        const result: SyntheticArr = { id, setId: args.setId, kind: args.kind, srcId: args.srcId, dstId: args.dstId ?? null, note: args.note ?? null, source: args.source, synthetic: true };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );
}