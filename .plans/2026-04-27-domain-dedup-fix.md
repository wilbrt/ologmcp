# Plan: Fix Domain Discovery Duplicate Creation Bug

## Intent

The domain discovery commit path creates duplicate domain objects each time a session is committed. When a user runs `start` → `refine` → `commit` multiple times, every commit creates fresh domain elements with new UUIDs for the same `codeElementId`, instead of detecting that a domain element already exists for that code element and reusing it. This has resulted in 35 duplicate pairs (70 domain elements instead of 35 unique concepts).

The fix has two parts:
1. **Root cause**: Modify the commit handler in `olog-domain-discover.ts` to check for existing domain elements with the same `codeElementId` before inserting new ones, reusing the existing domain element ID when found.
2. **Cleanup**: Remove the 35 stale duplicate domain objects that lack rich arrows (the `HEAD`-provenanced ones).

## Root cause analysis

- `discoverDomainCandidates()` at `discover.ts:93` generates `candidateId = randomUUID()` for each candidate, so `domain:${candidate.id}` is always new per session
- `discoverDomainCandidates()` at `discover.ts:123-135` builds an `existingDomainByCodeId` map but only uses it for arrow codomain resolution—not for commit deduplication
- The commit handler at `olog-domain-discover.ts:275-289` calls `store.addElement()` without checking if a domain element for `codeElementId` already exists
- `addElement()` at `db.ts:721-730` uses a plain `INSERT` with no conflict handling; `codeElementId` is stored in JSON `attrs`, not as an indexed column

## Olog operations

None — this is a pure code fix within existing functions.

## Invariants to preserve

- `discoverDomainCandidates()` must still build `existingDomainByCodeId` for arrow resolution
- Existing domain elements with rich arrows (provenance from specific commits) must not be deleted or modified
- `addElement` / `addArrow` signatures in `OlogStore` must remain unchanged
- Arrow IDs generated during commit must remain deterministic for idempotency

## Implementation slices

1. **write_function_body**: `packages/mcp-server/src/tools/olog-domain-discover.ts` commit handler (lines ~269-331) — Before inserting domain elements, query existing domain elements and build a `codeElementId → existingDomainElemId` map. For each accepted candidate, if a domain element already exists for its `codeElementId`, skip `addElement` and map `candidate.id → existingElem.id` in `candidateToElemId`. Also skip the bridge arrow if it already exists.

2. **write_function_body**: `packages/core/src/domain/discover.ts` — Export `discoverDomainCandidates`'s `existingDomainByCodeId` logic as a reusable helper function `getExistingDomainElementsByCodeId(store: OlogStore): Map<string, string>` so the commit handler can call it.

3. **Data cleanup**: After the code fix, remove the 35 duplicate domain elements (those with `HEAD` provenance and minimal arrows) from the olog database. This can be done via a targeted script or manual SQL.

## Acceptance criteria

- Re-running domain discovery `start → refine → commit` for an already-committed code element produces **zero new domain elements**
- The `candidateToElemId` map correctly maps to existing domain element IDs when duplicates are found
- Bridge arrows (`implementedAs`) and cross-domain arrows reference the canonical domain element
- The `addedObjects` count in commit responses accurately reflects new-vs-reused elements
- Existing domain relationships (has kind, has domain, has codomain, etc.) remain intact

## Validation status
- [ ] olog_plan created (N/A — no structural changes)
- [ ] olog_validate passed (N/A)
- [x] Slices defined
- [ ] Slice 1 delegated and completed
- [ ] Slice 2 delegated and completed
- [ ] Data cleanup completed
- [ ] olog_reindex run