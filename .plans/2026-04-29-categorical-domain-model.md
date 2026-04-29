# Categorical Domain Model Improvements

Inspired by Spivak's olog paper. The current system already has:
- `total` flag on arrows (Spivak's totality condition)
- `PathEquation` (commutative diagram facts)
- `implementedAs` as a bridge functor F: D → C (domain → code)

What's missing: computed structure from limits (pullbacks) and extensions (Kan extensions).

---

## 1. Left Kan Extension (highest impact)

**What it is:** Given the functor F: D → C via `implementedAs`, the left Kan extension
Lan_F propagates domain labeling along the code-level call graph. For every
`code-A --callerOf--> code-B` where `code-A --implementedAs--> domain-A`, propose
`domain-A --[lifted arrow]--> domain-B` where domain-B is whatever domain concept
code-B implements (or propose a new concept if none exists).

**Why it matters:** `discoverDomainCandidates` currently only reads struct/class/interface
definitions — purely type-driven. The Kan extension pass makes domain labeling propagate
along function calls, so the domain layer grows to cover the whole call graph rather than
requiring manual labeling of every concept.

**Implementation sketch:**
- After struct-based discovery, walk `callerOf` / `calleeOf` edges from each accepted
  domain element's `implementedAs` target
- For each reachable code element: if it already has a domain label, propose an arrow
  between the two domain concepts; if not, propose a new domain candidate for it
- Depth-limited (configurable, default 2 hops) to avoid flooding
- Arrows get `source: 'kan_extension'` and `confidence: 'tentative'`
- Add to `discoverDomainCandidates` as a second pass, or as a separate
  `extendDomainByKan(store, options)` function in `domain/discover.ts`

---

## 2. Pullback Mining

**What it is:** A pullback of `domain-A --implementedAs--> code-fn` and
`domain-B --implementedAs--> code-fn` (two domain concepts sharing an implementation)
is a new domain concept P with projections P → A and P → B. P represents the hidden
abstraction that the single function already serves — the join of both domain concepts
over that code element.

**Why it matters:** Detects single-responsibility violations at the domain level.
When one function implements two domain concepts, the pullback names the shared
concern that should probably be extracted.

**Implementation sketch:**
- Scan all code elements that have more than one incoming `implementedAs` arrow
- For each such element, group the domain sources — these form a pullback candidate
- Propose a new domain concept P with name derived from the two source names
- Propose arrows from P to each source domain element (with `source: 'pullback'`)
- Implemented as `minePullbacks(store): DomainCandidate[]` in `domain/discover.ts`
- Best surfaced as a separate `olog_mine_pullbacks` tool or folded into `olog_domain_discover`

---

## 3. Functoriality Validation

**What it is:** The `implementedAs` bridge functor should preserve composition. If
`domain-A --f--> domain-B` exists, and `code-A --implementedAs--> domain-A` and
`code-B --implementedAs--> domain-B`, then there must exist a code-level path
(via `calls` / `callerOf`) from code-A to code-B. If not, either the domain arrow
is wrong or the code is missing the call.

**Why it matters:** Makes the domain model falsifiable. Every domain arrow becomes a
testable claim about the code graph. Gaps are architectural violations.

**Implementation sketch:**
- In `olog_validate`, add a new constraint kind: `functoriality`
- For each domain arrow `domain-A --f--> domain-B`:
  - Find code-A via `domain-A --implementedAs--> code-A`
  - Find code-B via `domain-B --implementedAs--> code-B`
  - BFS from code-A over `callerOf` edges; check if code-B is reachable within N hops
  - If not reachable: emit a violation "domain arrow f has no code-level witness"
- Reachability check should be depth-limited (default 5 hops)
- Add `'functoriality'` to `ConstraintKind` in `ontology.ts`

---

## 4. Instance Grounding (longer term)

**What it is:** In Spivak's framework, an olog instance is a set-valued functor — each
domain type maps to a set of concrete examples, each domain arrow maps to a function
between those sets. In our context, each domain element's "instance set" is the set of
runtime values / data records it describes, not the code elements that implement it.

**Why it matters:** Right now code elements ARE the instances. Separating the instance
layer would enable queries like "find all runtime data that is a domain-X" using the
domain model as a schema for the database, not just for the code.

**Implementation sketch (speculative):**
- Add an `olog_instance` table with `(domain_elem_id, instance_key, instance_value)`
- Ground instances manually or via test fixtures
- Validate instance functions are consistent with domain arrows
- Long-term: query instances through the domain layer using the functor structure
