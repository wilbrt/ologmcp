import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OlogStore, discoverDomainCandidates, extendDomainByKan, getExistingDomainElementsByCodeId } from '@olog/core';

export function registerOlogDomainDiscover(server: McpServer, store: OlogStore): void {
  server.registerTool(
    'olog_domain_discover',
    {
      description:
        'Domain modeling session tool. Discovers domain concepts from the olog\'s interface/type/class ' +
        'elements and proposes domain objects with arrows between them. ' +
        'Arrow proposals include: (1) field-level "has X" arrows via hasProperty→hasType chains, ' +
        '(2) structural "extends"/"implements" arrows when the supertype is also a domain concept. ' +
        'Both current-session candidates and already-committed domain elements are resolved as arrow ' +
        'codomains, enabling incremental multi-session domain modeling. ' +
        'After committing, a new session on a broader scope will automatically link to the ' +
        'committed elements from previous sessions.\n\n' +
        'Actions:\n' +
        '- action="start": Begin a new discovery session. Optional: scopeRegex (regex to restrict ' +
        'discovery to matching module paths, e.g. "packages/core/src/ontology"), excludeModules (array ' +
        'of module path patterns to exclude). Returns sessionId, candidateCount, arrowCount, and the ' +
        'full list of candidates with proposedNames, codeElements, proposedArrows, bridgeArrows, and ' +
        'clarifyingQuestions.\n' +
        '- action="refine": Accept/reject/rename candidates. Required: sessionId (string, from start), ' +
        'responses (array of objects with candidateId, status ("accepted"|"rejected"|"deferred"), ' +
        'optional nameOverride string, optional arrowOverrides array). Each arrowOverride has arrowId, ' +
        'status ("accepted"|"rejected"|"modified"), optional newName, optional totalOverride boolean. ' +
        'Returns summary with accepted/rejected/pending counts and remaining pendingCandidates.\n' +
        '- action="commit": Write accepted domain objects and resolved arrows to the olog. Required: ' +
        'sessionId, provenance (object with source: "manual"|"llm", ' +
        'commitSha: string, confidence: "resolved"|"unresolved"|"tentative"). Returns sessionId, status "committed", ' +
        'addedObjects, addedArrows, addedBridges counts. At least one candidate must be accepted before committing.\n' +
        '- action="list": List all domain discovery sessions. Returns array of session summaries.\n' +
        '- action="get": Get details of a specific session. Required: sessionId. Returns the full ' +
        'session object including candidates and their status.',
      inputSchema: z.object({
        action: z
          .enum(['start', 'extend', 'refine', 'commit', 'list', 'get'])
          .describe(
            'Action to perform: "start" begins a new session from type definitions, ' +
            '"extend" runs the Kan extension pass to propagate domain labels along the call graph, ' +
            '"refine" accepts/rejects candidates, ' +
            '"commit" writes to the olog, "list" shows all sessions, "get" returns a session by ID.',
          ),
        // start
        scopeRegex: z
          .string()
          .optional()
          .describe('(start) Regex to restrict discovery to matching module paths (e.g. "packages/core/src/ontology")'),
        excludeModules: z
          .array(z.string())
          .optional()
          .describe('(start/extend) Module path patterns to exclude from discovery'),
        maxDepth: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe('(extend) Maximum call-graph hops to follow from each labeled domain element. Default 2.'),
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
              arrowOverrides: z
                .array(
                  z.object({
                    arrowId: z.string(),
                    status: z.enum(['accepted', 'rejected', 'modified']),
                    newName: z.string().optional(),
                    totalOverride: z.boolean().optional(),
                  }),
                )
                .optional(),
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
            ...(params.scopeRegex !== undefined && { scopeRegex: params.scopeRegex }),
            ...(params.excludeModules !== undefined && { excludeModules: params.excludeModules }),
          };
          const candidates = discoverDomainCandidates(store, discoveryOpts);

          const sessionId = store.sessions.create({
            ...(params.scopeRegex !== undefined && { scopeRegex: params.scopeRegex }),
            candidates,
            equations: [],
            commitSha: store.commitSha(),
          });

          const allQuestions: string[] = [];
          for (const c of candidates) {
            allQuestions.push(...c.questions);
            for (const a of c.proposedArrows) {
              if (a.question) allQuestions.push(a.question);
            }
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    sessionId,
                    candidateCount: candidates.length,
                    arrowCount: candidates.reduce((n, c) => n + c.proposedArrows.length, 0),
                    candidates: candidates.map(c => ({
                      id: c.id,
                      proposedName: c.proposedName,
                      codeElement: c.codeElementId,
                      proposedArrows: c.proposedArrows.map(a => ({
                        id: a.id,
                        name: a.name,
                        codomain: a.codomainName,
                        total: a.total,
                        confidence: a.confidence,
                        question: a.question,
                      })),
                      bridgeArrow: { name: c.bridgeArrow.name, codomain: c.bridgeArrow.codomainName },
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

        if (params.action === 'extend') {
          const kanOpts = {
            ...(params.maxDepth !== undefined && { maxDepth: params.maxDepth }),
            ...(params.excludeModules !== undefined && { excludeModules: params.excludeModules }),
          };
          const candidates = extendDomainByKan(store, kanOpts);

          if (candidates.length === 0) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'No committed domain elements found. Run action="start" and commit a session first.' }, null, 2) }],
              isError: true,
            };
          }

          const shells = candidates.filter(c => c.status === 'accepted');
          const newCands = candidates.filter(c => c.status === 'proposed');

          const sessionId = store.sessions.create({
            candidates,
            equations: [],
            commitSha: store.commitSha(),
          });

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                sessionId,
                existingWithNewArrows: shells.length,
                newCandidates: newCands.length,
                totalArrowsProposed: candidates.reduce((n, c) => n + c.proposedArrows.length, 0),
                shells: shells.map(s => ({
                  id: s.id,
                  domainName: s.proposedName,
                  newArrows: s.proposedArrows.map(a => ({ id: a.id, name: a.name, codomain: a.codomainName, confidence: a.confidence })),
                })),
                newCandidates: newCands.map(c => ({
                  id: c.id,
                  proposedName: c.proposedName,
                  codeElement: c.codeElementId,
                  calledBy: c.proposedArrows.map(a => a.codomainName),
                  questions: c.questions,
                })),
              }, null, 2),
            }],
          };
        }

        if (params.action === 'refine') {
          if (!params.sessionId) {
            return { content: [{ type: 'text' as const, text: 'sessionId is required for action="refine"' }], isError: true };
          }
          if (!params.responses) {
            return { content: [{ type: 'text' as const, text: 'responses is required for action="refine"' }], isError: true };
          }
          const session = store.sessions.get(params.sessionId);
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

            if (response.arrowOverrides) {
              for (const override of response.arrowOverrides) {
                const arrow = candidate.proposedArrows.find(a => a.id === override.arrowId);
                if (!arrow) continue;
                arrow.status = override.status;
                if (override.newName) arrow.name = override.newName;
                if (override.totalOverride !== undefined) arrow.total = override.totalOverride;
              }
            }
          }

          // Remove arrows referencing rejected candidates
          const rejectedIds = new Set(
            session.candidates.filter(c => c.status === 'rejected').map(c => c.id),
          );
          for (const candidate of session.candidates) {
            candidate.proposedArrows = candidate.proposedArrows.filter(
              a => !a.codomainCandidateId || !rejectedIds.has(a.codomainCandidateId),
            );
          }

          store.sessions.update(params.sessionId, { candidates: session.candidates });

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
          const session = store.sessions.get(params.sessionId);
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

          // Map candidate id → domain element id for arrow resolution
          const candidateToElemId = new Map<string, string>();
          let addedObjects = 0;
          let reusedObjects = 0;
          let addedArrows = 0;
          let addedBridges = 0;

          // Build lookup: code element id → already-committed domain element
          const existingDomainByCodeId = getExistingDomainElementsByCodeId(store);

          // Insert domain elements (skipping duplicates)
          for (const candidate of accepted) {
            const existing = existingDomainByCodeId.get(candidate.codeElementId);
            if (existing) {
              // Reuse existing domain element — don't create a duplicate
              candidateToElemId.set(candidate.id, existing.id);
              reusedObjects++;
            } else {
              const elemId = `domain:${candidate.id}`;
              candidateToElemId.set(candidate.id, elemId);
              store.addElement({
                id: elemId,
                kind: 'domain',
                name: candidate.proposedName,
                module: null,
                span: null,
                attrs: { codeElementId: candidate.codeElementId },
              });
              store.addProvenance(elemId, prov);
              addedObjects++;
            }
          }

          // Insert domain→domain arrows
          for (const candidate of accepted) {
            const srcId = candidateToElemId.get(candidate.id)!;
            const isNew = !existingDomainByCodeId.has(candidate.codeElementId);
            for (const arrow of candidate.proposedArrows) {
              if (arrow.status === 'rejected') continue;

              let dstId: string | undefined;
              if (arrow.codomainCandidateId) {
                dstId = candidateToElemId.get(arrow.codomainCandidateId);
              }
              if (!dstId && arrow.codomainExistingElemId) {
                dstId = arrow.codomainExistingElemId;
              }
              if (!dstId) continue; // unresolved cross-domain arrow

              const arrowId = `${srcId}:${arrow.name.replace(/\s+/g, '-')}:${dstId}`;
              store.addArrow({
                id: arrowId,
                kind: 'other',
                srcId,
                dstId,
                attrs: { name: arrow.name, total: arrow.total },
              });
              addedArrows++;
            }

            // Bridge arrow: domain element → code element
            // Only add bridge arrow for newly created domain elements;
            // reused ones already have an implementedAs arrow
            const bridgeArrow = candidate.bridgeArrow;
            if (bridgeArrow.status !== 'rejected' && isNew) {
              const domElemId = candidateToElemId.get(candidate.id)!;
              const bridgeId = `${domElemId}:implementedAs:${candidate.codeElementId}`;
              store.addArrow({
                id: bridgeId,
                kind: 'implementedAs',
                srcId: domElemId,
                dstId: candidate.codeElementId,
                attrs: {},
              });
              addedBridges++;
            }
          }

          store.sessions.update(params.sessionId, { status: 'committed' });

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    sessionId: params.sessionId,
                    status: 'committed',
                    addedObjects,
                    reusedObjects,
                    addedArrows,
                    addedBridges,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        if (params.action === 'list') {
          const sessions = store.sessions.list();
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
          const session = store.sessions.get(params.sessionId);
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
