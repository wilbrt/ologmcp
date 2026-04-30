# Plan: Arrow Compression — Remove Redundant Stored Arrows

## Intent

The olog stores ~3,268 arrows, of which approximately 2,000 are redundant:
- `inModule` (679 arrows) ≡ `definedIn` (equation: `inModule = definedIn`, 100% coverage)
- `locatedIn` (679 arrows) ≡ `definedIn` (equation: `locatedIn = definedIn`, 100% coverage)
- `contains` (679 arrows) ≡ `definedIn⁻¹` (inverse relationship)
- `imports` (344 arrows) ≡ relationship derivable from `importsFrom`
- `callerOf` (303 arrows) ≡ `calls` (equation: `calls = callerOf`, 100% coverage)

These redundant arrows flood motif discovery with noise, making all shapes unique
and preventing pattern detection. This plan removes 4 of 5 redundant arrow kinds
from storage, computes them on-the-fly via OlogStore methods, and keeps `callerOf`
stored (it's heavily consumed).

## Canonical vs Derived

| Arrow kind | Verdict | Canonical source | Derivation |
|---|---|---|---|
| `definedIn` | **Keep** (canonical) | Stored | — |
| `inModule` | **Derive** | `definedIn` | `outgoing(elemId).filter(a => a.kind === 'definedIn')` |
| `locatedIn` | **Derive** | `definedIn` | Same as `inModule` (identical relationship) |
| `contains` | **Derive** | `definedIn⁻¹` | For file F: find all elements where `definedIn` points to F |
| `imports` | **Derive** | `importsFrom` | For file F: find import elements with `importsFrom` arrow |
| `callerOf` | **Keep** (stored) | — | Too many consumer sites (~10); low risk, low redundancy cost |
| `calls` | **Keep** (canonical) | — | — |
| `calleeOf` | **Keep** (stored) | — | Different relationship (incoming calls) |

## Implementation Slices

### Slice 1: Add derived-arrow methods to OlogStore

**File:** `packages/core/src/db.ts`

Add three new methods to `OlogStore`:

```typescript
/**
 * Derive `inModule` arrows: elem --inModule--> module
 * Equivalent to `definedIn` arrows (same src/dst).
 * Returns arrows with kind='inModule' for API compatibility.
 */
derivedInModule(elemId: string): OlogArr[] {
  return this.outgoing(elemId)
    .filter(a => a.kind === 'definedIn')
    .map(a => ({ id: a.id.replace('definedIn', 'inModule'), kind: 'inModule', srcId: a.srcId, dstId: a.dstId, attrs: a.attrs }));
}

/**
 * Derive `locatedIn` arrows: elem --locatedIn--> file
 * Equivalent to `definedIn` arrows (same src/dst, same semantics for code elements).
 */
derivedLocatedIn(elemId: string): OlogArr[] {
  return this.outgoing(elemId)
    .filter(a => a.kind === 'definedIn')
    .map(a => ({ id: a.id.replace('definedIn', 'locatedIn'), kind: 'locatedIn', srcId: a.srcId, dstId: a.dstId, attrs: a.attrs }));
}

/**
 * Derive `contains` arrows: file --contains--> child
 * Inverse of `definedIn`: for element E with definedIn→F, return F contains E.
 * Also include `imports` relationship: file contains its import elements.
 */
derivedContains(fileId: string): OlogArr[] {
  // 1. Find all elements definedIn this file
  const incoming = this.incoming(fileId);
  const definedHere = incoming
    .filter(a => a.kind === 'definedIn')
    .map(a => ({ id: a.id.replace('definedIn', 'contains'), kind: 'contains', srcId: fileId, dstId: a.srcId, attrs: a.attrs }));
  // 2. Find import elements with importsFrom from this file
  const importContainment = incoming
    .filter(a => a.kind === 'importsFrom')
    .map(a => ({ id: a.id.replace('importsFrom', 'contains'), kind: 'contains', srcId: fileId, dstId: a.srcId, attrs: a.attrs }));
  return [...definedHere, ...importContainment];
}

/**
 * Derive `imports` arrows: file --imports--> importElement
 * A file imports an import element if that element has an importsFrom arrow
 * pointing to the same source module as the file's module.
 */
derivedImports(fileId: string): OlogArr[] {
  // This is more complex — we need to find import elements that belong to this file.
  // For now, we'll use the incoming importsFrom arrows.
  const incoming = this.incoming(fileId);
  return incoming
    .filter(a => a.kind === 'importsFrom')
    .map(a => ({ id: a.id.replace('importsFrom', 'imports'), kind: 'imports', srcId: fileId, dstId: a.srcId, attrs: a.attrs }));
}
```

Update `outgoing()` and `incoming()` to transparently include derived arrows
when the kind is requested. This requires a more careful design — see Slice 2.

### Slice 2: Make derived arrows transparent in outgoing/incoming

**File:** `packages/core/src/db.ts`

The key insight: we should NOT modify `outgoing()` and `incoming()` to inject
derived arrows into every query — that would be slow and would re-introduce
the noise problem for motif discovery.

Instead, add specific accessor methods and update ONLY the consumer sites
to call the derived methods explicitly:

```typescript
// In OlogStore, add convenience methods that merge stored + derived:
outgoingWithDerived(elemId: string, kind?: string): OlogArr[] {
  const stored = kind ? this.outgoing(elemId).filter(a => a.kind === kind) : this.outgoing(elemId);
  // Add derived arrows only for the specific kinds requested
  const derived: OlogArr[] = [];
  if (!kind || kind === 'inModule') derived.push(...this.derivedInModule(elemId));
  if (!kind || kind === 'locatedIn') derived.push(...this.derivedLocatedIn(elemId));
  if (!kind || kind === 'contains') derived.push(...this.derivedContains(elemId));
  if (!kind || kind === 'imports') derived.push(...this.derivedImports(elemId));
  return [...stored, ...derived];
}
```

BUT: this is overengineered. The simpler approach is:

**For each consumer site, replace `a.kind === 'inModule'` etc. with the
appropriate canonical arrow kind.** The derived methods are only needed for
the MCP query tool and traverse, where users can still query these arrow kinds.

### Slice 3: Update consumer sites

**`delegate/context.ts` line 220** — Replace `locatedIn`:
```typescript
// BEFORE:
const locatedIn = outgoing.find(a => a.kind === 'locatedIn');
// AFTER:
const locatedIn = outgoing.find(a => a.kind === 'definedIn');
```
(Semantically equivalent: for code elements, `locatedIn` = `definedIn`.)

**`render/strategies/remove-symbol.ts` line 86** — Replace `imports`:
```typescript
// BEFORE:
const importsFrom = incoming.filter(a => a.kind === 'imports');
// AFTER:
const importsFromArrows = incoming.filter(a => a.kind === 'importsFrom');
```
(Use the canonical `importsFrom` arrow instead.)

**`mcp-server/src/tools/olog-query.ts`** — Keep derived kinds in `arrowKindEnum`
but mark them with a `derivedFrom` field in the schema description so users
know they're computed. The tool should compute them on-the-fly when requested.

### Slice 4: Remove redundant arrow creation from ingestion

**`packages/core/src/ingest/project.ts`:**

- **Lines ~429–435**: Remove the loop that creates `inModule` arrows.
- **Lines ~438–444**: Remove the loop that creates `locatedIn` arrows.
- **Lines ~403–413**: Remove the `contains` arrow creation loop.
- **Lines ~511–520**: Remove the `imports` arrow creation loop.

**`packages/lang-typescript/src/extract.ts`:**
- **Lines 186, 191**: Remove `imports` arrow emission (keep `importsFrom`).
- **Lines 203, 216, 229**: Keep `callerOf` emission (we're keeping it stored).

**`packages/lang-clojure/src/extract.ts`:**
- **Line 137**: Remove `imports` arrow emission (keep `importsFrom`).

### Slice 5: Add DB migration to delete existing redundant arrows

**`packages/core/src/db.ts`:**

Add a migration method that deletes all redundant arrows:

```typescript
migrateRemoveRedundantArrows(): number {
  const kinds = ['inModule', 'locatedIn', 'contains', 'imports'];
  let total = 0;
  for (const kind of kinds) {
    const result = this.db.prepare('DELETE FROM olog_arr WHERE kind = ?').run(kind);
    total += result.changes;
  }
  return total;
}
```

Call this migration during `OlogStore` initialization (or as a separate
`olog_migrate` command). Log the number of arrows removed.

### Slice 6: Update motif discovery and mining to exclude derived arrows

**`packages/core/src/mining/index.ts`:**

Add a `DERIVED_ARROW_KINDS` constant and exclude them by default:

```typescript
const DERIVED_ARROW_KINDS = ['inModule', 'locatedIn', 'contains', 'imports'];

// In mineEquations, filter out derived arrows unless explicitly requested:
const arrowKindsToUse = arrowKinds?.filter(k => !DERIVED_ARROW_KINDS.includes(k))
  ?? ALL_ARROW_KINDS.filter(k => !DERIVED_ARROW_KINDS.includes(k));
```

**`packages/core/src/mining/motifs.ts`:**

Similarly, the `discoverMotifs` function should exclude derived arrow kinds
by default, with an opt-in flag to include them.

### Slice 7: Update equation miner to skip trivial equations

**`packages/core/src/mining/paths.ts`:**

The path enumerator should skip paths that are purely composed of `definedIn ↔ inModule ↔ locatedIn`
equivalences. These are now trivially true by construction, not interesting findings.

Add a filtering step that removes candidate pairs where both paths differ only
in `definedIn`/`inModule`/`locatedIn` substitutions.

## Invariants to preserve

1. All MCP tool API responses that include `inModule`, `locatedIn`, `contains`,
   or `imports` arrows must continue to work — these arrows should be computed
   on-the-fly and included in `outgoing`/`incoming` results when they would have
   been present before.

2. `olog_inspect` must still show these arrow kinds in element detail views.

3. `olog_validate` must still accept path equations using these arrow kinds.

4. `callerOf` must remain stored (not derived) — it has ~10 active consumers.

5. The `definedIn ↔ inModule ↔ locatedIn` equations must still be exposed
   in `olog_mine_equations` results, but marked as `trivial: true` or similar.

## Acceptance criteria

- [ ] `inModule`, `locatedIn`, `contains`, `imports` are no longer stored in `olog_arr`
- [ ] `definedIn`, `calls`, `calleeOf`, `importsFrom` are still stored
- [ ] `callerOf` is still stored
- [ ] All MCP tool APIs return derived arrows correctly (transparent to users)
- [ ] `delegate/context.ts` consumers use canonical arrows (`definedIn` instead of `locatedIn`)
- [ ] Motif discovery with default settings returns meaningful results (not 0)
- [ ] Equation mining no longer returns `inModule = definedIn` etc. as "discoveries"
- [ ] Total arrow count drops by ~1,700+ (from ~3,268 to ~1,500)
- [ ] All existing tests pass
- [ ] `olog_query` with `arrowKind: 'inModule'` still works (returns derived arrows)

## Validation status

[ ] olog_plan created
[ ] olog_validate passed
[ ] Slices delegated
[ ] olog_reindex run
[ ] Integration tests pass