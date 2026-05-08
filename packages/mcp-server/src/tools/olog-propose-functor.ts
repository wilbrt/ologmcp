import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore } from '@olog/core';

const DomainBriefElementSchema = z.object({
  id: z.string().describe('Brief-local identifier for this element'),
  name: z.string().describe('Name to match against olog elements'),
  kind: z.string().default('domain').describe('Olog element kind to search (default: "domain")'),
  description: z.string().optional().describe('Human description of this concept'),
});

const DomainBriefSchema = z.object({
  id: z.string().describe('Brief identifier — passed back in originBriefRef on DelegationBriefs'),
  elements: z.array(DomainBriefElementSchema).describe('Domain concepts to map to code elements'),
});

type Mapping = 'existing' | 'to-create' | 'ambiguous';

interface MappingEntry {
  briefElementId: string;
  briefElementName: string;
  mapping: Mapping;
  ologElementId?: string;
  implementedByIds?: string[];
  syntheticArrowId?: string;
  candidates?: Array<{ id: string; name: string; module: string | null }>;
}

export function registerOlogProposeFunctor(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_propose_functor',
    {
      description:
        'Map each element in a DomainBrief to either an existing olog element (existing), a missing element that must be created (to-create), or multiple ambiguous matches. For each existing match, asserts a proposedImplementation synthetic arrow into the working set. Returns the full mapping and the resulting working-set subgraph.',
      inputSchema: z.object({
        setId: z.string().describe('Working set ID — proposedImplementation arrows are written here'),
        brief: DomainBriefSchema.describe('DomainBrief produced by the elicit agent or authored manually'),
      }),
      annotations: { idempotentHint: false },
    },
    async ({ setId, brief }) => {
      try {
        const mappings: MappingEntry[] = [];

        for (const el of brief.elements) {
          const matches = store.queryElements({ kind: el.kind, nameRegex: `^${escapeRegex(el.name)}$`, limit: 10 });

          if (matches.length === 0) {
            mappings.push({ briefElementId: el.id, briefElementName: el.name, mapping: 'to-create' });
            continue;
          }

          if (matches.length > 1) {
            mappings.push({
              briefElementId: el.id,
              briefElementName: el.name,
              mapping: 'ambiguous',
              candidates: matches.map(m => ({ id: m.id, name: m.name, module: m.module ?? null })),
            });
            continue;
          }

          const found = matches[0]!;
          const implementedByArrows = store.outgoing(found.id).filter(a => a.kind === 'implementedAs');
          const implementedByIds = implementedByArrows.map(a => a.dstId);

          const dstId = implementedByIds[0] ?? undefined;
          const arrowId = store.assertSyntheticArrow(
            setId,
            found.id,
            dstId,
            'proposedImplementation',
            'propose_functor',
            JSON.stringify({ briefElementId: el.id, mapping: 'existing', implementedByCount: implementedByIds.length }),
          );

          mappings.push({
            briefElementId: el.id,
            briefElementName: el.name,
            mapping: 'existing',
            ologElementId: found.id,
            implementedByIds,
            syntheticArrowId: arrowId,
          });
        }

        const graph = store.queryWorkingSetGraph(setId, { source: 'propose_functor' });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ briefId: brief.id, mappings, graph }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
