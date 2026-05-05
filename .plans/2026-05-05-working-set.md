# Plan: DB-backed working set for the planning agent

## Problem

The planning agent accumulates structural knowledge across many explore calls but
has no memory of what it has already investigated. By turn 10+ it re-asks explore
for elements it already retrieved earlier in the session. Explore returns markdown
prose, so the planning agent can't detect duplicates or query what it already knows.

## Solution

A lightweight "working set" — a named, persistent subgraph scoped to a planning
session — stored in the same SQLite DB. The planning agent opens one at the start
of a session, adds elements/arrows as explore returns them, and checks it before
calling explore again. Explore switches from markdown output to structured JSON so
the planning agent can actually accumulate and deduplicate results.

---

## Architecture

### New tables (schema.sql)

```sql
CREATE TABLE IF NOT EXISTS olog_working_set (
  id         TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  plan_hash  TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (id)
) STRICT WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS olog_working_set_elem (
  set_id  TEXT NOT NULL REFERENCES olog_working_set(id) ON DELETE CASCADE,
  elem_id TEXT NOT NULL,
  PRIMARY KEY (set_id, elem_id)
) STRICT WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS olog_working_set_arr (
  set_id TEXT NOT NULL REFERENCES olog_working_set(id) ON DELETE CASCADE,
  arr_id TEXT NOT NULL,
  PRIMARY KEY (set_id, arr_id)
) STRICT WITHOUT ROWID;
```

No foreign key to `olog_elem` — elements can be in the working set even if they
are later re-indexed (IDs are stable content hashes).

### New OlogStore methods (db.ts)

```
createWorkingSet(name, planHash?) → id
addToWorkingSet(setId, elemIds, arrIds) → { elementsAdded, arrowsAdded }
getWorkingSet(setId) → { id, name, planHash, elements: OlogElem[], arrows: OlogArr[] }
listWorkingSets() → Array<{ id, name, planHash, elementCount, arrowCount, updatedAt }>
deleteWorkingSet(setId) → void
```

`getWorkingSet` joins olog_working_set_elem → olog_elem and olog_working_set_arr →
olog_arr, returning full typed objects (not just IDs).

### New MCP tools (core server — available to planning agent)

| Tool | Purpose |
|---|---|
| `olog_ws_open` | Create a working set; returns `setId`. Call once at start of session. |
| `olog_ws_add` | Add element and/or arrow IDs to an open working set. |
| `olog_ws_query` | Query the working set with optional kind/name/module filters. Returns elements + arrows. |
| `olog_ws_drop` | Delete a working set when the session is done. |

`olog_ws_query` intentionally mirrors `olog_query` — same filter parameters, same
return shape — so the planning agent can treat the working set as a local olog.

### Explore agent output format change

Current output (markdown):
```
## Facts
- ElementName does X [ref: elem:abc123]
## Gaps
none
```

New output (JSON):
```json
{
  "elements": [ { "id": "...", "kind": "function", "name": "...", ... } ],
  "arrows":   [ { "id": "...", "kind": "calls", "srcId": "...", "dstId": "..." } ],
  "gaps": "The olog has no callers for element X — it may be a leaf."
}
```

`gaps` is a free-text string, not structured — it's the one field that requires
LLM judgment rather than data retrieval.

---

## Implementation slices

### Slice 1 — Schema
Add the three tables to `packages/core/src/schema.sql`. Schema is applied via
`CREATE TABLE IF NOT EXISTS` so existing DBs gain the tables on next startup.

### Slice 2 — OlogStore methods
Add `createWorkingSet`, `addToWorkingSet`, `getWorkingSet`, `listWorkingSets`,
`deleteWorkingSet` to `packages/core/src/db.ts`. Prepare all statements in
constructor alongside existing ones. Export new types from `packages/core/src/index.ts`.

### Slice 3 — MCP tools
Add `packages/mcp-server/src/tools/olog-ws.ts` with four `register*` functions.
Wire them into `packages/mcp-server/src/index.ts` (core server only — not mining).

### Slice 4 — Explore agent output format
Change `olog-explore.md` and `AGENT_EXPLORE` in `init.ts` to return JSON instead
of markdown facts. Update the Mode A output spec and constraints section.

### Slice 5 — Planning agent prompt
Update `olog-planning.md` and `AGENT_PLANNING` in `init.ts`:
- Open a working set at the start of Phase 1
- After each explore call, add returned elements/arrows to the working set via `olog_ws_add`
- Before calling explore, check `olog_ws_query` for elements already in the set
- Drop the working set in Phase 5 after `olog_reindex`

---

## What this does NOT do

- No deduplication of explore calls automatically — the planning agent still
  decides when to call explore; the working set just makes "do I already have
  this?" answerable.
- No cross-session persistence intended — working sets are dropped at plan
  completion. If a session dies mid-plan, the working set remains and can be
  reopened by ID (stored in the plan file).
- No changes to `olog_query` or `olog_inspect` — those remain available for
  one-off lookups that don't need to be accumulated.

---

## Validation status
[ ] Schema reviewed
[ ] OlogStore methods implemented and typechecked
[ ] MCP tools registered and typechecked
[ ] Explore format change applied to agent files and init.ts
[ ] Planning agent prompt updated
[ ] End-to-end test: open set → explore → add → query → drop
