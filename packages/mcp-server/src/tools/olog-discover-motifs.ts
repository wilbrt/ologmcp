import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OlogStore } from '@olog/core';
import { discoverMotifs } from '@olog/core';

export function registerOlogDiscoverMotifs(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_discover_motifs',
    {
      description:
        'Motif discovery session tool. Finds recurring structural patterns (motifs) in the olog graph ' +
        'by extracting ego-graphs around seed elements, grouping by shape similarity, and surfacing ' +
        'high-support patterns with optional internal equation mining.\n\n' +
        'Actions:\n' +
        '- action="start": Begin a new discovery session. Optional: seedKinds (element kinds to use as ' +
        'seeds, default ["function","class","interface"]), depth (ego-graph expansion depth, default 2), ' +
        'arrowKinds (arrow kinds to follow during expansion), minSupport (minimum instance count, ' +
        'default 3), mineEquations (whether to mine internal equations, default true), scopeRegex ' +
        '(regex to restrict seeds to specific modules), excludeModules (module patterns to exclude). ' +
        'Returns sessionId, candidateCount, and the full list of candidates with proposedNames, ' +
        'shapes, support counts, instances, equations, and clarifying questions.\n' +
        '- action="refine": Accept/reject/rename candidates. Required: sessionId (string, from start), ' +
        'responses (array of objects with candidateId, status ("accepted"|"rejected"|"deferred"), ' +
        'optional nameOverride string). Returns summary with accepted/rejected/pending counts and ' +
        'remaining pendingCandidates.\n' +
        '- action="commit": Write accepted motif templates as domain elements to the olog. Required: ' +
        'sessionId, provenance (object with source: "manual"|"llm", ' +
        'commitSha: string, confidence: "resolved"|"unresolved"|"tentative"). Returns sessionId, ' +
        'status "committed", and addedTemplates count. At least one candidate must be accepted before ' +
        'committing.\n' +
        '- action="list": List all motif discovery sessions. Returns array of session summaries.\n' +
        '- action="get": Get details of a specific session. Required: sessionId. Returns the full ' +
        'session object including candidates and their status.',
      inputSchema: z.object({
        action: z
          .enum(['start', 'refine', 'commit', 'list', 'get'])
          .describe(
            'Action to perform: "start" begins a new session, "refine" accepts/rejects candidates, ' +
              '"commit" writes to the olog, "list" shows all sessions, "get" returns a session by ID.',
          ),
        // start
        seedKinds: z
          .array(z.string())
          .optional()
          .describe('(start) Element kinds to use as seeds (default: ["function", "class", "interface"])'),
        depth: z
          .number()
          .optional()
          .describe('(start) Ego-graph expansion depth (default: 2)'),
        arrowKinds: z
          .array(z.string())
          .optional()
          .describe('(start) Arrow kinds to follow during expansion'),
        minSupport: z
          .number()
          .optional()
          .describe('(start) Minimum support for a motif to be surfaced (default: 3)'),
        mineEquations: z
          .boolean()
          .optional()
          .describe('(start) Whether to mine equations internal to each motif (default: true)'),
        scopeRegex: z
          .string()
          .optional()
          .describe('(start) Regex to restrict seeds to specific modules'),
        excludeModules: z
          .array(z.string())
          .optional()
          .describe('(start) Module patterns to exclude'),
        // refine, commit, get
        sessionId: z
          .string()
          .optional()
          .describe('(refine/commit/get) Session ID returned by start'),
        // refine
        responses: z
          .array(
            z.object({
              candidateId: z.string(),
              status: z.enum(['accepted', 'rejected', 'deferred']),
              nameOverride: z.string().optional().describe('Override the proposed noun phrase name'),
            }),
          )
          .optional()
          .describe('(refine) Array of candidate responses'),
        // commit
        provenance: z
          .object({
            source: z.enum(['manual', 'llm']),
            commitSha: z.string(),
            confidence: z.enum(['resolved', 'unresolved', 'tentative']),
          })
          .optional()
          .describe('(commit) Provenance metadata'),
      }),
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (params) => {
      try {
        if (params.action === 'start') {
          const discoveryOpts = {
            ...(params.seedKinds !== undefined && { seedKinds: params.seedKinds }),
            ...(params.depth !== undefined && { depth: params.depth }),
            ...(params.arrowKinds !== undefined && { arrowKinds: params.arrowKinds }),
            ...(params.minSupport !== undefined && { minSupport: params.minSupport }),
            ...(params.mineEquations !== undefined && { mineEquations: params.mineEquations }),
            ...(params.scopeRegex !== undefined && { scopeRegex: params.scopeRegex }),
            ...(params.excludeModules !== undefined && { excludeModules: params.excludeModules }),
          };
          const candidates = discoverMotifs(store, discoveryOpts);

          const sessionId = store.motifSessions.create({
            ...(params.scopeRegex !== undefined && { scopeRegex: params.scopeRegex }),
            candidates,
            commitSha: store.commitSha(),
          });

          const allQuestions: string[] = [];
          for (const c of candidates) {
            allQuestions.push(...c.questions);
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    sessionId,
                    candidateCount: candidates.length,
                    candidates: candidates.map(c => ({
                      id: c.id,
                      proposedName: c.proposedName,
                      shape: {
                        hash: c.shape.hash,
                        objects: c.shape.objects,
                        arrows: c.shape.arrows,
                      },
                      support: c.support,
                      instanceCount: c.instances.length,
                      equations: c.equations,
                      questions: c.questions,
                      status: c.status,
                    })),
                    clarifyingQuestions: [...new Set(allQuestions)].slice(0, 10),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        if (params.action === 'refine') {
          if (!params.sessionId) {
            return { content: [{ type: 'text' as const, text: 'sessionId is required for action="refine"' }], isError: true };
          }
          if (!params.responses) {
            return { content: [{ type: 'text' as const, text: 'responses is required for action="refine"' }], isError: true };
          }
          const session = store.motifSessions.get(params.sessionId);
          if (!session) {
            return {
              content: [{ type: 'text' as const, text: `Session not found: ${params.sessionId}` }],
              isError: true,
            };
          }

          // Apply responses to candidates
          for (const response of params.responses) {
            const candidate = session.candidates.find(c => c.id === response.candidateId);
            if (!candidate) continue;

            candidate.status = response.status;
            if (response.nameOverride) {
              candidate.proposedName = response.nameOverride;
            }
          }

          store.motifSessions.update(params.sessionId, { candidates: session.candidates });

          const pending = session.candidates.filter(c => c.status === 'proposed');
          const accepted = session.candidates.filter(c => c.status === 'accepted');
          const rejected = session.candidates.filter(c => c.status === 'rejected');

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    sessionId: params.sessionId,
                    summary: { accepted: accepted.length, rejected: rejected.length, pending: pending.length },
                    pendingCandidates: pending.map(c => ({
                      id: c.id,
                      proposedName: c.proposedName,
                      questions: c.questions,
                    })),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        if (params.action === 'commit') {
          if (!params.sessionId) {
            return { content: [{ type: 'text' as const, text: 'sessionId is required for action="commit"' }], isError: true };
          }
          if (!params.provenance) {
            return { content: [{ type: 'text' as const, text: 'provenance is required for action="commit"' }], isError: true };
          }
          const session = store.motifSessions.get(params.sessionId);
          if (!session) {
            return {
              content: [{ type: 'text' as const, text: `Session not found: ${params.sessionId}` }],
              isError: true,
            };
          }
          if (session.status !== 'active') {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Session is already ${session.status}`,
                },
              ],
              isError: true,
            };
          }

          const accepted = session.candidates.filter(c => c.status === 'accepted');
          if (accepted.length === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'No accepted candidates to commit. Use action="refine" to accept candidates first.',
                },
              ],
              isError: true,
            };
          }

          const prov = {
            source: params.provenance.source,
            commitSha: params.provenance.commitSha,
            ingestedAt: Date.now(),
            confidence: params.provenance.confidence,
          };

          let totalInstances = 0;

          // Insert motif templates and instances
          for (const candidate of accepted) {
            const templateId = `motif:${candidate.id}`;
            store.addMotifTemplate({
              id: templateId,
              name: candidate.proposedName,
              description: candidate.description,
              shape: candidate.shape,
              equations: candidate.equations,
              provenance: prov,
            });

            // Add instances for this template
            for (let i = 0; i < candidate.instances.length; i++) {
              const instance = candidate.instances[i];
              if (!instance) continue;
              store.addMotifInstance({
                id: `instance:${candidate.id}:${i}`,
                templateId,
                mappings: instance.mappings,
                provenance: prov,
              });
              totalInstances++;
            }
          }

          store.motifSessions.update(params.sessionId, { status: 'committed' });

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    sessionId: params.sessionId,
                    status: 'committed',
                    addedTemplates: accepted.length,
                    addedInstances: totalInstances,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        if (params.action === 'list') {
          const sessions = store.motifSessions.list();
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  sessions.map(s => ({
                    id: s.id,
                    status: s.status,
                    scopeRegex: s.scopeRegex,
                    candidateCount: s.candidates.length,
                    commitSha: s.commitSha,
                    createdAt: new Date(s.createdAt).toISOString(),
                  })),
                  null,
                  2,
                ),
              },
            ],
          };
        }

        if (params.action === 'get') {
          if (!params.sessionId) {
            return { content: [{ type: 'text' as const, text: 'sessionId is required for action="get"' }], isError: true };
          }
          const session = store.motifSessions.get(params.sessionId);
          if (!session) {
            return {
              content: [{ type: 'text' as const, text: `Session not found: ${params.sessionId}` }],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(session, null, 2),
              },
            ],
          };
        }

        return {
          content: [{ type: 'text' as const, text: 'Unknown action' }],
          isError: true,
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