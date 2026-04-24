import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore, mineEquations as mineEquationsCore } from '@olog/core';
import type { EquationCandidate, ArrowKind } from '@olog/core';

export function registerOlogMineEquations(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_mine_equations',
    {
      description:
        'Discover path equations that hold (or nearly hold) in the olog graph. ' +
        'Tests all possible commutativity conditions between arrow paths up to ' +
        'the specified depth. Returns equations ranked by coverage ratio. ' +
        'Coverage 1.0 means the equation holds for every element tested; ' +
        'lower values indicate near-invariants with counterexamples.',
      inputSchema: z.object({
        maxDepth: z
          .number()
          .int()
          .min(2)
          .max(4)
          .default(3)
          .describe(
            'Maximum path length to explore. Depth 2 finds 2-arrow paths, depth 3 finds 3-arrow paths. Higher = slower but more thorough.',
          ),
        minCoverage: z
          .number()
          .min(0)
          .max(1)
          .default(1.0)
          .describe(
            'Minimum coverage ratio to report. 1.0 = only strict invariants. 0.8 = near-invariants that hold for 80%+ of elements.',
          ),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe('Maximum number of equations to return.'),
        arrowKinds: z
          .array(z.string())
          .optional()
          .describe(
            'Restrict to these arrow kinds. Default: all arrow kinds in use.',
          ),
        elementKinds: z
          .array(z.string())
          .optional()
          .describe(
            'Restrict seed elements to these kinds. Default: function, method, class, interface, type, import, module.',
          ),
        maxCounterexamples: z
          .number()
          .int()
          .min(0)
          .max(20)
          .default(5)
          .describe(
            'Maximum number of counterexamples to include per equation. Counterexamples show elements where the equation fails.',
          ),
        sampleSize: z
          .number()
          .int()
          .min(10)
          .max(500)
          .default(100)
          .describe(
            'Number of seed elements per kind to sample. Higher = more accurate but slower.',
          ),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (params) => {
      try {
        const opts: Record<string, unknown> = {
          maxDepth: params.maxDepth,
          minCoverage: params.minCoverage,
          maxResults: params.maxResults,
          maxCounterexamples: params.maxCounterexamples,
          sampleSize: params.sampleSize,
        };
        if (params.arrowKinds) {
          opts.arrowKinds = params.arrowKinds as ArrowKind[];
        }
        if (params.elementKinds) {
          opts.elementKinds = params.elementKinds;
        }

        const results: EquationCandidate[] = mineEquationsCore(store, opts);

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    message:
                      'No path equations found at the specified coverage threshold.',
                    suggestion:
                      'Try lowering minCoverage to discover near-invariants, or increasing maxDepth to find longer-path equations.',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Format results for readability
        const formatted = results.map((r) => ({
          equation: `${r.lhsPath.join(' → ')} = ${r.rhsPath.join(' → ')}`,
          domainKind: r.domainKind,
          coverage: `${(r.coverage * 100).toFixed(1)}%`,
          support: r.support,
          total: r.total,
          counterexamples:
            r.counterexamples.length > 0
              ? r.counterexamples.map((c) => ({
                  element: `${c.elementName} (${c.elementKind})`,
                  lhsReaches: c.lhsResult,
                  rhsReaches: c.rhsResult,
                }))
              : undefined,
        }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  totalEquations: results.length,
                  parameters: {
                    maxDepth: params.maxDepth,
                    minCoverage: params.minCoverage,
                    arrowKinds: params.arrowKinds ?? '(all in use)',
                    elementKinds: params.elementKinds ?? '(defaults)',
                  },
                  equations: formatted,
                },
                null,
                2,
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
    },
  );
}