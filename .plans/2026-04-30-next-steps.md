# Next Steps — 2026-04-30

Possible directions ranked roughly by impact / effort ratio. Each item notes
what's already in place and what remains to be built.

---

## 1. Pullback Mining (`olog_domain_discover` or new `olog_mine_pullbacks`)

**What:** When two domain concepts share a single code implementation (two
`implementedAs` arrows pointing to the same code element), their pullback
names the hidden abstraction that function is serving. Surfaces
single-responsibility violations at the domain level.

**Why now:** Kan extension is implemented. Pullback is the natural complement —
together they give the full functorial picture of the domain→code bridge.

**What's in place:**
- `implementedAs` arrows are stored and queryable
- `domain/discover.ts` has the session + commit machinery
- The design sketch is in `.plans/2026-04-29-categorical-domain-model.md`

**What to build:**
- `minePullbacks(store): DomainCandidate[]` in `domain/discover.ts`
- Scans elements with 2+ incoming `implementedAs`; groups by domain source pairs
- Proposes a new domain concept P with projections P→A, P→B, source=`'pullback'`
- Surface via a new `mode="pullback"` in `olog_domain_discover`, or a dedicated
  `olog_mine_pullbacks` tool if the UI needs to be distinct

---

## 2. Functoriality Validation (new constraint kind in `olog_validate`)

**What:** The `implementedAs` bridge functor should preserve composition: every
domain arrow `A --f--> B` must have a code-level witness (a `callerOf` path
from `impl(A)` to `impl(B)`). Gaps are architectural violations — domain claims
that the code doesn't support.

**Why now:** We have the constraint infrastructure and path-equation evaluation.
This makes the domain model falsifiable, which greatly increases its utility for
planning.

**What's in place:**
- `evaluateConstraints()` in `constraints.ts` handles pluggable constraint kinds
- `ConstraintKind` in `ontology.ts` is extensible
- Domain arrows and `implementedAs` arrows are both in the store
- Design in `.plans/2026-04-29-categorical-domain-model.md`

**What to build:**
- Add `'functoriality'` to `ConstraintKind`
- In `constraints.ts`: for each domain arrow, BFS from `impl(srcDomain)` over
  `callerOf` edges (depth ≤ 5); emit violation if `impl(dstDomain)` unreachable
- Wire into `olog_validate` response alongside path equations

---

## 3. `rewrite_body` Render Strategy

**What:** `rewrite_body` is a valid `PlanOperation` and passes `olog_validate`,
but the render pipeline has no `expand.ts` strategy for it — the plan operation
is a signal to delegate to `@code-writer`, not a direct source edit. The gap
is that `olog_apply` with `render=true` currently silently skips it.

**Why now:** This is the most common delegation workflow. Completing it makes
the plan→validate→apply→delegate flow actually end-to-end.

**What to build:**
- In `render/expand.ts`, add a case for `rewrite_body` that emits a
  `SourceEdit` replacing the function body with a `// REWRITE_PENDING` marker
  and a structured comment carrying the rationale
- This gives `olog_apply render=true` a concrete action; the marker also lets
  the agent confirm the stub is on disk before calling `olog_delegate`
- Alternatively (simpler): skip the edit, but return a `pendingDelegations`
  field from `olog_apply` listing the `rewrite_body` ops so the agent knows
  to call `olog_delegate` next

---

## 4. Span Coverage Metrics in `olog_dump`

**What:** `olog_dump` currently returns element/arrow counts by kind. Adding a
span-coverage metric — what percentage of functions/methods have a stored span
vs. are span-less — would give an immediate health signal for the index.

**Why now:** Quick win. Span coverage determines how useful `olog_inspect` and
`olog_delegate` are on a given codebase. Low coverage = something is wrong with
extraction.

**What to build:**
- In `db.ts`: `getSpanCoverage(): Record<string, { withSpan: number; total: number }>`
- Surface in `olog_dump` response as `spanCoverage`

---

## 5. Cross-File `callerOf` Coverage Report in `olog_query`

**What:** With the new cross-module call resolution in the TypeScript adapter,
`callerOf` arrows now carry `dstModule`. But it's unclear how many arrows are
still unresolved (dstModule = ''). A diagnostic would show the resolution rate.

**Why now:** Before trusting cross-module call graphs for delegation or mining,
it's useful to know the actual coverage. Also helps debug adapter issues.

**What to build:**
- A `stats: true` mode in `olog_query` (or a field in `olog_dump`) that counts
  `callerOf` arrows by resolution state: `{resolved: N, unresolved: N}`
- Arrow is considered resolved if `dst_id` points to an element with a non-null module

---

## 6. `olog_domain_discover` Dedup Fix

**What:** The untracked `.plans/2026-04-27-domain-dedup-fix.md` suggests there's
a known bug in domain element deduplication. Worth reading and fixing if it
causes incorrect duplicate domain nodes.

**What to do:** Read `.plans/2026-04-27-domain-dedup-fix.md` and assess severity.

---

## 7. Clojure `defmulti` / `defmethod` Call Graph

**What:** The Clojure adapter extracts `defmulti` as a method and `defmethod`
implementations, but does not emit arrows from `defmethod` to their dispatch
values or from callers of the multimethod to the right `defmethod` branch.
This means polymorphic dispatch is invisible to the olog.

**Why now:** In a Clojure codebase that uses multimethods heavily, the call
graph will have large holes. `olog_delegate` analogues and `mustCall` will miss
multi-method relationships.

**What to build:**
- In `extract.ts` (Clojure): when processing `defmethod`, emit a
  `dispatchesTo` arrow from the multimethod element to each `defmethod`
  implementation, keyed by dispatch value
- When processing a call to a multimethod name, emit `callerOf` to the
  multimethod element (not to each branch — the dispatch is runtime)

---

## 8. LSP-Backed Import Resolution for TypeScript Render

**What:** The current `render/imports.ts` uses heuristic string matching to
compute which import statements to add/remove during rename/move operations.
This breaks on re-exports, barrel files, and path aliases.

**Why later:** High effort; requires an LSP server process running alongside
the MCP server. But it's the correct long-term fix for the render pipeline's
biggest fragility.

**What to build:**
- Optional LSP client (typescript-language-server) started lazily in the MCP
  server process
- Use `textDocument/definition` to verify rename targets; `workspace/applyEdit`
  for cross-file renames
- Falls back to heuristic if LSP unavailable

---

## 9. Instance Grounding (Longer Term)

**What:** Currently code elements ARE the instance layer. Separating runtime
data from code elements would allow querying the domain model like a schema:
"find all data records that are a domain-X".

**Why later:** Design-phase only; requires significant schema changes and a
clear use case driving the need.

**Reference:** `.plans/2026-04-29-categorical-domain-model.md §4`

---

## Priority Order

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | Pullback mining | Medium | High — completes the functorial picture |
| 2 | Functoriality validation | Medium | High — makes domain model falsifiable |
| 3 | `rewrite_body` render | Small | High — completes the plan→apply→delegate flow |
| 4 | Domain dedup fix | Small | Medium — bug fix, read plan first |
| 5 | Span coverage in `olog_dump` | Small | Medium — diagnostic health signal |
| 6 | Cross-file callerOf stats | Small | Medium — resolution rate visibility |
| 7 | Clojure multimethod call graph | Medium | Medium — Clojure-specific gap |
| 8 | LSP-backed import resolution | Large | Medium — correctness for complex TS projects |
| 9 | Instance grounding | Large | Low — speculative |
