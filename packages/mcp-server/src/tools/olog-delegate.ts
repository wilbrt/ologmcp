import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore } from '@olog/core';
import { assembleBrief, type DelegationTask, type ContextOverrides } from '@olog/core';

const TASK_TYPES = [
  'write_function_body',
  'write_test',
  'write_migration',
  'rewrite_body',
  'write_documentation',
] as const;

export function registerOlogDelegate(
  server: McpServer,
  store: OlogStore,
  projectRoot: string,
): void {
  server.registerTool(
    'olog_delegate',
    {
      description:
        'Assemble a fully-resolved structural brief for a text-generation subagent. ' +
        'Traverses the olog to collect signatures, call graphs, interface contracts, ' +
        'import paths, analogue source code, and domain model context. ' +
        'The brief includes a domainContext field: ownConcepts lists the domain ' +
        'concept(s) this code element implements (via implementedAs) along with their ' +
        'domain arrows, and neighborConcepts lists domain concepts reachable via callers ' +
        'and callees (Kan extension neighborhood). Both are null when no domain model ' +
        'exists yet — call olog_domain_discover first to populate it. ' +
        'Returns a self-contained brief that requires NO further olog queries — ' +
        'designed for consumption by a smaller/cheaper model that will write the actual code.',
      inputSchema: z.object({
        task: z.enum(TASK_TYPES).describe(
          'The type of text-generation task.',
        ),
        target: z.string().describe(
          'Element ID of the target entity (e.g., "symbol:src/auth.verifyJwt"). ' +
          'Use olog_query or olog_inspect to find the ID.',
        ),
        contextOverrides: z.object({
          mustCall: z.array(z.string()).optional().describe(
            'Element IDs the implementation must call. Replaces automatically derived context.',
          ),
          mustImplement: z.array(z.string()).optional().describe(
            'Element IDs of interfaces this implementation must satisfy. Replaces derived context.',
          ),
          analogues: z.array(z.string()).optional().describe(
            'Element IDs of similar existing implementations. Replaces automatic discovery.',
          ),
        }).optional().describe(
          'Manual overrides for structural context. When provided, these REPLACE ' +
          'the automatically derived values (not merge).',
        ),
        acceptanceCriteria: z.array(z.string()).optional().describe(
          'Additional acceptance criteria, merged with task-type defaults.',
        ),
        maxAnalogues: z.number().int().min(0).max(5).default(3).describe(
          'Maximum number of analogue implementations to include.',
        ),
        snippetLines: z.number().int().min(10).max(200).default(50).describe(
          'Maximum lines of source code per snippet.',
        ),
        lineRange: z.object({
          start: z.number(),
          end: z.number(),
        }).optional().describe(
          'Line range to narrow focus within a file.',
        ),
        skipAnalogues: z.boolean().optional().describe(
          'Skip analogue discovery; overrides maxAnalogues to 0.',
        ),
        signatureChange: z.boolean().optional().describe(
          'Allow signature changes in generated code.',
        ),
        rationale: z.string().optional().describe(
          'Why this body rewrite is needed. Passed through to the delegation brief so the edit agent understands the intent. Populate from pendingDelegations[].rationale returned by olog_apply.',
        ),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ task, target, contextOverrides, acceptanceCriteria, maxAnalogues, snippetLines, lineRange, skipAnalogues, signatureChange, rationale }) => {
      try {
        const effectiveMaxAnalogues = skipAnalogues ? 0 : maxAnalogues;
        const overrides: ContextOverrides | undefined =
          contextOverrides
            ? {
                ...(contextOverrides.mustCall ? { mustCall: contextOverrides.mustCall } : {}),
                ...(contextOverrides.mustImplement ? { mustImplement: contextOverrides.mustImplement } : {}),
                ...(contextOverrides.analogues ? { analogues: contextOverrides.analogues } : {}),
                ...(lineRange ? { lineRange } : {}),
                ...(skipAnalogues !== undefined ? { skipAnalogues } : {}),
                ...(signatureChange !== undefined ? { signatureChange } : {}),
              }
            : undefined;
        const result = assembleBrief(
          store,
          projectRoot,
          task as DelegationTask,
          target,
          overrides,
          effectiveMaxAnalogues,
          snippetLines,
          acceptanceCriteria,
          rationale,
        );

        if ('ok' in result && result.ok === false) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: false, error: message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );
}