import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { OlogStore, isNounPhrase, validateEquation, arrowId } from '@olog/core';
import type { OlogElem, OlogArr, PathEquation, Provenance } from '@olog/core';

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
  src: z.string().describe('Source element ID or name'),
  tgt: z.string().describe('Target element ID or name'),
  arrows: z.array(z.string()).describe('Sequence of arrow kinds'),
});

const equationSchema = z.object({
  id: z.string(),
  name: z.string(),
  humanMessage: z.string(),
  lhs: pathSchema,
  rhs: pathSchema,
});

const provenanceSchema = z.object({
  source: z.enum(['tree-sitter', 'lsp', 'manual', 'llm', 'heuristic', 'other']),
  commitSha: z.string(),
  ingestedAt: z.number().optional(),
  confidence: z.enum(['resolved', 'unresolved', 'tentative']),
});

const STANDARD_KINDS: string[] = [
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
  'domain',
  'property',
  'other',
];

export function registerOlogProposeSchema(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_propose_schema',
    {
      description:
        'Propose a new schema fragment to the olog. Validates noun phrases for objects, total-function semantics for arrows, and path equation composability. Stores accepted objects in olog_elem, arrows in olog_arr, equations in olog_equation, and provenance in olog_prov.',
      inputSchema: z.object({
        objects: z
          .preprocess(v => typeof v === 'string' ? JSON.parse(v) : v, z.array(objectSchema))
          .default([])
          .describe('Objects to add to the schema. Omit or pass [] if adding only arrows/equations.'),
        arrows: z
          .preprocess(v => typeof v === 'string' ? JSON.parse(v) : v, z.array(arrowSchema))
          .default([])
          .describe('Arrows to add to the schema. Omit or pass [] if adding only objects/equations.'),
        equations: z
          .preprocess(v => typeof v === 'string' ? JSON.parse(v) : v, z.array(equationSchema))
          .default([])
          .describe('Path equations to add. Omit or pass [] if not adding equations.'),
        provenance: provenanceSchema.describe('Provenance metadata for all proposed items'),
      }),
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ objects, arrows, equations, provenance }) => {
      try {
        const errors: string[] = [];
        const added = { objects: 0, arrows: 0, equations: 0 };

        const objectMap = new Map<string, { kind: string; name: string; module?: string | undefined }>();
        for (const obj of objects) {
          if (!isNounPhrase(obj.name)) {
            errors.push(
              `Object "${obj.name}" is not a valid noun phrase (must start with uppercase after optional "a"/"an"/"the")`,
            );
          }
          objectMap.set(obj.name, obj);
        }

        const arrowList: Array<{ name: string; domain: string; codomain: string; total: boolean }> = [];
        const proposedArrowKinds = new Set<string>();
        for (const arrow of arrows) {
          if (!arrow.total) {
            errors.push(
              `Arrow "${arrow.name}" is not total. Many-valued relationships must be reified before proposing.`,
            );
            continue;
          }

          const domainElems = store.queryElements({ nameRegex: `^${arrow.domain}$`, limit: 1 });
          const domainExists = domainElems.length > 0 || objectMap.has(arrow.domain);
          if (!domainExists) {
            errors.push(`Arrow "${arrow.name}": domain "${arrow.domain}" does not exist`);
            continue;
          }

          const codomainElems = store.queryElements({ nameRegex: `^${arrow.codomain}$`, limit: 1 });
          const codomainExists = codomainElems.length > 0 || objectMap.has(arrow.codomain);
          if (!codomainExists) {
            errors.push(`Arrow "${arrow.name}": codomain "${arrow.codomain}" does not exist`);
            continue;
          }

          arrowList.push(arrow);
          proposedArrowKinds.add(arrow.name);
        }

        for (const eq of equations) {
          const result = validateEquation(eq as PathEquation, store, Array.from(proposedArrowKinds));
          errors.push(...result.errors);
        }

        if (errors.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ ok: false, errors }, null, 2),
              },
            ],
          };
        }

        const createdElemIds = new Map<string, string>();

        for (const obj of objects) {
          const id = randomUUID();
          createdElemIds.set(obj.name, id);
          const kind = STANDARD_KINDS.includes(obj.kind) ? obj.kind : 'other';
          const elem: OlogElem = {
            id,
            kind: kind as OlogElem['kind'],
            name: obj.name,
            module: obj.module ?? null,
            span: null,
            attrs: {},
          };
          store.addElement(elem);
          store.addProvenance(id, {
            source: provenance.source,
            commitSha: provenance.commitSha,
            ingestedAt: provenance.ingestedAt ?? Date.now(),
            confidence: provenance.confidence,
          });
          added.objects++;
        }

        for (const arrow of arrowList) {
          const domainId =
            createdElemIds.get(arrow.domain) ??
            store.queryElements({ nameRegex: `^${arrow.domain}$`, limit: 1 })[0]?.id;
          const codomainId =
            createdElemIds.get(arrow.codomain) ??
            store.queryElements({ nameRegex: `^${arrow.codomain}$`, limit: 1 })[0]?.id;

          if (!domainId || !codomainId) {
            errors.push(`Arrow "${arrow.name}": failed to resolve domain/codomain IDs`);
            continue;
          }

          const arr: OlogArr = {
            id: arrowId(domainId, arrow.name, codomainId),
            kind: arrow.name as OlogArr['kind'],
            srcId: domainId,
            dstId: codomainId,
            attrs: {},
          };
          store.addArrow(arr);
          added.arrows++;
        }

        if (errors.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ ok: false, errors }, null, 2),
              },
            ],
          };
        }

        for (const eq of equations) {
          const eqWithProv: PathEquation = {
            id: eq.id,
            name: eq.name,
            humanMessage: eq.humanMessage,
            lhs: eq.lhs,
            rhs: eq.rhs,
            provenance: {
              source: provenance.source,
              commitSha: provenance.commitSha,
              ingestedAt: provenance.ingestedAt ?? Date.now(),
              confidence: provenance.confidence,
            },
          };
          store.addEquation(eqWithProv);
          added.equations++;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, added }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: false, errors: [message] }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
