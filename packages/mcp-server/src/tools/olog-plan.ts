import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { OlogStore } from '@olog/core';
import type { PathEquation, IntegrityConstraint } from '@olog/core';

const operationSchema = z.union([
  z.object({
    kind: z.literal('rename'),
    target: z.string(),
    newName: z.string(),
  }),
  z.object({
    kind: z.literal('move'),
    target: z.string(),
    newModule: z.string(),
  }),
  z.object({
    kind: z.literal('addSymbol'),
    module: z.string(),
    name: z.string(),
    symbolKind: z.string(),
  }),
  z.object({
    kind: z.literal('removeSymbol'),
    target: z.string(),
  }),
  z.object({
    kind: z.literal('addArrow'),
    arrowKind: z.string(),
    src: z.string(),
    dst: z.string(),
  }),
  z.object({
    kind: z.literal('removeArrow'),
    arrowId: z.string(),
  }),
]);

type PlanOperationInput = z.infer<typeof operationSchema>;

interface StoredPlan {
  operations: PlanOperationInput[];
  hash: string;
  rationale: string;
  invariants: {
    equations: PathEquation[];
    constraints: IntegrityConstraint[];
  };
}

export const planStore = new Map<string, StoredPlan>();

export function registerOlogPlan(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_plan',
    {
      description:
        'Describe a set of structural changes as a plan with invariants. The plan is stored in-memory keyed by its hash for later validation and application.',
      inputSchema: z.object({
        operations: z
          .array(operationSchema)
          .describe('List of planned structural operations'),
        rationale: z
          .string()
          .describe('Human-readable rationale for the plan'),
      }),
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ operations, rationale }) => {
      try {
        const hash = createHash('sha256')
          .update(JSON.stringify(operations))
          .digest('hex');

        const targetElementIds = new Set<string>();
        const targetKinds = new Set<string>();
        const targetModules = new Set<string>();

        for (const op of operations) {
          switch (op.kind) {
            case 'rename':
            case 'move':
            case 'removeSymbol':
              targetElementIds.add(op.target);
              break;
            case 'addSymbol':
              targetModules.add(op.module);
              targetKinds.add(op.symbolKind);
              break;
            case 'addArrow':
              targetElementIds.add(op.src);
              targetElementIds.add(op.dst);
              break;
            case 'removeArrow':
              break;
          }
        }

        for (const id of targetElementIds) {
          const elem = store.getElem(id);
          if (elem) {
            targetKinds.add(elem.kind);
            if (elem.module) {
              targetModules.add(elem.module);
            }
          }
        }

        const equationsById = new Map<string, PathEquation>();
        for (const id of targetElementIds) {
          for (const eq of store.getEquationsForObject(id)) {
            equationsById.set(eq.id, eq);
          }
        }

        const constraintsById = new Map<string, IntegrityConstraint>();
        for (const constraint of store.getConstraints()) {
          const configStr = JSON.stringify(constraint.config);
          let matched = false;
          for (const kind of targetKinds) {
            if (configStr.includes(kind)) {
              matched = true;
              break;
            }
          }
          if (!matched) {
            for (const mod of targetModules) {
              if (configStr.includes(mod)) {
                matched = true;
                break;
              }
            }
          }
          if (matched) {
            constraintsById.set(constraint.id, constraint);
          }
        }

        const invariants = {
          equations: Array.from(equationsById.values()),
          constraints: Array.from(constraintsById.values()),
        };

        const plan: StoredPlan = {
          operations,
          hash,
          rationale,
          invariants,
        };

        planStore.set(hash, plan);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ok: true, plan: { operations, hash, invariants } },
                null,
                2
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
    }
  );
}

export function getPlanByHash(hash: string): StoredPlan | undefined {
  return planStore.get(hash);
}
