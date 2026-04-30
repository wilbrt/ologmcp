# Refactor Session Retrospective: Olog MCP Improvements

**Date:** 2026-04-30
**Session:** Structural pattern extraction (SessionStore, queryRelatedElements, LanguageAdapterConfig)
**Plan file:** `.plans/2026-04-30-structural-extractions.md`

This document captures what went wrong, what was manual, and what should be automated
so future refactoring sessions are faster and require less human assembly.

---

## 1. No Structural Similarity Detection  🔴 HIGH PRIORITY

**What happened:** I had to manually discover that `MotifSessionStore` and
`DomainSessionStore` were near-identical by reading their source files and
comparing method-by-method. Same for the `gather*` functions.

**What's needed:** A query like:
- "Find all classes that share ≥80% of their method names"
- "Find all functions with matching parameter-and-call-graph shapes"

The olog has `hasProperty`, `memberOf`, `calls`, and `calleeOf` arrows, so the
data exists. What's missing is a **similarity search** operation that compares
two elements by their structural neighborhoods.

**Concrete fix:** Add `olog_similar(elementId, threshold)` → returns elements
whose ego-graph overlap exceeds the threshold. This would have immediately
surfaced `MotifSessionStore ≈ DomainSessionStore` (7/7 shared methods, 5/5
shared properties) and the `gather*` family similarity.

---

## 2. Motif Discovery Overwhelmed by Schema Noise  🔴 HIGH PRIORITY

**What happened:** The default `discover_motifs` run returned **0 candidates**.
When I tuned parameters manually (depth=3, minSupport=2, specific arrowKinds),
it produced 37 candidates — but the top ones were just "a file contains many
functions and imports" with 73-arrow shapes. The interesting patterns (duplicate
session stores, similar gather functions) were buried under structural
boilerplate.

**Root cause:** The arrows `contains`, `definedIn`, `inModule`, `locatedIn`,
`importsFrom` are present on almost every element. They create huge, low-signal
ego-graphs that dominate motif shapes.

**Concrete fixes:**

- **Add `excludeArrowKinds` parameter** to motif discovery. Let the caller say
  "ignore `contains`, `definedIn`, `inModule`, `locatedIn`, `importsFrom`" and
  mine only the interesting arrows (`calls`, `calleeOf`, `memberOf`,
  `hasProperty`, `hasType`, `implements`).
- **Auto-tune defaults**: When all seeds produce the same shape
  (file-with-many-children), automatically flatten or filter and re-run.
- **Shape compression**: Two motifs that differ only in the number of
  `contains` children are the same pattern. Normalize out "fan-out" nodes.

---

## 3. Can't Plan New Files or Symbols  🟡 MEDIUM PRIORITY

**What happened:** Creating `packages/core/src/session-store.ts` was an entirely
manual process. I had to:
1. Write the file content in the edit agent's prompt verbatim
2. `olog_plan` didn't support `createFile` — I could only `addSymbol`
3. `olog_delegate` doesn't have a "create new file" task type

The planning workflow assumes you're always modifying existing elements, never
creating new ones from scratch.

**Concrete fixes:**

- **`olog_plan`**: Add a `createFile` operation with `path` and `description`
  fields
- **`olog_delegate`**: Add a `write_new_file` task type that assembles context
  from analogues plus a description
- **Plan markdown**: Allow sections like `## New files` alongside
  `## Olog operations`

---

## 4. Explore Agent Can't Read Source Code  🟡 MEDIUM PRIORITY

**What happened:** The `@explore` agent can only query the olog. When I needed
to compare the actual bodies of `gatherMustCall` and `gatherUsedBy`, I had to
manually prefetch source through the explore agent (which has to use the read
tool, not olog queries) and paste it into the edit agent's prompt.

**Concrete fix:** The `@explore` agent should be able to read file spans
directly (using `olog_inspect` which returns source snippets, or falling back to
file reads). Better yet, `olog_delegate` should automatically include source
bodies for analogue elements, not just signatures.

