# Plan: General Improvements v2 — Reorganized

## Intent
Implement improvements to the olog MCP pipeline that establish a tiered edit path (A/B/C), reduce token cost for targeted edits, prevent silent failures, and make plan management more robust. Originally 7 issues, expanded to 16, now reorganized into 5 execution waves dropping 3 groups that are better handled as agent concerns.

## Design Decisions (from trade-off analysis)

**D1: Mixed-plan approach → Return pending ops, don't auto-delegate.**
`olog_apply render=true` processes only mechanical ops. When it encounters `rewrite_body` ops, it skips them and returns a `pendingDelegations` list. The planning agent delegates those via `olog_delegate` → `@olog-edit` in its own loop. Keeps apply focused; gives the agent control.

**D2: Drop callSiteUpdate (Issue 14) → Solve with callers in briefs (Issue 13).**
Mechanically appending arguments at call sites is fragile. Including callers in delegation briefs (with `signatureChange` flag) lets the edit agent handle any signature change robustly. Group K absorbs this responsibility.

**D3: Drop dependency ordering (Issue 8) and build verification (Issue 11) → Agent concerns.**
The planning agent has import arrows via `olog_query` and `bash` for build checks. No pipeline changes needed.

**D4: Group N (shared types) → Last, as cleanup.**
Moving types to `@olog/core` is valuable but not blocking. Do it last when all functional changes have landed.

## Issues Tracking

### Completed Issues

1. ✅ **rewrite_body support in olog_apply** (Issue 1 — partial) — Zod schema added; full mixed-plan handling in Wave 3
2. ✅ **Barrel file support** (Issue 2) — `addReexport` type + render strategy + validation complete
5. ✅ **Plan persistence** (Issue 5) — `.olog/plans/<hash>.json` with in-memory cache
6. ✅ **Lightweight type edits** (Issue 6) — `amendType` type + render strategy + validation complete
7. ✅ **Auto-reindex after olog_apply** (Issue 7) — `reindexed: true` flag in response
12. ✅ **Inbound reference tracing** (Issue 12) — `direction: "in"` already implemented
15. ✅ **New-file stub rendering** (Issue 15 — partial) — Typed stubs with `throw new Error`; skip-on-rewrite still pending (Issue 19)

### Active Issues (by wave)

- **Wave 1**: Issue 12 ✅ (inbound reference tracing — already implemented)
- **Wave 2**: Issues 15 (partial ✅), 2 ✅, 6 ✅ (stub rendering, re-export render, amend-type render, validation)
- **Wave 3**: Issues 1, 3, 13+14 (mixed plans, lineRange/skipAnalogues, callers in briefs)
- **Wave 4**: Issue 9 (fast-path delegation)
- **Wave 5**: Issue 16 (shared types to core)
- **Wave 6**: Issues 17, 18, 19 (class method indexing, fuzzy IDs, skip stub on rewrite_body)

### New Issues (17–19) — From Wave 2 Retrospective

#### 17. Class methods not indexed by tree-sitter adapter
**What happened:** `OlogStore.applyPlan` is a class method, not a top-level function. The olog didn't have an element for it, so `rewrite_body` couldn't target it. Had to delegate at module level, sending the entire ~1000-line file. The edit agent ran out of steps and left a duplicate `default` case requiring a manual cleanup delegation.

**Fix:** Update the tree-sitter adapter to index methods on exported classes as `method` kind elements with their own spans, so they're targetable via `rewrite_body` without sending the whole file.

#### 18. Fuzzy element ID resolution in olog_plan/olog_validate
**What happened:** Wrote `symbol:packages/core/src/render/strategies/add-symbol.ts/computeAddSymbolEdits` as a target ID. The actual ID was `module:packages/core/src/render/strategies/add-symbol.ts:36:17:function:computeAddSymbolEdits`. Validation failed, requiring 5 separate `olog_query` calls to find the correct IDs.

