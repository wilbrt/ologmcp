# Olog Mining: Path Equations, Motifs, and Functor Discovery

> **Status: PLANNING** — Tier 1 implementation next.

## 1. Motivation

The olog currently holds structural knowledge extracted from source code — elements, arrows, and manually-asserted path equations. But much structural knowledge is *implicit*: it holds in the data but nobody has written it down. Mining discovers that implicit knowledge automatically.

There are three tiers, each building on the previous:

| Tier | Discovers | Question Answered | Output |
|------|-----------|-------------------|--------|
| **1. Path equations** | Commutativity invariants | "Do path A and path B always reach the same element?" | `PathEquation` with coverage ratio |
| **2. Motifs** | Recurring structural patterns | "What shapes appear N+ times in the graph?" | `MotifTemplate` with instance list |
| **3. Functor mapping** | Pattern instantiations | "Does this motif template have structure-preserving instances in the codebase?" | `MotifInstance` (a strongly meaningful functor) |

## 2. Theoretical Foundation: Ologs and Functors

An olog **𝒞** (Spivak & Kent 2012) is a category whose:
- **Objects** are boxes labeled with noun phrases ("a Function", "a Module")
- **Morphisms** are labeled arrows that must be **total functions** (every element of the domain maps to exactly one element of the codomain)
- **Path equations** assert commutativity (following path A yields the same result as following path B)
- **Instance data** is a functor **I : 𝒞 → Set** (our SQLite rows)

Our implementation maps directly:
- `OlogElem` → objects with instance data in `ElemRow`
- `OlogArr` → morphisms with instance data in `ArrRow`
- `PathEquation` → commutativity conditions checked by `evaluatePathEquations`
- `IntegrityConstraint` → existence, layering, monotonicity, totality constraints
- `Provenance` → confidence tracking (resolved / unresolved / tentative)

The article also defines **functors between ologs**: a functor **F : 𝒞 → 𝒟** maps each object and arrow in 𝒞 to a corresponding object and arrow in 𝒟, preserving composition. F is **strongly meaningful** when **I(X) = J(F(X))** for every object X — i.e., the concrete instances match exactly.

This gives us the precise formalism for motifs:

> **A motif template is a small olog 𝒟. A motif instance is a strongly meaningful functor F : 𝒟 → 𝒞. The motif "holds" when F preserves all path equations of 𝒟 in the image F(𝒟) ⊂ 𝒞.**

## 3. Tier 1: Path Equation Mining

### 3.1 What It Discovers

Path equations that hold (or nearly hold) for all elements of a type. For example:

```
memberOf ∘ inModule = inModule
```

This reads: "For every Method, the module of its enclosing Class equals the module of the Method itself." If this holds for 100% of methods, it's a strict invariant. If it holds for 95%, it's a near-invariant worth surfacing.

### 3.2 Algorithm

Given a set of arrow kinds and a maximum path depth:

1. **Enumerate candidate path pairs**: For each pair of arrow-kind sequences (A₁∘A₂∘...∘Aₙ, B₁∘B₂∘...∘Bₘ) where n,m ≤ maxDepth and the codomain of the last arrow in both paths matches, generate a candidate equation.

2. **Evaluate each candidate**: For every element of the domain type, follow both paths. Count how many elements have matching endpoints (support) and how many have a defined result for both paths (total). Coverage = support / total.

3. **Filter by threshold**: Keep equations where coverage ≥ minCoverage (default 1.0, configurable).

4. **Deduplicate**: Remove equations that are subsumed by a more general equation (e.g., if `A ∘ B = C ∘ D` holds, also reports `A ∘ B ∘ E = C ∘ D ∘ E` — keep only the shorter form).

5. **Return results**: Each surviving equation with its coverage ratio, support count, total count, and concrete counterexamples (up to a limit).

### 3.3 Arrow Kinds Available for Mining

The current olog has these arrow kinds:

| Arrow Kind | Domain → Codomain | Count |
|---|---|---|
| `contains` | File/Module → child | 420 |
| `inModule` | Symbol → Module | 420 |
| `locatedIn` | Symbol → File | 420 |
| `definedIn` | Import → File | 210 |
| `importsFrom` | Import → Module | 210 |
| `imports` | Import → Module | 210 |
| `callerOf` | Function → CallSite | 153 |
| `calleeOf` | Function → CallSite | 153 |
| `calls` | CallSite → ??? | 153 |
| `memberOf` | Method → Class | 37 |