---

## 5. Equation Mining Found Meta-Model Invariants, Not Code Patterns  🟡 MEDIUM PRIORITY

**What happened:** The equation miner returned 50 equations, but they were all
about the meta-model: `inModule = locatedIn`, `memberOf → definedIn =
memberOf → inModule`, etc. None said "these two classes have the same method
set" or "these functions call the same helpers".

The equation miner operates on the graph algebra (arrow composition), which
finds categorical invariants. That's architecturally interesting but not what a
refactoring needs.

**Concrete fix:** Add a **structural equation miner** that operates at a
different level. Instead of composing arrows, compare element neighborhoods:
- "Class A and class B have the same method names" →
  `memberOf(A) ◦ name = memberOf(B) ◦ name`
- "Function X and function Y call the same set of helpers" →
  `callerOf ∘ callerOf` overlap

This is not path equations on the graph, but **element-level shape equations**.

---

## 6. No `hasSignature` or `hasParameterCount` Arrows  🟡 MEDIUM PRIORITY

**What happened:** The olog stores `name`, `kind`, `module`, and `span` for each
element, but not the function signature. When comparing `gatherMustCall` vs
`gatherUsedBy`, I couldn't determine they had similar signatures
`(OlogStore, string) → Entry[]` from the olog alone — I had to read source.

**Concrete fix:** During tree-sitter ingestion, extract and store:
- Function parameter types and count
- Return type (as stored in `attrs.typeText` or parsed from signature)
- Class property types

Then `hasSignature` arrows (or `attrs.parameters` / `attrs.returnType`) would
enable similarity search without reading files.

---

## 7. The Edit Agent Needed Manual File Content Assembly  🟢 LOWER PRIORITY

**What happened:** For the `SessionStore` creation, I had to manually paste the
entire source of both session stores into the edit agent prompt. `olog_delegate`
can only brief on existing elements, and the new class doesn't exist yet.

**Concrete fix:** When `olog_delegate` receives a task of type `write_new_file`,
it should:
1. Accept an explicit list of **analogue element IDs** (already supported via
   `contextOverrides.analogues`)
2. Auto-include their source bodies in the brief
3. Accept a `description` field for the new element's purpose
4. Not require a `target` element ID (currently mandatory)

---

## Priority-Ordered Summary

| Priority | Fix | Impact on Refactor Session |
|---|---|---|
| **1** | `excludeArrowKinds` in motif discovery | Would have surfaced meaningful patterns immediately instead of 0 results |
| **2** | Structural similarity search (`olog_similar`) | Would have found `MotifSessionStore ≈ DomainSessionStore` and `gather*` similarity automatically |
| **3** | Store function signatures in element attrs | Would have enabled signature-based similarity without reading source |
| **4** | New-file creation in planning workflow | Would have made `SessionStore<T>` creation a planned operation, not manual assembly |
| **5** | Source-reading in explore agent | Would have avoided manual file prefetching |
| **6** | Element-level shape equations | Would have found "same method names on two classes" as invariant |
| **7** | `write_new_file` task type in delegate | Would have auto-assembled context from analogues instead of manual pasting |

Items 1–3 would have the highest impact: they would have turned a ~30-minute
manual exploration session into a single `olog_similar` query followed by a
planned extraction.

---

## What Worked Well

- **Equation mining** correctly identified the 5 call-graph invariant-breaking
  functions, even though they turned out to be intentional cross-module calls.
  This is a useful diagnostic.

- **`olog_delegate`** produced excellent briefs for existing elements — the
  `gatherMustCall` brief included its full source, callers, and context, making
  refactoring straightforward.

- **`olog_plan` + `olog_validate`** caught no violations when adding new symbols,
  confirming the structural model is sound for incremental changes.

- **`@edit` agent** executed all 3 extractions correctly on first attempt with
  TypeScript compilation passing each time.