**Fix:** When `olog_plan` or `olog_validate` receives a target that doesn't match any element ID exactly, attempt fuzzy resolution: try matching by name regex, module prefix, or kind. If exactly one match is found, use it. If multiple matches, return them as a validation error with the candidates listed.

#### 19. addSymbol stub should be skipped when rewrite_body targets the same file
**What happened:** `olog_apply render=true` created stub files with `// TODO: implement` bodies, then separately delegated `rewrite_body` to fill them in. The stubs used the old template format because Group M's stub improvement happened in the same wave — the `addSymbol` ran before the stub templates were fixed. Even with improved stubs, the sequence is wasteful: create a stub, then immediately rewrite it.

**Fix:** When `expandOperation` processes an `addSymbol` for a file that also has `rewrite_body` operations in the same plan, skip the stub entirely. The `rewrite_body` delegation will produce the full file content. This requires passing the plan's operation list to `expandOperation` (or `expandAllOperations` which already receives it).

### Dropped Issues

8. ~~Dependency ordering~~ → **Restored as Issue 19's prerequisite** — The agent had to manually determine edit order for dependent files. Issue 8's fix (return `editOrder` hint from `olog_plan`) is now re-scoped: `olog_plan` should analyze import arrows between files targeted by `rewrite_body` ops and return an `editOrder` array.
11. **Build verification** — Agent runs `bash` for build checks after edits
14. **callSiteUpdate operation** — Absorbed by Issue 13 (callers in briefs)

## Tiered Edit Path (Updated)

| Tier | Kind of change | Mechanism | Token cost | Status |
|------|---------------|-----------|------------|--------|
| A | Add symbol, rename, move, add arrow, add re-export, amend type union | `olog_plan` → `olog_apply render=true` (auto-reindex) | ~100 | ✅ Complete |
| B | Targeted insertion in a known location | `olog_delegate` with line-range scoping → `@edit` | ~2K | **Pending (Wave 3)** |
| C | Full body rewrite | `olog_delegate` full brief → `@edit` | ~5-10K | Current default |

## Wave Execution Plan

### Group A ✅ — Type system + Zod schemas + auto-reindex
**Status: COMPLETE**
- `packages/core/src/ontology.ts` — Added `addReexport` and `amendType` variants to `PlanOperation`
- `packages/mcp-server/src/tools/olog-plan.ts` — Added Zod schemas + switch cases for new ops
- `packages/mcp-server/src/tools/olog-apply.ts` — Added `addReexport`, `amendType`, `rewrite_body` to schema; auto-reindex in no-source-edits branch; `reindexed: true` + `note` flags

### Group B ✅ — Plan persistence (Issue 5)
**Status: COMPLETE**
- `packages/mcp-server/src/tools/olog-plan-store.ts` — Persist plans to `.olog/plans/<hash>.json`
- `persistPlan(hash, plan)` and `loadPlan(hash)` functions
- Keep in-memory Map as LRU cache

---

### Wave 1 — Query Infrastructure
**Why first:** Tiny change, big leverage. Enables safe refactoring in all subsequent waves.

#### Group J — Inbound reference tracing in olog_query (Issue 12)
**Status: COMPLETE (already implemented)**
- ✅ `direction: "in"` parameter was already fully wired in the MCP tool schema, handler, and core traverse engine

---

### Wave 2 — Render Pipeline ✅
**Why together:** All touch `render/` and `expand.ts`. M fixes the existing stub bug; C adds new strategies on the fixed foundation; F completes the cycle with validation.

#### Group M — Improved new-file stub rendering (Issue 15)
**Status: PARTIALLY COMPLETE**
- ✅ `packages/core/src/render/strategies/add-symbol.ts` — Replaced `TODO`/`unknown` stubs with typed stubs: `throw new Error('Not implemented')`, `never`, `{}`, `any`
- ❌ `packages/core/src/render/expand.ts` — Skip stub rendering when `rewrite_body` targets same file (Issue 19 — not yet implemented)