### 3.4 Candidate Equations Expected in This Codebase

Based on the arrow structure, likely Tier 1 discoveries:

1. **`memberOf ∘ inModule = inModule`** — Method→Class→Module equals Method→Module (module cohesion)
2. **`locatedIn ∘ inModule = inModule`** — Symbol→File→Module equals Symbol→Module (trivially true)
3. **`definedIn ∘ inModule = importsFrom`** — Import→File→Module equals Import→sourceModule (import consistency)
4. **`calleeOf ∘ inModule = callerOf ∘ inModule`** — Call-site callee's module equals caller's module for internal calls (layering invariant)

### 3.5 Data Model

```typescript
interface MiningOptions {
  maxDepth: number;          // max path length (default 3)
  minCoverage: number;       // 0–1, minimum coverage ratio (default 1.0)
  maxResults: number;        // max equations to return (default 50)
  arrowKinds?: string[];     // restrict to these arrow kinds (default: all)
  elementKinds?: string[];  // restrict seed elements to these kinds (default: all)
}

interface MinedEquationResult {
  lhsPath: string[];         // e.g., ["memberOf", "inModule"]
  rhsPath: string[];         // e.g., ["inModule"]
  domainKind: string;        // e.g., "method"
  codomainKind: string;       // e.g., "module"
  support: number;           // how many elements satisfy the equation
  total: number;             // how many elements have both paths defined
  coverage: number;          // support / total (0–1)
  counterexamples: Array<{   // up to 5 elements that violate
    elementId: string;
    elementName: string;
    lhsResult: string;
    rhsResult: string;
  }>;
}
```

### 3.6 Storage

Mined equations are stored as `PathEquation` entries in the existing `olog_equations` table with:
- `provenance.source = "mining"`
- `provenance.confidence = "tentative"`
- A human-readable name like `mined:memberOf∘inModule=inModule`

The user can promote accepted equations to `resolved` confidence via `olog_propose_schema`, or discard them.

### 3.7 File Structure

```
packages/core/src/mining/
├── index.ts         # mineEquations(), MiningOptions, MinedEquationResult
├── paths.ts         # enumeratePaths() — generate all path sequences up to maxDepth
├── candidates.ts    # generateCandidatePairs() — pair paths with matching domain/codomain
└── evaluate.ts       # evaluateEquationCandidate() — follow both paths, compute coverage

packages/mcp-server/src/tools/
└── olog-mine-equations.ts  # MCP tool registration
```

### 3.8 MCP Tool

```typescript
server.registerTool('olog_mine_equations', {
  description:
    'Discover path equations that hold (or nearly hold) in the olog graph. ' +
    'Tests all possible commutativity conditions between arrow paths up to ' +
    'the specified depth. Returns equations ranked by coverage ratio.',
  inputSchema: z.object({
    maxDepth: z.number().int().min(2).max(4).default(3),
    minCoverage: z.number().min(0).max(1).default(1.0),
    maxResults: z.number().int().min(1).max(500).default(50),
    arrowKinds: z.array(z.string()).optional(),
    elementKinds: z.array(z.string()).optional(),
    autoPropose: z.boolean().default(false).describe(
      'If true, automatically propose accepted equations to the olog schema with tentative provenance.'
    ),
  }),
  // ...
})
```

## 4. Tier 2: Motif Discovery

### 4.1 What It Discovers

Recurring structural configurations — "motifs" — that appear multiple times in the graph but are not expressed as explicit schemas or equations.

### 4.2 Formalism

A **motif template** is a small olog 𝒟 with objects, arrows, and equations. A **motif instance** is a functor F : 𝒟 → 𝒞 that:

1. Maps every object in 𝒟 to a concrete element of the right kind in 𝒞
2. Maps every arrow in 𝒟 to a concrete arrow of the right kind in 𝒞
3. Preserves all path equations of 𝒟 (if A∘B = C∘D in 𝒟, then F(A)∘F(B) = F(C)∘F(D) in 𝒞)

