import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore, isNounPhrase, validateEquation } from '@olog/core';
import type { PathEquation } from '@olog/core';

const objectSchema = z.object({
  kind: z.string().describe('Element kind'),
  name: z.string().describe('Element name (noun phrase)'),
  module: z.string().optional().describe('Optional module path'),
});

const arrowSchema = z.object({
  name: z.string().describe('Arrow kind/name'),
  domain: z.string().describe('Domain element name'),
  codomain: z.string().describe('Codomain element name'),
  total: z.boolean().describe('Whether this is a total function'),
});

const pathSchema = z.object({
  src: z.string().describe('Source element name'),
  tgt: z.string().describe('Target element name'),
  arrows: z.array(z.string()).describe('Sequence of arrow kinds'),
});

const equationSchema = z.object({
  id: z.string(),
  name: z.string(),
  humanMessage: z.string(),
  lhs: pathSchema,
  rhs: pathSchema,
});

export function registerOlogDomainDryrun(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_domain_dryrun',
    {
      description:
        'Validate a proposed schema fragment (objects, arrows, equations) without committing it to the olog. Returns {ok: true} if the proposal is consistent, or {ok: false, errors: [...]} if not. The elicit agent uses this to check "would this brief, if accepted, produce a valid schema?" between conversation turns.',
      inputSchema: z.object({
        objects: z
          .preprocess(v => typeof v === 'string' ? JSON.parse(v) : v, z.array(objectSchema))
          .default([])
          .describe('Proposed domain objects to validate'),
        arrows: z
          .preprocess(v => typeof v === 'string' ? JSON.parse(v) : v, z.array(arrowSchema))
          .default([])
          .describe('Proposed arrows to validate'),
        equations: z
          .preprocess(v => typeof v === 'string' ? JSON.parse(v) : v, z.array(equationSchema))
          .default([])
          .describe('Proposed path equations to validate'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ objects, arrows, equations }) => {
      try {
        const errors: string[] = [];
        const objectMap = new Map<string, { kind: string; name: string }>();

        for (const obj of objects) {
          if (!isNounPhrase(obj.name)) {
            errors.push(`Object "${obj.name}" is not a valid noun phrase (must start with uppercase after optional "a"/"an"/"the")`);
          }
          objectMap.set(obj.name, obj);
        }

        const proposedArrowKinds = new Set<string>();
        for (const arrow of arrows) {
          if (!arrow.total) {
            errors.push(`Arrow "${arrow.name}" is not total. Many-valued relationships must be reified before proposing.`);
            continue;
          }
          const domainExists =
            store.queryElements({ nameRegex: `^${escapeRegex(arrow.domain)}$`, limit: 1 }).length > 0 ||
            objectMap.has(arrow.domain);
          if (!domainExists) {
            errors.push(`Arrow "${arrow.name}": domain "${arrow.domain}" does not exist in olog or proposed objects`);
            continue;
          }
          const codomainExists =
            store.queryElements({ nameRegex: `^${escapeRegex(arrow.codomain)}$`, limit: 1 }).length > 0 ||
            objectMap.has(arrow.codomain);
          if (!codomainExists) {
            errors.push(`Arrow "${arrow.name}": codomain "${arrow.codomain}" does not exist in olog or proposed objects`);
            continue;
          }
          proposedArrowKinds.add(arrow.name);
        }

        for (const eq of equations) {
          const result = validateEquation(eq as PathEquation, store, Array.from(proposedArrowKinds));
          errors.push(...result.errors);
        }

        if (errors.length > 0) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, errors }, null, 2) }] };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: true,
              summary: {
                objects: objects.length,
                arrows: arrows.length,
                equations: equations.length,
              },
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, errors: [err instanceof Error ? err.message : String(err)] }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