#### Group C — DB + render strategies for addReexport & amendType (Issues 2, 6)
**Status: COMPLETE**
- ✅ `packages/core/src/db.ts` — Added `addReexport` and `amendType` cases to `applyPlan`
- ✅ `packages/core/src/render/strategies/add-reexport.ts` — New file: `computeAddReexportEdits` — reads barrel file, computes relative import path, appends re-export line
- ✅ `packages/core/src/render/strategies/amend-type.ts` — New file: `computeAmendTypeEdits` — uses element span to locate type, appends union member or property
- ✅ `packages/core/src/render/expand.ts` — Added `addReexport` and `amendType` cases to `expandOperation`
- ✅ `packages/core/src/render/index.ts` — Added verification cases for `addReexport`, `amendType`, `addArrow`, `removeArrow` in `verifyOperation`

#### Group F — ProjectedState validation for new ops (Issues 2, 6)
**Status: COMPLETE**
- ✅ `packages/mcp-server/src/tools/olog-validate.ts` — Added `addReexport` (projected element + module existence + name uniqueness) and `amendType` (target existence) cases to both `ProjectedState` and validation loop

---

### Wave 3 — Delegation Pipeline
**Why together:** All touch the delegate/apply path. D is most impactful; E and K reduce cost and risk respectively.

#### Group D — Mixed plans: return pending ops (Issue 1)
**Status: PENDING**
- `packages/mcp-server/src/tools/olog-apply.ts` — When processing a plan with `rewrite_body` ops, apply only mechanical ops. Return `pendingDelegations: [{ target, task, rationale }]` for each rewrite_body op
- Response shape changes to: `{ applied: [...], warnings: [...], reindexed: boolean, pendingDelegations: [{ target, task, rationale }] }`

#### Group E — lineRange + skipAnalogues in assembleBrief (Issue 3)
**Status: PENDING**
- `packages/core/src/delegate/index.ts` — Add `lineRange?: { start: number; end: number }` and `skipAnalogues?: boolean` to `ContextOverrides`
- When `lineRange` is provided, use it to scope the target body content instead of the full span
- When `skipAnalogues` is true (or when target body is large and `maxAnalogues=0`), skip `findAnalogues` call
- `packages/mcp-server/src/tools/olog-delegate.ts` — Add `lineRange` and `skipAnalogues` to MCP tool input schema, pass through to `assembleBrief`

#### Group K — Include callers in delegation briefs (Issues 13 + 14)
**Status: PENDING**
- `packages/core/src/delegate/index.ts` — In `assembleBrief`, when the target is a function/method, traverse `callerOf` arrows and include top 3 callers' source context
- Add `signatureChange?: boolean` field to `ContextOverrides`. When true, always include callers regardless of target kind
- `packages/mcp-server/src/tools/olog-delegate.ts` — Expose `signatureChange` in MCP tool schema
- *This replaces the former Group L (callSiteUpdate) — callers in the brief let the edit agent update call sites for any kind of signature change*

---

### Wave 4 — Quality of Life

#### Group H — Fast-path delegation without plan (Issue 9)
**Status: COMPLETE** — `olog_delegate` never had a `planHash` param; it always called `assembleBrief` directly. The tool accepts `{ target, task, rationale }` with everything else optional.

---

### Wave 5 — Cleanup

#### Group N — Move shared types to @olog/core (Issue 16)
**Status: COMPLETE** — `StoredPlan` replaced by the existing `Plan` type from `@olog/core/ontology.ts` (identical shape, already exported). `PlanOperationInput` was unused dead code; deleted. Casts removed from `olog-apply.ts` and `olog-render.ts`. `olog-plan-store.ts` now imports `Plan` from `@olog/core`.

---

### Wave 6 — Olog Pipeline Improvements (from Wave 2 retrospective)

#### Group O — Class method indexing (Issue 17)
**Status: COMPLETE** — `extract.ts` now uses `@method` capture (full `method_definition` node) for the span instead of `@method.name` (just the identifier). Abstract methods fall back to the name node. Methods like `OlogStore.applyPlan` are now targetable via `rewrite_body`.