This is precisely Spivak & Kent's notion of a **strongly meaningful functor**.

### 4.3 Algorithm

1. **Seed selection**: Pick seed elements by kind (e.g., all interfaces, all classes, all functions in specific modules).

2. **Ego-graph extraction**: For each seed, expand the graph to depth N (default 2–3) along all arrow kinds, collecting the induced subgraph.

3. **Shape abstraction**: Replace every concrete element with its kind. Replace specific modules/files with anonymous placeholders. Keep arrow labels. This produces a **shape template** — a candidate motif olog 𝒟ᵢ.

4. **Frequency grouping**: Group ego-graphs by structural equivalence (isomorphic shape templates). Count instances per shape.

5. **Filtering**: Remove trivial shapes (e.g., "Interface inModule Module" — too simple). Remove subsumed shapes. Keep shapes with `support >= minSupport` (default 3).

6. **Internal equation verification**: For each surviving shape, run Tier 1 equation mining *within* the shape's instances. Attach equations where coverage ≥ threshold.

7. **Proposal**: Present to the user as candidate motifs with name, shape, support count, instance list, and internal equations.

### 4.4 Example Motifs Expected in This Codebase

**Motif: "MCP Tool Registration"** (support ≥ 9)

```
a Function
  → calleeOf → a Method (of OlogStore, ×2–4)
  → importsFrom → @olog/core
  → inModule → packages/mcp-server/src/tools/*
  → locatedIn → a File
  ← callerOf ← a Function (MCP server setup)

Internal equation: calleeOf ∘ memberOf = importsFrom ∘ imports
  (the module of the called method matches the imported module)
```

**Motif: "Interface-as-data-contract"** (support ≥ 50)

```
an Interface
  → definedIn → a File
  → inModule → a Module
  ← importsFrom ← (imports that reference this interface)
```

**Motif: "Register-Function-as-MCP-Tool"** (support ≥ 9)

```
a Function (registerOlog*)
  → importsFrom → @olog/core
  → calleeOf → OlogStore methods
  → inModule → packages/mcp-server/src/tools/*
```

### 4.5 Data Model

```typescript
interface MotifTemplate {
  id: string;
  name: string;                // user-assigned, e.g. "MCP Tool Registration"
  description: string;
  objects: Array<{              // olog objects in the motif
    id: string;                // e.g., "factory"
    kind: string;              // e.g., "class"
    nounPhrase: string;        // e.g., "a Factory"
  }>;
  arrows: Array<{              // olog arrows in the motif
    id: string;
    domain: string;
    codomain: string;
    label: string;             // e.g., "creates"
  }>;
  equations: Array<{
    lhs: string[];             // e.g., ["calleeOf", "memberOf"]
    rhs: string[];             // e.g., ["importsFrom", "imports"]
  }>;
}

interface MotifInstance {
  id: string;
  motifTemplateId: string;
  mappings: Record<string, string>;  // motif object ID → concrete element ID
  provenance: Provenance;
}
```

### 4.6 User Interaction

```
🔍 Mining found 3 recurring structural motifs:

┌──────────────────────────────────────────────────────┐
│ Motif #1: "Module-as-internal-library"               │
│ Support: 7 instances | Internal equations: 1        │
│                                                       │
│ Shape:                                                │
│   a Module ─importsFrom→ a Module (sibling)          │
│   a Module ←importsFrom← a Module (consumer)         │
│   a File ─contains→ an Interface (×1–5)                │
│   a File ─contains→ a Function (×2–8)                 │
│                                                       │
│ Equation: imports ∘ importsFrom = calleeOf ∘ inModule │
│ Coverage: 94%                                         │
│                                                       │
│ Instances:                                            │
│   • packages/core/src/ontology.ts                    │
│   • packages/core/src/constraints.ts                 │
│   • packages/core/src/delegate/context.ts            │
│   • ... 4 more                                       │
│                                                       │
│ [✓ Add as motif] [✗ Skip] [✎ Rename & edit]         │
└──────────────────────────────────────────────────────┘
```

If the user accepts, the motif becomes a `SchemaProposal` with `provenance.confidence = "tentative"`.

## 5. Tier 3: Functor Discovery and Pattern Matching

### 5.1 What It Discovers

