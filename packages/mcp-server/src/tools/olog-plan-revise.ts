import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore } from '@olog/core';
import type { PlanOperation } from '@olog/core';
import { loadPlan } from './olog-plan-store.js';

type Verdict = 'keep' | 'rollback' | 'redirect';

interface OperationVerdict {
  operation: PlanOperation;
  verdict: Verdict;
  reason: string;
}

interface NewOpSuggestion {
  briefElementId: string;
  briefElementName: string;
  suggestedOps: Array<{ kind: string; description: string }>;
}

const BriefDeltaElementSchema = z.object({
  id: z.string().describe('Brief-local element ID'),
  name: z.string().describe('Element name'),
  description: z.string().optional().describe('What changed'),
});

export function registerOlogPlanRevise(server: McpServer, store: OlogStore, projectRoot: string): void {
  server.registerTool(
    'olog_plan_revise',
    {
      description:
        'Diff the current plan against a brief change and classify each operation as keep, rollback, or redirect. Returns a revision proposal — does NOT execute. The orchestrator reviews the proposal and confirms with the PM before resuming.',
      inputSchema: z.object({
        planHash: z.string().describe('Hash of the plan to revise (as returned by olog_plan)'),
        setId: z.string().optional().describe('Working set ID — when provided, proposedImplementation arrows are used to map brief elements to olog elements'),
        briefDelta: z.object({
          removed: z.array(z.string()).default([]).describe('Brief element IDs that were removed from the brief'),
          added: z.array(BriefDeltaElementSchema).default([]).describe('New brief elements added to the brief'),
          modified: z.array(BriefDeltaElementSchema).default([]).describe('Brief elements whose description or intent changed'),
        }).describe('Changes to the DomainBrief since the plan was drafted'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ planHash, setId, briefDelta }) => {
      try {
        const plan = loadPlan(planHash, projectRoot);
        if (!plan) {
          return {
            content: [{ type: 'text' as const, text: `Plan not found: ${planHash}` }],
            isError: true,
          };
        }

        // Build brief-element → olog-element map from working set if available
        const briefToOlog = new Map<string, string>(); // briefElementId → ologElementId
        const ologToBrief = new Map<string, string>(); // ologElementId → briefElementId

        if (setId) {
          const graph = store.queryWorkingSetGraph(setId, { source: 'propose_functor' });
          for (const arrow of graph.syntheticArrows) {
            if (arrow.kind !== 'proposedImplementation' || !arrow.note) continue;
            try {
              const parsed = JSON.parse(arrow.note) as { briefElementId?: string };
              if (parsed.briefElementId) {
                briefToOlog.set(parsed.briefElementId, arrow.srcId);
                ologToBrief.set(arrow.srcId, parsed.briefElementId);
              }
            } catch {
              // non-JSON note, skip
            }
          }
        }

        const removedOlogIds = new Set<string>(
          briefDelta.removed.map(bid => briefToOlog.get(bid)).filter((id): id is string => id !== undefined)
        );
        const modifiedOlogIds = new Set<string>(
          briefDelta.modified.map(el => briefToOlog.get(el.id)).filter((id): id is string => id !== undefined)
        );

        // Helper: extract element IDs touched by an operation
        function touchedIds(op: PlanOperation): string[] {
          switch (op.kind) {
            case 'rename': return [op.target];
            case 'move': return [op.target];
            case 'removeSymbol': return [op.target];
            case 'rewrite_body': return [op.target];
            case 'amendType': return [op.target];
            case 'addArrow': return [op.src, op.dst];
            case 'addSymbol': return []; // no existing olog ID
            case 'addReexport': return [];
            case 'removeArrow': {
              const arr = store.getArr(op.arrowId);
              return arr ? [arr.srcId, arr.dstId] : [];
            }
          }
        }

        // Helper: match addSymbol by name against removed/modified brief element names
        const removedNames = new Set(briefDelta.removed.map(bid => {
          const ologId = briefToOlog.get(bid);
          if (ologId) { const el = store.getElem(ologId); return el?.name ?? ''; }
          return '';
        }).filter(Boolean));
        const modifiedNames = new Set(briefDelta.modified.map(el => el.name));

        const verdicts: OperationVerdict[] = plan.operations.map(op => {
          const ids = touchedIds(op);

          if (ids.some(id => removedOlogIds.has(id))) {
            return { operation: op, verdict: 'rollback', reason: 'Target element was removed from the brief' };
          }
          if (ids.some(id => modifiedOlogIds.has(id))) {
            return { operation: op, verdict: 'redirect', reason: 'Target element was modified in the brief — review implementation approach' };
          }

          // Name-based fallback for addSymbol / addReexport
          if (op.kind === 'addSymbol') {
            if (removedNames.has(op.name)) return { operation: op, verdict: 'rollback', reason: `"${op.name}" was removed from the brief` };
            if (modifiedNames.has(op.name)) return { operation: op, verdict: 'redirect', reason: `"${op.name}" was modified in the brief` };
          }

          return { operation: op, verdict: 'keep', reason: 'Not affected by brief changes' };
        });

        // Suggest new operations for added brief elements
        const newOpsNeeded: NewOpSuggestion[] = briefDelta.added.map(el => ({
          briefElementId: el.id,
          briefElementName: el.name,
          suggestedOps: [
            { kind: 'addSymbol', description: `Add domain element "${el.name}" to the olog` },
            { kind: 'rewrite_body', description: `Implement "${el.name}" in source` },
          ],
        }));

        const summary = {
          keep: verdicts.filter(v => v.verdict === 'keep').length,
          rollback: verdicts.filter(v => v.verdict === 'rollback').length,
          redirect: verdicts.filter(v => v.verdict === 'redirect').length,
          newOpsNeeded: newOpsNeeded.length,
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ summary, verdicts, newOpsNeeded }, null, 2),
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