#### Group P — Fuzzy element ID resolution (Issue 18)
**Status: COMPLETE** — Added `fuzzyFindElement` + `notFoundMessage` in `olog-validate.ts`. All `notFound` violations for `move`, `rewrite_body`, `addArrow src/dst`, `amendType` now include fuzzy candidates by name. Single candidate: "Did you mean X?". Multiple: lists all. Also removed remaining `as unknown as PlanOperation[]` cast.

#### Group Q — Skip addSymbol stub when rewrite_body targets same file (Issue 19)
**Status: COMPLETE** — `expandAllOperations` in `expand.ts` now pre-collects modules targeted by `rewrite_body` ops and skips `addSymbol` stubs for those modules, emitting a warning instead.

## Invariants to preserve

1. **Backward compatibility**: All existing PlanOperation variants must continue to work unchanged
2. **Zod schema consistency**: `olog-plan.ts` operationSchema and `olog-apply.ts` planOperationSchema must include the same set of operation kinds
3. **`applyPlan` completeness**: Every operation kind in PlanOperation must have a case in `applyPlan` (even if no-op)
4. **`expandOperation` completeness**: Every mechanical operation kind must have a render strategy
5. **`verifyOperation` completeness**: Every operation kind should have a verification case
6. **Plan hash stability**: Changing PlanOperation type changes JSON serialization → existing hashes invalid. Plan persistence (Group B ✅) mitigates this.
7. **Edit order respects imports**: Planning agent queries import arrows before delegating multi-file rewrites
8. **Consumer traceability**: Any exported symbol must be discoverable via `olog_query` inbound reference traversal
9. **New-file stubs must compile**: `addSymbol` in a new file must produce type-correct stubs
10. **Shared types in core (eventually)**: Types used by 2+ tool modules should live in `@olog/core`

## Acceptance criteria

- [x] `addReexport` operation: Plan → Validate → Apply → Verify works end-to-end
- [x] `amendType` operation: same end-to-end flow
- [ ] Mixed plans: `olog_apply render=true` processes mechanical ops and returns `pendingDelegations` for rewrite_body ops
- [ ] `lineRange` override in `olog_delegate`: callable with lineRange param, brief only includes specified lines
- [ ] `skipAnalogues`: delegate brief omits analogues when true
- [x] Plan persistence: plans survive server restart ✅
- [x] Auto-reindex: olog_apply `render=true` response includes reindex note ✅
- [x] Fast-path delegation: `olog_delegate` callable with `{ target, task, rationale }` without planHash — no planHash param exists; always direct
- [x] `olog_query direction="in"` returns all importers/referencers of a queried symbol (already implemented)
- [ ] Delegation briefs include callers when `signatureChange=true`
- [x] New-file `addSymbol` stubs compile without `unknown` types
- [x] `addSymbol` stubs are skipped when `rewrite_body` targets the same file (Issue 19)
- [x] Class methods are indexed by tree-sitter and targetable via `rewrite_body` (Issue 17)
- [x] Fuzzy element ID resolution works in `olog_plan` and `olog_validate` (Issue 18)
- [x] `StoredPlan` and `PlanOperation` imported from `@olog/core` with no casts needed (Wave 5)

## Validation status
- [x] Plan reorganized (v2)
- [x] Wave 1: Group J — already implemented (direction="in" was already wired)
- [x] Wave 2: Groups M ✅ (partial), C ✅, F ✅ — render pipeline changes applied
- [x] Wave 3: Groups D, E, K — delegation pipeline changes (see 2026-05-03-wave3-delegation-pipeline.md)
- [x] Wave 4: Group H — fast-path delegation (already satisfied; no planHash ever existed)
- [x] Wave 5: Group N — shared types to core (StoredPlan → Plan; casts removed)
- [x] Wave 6: Groups O, P, Q — olog pipeline improvements