Given a **known motif template** (from Tier 2 or manually defined), finds all **strongly meaningful functors** F : 𝒟 → 𝒞 — that is, all concrete instantiations of the pattern in the codebase.

This is the tool you'd use to answer: "Show me every Abstract Factory in this code."

### 5.2 Algorithm

1. **Start with a motif template** 𝒟 (a `MotifTemplate` with objects, arrows, and equations).

2. **Candidate generation**: For each object in 𝒟 with kind K, enumerate all elements of kind K in 𝒞 as candidate mappings.

3. **Constraint propagation**: For each candidate mapping, check that:
   - Every arrow in 𝒟 has a corresponding arrow in 𝒞 between the mapped elements
   - Every equation in 𝒟 holds for the mapped elements

4. **Backtracking search**: Use CSP (constraint satisfaction) or backtracking to find all complete mappings.

5. **Deduplication**: Remove mappings that differ only by element IDs of "don't care" objects.

6. **Result**: Each valid mapping is a motif instance.

### 5.3 Example: Finding Abstract Factory Instances

The Abstract Factory motif template would be:

```
Objects:
  - a Factory (kind: class)
  - an AbstractProduct (kind: interface)
  - a ConcreteProduct (kind: class)

Arrows:
  - createsProduct: ConcreteProduct → Factory
  - implementsInterface: ConcreteProduct → AbstractProduct

Equations:
  - (none that are purely structural; the pattern requires
     a correlated set of products per factory, which is an
     existence constraint, not a path equation)
```

The miner would search for all triples (Factory, AbstractProduct, ConcreteProduct) where the arrows hold. The existence constraint (each factory produces at least one product per abstract product) would be checked as a post-filter.

### 5.4 Relationship to Design Patterns

Design patterns are precisely motif templates that have been given names by the software engineering community. The Abstract Factory, Observer, Strategy, etc. are all expressible as motif ologs with specific object kinds, arrow kinds, and equations/constraints.

The mining pipeline naturally accommodates them:

| Design Pattern | Motif Objects | Key Equations |
|---|---|---|
| Abstract Factory | Factory, AbstractProduct, ConcreteProduct | `createsProduct ∘ productKind = factoryKind` |
| Observer | Subject, Observer, Notification | `notifies ∘ update = notifyObservers ∘ handlerOf` |
| Strategy | Context, Strategy, Algorithm | `usesStrategy ∘ execute = executeStrategy` |

Tier 3 can load these as predefined templates and search for instances.

## 6. Implementation Plan

### Phase 1: Tier 1 — Path Equation Mining (Next)

| Step | Files | Description |
|------|-------|-------------|
| 1.1 | `core/mining/paths.ts` | `enumeratePaths(store, maxDepth, arrowKinds?)` — generate all path sequences up to maxDepth |
| 1.2 | `core/mining/candidates.ts` | `generateCandidatePairs(paths)` — pair paths with matching domain/codomain kinds |
| 1.3 | `core/mining/evaluate.ts` | `evaluateEquationCandidate(store, lhs, rhs, elementKinds?)` — follow both paths, compute coverage |
| 1.4 | `core/mining/index.ts` | `mineEquations(store, options)` — orchestrate paths → candidates → evaluate → filter → deduplicate |
| 1.5 | `mcp-server/tools/olog-mine-equations.ts` | MCP tool registration |
| 1.6 | `mcp-server/index.ts` | Register the new tool |
| 1.7 | `core/index.ts` | Export `mineEquations` and types |
| 1.8 | Tests | Unit tests for each module, integration test with full pipeline |

### Phase 2: Tier 2 — Motif Discovery (Future)

| Step | Files | Description |
|------|-------|-------------|
| 2.1 | `core/mining/ego.ts` | `extractEgoGraph(store, seedId, depth)` — expand N hops from seed |
| 2.2 | `core/mining/shape.ts` | `abstractToShape(egoGraph)` — replace concrete IDs with kinds |
| 2.3 | `core/mining/group.ts` | `groupByShape(shapes)` — cluster structurally-equivalent shapes |
| 2.4 | `core/mining/motifs.ts` | `discoverMotifs(store, options)` — full pipeline |
| 2.5 | `mcp-server/tools/olog-discover-motifs.ts` | MCP tool registration |

