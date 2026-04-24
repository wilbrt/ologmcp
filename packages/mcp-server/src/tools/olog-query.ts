import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore } from '@olog/core';

export function registerOlogQuery(server: McpServer, store: OlogStore): void {
  const elemKindEnum = [
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
    'property',
    'domain',
    'other',
  ] as const;

  const arrowKindEnum = [
    'extends',
    'implements',
    'calls',
    'imports',
    'exports',
    'references',
    'contains',
    'returns',
    'param',
    'typeof',
    'instanceof',
    'definedIn',
    'inModule',
    'memberOf',
    'callerOf',
    'calleeOf',
    'importsFrom',
    'locatedIn',
    'hasProperty',
    'hasType',
    'implementedAs',
    'other',
  ] as const;

  const startByIdSchema = z.object({
    id: z.string().describe('Element ID to start from'),
  });

  const startByFilterSchema = z.object({
    kind: z.enum(elemKindEnum).optional().describe("Element kind to filter by. Omit to match all kinds."),
    name: z.string().optional().describe(
      "Regex pattern matched against element name. Examples: '^handle', 'User', 'Button$'"
    ),
    module: z.string().optional().describe(
      "Regex pattern matched against module (relative file path). Examples: 'src/components', 'utils/'"
    ),
  });

  server.registerTool(
    'olog_query',
    {
      description:
        'Query the ontology log for structural elements matching filters, or traverse the graph via multi-hop arrow following. Returns elements with their kind, name, module (file path), and span (location). Traversal returns both reached elements and the arrows traversed.',
      inputSchema: z.object({
        start: z.union([startByIdSchema, startByFilterSchema]).optional().describe(
          'Start element specification: either an exact element ID, or a filter (kind/name/module) to find starting element(s). When omitted, falls back to the top-level kind/name/module parameters.'
        ),
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
            'property',
            'domain',
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
        arrows: z
          .array(z.enum(arrowKindEnum))
          .optional()
          .describe(
            'Ordered array of arrow kinds to traverse multi-hop. When provided, the tool performs graph traversal instead of a simple filter query.'
          ),
        direction: z
          .enum(['out', 'in'])
          .default('out')
          .describe(
            'Direction for all arrow hops in a traversal. "out" follows natural direction (src -> dst); "in" reverses it (dst -> src).'
          ),
        minConfidence: z
          .enum(['resolved', 'unresolved', 'tentative'])
          .optional()
          .describe(
            'Minimum provenance confidence level. For filter queries, requires an exact match. For traversals, filters arrows by exact confidence match.'
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
    async (args) => {
      try {
        if (args.arrows && args.arrows.length > 0) {
          let startIds: string[];

          if (args.start && 'id' in args.start) {
            startIds = [args.start.id];
          } else {
            const filter =
              args.start && 'kind' in args.start
                ? args.start
                : { kind: args.kind, name: args.name, module: args.module };

            const queryOpts: {
              kind?: string;
              nameRegex?: string;
              moduleRegex?: string;
              limit: number;
            } = { limit: args.limit };
            if (filter.kind && filter.kind !== 'any') {
              queryOpts.kind = filter.kind;
            }
            if (filter.name !== undefined) {
              queryOpts.nameRegex = filter.name;
            }
            if (filter.module !== undefined) {
              queryOpts.moduleRegex = filter.module;
            }

            const elems = store.queryElements(queryOpts);
            if (elems.length === 0) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'No elements found matching start criteria',
                  },
                ],
              };
            }
            startIds = elems.map((e) => e.id);
          }

          const steps = args.arrows.map((kind) => ({
            kind,
            direction: args.direction,
          }));

          const allElements = new Map<string, import('@olog/core').OlogElem>();
          const allArrows = new Map<string, import('@olog/core').OlogArr>();

          for (const startId of startIds) {
            const traverseOpts: import('@olog/core').TraverseOptions = {
              startId,
              steps,
            };
            if (args.minConfidence) {
              traverseOpts.minConfidence = args.minConfidence;
            }
            const result = store.traverse(traverseOpts);
            for (const elem of result.elements) {
              allElements.set(elem.id, elem);
            }
            for (const arr of result.arrows) {
              allArrows.set(arr.id, arr);
            }
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    elements: Array.from(allElements.values()),
                    arrows: Array.from(allArrows.values()),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        if (args.start && 'id' in args.start) {
          const elem = store.getElem(args.start.id);
          if (!elem) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Element not found',
                },
              ],
            };
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(elem, null, 2),
              },
            ],
          };
        }

        const filter =
          args.start && 'kind' in args.start
            ? args.start
            : { kind: args.kind, name: args.name, module: args.module };

        const opts: {
          kind?: string;
          nameRegex?: string;
          moduleRegex?: string;
          limit: number;
        } = { limit: args.limit };
        if (filter.kind && filter.kind !== 'any') {
          opts.kind = filter.kind;
        }
        if (filter.name !== undefined) {
          opts.nameRegex = filter.name;
        }
        if (filter.module !== undefined) {
          opts.moduleRegex = filter.module;
        }

        let rows: import('@olog/core').OlogElem[];
        if (args.minConfidence) {
          rows = store.queryElementsWithConfidence({
            ...opts,
            minConfidence: args.minConfidence,
          });
        } else {
          rows = store.queryElements(opts);
        }

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