### Phase 3: Tier 3 — Functor Search (Future)

| Step | Files | Description |
|------|-------|-------------|
| 3.1 | `core/mining/functor.ts` | `findFunctors(store, motifTemplate, options)` — CSP-based search for strongly meaningful functors |
| 3.2 | `mcp-server/tools/olog-find-patterns.ts` | MCP tool registration |

## 7. Key Design Decisions

### 7.1 Provenance and Confidence

All mining results are stored with `provenance.source = "mining"` and `provenance.confidence = "tentative"`. The user must explicitly accept a mined equation or motif before it becomes `resolved`. This preserves the olog's integrity model: nothing enters the schema without deliberate human judgment.

### 7.2 Incremental Re-mining

When the olog is re-ingested (after code changes), previously mined equations should be re-evaluated. The `mineEquations` function should accept an optional `reevaluate` flag that checks existing "tentative" equations against the current graph state and updates their coverage ratio.

### 7.3 Scalability

For a graph with N elements and A arrows:
- Path enumeration is O(A^d) where d = maxDepth (typically 3 → O(A³))
- Candidate pairing is quadratic in the number of paths
- Path following for each candidate is O(N × d)

For our current graph (498 elements, ~2,400 arrows), depth-3 mining should complete in under 10 seconds. For larger codebases, we may need to:
- Restrict `arrowKinds` to a subset
- Use `elementKinds` to seed only specific types
- Cache path results between runs

### 7.4 Relationship to Existing Tools

Mining is purely additive — it adds new `PathEquation` entries with tentative provenance. It does not modify existing elements, arrows, constraints, or equations. The existing validation pipeline (`evaluatePathEquations`, `evaluateConstraints`) is used to verify that proposed equations are structurally valid before insertion.

The mining pipeline composes before the proposal pipeline:

```
mineEquations → review results → olog_propose_schema (for accepted equations)
discoverMotifs → review results → olog_propose_schema (for accepted motifs)
```

## 8. Schema Changes

### 8.1 New Olog Schema Elements (Proposed)

These objects and arrows were proposed to the olog during planning:

| Object | Kind | Purpose |
|---|---|---|
| `a Mining Options` | interface | Input parameters for the mining algorithm |
| `a Mined Equation Result` | interface | Output of equation mining |
| `a Path Equation` | interface | (already exists in `ontology.ts`) |

The full motif schema (Tier 2/3) will be proposed after Tier 1 is implemented and tested.

### 8.2 No Database Schema Changes

The existing `olog_equations` table has all the columns needed for mined equations:
- `lhs_path` and `rhs_path` (JSON arrays of arrow kinds)
- `src_object` and `tgt_object` (noun phrases for domain and codomain)
- `human_message` (description)

Mined equations will use `provenance.source = "mining"` to distinguish them from manually proposed equations.

## 9. Testing Strategy

### 9.1 Unit Tests

Each module in `packages/core/src/mining/` should have a corresponding test file:

```
packages/core/test/mining/
├── paths.test.ts          # path enumeration, edge cases (empty graph, cycles)
├── candidates.test.ts     # candidate pair generation, deduplication
├── evaluate.test.ts       # equation evaluation with known-good graphs
└── index.test.ts          # end-to-end mining with in-memory OlogStore
```

Each test:
1. Creates an in-memory `OlogStore` with a known graph (elements + arrows)
2. Inserts manual path equations as ground truth
3. Runs the mining function
4. Asserts that all ground-truth equations are discovered (with appropriate coverage)
5. Asserts that no spurious equations are returned above the threshold

### 9.2 Integration Tests

Test against the real olog (after ingestion):
- `mineEquations` with `maxDepth=2, minCoverage=1.0` should discover `memberOf ∘ inModule = inModule`
- `mineEquations` with `maxDepth=3, minCoverage=1.0` should discover `definedIn ∘ inModule = importsFrom`
- Coverage < 1.0 queries should surface near-invariants with counterexamples

### 9.3 Property Tests

- Mining is idempotent: running twice produces the same results
- Mining is monotonic: adding elements/arrows can only increase coverage, never decrease it
- Every mined equation with coverage = 1.0 passes `evaluateConcreteEquation`