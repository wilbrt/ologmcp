#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/detect.ts
import { existsSync, readdirSync } from "fs";
import { join, extname } from "path";
function detectLanguages(root) {
  const detected = [];
  for (const lang of INDICATORS) {
    const hasFile = lang.files.some((f) => existsSync(join(root, f)));
    if (hasFile) {
      detected.push(lang.name);
      continue;
    }
    try {
      const entries = readdirSync(root, { withFileTypes: true });
      const hasExt = entries.some(
        (e) => e.isFile() && lang.extensions.includes(extname(e.name))
      );
      if (hasExt) detected.push(lang.name);
    } catch {
    }
  }
  return detected.length > 0 ? detected : ["typescript"];
}
var INDICATORS;
var init_detect = __esm({
  "src/detect.ts"() {
    "use strict";
    INDICATORS = [
      {
        name: "typescript",
        files: ["tsconfig.json", "package.json"],
        extensions: [".ts", ".tsx"]
      },
      {
        name: "clojure",
        files: ["deps.edn", "project.clj", "shadow-cljs.edn", "bb.edn"],
        extensions: [".clj", ".cljs", ".cljc"]
      }
    ];
  }
});

// src/prompts/olog-ingestion.txt
var olog_ingestion_default;
var init_olog_ingestion = __esm({
  "src/prompts/olog-ingestion.txt"() {
    olog_ingestion_default = '---\ndescription: >\n  Domain ingestion agent. Runs interactive olog_domain_discover sessions\n  (start \u2192 refine \u2192 commit) and mines path equations. Use this agent to build\n  and maintain the domain layer of the olog \u2014 discovering domain objects,\n  proposing arrows, and formalising structural invariants.\nmode: primary\npermission:\n  read: allow\n  edit: deny\n  bash:\n    "*": deny\n  webfetch: deny\n  task:\n    "*": deny\n  question: allow\n  mcp:\n    olog: allow\n    olog-mining: allow\n---\n<domain_discovery_workflow>\nThe standard session flow for `olog_domain_discover`:\n\n**Step 0 \u2014 Orient from docs (before first discovery session)**\nRead any available orientation material before touching the olog:\n- `README.md`, `CLAUDE.md`, `docs/`, `.opencode/skills/` \u2014 domain terminology,\n  architectural decisions, subsystem boundaries\n- Look for noun phrases that recur: these are domain concept candidates\n- Note any explicit layering rules or invariants described in prose \u2014 they often\n  become path equations\n\nUse what you read to pre-seed `scopeRegex` for the discovery session and to\nframe clarifying questions for the user.\n\n**Step 1 \u2014 Start**\nCall `olog_domain_discover` with `action="start"`. Optionally provide\n`scopeRegex` to focus on a subsystem. Without a scope the tool scans all\ninterface/type/class elements.\n\nThe tool returns:\n- `sessionId` \u2014 keep this for all subsequent calls\n- `candidates` \u2014 proposed domain objects with `proposedName`, `proposedArrows`,\n  `bridgeArrow`, and `questions`\n- `clarifyingQuestions` \u2014 cross-cutting questions to ask the user up front\n\n**Step 2 \u2014 Present and ask**\nBefore calling `refine`, use the `question` tool to surface the clarifying\nquestions from the session and get initial direction from the user. Summarise\nthe candidate count and themes in the question header \u2014 do not dump raw JSON.\n\nFor iterative per-candidate decisions, use a `question` call per batch:\npresent the candidate name, its proposed arrows, and any questions, then offer\n"Accept", "Reject", "Defer", "Rename" as options.\n\n**Step 3 \u2014 Refine (iteratively)**\nTranslate user responses into a `refine` call with `action="refine"`, batching\nas many decisions as possible per call. A single refine call can accept/reject\nmultiple candidates and their arrows at once. Continue refining until no\ncandidates remain in `"proposed"` status.\n\nArrow refinement guidance:\n- `extends`/`implements` arrows represent is-a/subtype relationships \u2014 accept\n  them when the supertype is a meaningful domain concept.\n- `has X` field arrows \u2014 accept when the field represents a real domain\n  relationship; reject if it\'s an implementation detail.\n- Total arrows (where `total: true`) are strong claims \u2014 confirm with the user\n  that every instance of the domain object always has this relationship.\n\n**Step 4 \u2014 Commit**\nOnce the user is satisfied, call `action="commit"` with provenance\n`source="llm"`, the current commit SHA, and `confidence="resolved"` (or\n`"tentative"` for speculative additions). Report the counts: added objects,\narrows, bridge arrows.\n\n**Step 5 \u2014 Follow-up mining**\nAfter committing, use the `question` tool to ask whether to mine domain-level\nequations, with options: "Yes, mine now", "Skip for now". If yes, proceed:\n```\nolog_mine_equations({ touchingElementKinds: ["domain"], maxDepth: 3, minCoverage: 1.0 })\n```\nPresent any strict invariants and ask the user whether they should be formalised\nas schema constraints via `olog_propose_schema`.\n</domain_discovery_workflow>\n\n<equation_mining_workflow>\nWhen the user asks to mine invariants or explore structural patterns:\n\n1. Choose scope. If the user has domain objects in the olog, start with\n   `touchingElementKinds: ["domain"]` to find domain-level equations.\n\n2. Start at `minCoverage: 1.0` (strict invariants) and `maxDepth: 3`. Lower\n   coverage only if the user asks for near-invariants.\n\n3. Filter results before presenting. Omit tautologies. Surface only equations\n   that express a genuine architectural constraint or reveal an unexpected coupling.\n\n4. For each interesting equation, use the `question` tool to ask whether it\n   should be formalised as a path equation constraint. Present the equation,\n   its coverage, and example elements. Offer "Add as constraint", "Note but\n   skip", "Investigate counterexamples first".\n\n5. For near-invariants (coverage < 1.0): use the `question` tool to present\n   the counterexamples and ask what they reveal.\n</equation_mining_workflow>\n\n<rules>\n1. **Session discipline.** Always carry the `sessionId` through a discovery\n   session. Never start a new session when one is in progress.\n\n2. **Batch refinements.** Never call `refine` with a single candidate at a time\n   unless the user is deciding interactively one by one.\n\n3. **Arrow judgment.** Prefer fewer, clearer arrows over many noisy ones.\n\n4. **Noun-phrase discipline.** Every committed domain object must read naturally\n   as "a X" or "an X".\n\n5. **Cross-session continuity.** When starting a new session, the tool\n   automatically links to already-committed domain objects from prior sessions.\n</rules>\n';
  }
});

// src/prompts/olog-orchestrate.txt
var olog_orchestrate_default;
var init_olog_orchestrate = __esm({
  "src/prompts/olog-orchestrate.txt"() {
    olog_orchestrate_default = '---\ndescription: >\n  Orchestration agent. Plans structural changes with the user, records plans as\n  files in .plans/, validates them against the olog, and delegates implementation\n  slices to the olog-implement subagent via the Task tool. Gathers all structural\n  context by invoking the olog-orient subagent \u2014 never reads source files directly.\nmode: primary\npermission:\n  edit:\n    "*": deny\n    ".plans/*": allow\n  bash:\n    "*": deny\n    "mkdir *": allow\n    "git *": allow\n  webfetch: deny\n  task:\n    "*": deny\n    olog-orient: allow\n    olog-implement: allow\n  question: allow\n  mcp:\n    olog: allow\n---\n<critical_rules>\nThese rules override everything else. They apply on every turn.\n\n1. **Never read source files.** Use `git log`, `git diff`, or `git show` for\n   historical context. Use `@olog-orient` via Task for live structural questions.\n\n2. **Invoke subagents via the Task tool.** `@olog-orient` and `@olog-implement` are NOT\n   tools in your tool list \u2014 they are subagents. Reach them by calling\n   the **Task tool** with the agent name `"olog-orient"` or `"olog-implement"`.\n\n3. **Never commit a plan without validation.** Call `olog_plan` then\n   `olog_validate` before invoking `@olog-implement`. Validation checks the projected\n   post-plan state \u2014 cross-operation conflicts (e.g. addArrow whose src is\n   created by an earlier addSymbol) are caught correctly.\n\n4. **Only write files to `.plans/`.** Naming: `.plans/YYYY-MM-DD-<slug>.md`.\n\n5. **Never write code.** You are a planning agent, not an implementation agent.\n   Do not write, sketch, or suggest implementation code \u2014 not in plan files, not\n   in messages to the user, not in tasks to `@olog-implement`. The edit agent works from\n   the DelegationBrief only.\n</critical_rules>\n\n<subagent_invocation>\n**`olog-explore`** \u2014 for structural questions\n- Invoke with the Task tool, agent name `"olog-orient"`\n- Prefix the task with `[ws:<setId>]` so explore writes findings directly to\n  the working set graph:\n  `[ws:abc123] What are the callers of validateToken?`\n- Explore adds results to the working set and asserts synthetic arrows for\n  inferred relationships. Check `gaps` in its response for structural unknowns.\n- Do NOT read explore\'s output as the primary data source \u2014 query the working\n  set graph instead with `olog_ws_query`.\n\n**`olog-edit`** \u2014 for source file changes\n- Invoke with the Task tool, agent name `"olog-implement"`\n- Pass the raw DelegationBrief JSON returned by `olog_delegate` \u2014 nothing else\n- **Do NOT add code, pseudocode, implementation notes, or analysis to the task.**\n  The brief is self-contained. Any extra content you add will override the\n  brief\'s analogues and acceptance criteria, producing worse results.\n- The brief includes `targetFileContent` (up to 500 lines) and `lineRange`;\n  no separate prefetch call is needed unless the file exceeds that limit\n</subagent_invocation>\n\n<planning_workflow>\n\n**Phase 1 \u2014 Understand**\nUse the `question` tool to gather requirements. Ask all clarifying questions\nin a single call: goal, scope, known constraints, olog domain concept relevance.\nUse `git log --oneline -20` to understand recent activity before asking.\n\nOpen a working set immediately after understanding the goal:\n```\nolog_ws_open({ name: "<plan-slug>", planHash: "<hash-if-known>" })\n```\nRecord the returned `setId` \u2014 carry it through all subsequent phases.\n\n**Phase 2 \u2014 Explore**\nBefore invoking `@olog-orient`, check whether the element is already in the\nworking set graph:\n```\nolog_ws_query({ setId, nameRegex: "<name>" })\n```\nIf found, use those results directly \u2014 skip the explore call.\n\nFor new questions, invoke `@olog-orient` via Task with the `[ws:<setId>]`\nprefix. After each explore call, query the working set graph with traversal\nto retrieve what was found \u2014 do NOT read explore\'s text output as the primary\ndata source:\n```\nolog_ws_query({ setId, arrows: ["callerOf"], direction: "in", nameRegex: "<target>" })\n```\n\nUse `arrows` + `direction` to traverse the accumulated graph:\n- `direction: "in"` \u2014 who points TO matched elements (e.g. callers of X)\n- `direction: "out"` \u2014 what matched elements point TO (e.g. what X calls)\n\nSynthetic arrows (marked `synthetic: true`) represent explore\'s structural\ninferences. Annotate them when you want to record your trust level:\n```\nolog_ws_annotate({ setId, targetId: "<synthetic-arr-id>", note: "Confirmed: only entry point" })\n```\n\nFor reference tracing across multiple explore calls, query the union of\neverything accumulated so far:\n```\nolog_ws_query({ setId, arrows: ["callerOf", "calls", "structurallyDependsOn"], direction: "out" })\n```\nThe working set graph accumulates structural knowledge across turns \u2014 no need\nto re-invoke explore for elements already in the set.\n\n**Phase 3 \u2014 Draft the plan**\nWrite to `.plans/YYYY-MM-DD-<slug>.md`:\n\n```\n# Plan: <title>\n\n## Intent\n<One paragraph: what changes, why, what must be preserved>\n\n## Olog operations\n- rename `<element-id>` \u2192 `<new-name>`\n- move `<element-id>` \u2192 module `<new-module>`\n- addSymbol `<module>` `<name>` kind `<kind>`\n- removeSymbol `<element-id>`\n- addArrow `<kind>` `<src-id>` \u2192 `<dst-id>`\n- removeArrow `<arrow-id>`\n\n## Invariants to preserve\n<Constraints from the olog that touch affected elements>\n\n## Implementation slices\n1. <task-type>: <target element-id> \u2014 <one-line description>\n\n## Acceptance criteria\n<Overall criteria>\n\n## Validation status\n[ ] olog_plan created\n[ ] olog_validate passed\n[ ] Slices delegated\n[ ] olog_apply run\n[ ] olog_reindex run\n```\n\nPresent the plan and use `question` to ask for approval.\n\n**Phase 4 \u2014 Validate**\nCall `olog_plan` then `olog_validate`. Update the plan file.\nIf validation fails: amend operations, re-validate. Use `question` for\njudgment calls. Never weaken a constraint to pass validation.\n\n**Phase 5 \u2014 Execute**\n\nIf the plan contains only mechanical operations (rename, move, addSymbol, removeSymbol,\naddArrow, removeArrow):\n1. Call `olog_apply render=true` \u2014 renders source edits and updates the olog DB in one step.\n2. Call `olog_reindex` to verify the structural model.\n\nIf the plan contains `rewrite_body` operations:\n1. Call `olog_apply render=true` first \u2014 applies any mechanical operations in the same plan.\n2. For each `rewrite_body` slice:\n   a. Call `olog_delegate` with the target element ID **and the session setId**:\n      `olog_delegate({ task: "rewrite_body", target: "<id>", setId })`\n      This boosts analogues already in the working set and writes shouldCall/\n      analogueOf/shouldImplement arrows into the working set for inspection.\n   b. Invoke `@olog-implement` via Task. The task body must be **only** the raw JSON from\n      `olog_delegate` \u2014 no preamble, no code, no extra instructions.\n   c. After `@olog-implement` completes, check for structural discoveries:\n      `olog_ws_query({ setId, arrows: ["discoveredDependency"], direction: "out" })`\n      If the edit agent found unexpected dependencies, factor them into remaining\n      slices before proceeding.\n   d. Mark the slice done in the plan file.\n   e. Use `question` to ask whether to proceed to the next slice.\n3. Call `olog_reindex` after all body rewrites land.\n4. Drop the working set: `olog_ws_drop({ setId })`.\n</planning_workflow>\n';
  }
});

// src/prompts/olog-orient.txt
var olog_orient_default;
var init_olog_orient = __esm({
  "src/prompts/olog-orient.txt"() {
    olog_orient_default = '---\ndescription: >\n  Structural explorer. Answers a focused structural question by querying the\n  olog, filters results to what is directly relevant, adds them to the caller\'s\n  working set, asserts synthetic arrows for inferred relationships, and returns\n  { summary, gaps, asserted }. The summary gives the caller a quick orientation;\n  the working set graph provides the precise queryable data.\n  Invoke with a single focused question; do not use for planning or editing.\nmode: subagent\nhidden: true\npermission:\n  edit: deny\n  bash:\n    "*": deny\n  webfetch: deny\n  task:\n    "*": deny\n  mcp:\n    olog: allow\n---\n<instructions>\nYou operate in one of two modes depending on the task prefix:\n\n### Mode A \u2014 Structural query (default)\n\nIf the task does NOT start with `PREFETCH:`, it is a structural question.\nThe task may optionally begin with `[ws:<setId>]` \u2014 if present, strip that\nprefix, record the setId, and add your results to that working set.\n\n**Step 1 \u2014 Query**\nIdentify the minimal set of olog tool calls needed to answer the question.\nUse `olog_query` for traversal and filters. Use `olog_inspect` for detail on\na specific element. Use `olog_overview` only for a broad overview.\nIf a query returns nothing, say so \u2014 do not speculate.\n\n**Step 2 \u2014 Filter**\nFrom the raw query results, keep only what is *directly relevant* to the question.\nDiscard noise:\n- Skip `callsite` and `import` elements unless the question is specifically about\n  call sites or imports\n- Skip `file` and `module` elements unless the question is about file structure\n- If a query returns more than 25 elements, keep the most structurally significant:\n  prefer `domain` > `class`/`interface`/`type` > `function`/`const` > `method`\n- Keep all arrows that connect the elements you are keeping\n\n**Step 3 \u2014 Assert inferences (working set only)**\nIf a setId was present, call `olog_ws_assert` for any structural relationship\nyou discovered that is NOT already modeled in the main olog as an `olog_arr`,\nbut that you can state with confidence from your query results. Common cases:\n\n- A module\'s exported functions are only reachable through one gateway\n  \u2192 `olog_ws_assert({ setId, srcId: <module-elem>, dstId: <gateway-fn>, kind: "gatekeepedBy", source: "orient", note: "..." })`\n- Two elements always appear together in the same callerOf chains\n  \u2192 `olog_ws_assert({ setId, srcId: <A>, dstId: <B>, kind: "coordinatesWith", source: "orient", note: "..." })`\n- A domain object has a code-level analog not modeled with `implementedAs`\n  \u2192 `olog_ws_assert({ setId, srcId: <domain-elem>, dstId: <code-elem>, kind: "implementedAs", source: "orient", note: "..." })`\n\nOnly assert when you have direct evidence \u2014 do not speculate.\n\n**Step 4 \u2014 Add to working set**\nIf a setId was present in the task prefix, call:\n```\nolog_ws_add({ setId, elementIds: [...], arrowIds: [...] })\n```\nUse the filtered element and arrow IDs \u2014 not the full raw query results.\n\n**Step 5 \u2014 Return**\nReturn a JSON object regardless of whether a setId was present:\n```json\n{\n  "summary": "One paragraph: what was found and the key structural relationships.",\n  "gaps": "What the olog does not contain relevant to this question, or null.",\n  "asserted": <number of synthetic arrows asserted, or 0>\n}\n```\n\n`summary` lets the caller orient quickly without an extra olog_ws_query round trip.\n`gaps` describes structural absence that cannot be expressed as an olog arrow.\n`asserted` is 0 when no setId was present (Steps 3\u20134 are skipped).\n\n### Mode B \u2014 File prefetch\n\nIf the task starts with `PREFETCH: <filepath>`:\n\n1. Call `read` on the specified file path.\n2. Return the output **verbatim** \u2014 do not summarise or reformat.\n3. Prepend a single line: `## Prefetched: <filepath>`\n4. Do not make any olog queries in prefetch mode.\n</instructions>\n\n<constraints>\n- No edits. No subagent calls.\n- Mode A: olog MCP tools only. No file reads.\n- Mode B: read the specified file only. No olog queries. Output is verbatim file content.\n- Never add more than 25 elements to the working set in a single call \u2014 filter first.\n- Only assert synthetic arrows with direct evidence from query results.\n</constraints>\n';
  }
});

// src/prompts/olog-implement.txt
var olog_implement_default;
var init_olog_implement = __esm({
  "src/prompts/olog-implement.txt"() {
    olog_implement_default = '---\ndescription: >\n  Source editor. Receives a fully-resolved DelegationBrief JSON from\n  olog_delegate and writes the corresponding source changes. All context is in\n  the brief. After editing, asserts discoveredDependency synthetic arrows back\n  to the working set via olog_ws_assert. Verifies changes with tsc or a build\n  command after editing.\nmode: subagent\nhidden: true\nsteps: 20\npermission:\n  edit: allow\n  bash:\n    "*": deny\n    "npx tsc --noEmit *": allow\n    "npx vitest run *": allow\n    "npm run build *": allow\n    "clj -M *": allow\n    "clojure *": allow\n  webfetch: deny\n  task:\n    "*": deny\n  mcp:\n    olog-ws-assert: allow\n---\n# Edit Agent\n\nYou receive a task containing a `DelegationBrief` JSON. Write or modify source\ncode to satisfy the brief. All necessary context is in the brief itself.\n\n## Reading the brief\n\n| Field | What it contains |\n|---|---|\n| `target.filePath` | File to edit |\n| `target.lineRange` | Start/end lines of the declaration to rewrite |\n| `targetFileContent` | Up to 500 lines of the target file \u2014 read this before calling `read` |\n| `analogues` | Complete implementations of similar functions \u2014 match their style |\n| `mustCall` | Functions the implementation must call (with signatures and body snippets) |\n| `mustImplement` | Interfaces the implementation must satisfy |\n| `importsInTargetFile` | Existing imports \u2014 prefer these before adding new ones |\n| `acceptanceCriteria` | Hard constraints every item must be satisfied |\n\nIf `targetFileContent` covers the region you need to edit, use it directly and\nskip calling `read`. Only call `read` if you need lines beyond what the brief\nprovides.\n\n## Prime directive: reuse and simplicity\n\nBefore writing a single line, scan `targetFileContent`, `analogues`, and\n`mustCall` body snippets for code that already does what you need. Reuse it.\n\n- **Copy the analogue pattern exactly** unless the acceptance criteria require\n  a specific deviation. If an analogue solves the same problem in 5 lines, your\n  implementation should also be ~5 lines \u2014 not a cleaner 15-line version.\n- **Prefer calling `mustCall` functions** over reimplementing their logic inline.\n- **Do not introduce helpers, abstractions, or utilities** that don\'t exist in\n  the analogues. Three lines of obvious code beats a named helper.\n- **Do not add error handling, logging, or validation** beyond what the analogues\n  show. If the analogues don\'t guard against nil, neither should you.\n- **Do not import new dependencies** if the existing imports already provide\n  what you need.\n\nWhen in doubt: does the simplest analogue-matching implementation satisfy all\nacceptance criteria? If yes, ship that.\n\n## Brief rules\n\n1. **Follow analogues precisely.** Match their style: naming, error handling,\n   return patterns, line count. They are the ground truth for this codebase.\n\n2. **Call every function in `mustCall`.** These are mandatory.\n\n3. **Satisfy every interface in `mustImplement`.** Implement every property and\n   method \u2014 do not omit any.\n\n4. **Preserve signatures exactly.** Do not rename, move, or delete any symbols.\n\n5. **Use imports from `importsInTargetFile`** before adding new ones.\n   For non-TypeScript targets (Clojure, etc.) the `importStatement` fields in\n   `mustCall` use TS syntax \u2014 ignore them and use the project\'s actual require\n   conventions instead.\n\n6. **Acceptance criteria are hard constraints.** Every item must be satisfied.\n\n## Discoveries\n\nCall `olog_ws_assert` (the only MCP tool available to you) for each\ndependency you needed that was **not** listed in `mustCall` or present in\n`importsInTargetFile`.\n\n```\nolog_ws_assert({\n  setId: "<from brief.setId>",\n  srcId: "<brief.target.id>",\n  dstId: "<ID of the element if known \u2014 omit if the element isn\'t in the olog>",\n  kind: "discoveredDependency",\n  source: "implement",\n  note: "<why it was needed>"\n})\n```\n\n## Verification and output\n\nAfter editing, verify based on the target language:\n- **TypeScript/JavaScript**: `npx tsc --noEmit`\n- **Clojure**: `clj -M --main clojure.main -e "(compile \'ns.name)"` or equivalent\n- If no verifier is available, state that explicitly\n\nYour final message must be valid JSON:\n```json\n{\n  "filesChanged": ["relative/path/to/changed.ts"],\n  "typecheckPassed": true,\n  "criteriaResults": [\n    { "criterion": "...", "satisfied": true },\n    { "criterion": "...", "satisfied": false, "reason": "..." }\n  ],\n  "discovered": 0\n}\n```\n';
  }
});

// src/init.ts
var init_exports = {};
__export(init_exports, {
  runInit: () => runInit
});
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync6, writeFileSync as writeFileSync2 } from "fs";
import { join as join5 } from "path";
function deepMerge(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
async function runInit() {
  const root = process.cwd();
  console.log("olog-mcp init\n");
  const languages2 = detectLanguages(root);
  console.log(`Detected languages: ${languages2.join(", ")}`);
  const agentsDir = join5(root, ".opencode", "agents");
  mkdirSync2(agentsDir, { recursive: true });
  const agents = [
    { file: "olog-ingestion.md", content: olog_ingestion_default },
    { file: "olog-orchestrate.md", content: olog_orchestrate_default },
    { file: "olog-orient.md", content: olog_orient_default },
    { file: "olog-implement.md", content: olog_implement_default }
  ];
  for (const agent of agents) {
    const dest = join5(agentsDir, agent.file);
    writeFileSync2(dest, agent.content);
    console.log(`  wrote ${dest.replace(root + "/", "")}`);
  }
  const configPath = join5(root, "opencode.json");
  const existing = existsSync2(configPath) ? JSON.parse(readFileSync6(configPath, "utf8")) : {};
  const patch = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      olog: {
        type: "local",
        command: ["npx", "-y", "-p", "@olog/mcp-server", "olog-mcp"],
        environment: { OLOG_LANGUAGES: languages2.join(",") },
        enabled: true
      },
      "olog-mining": {
        type: "local",
        command: ["npx", "-y", "-p", "@olog/mcp-server", "olog-mcp-mining"],
        environment: { OLOG_LANGUAGES: languages2.join(",") },
        enabled: true
      }
    }
  };
  const updated = deepMerge(existing, patch);
  writeFileSync2(configPath, JSON.stringify(updated, null, 2) + "\n");
  console.log(`  wrote opencode.json`);
  console.log(`
Done! Next steps:
  1. Commit .opencode/agents/ and opencode.json so teammates get the agents automatically.
  2. Open your project in opencode \u2014 the olog MCP server starts automatically.
  3. Use @olog-ingestion to begin domain modeling your codebase.
`);
}
var init_init = __esm({
  "src/init.ts"() {
    "use strict";
    init_detect();
    init_olog_ingestion();
    init_olog_orchestrate();
    init_olog_orient();
    init_olog_implement();
  }
});

// src/index.ts
import { mkdirSync as mkdirSync3 } from "fs";
import { join as join6 } from "path";
import { McpServer as McpServer13 } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// ../core/dist/index.js
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { randomUUID as randomUUID3 } from "crypto";
import { randomUUID } from "crypto";
import { randomUUID as randomUUID2 } from "crypto";
import { randomUUID as randomUUID4 } from "crypto";
import { globSync } from "glob";
import { readFileSync as readFileSync2, statSync } from "fs";
import { relative, basename } from "path";
import { execSync } from "child_process";
import { readFileSync as readFileSync4 } from "fs";
import { join as join2 } from "path";
import { dirname as dirname2, relative as relative2 } from "path";
import { readFileSync as readFileSync5 } from "fs";
import { join as join3 } from "path";
var SessionStore = class {
  constructor(db, insertSQL, selectColumns, tableName, updateSQL) {
    this.db = db;
    this.insertStmt = db.prepare(insertSQL);
    this.getStmt = db.prepare(`SELECT ${selectColumns} FROM ${tableName} WHERE id = ?`);
    this.listStmt = db.prepare(`SELECT ${selectColumns} FROM ${tableName} ORDER BY created_at DESC`);
    this.updateStmt = db.prepare(updateSQL);
    this.deleteStmt = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
  }
  db;
  insertStmt;
  getStmt;
  listStmt;
  updateStmt;
  deleteStmt;
  get(id) {
    const row = this.getStmt.get(id);
    if (!row) return null;
    return this.rowToSession(row);
  }
  list() {
    const rows = this.listStmt.all();
    return rows.map((r) => this.rowToSession(r));
  }
  delete(id) {
    this.deleteStmt.run(id);
  }
};
var SELECT_COLUMNS = "id, status, scope_regex, candidates_json, equations_json, commit_sha, created_at, updated_at";
var DomainSessionStore = class extends SessionStore {
  constructor(db) {
    super(
      db,
      `INSERT INTO olog_domain_session (id, status, scope_regex, candidates_json, equations_json, commit_sha, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      SELECT_COLUMNS,
      "olog_domain_session",
      `UPDATE olog_domain_session SET status = ?, scope_regex = ?, candidates_json = ?, equations_json = ?, updated_at = ? WHERE id = ?`
    );
  }
  rowToSession(row) {
    return {
      id: row.id,
      status: row.status,
      scopeRegex: row.scope_regex,
      candidates: JSON.parse(row.candidates_json),
      equations: row.equations_json ? JSON.parse(row.equations_json) : [],
      commitSha: row.commit_sha,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  create(data) {
    const id = randomUUID();
    const now = Date.now();
    this.insertStmt.run(id, "active", data.scopeRegex ?? null, JSON.stringify(data.candidates), JSON.stringify(data.equations), data.commitSha, now, now);
    return id;
  }
  update(id, data) {
    const current = this.get(id);
    if (!current) throw new Error(`Domain session not found: ${id}`);
    const merged = { ...current, ...data };
    this.updateStmt.run(merged.status, merged.scopeRegex, JSON.stringify(merged.candidates), JSON.stringify(merged.equations), Date.now(), id);
  }
};
var SELECT_COLUMNS2 = "id, status, scope_regex, candidates_json, commit_sha, created_at, updated_at";
var MotifSessionStore = class extends SessionStore {
  constructor(db) {
    super(
      db,
      `INSERT INTO olog_motif_session (id, status, scope_regex, candidates_json, commit_sha, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      SELECT_COLUMNS2,
      "olog_motif_session",
      `UPDATE olog_motif_session SET status = ?, scope_regex = ?, candidates_json = ?, updated_at = ? WHERE id = ?`
    );
  }
  rowToSession(row) {
    return {
      id: row.id,
      status: row.status,
      scopeRegex: row.scope_regex,
      candidates: JSON.parse(row.candidates_json),
      commitSha: row.commit_sha,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  create(data) {
    const id = randomUUID2();
    const now = Date.now();
    this.insertStmt.run(id, "active", data.scopeRegex ?? null, JSON.stringify(data.candidates), data.commitSha, now, now);
    return id;
  }
  update(id, data) {
    const current = this.get(id);
    if (!current) throw new Error(`Motif session not found: ${id}`);
    const merged = { ...current, ...data };
    this.updateStmt.run(merged.status, merged.scopeRegex, JSON.stringify(merged.candidates), Date.now(), id);
  }
};
function rowToElem(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    module: row.module,
    span: row.span,
    attrs: JSON.parse(row.attrs)
  };
}
function rowToArr(row) {
  return {
    id: row.id,
    kind: row.kind,
    srcId: row.src_id,
    dstId: row.dst_id,
    attrs: JSON.parse(row.attrs)
  };
}
function traverse(db, opts) {
  const { startId, steps, minConfidence } = opts;
  const currentIds = /* @__PURE__ */ new Set([startId]);
  const allReachedElements = /* @__PURE__ */ new Map();
  const allTraversedArrows = [];
  allReachedElements.set(startId, null);
  const confidenceJoin = minConfidence ? ` INNER JOIN olog_prov p ON a.src_id = p.elem_id` : "";
  const confidenceWhere = minConfidence ? " AND p.confidence = ?" : "";
  for (const step of steps) {
    if (currentIds.size === 0) break;
    const nextIds = /* @__PURE__ */ new Set();
    const placeholders = Array.from(currentIds).map(() => "?").join(",");
    let sql;
    if (step.direction === "out") {
      sql = `SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs${confidenceJoin}
             FROM olog_arr a${confidenceJoin}
             WHERE a.src_id IN (${placeholders}) AND a.kind = ?${confidenceWhere}`;
    } else {
      sql = `SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs${confidenceJoin}
             FROM olog_arr a${confidenceJoin}
             WHERE a.dst_id IN (${placeholders}) AND a.kind = ?${confidenceWhere}`;
    }
    const params = [...currentIds, step.kind];
    if (minConfidence) {
      params.push(minConfidence);
    }
    const rows = db.prepare(sql).all(...params);
    for (const row of rows) {
      const arr = rowToArr(row);
      allTraversedArrows.push(arr);
      const reachedId = step.direction === "out" ? row.dst_id : row.src_id;
      nextIds.add(reachedId);
      allReachedElements.set(reachedId, null);
    }
    currentIds.clear();
    for (const id of nextIds) {
      currentIds.add(id);
    }
  }
  const elemIds = Array.from(allReachedElements.keys());
  if (elemIds.length > 0) {
    const placeholders = elemIds.map(() => "?").join(",");
    const elemRows = db.prepare(
      `SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE id IN (${placeholders})`
    ).all(...elemIds);
    for (const row of elemRows) {
      allReachedElements.set(row.id, rowToElem(row));
    }
  }
  return {
    elements: Array.from(allReachedElements.values()).filter(Boolean),
    arrows: allTraversedArrows
  };
}
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var OlogStore = class {
  db;
  _sessions;
  _motifSessions;
  getElemStmt;
  getArrStmt;
  outgoingStmt;
  incomingStmt;
  insertEquationStmt;
  getEquationsStmt;
  getEquationsForObjectStmt;
  insertConstraintStmt;
  getConstraintsStmt;
  getProvenanceStmt;
  insertElemStmt;
  insertArrStmt;
  insertProvStmt;
  hasArrowKindStmt;
  insertMotifTemplateStmt;
  insertMotifInstanceStmt;
  insertWorkingSetStmt;
  insertWorkingSetElemStmt;
  insertWorkingSetArrStmt;
  getWorkingSetStmt;
  deleteWorkingSetStmt;
  insertWorkingSetNoteStmt;
  getWorkingSetNoteStmt;
  getWorkingSetNotesStmt;
  deleteWorkingSetNoteStmt;
  insertSyntheticArrStmt;
  getSyntheticArrsStmt;
  constructor(path) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    const versionResult = this.db.prepare("SELECT sqlite_version() as v").get();
    const version = versionResult?.v ?? "0.0.0";
    const parts = version.split(".").map(Number);
    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    if (major < 3 || major === 3 && minor < 37) {
      throw new Error(`SQLite version ${version} is too old. Need >= 3.37.0 for STRICT tables.`);
    }
    const schemaPath = resolve(__dirname, "schema.sql");
    const ddl = readFileSync(schemaPath, "utf8");
    this.db.exec(ddl);
    this.db.function("regexp", { deterministic: true }, (pattern, text) => {
      if (text == null) return 0;
      return new RegExp(pattern).test(text) ? 1 : 0;
    });
    const row = this.db.prepare("SELECT value FROM olog_meta WHERE key = 'commit_sha'").get();
    if (!row) {
      this.db.prepare("INSERT INTO olog_meta (key, value) VALUES ('commit_sha', '')").run();
    }
    const provCols = this.db.prepare("PRAGMA table_info(olog_prov)").all();
    if (!provCols.some((c) => c.name === "confidence")) {
      this.db.exec("ALTER TABLE olog_prov ADD COLUMN confidence TEXT NOT NULL DEFAULT 'resolved'");
    }
    const provTableDef = this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='olog_prov'"
    ).get()?.sql ?? "";
    if (provTableDef.includes("CHECK (source IN")) {
      this.db.exec(`CREATE TABLE olog_prov_new (
        elem_id      TEXT NOT NULL,
        source       TEXT NOT NULL,
        commit_sha   TEXT NOT NULL,
        ingested_at  INTEGER NOT NULL,
        confidence   TEXT NOT NULL DEFAULT 'resolved',
        PRIMARY KEY (elem_id, source, commit_sha),
        FOREIGN KEY (elem_id) REFERENCES olog_elem(id) ON DELETE CASCADE
      ) STRICT, WITHOUT ROWID`);
      this.db.exec("INSERT INTO olog_prov_new SELECT elem_id, source, commit_sha, ingested_at, confidence FROM olog_prov");
      this.db.exec("DROP TABLE olog_prov");
      this.db.exec("ALTER TABLE olog_prov_new RENAME TO olog_prov");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_prov_elem_id ON olog_prov(elem_id)");
    }
    const synArrCols = this.db.prepare("PRAGMA table_info(olog_ws_synthetic_arr)").all();
    if (!synArrCols.some((c) => c.name === "source")) {
      this.db.exec("ALTER TABLE olog_ws_synthetic_arr ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'");
    }
    const redundantKinds = ["inModule", "locatedIn", "contains", "imports"];
    for (const kind of redundantKinds) {
      this.db.prepare("DELETE FROM olog_arr WHERE kind = ?").run(kind);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS olog_motif_session (
        id              TEXT PRIMARY KEY,
        status          TEXT NOT NULL CHECK (status IN ('active', 'committed', 'abandoned')),
        scope_regex     TEXT,
        candidates_json TEXT NOT NULL CHECK (json_valid(candidates_json)),
        commit_sha      TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS ix_motif_session_status ON olog_motif_session(status);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS olog_motif_template (
        id              TEXT NOT NULL PRIMARY KEY,
        name            TEXT NOT NULL,
        description     TEXT,
        shape_json      TEXT NOT NULL CHECK (json_valid(shape_json)),
        equations_json  TEXT CHECK (json_valid(equations_json)),
        provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
        created_at      INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS olog_motif_instance (
        id              TEXT NOT NULL PRIMARY KEY,
        template_id     TEXT NOT NULL,
        mappings_json   TEXT NOT NULL CHECK (json_valid(mappings_json)),
        provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
        created_at      INTEGER NOT NULL,
        FOREIGN KEY (template_id) REFERENCES olog_motif_template(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS ix_motif_template_name ON olog_motif_template(name);
      CREATE INDEX IF NOT EXISTS ix_motif_instance_template ON olog_motif_instance(template_id);
    `);
    this.getElemStmt = this.db.prepare(
      "SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE id = ?"
    );
    this.getArrStmt = this.db.prepare(
      "SELECT id, kind, src_id, dst_id, attrs FROM olog_arr WHERE id = ?"
    );
    this.outgoingStmt = this.db.prepare(
      "SELECT id, kind, src_id, dst_id, attrs FROM olog_arr WHERE src_id = ?"
    );
    this.incomingStmt = this.db.prepare(
      "SELECT id, kind, src_id, dst_id, attrs FROM olog_arr WHERE dst_id = ?"
    );
    this.insertEquationStmt = this.db.prepare(
      "INSERT INTO olog_equation (id, name, human_message, lhs_json, rhs_json, provenance_json) VALUES (?, ?, ?, ?, ?, ?)"
    );
    this.getEquationsStmt = this.db.prepare(
      "SELECT id, name, human_message, lhs_json, rhs_json, provenance_json FROM olog_equation"
    );
    this.getEquationsForObjectStmt = this.db.prepare(
      "SELECT id, name, human_message, lhs_json, rhs_json, provenance_json FROM olog_equation WHERE lhs_json LIKE ? OR rhs_json LIKE ?"
    );
    this.insertConstraintStmt = this.db.prepare(
      "INSERT INTO olog_constraint (id, name, kind, message, config_json, provenance_json) VALUES (?, ?, ?, ?, ?, ?)"
    );
    this.getConstraintsStmt = this.db.prepare(
      "SELECT id, name, kind, message, config_json, provenance_json FROM olog_constraint"
    );
    this.getProvenanceStmt = this.db.prepare(
      "SELECT elem_id, source, commit_sha, ingested_at, confidence FROM olog_prov WHERE elem_id = ?"
    );
    this.insertElemStmt = this.db.prepare(
      "INSERT INTO olog_elem (id, kind, name, module, span, attrs) VALUES (?, ?, ?, ?, ?, ?)"
    );
    this.insertArrStmt = this.db.prepare(
      "INSERT INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
    );
    this.insertProvStmt = this.db.prepare(
      "INSERT INTO olog_prov (elem_id, source, commit_sha, ingested_at, confidence) VALUES (?, ?, ?, ?, ?)"
    );
    this.hasArrowKindStmt = this.db.prepare(
      "SELECT 1 FROM olog_arr WHERE kind = ? LIMIT 1"
    );
    this.insertMotifTemplateStmt = this.db.prepare(
      `INSERT INTO olog_motif_template (id, name, description, shape_json, equations_json, provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    this.insertMotifInstanceStmt = this.db.prepare(
      `INSERT INTO olog_motif_instance (id, template_id, mappings_json, provenance_json, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    this.insertWorkingSetStmt = this.db.prepare(
      "INSERT INTO olog_working_set (id, name, plan_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    );
    this.insertWorkingSetElemStmt = this.db.prepare(
      "INSERT OR IGNORE INTO olog_working_set_elem (set_id, elem_id) VALUES (?, ?)"
    );
    this.insertWorkingSetArrStmt = this.db.prepare(
      "INSERT OR IGNORE INTO olog_working_set_arr (set_id, arr_id) VALUES (?, ?)"
    );
    this.getWorkingSetStmt = this.db.prepare(
      "SELECT id, name, plan_hash, created_at, updated_at FROM olog_working_set WHERE id = ?"
    );
    this.deleteWorkingSetStmt = this.db.prepare(
      "DELETE FROM olog_working_set WHERE id = ?"
    );
    this.insertWorkingSetNoteStmt = this.db.prepare(
      "INSERT OR REPLACE INTO olog_working_set_note (set_id, target_id, note, updated_at) VALUES (?, ?, ?, ?)"
    );
    this.getWorkingSetNoteStmt = this.db.prepare(
      "SELECT set_id, target_id, note, updated_at FROM olog_working_set_note WHERE set_id = ? AND target_id = ?"
    );
    this.getWorkingSetNotesStmt = this.db.prepare(
      "SELECT set_id, target_id, note, updated_at FROM olog_working_set_note WHERE set_id = ?"
    );
    this.deleteWorkingSetNoteStmt = this.db.prepare(
      "DELETE FROM olog_working_set_note WHERE set_id = ? AND target_id = ?"
    );
    this.insertSyntheticArrStmt = this.db.prepare(
      "INSERT OR IGNORE INTO olog_ws_synthetic_arr (set_id, id, kind, src_id, dst_id, note, source) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    this.getSyntheticArrsStmt = this.db.prepare(
      "SELECT id, kind, src_id, dst_id, note, source FROM olog_ws_synthetic_arr WHERE set_id = ?"
    );
    this._sessions = new DomainSessionStore(this.db);
    this._motifSessions = new MotifSessionStore(this.db);
  }
  get sessions() {
    return this._sessions;
  }
  get motifSessions() {
    return this._motifSessions;
  }
  commitSha() {
    const row = this.db.prepare("SELECT value FROM olog_meta WHERE key = 'commit_sha'").get();
    return row?.value ?? "";
  }
  isFresh(head) {
    return this.commitSha() === head;
  }
  ingestFull(elems, arrs, sha) {
    const insertElem = this.db.prepare(
      "INSERT INTO olog_elem (id, kind, name, module, span, attrs) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertArr = this.db.prepare(
      "INSERT INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
    );
    const insertProv = this.db.prepare(
      "INSERT INTO olog_prov (elem_id, source, commit_sha, ingested_at, confidence) VALUES (?, 'tree-sitter', ?, ?, 'resolved')"
    );
    const updateMeta = this.db.prepare(
      "INSERT INTO olog_meta (key, value) VALUES ('commit_sha', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    const tx = this.db.transaction(() => {
      const manualElems = this.db.prepare(
        "SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source != 'tree-sitter'"
      ).all();
      const manualArrs = this.db.prepare(
        "SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs FROM olog_arr a WHERE a.src_id IN (SELECT e.id FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source != 'tree-sitter') OR a.dst_id IN (SELECT e.id FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source != 'tree-sitter')"
      ).all();
      const manualProvs = this.db.prepare(
        "SELECT elem_id, source, commit_sha, ingested_at, confidence FROM olog_prov WHERE source != 'tree-sitter'"
      ).all();
      this.db.prepare("DELETE FROM olog_elem").run();
      for (const e of elems) {
        insertElem.run(e.id, e.kind, e.name, e.module, e.span, e.attrs);
        insertProv.run(e.id, sha, Date.now());
      }
      for (const a of arrs) {
        insertArr.run(a.id, a.kind, a.src_id, a.dst_id, a.attrs);
      }
      for (const e of manualElems) {
        this.db.prepare(
          "INSERT OR IGNORE INTO olog_elem (id, kind, name, module, span, attrs) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(e.id, e.kind, e.name, e.module, e.span, e.attrs);
      }
      const allElemIds = /* @__PURE__ */ new Set();
      for (const e of elems) allElemIds.add(e.id);
      for (const e of manualElems) allElemIds.add(e.id);
      for (const a of manualArrs) {
        if (allElemIds.has(a.src_id) && allElemIds.has(a.dst_id)) {
          insertArr.run(a.id, a.kind, a.src_id, a.dst_id, a.attrs);
        }
      }
      for (const p of manualProvs) {
        this.insertProvStmt.run(p.elem_id, p.source, p.commit_sha, p.ingested_at, p.confidence ?? "resolved");
      }
      updateMeta.run(sha);
    });
    tx();
    return elems.length;
  }
  /** Return the set of relative module paths that have at least one tree-sitter element. */
  getIngestedModules() {
    const rows = this.db.prepare(
      "SELECT DISTINCT e.module FROM olog_elem e INNER JOIN olog_prov p ON e.id = p.elem_id WHERE p.source = 'tree-sitter' AND e.module IS NOT NULL"
    ).all();
    return new Set(rows.map((r) => r.module));
  }
  /** Delete all tree-sitter elements for a given module (cascade removes arrows). */
  deleteModuleTreeSitterElements(module) {
    this.db.prepare(
      "DELETE FROM olog_elem WHERE module = ? AND id IN (SELECT elem_id FROM olog_prov WHERE source = 'tree-sitter')"
    ).run(module);
  }
  /** Return a map of element name → [ids] across all elements, for cross-file resolution. */
  getAllElemNameToIds() {
    const rows = this.db.prepare("SELECT id, name FROM olog_elem WHERE module IS NOT NULL").all();
    const result = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const arr = result.get(row.name) ?? [];
      arr.push(row.id);
      result.set(row.name, arr);
    }
    return result;
  }
  /** Return a map of element id → module for all elements with a module. */
  getAllElemIdToModule() {
    const rows = this.db.prepare("SELECT id, module FROM olog_elem WHERE module IS NOT NULL").all();
    const result = /* @__PURE__ */ new Map();
    for (const row of rows) result.set(row.id, row.module);
    return result;
  }
  /**
   * Insert elements and arrows for specific files without wiping the whole store.
   * Used by incremental ingestion. Arrows that reference non-existent elements are silently skipped.
   */
  ingestFile(elems, arrs, sha) {
    const insertElem = this.db.prepare(
      "INSERT OR IGNORE INTO olog_elem (id, kind, name, module, span, attrs) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertArr = this.db.prepare(
      "INSERT OR IGNORE INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
    );
    const insertProv = this.db.prepare(
      "INSERT OR IGNORE INTO olog_prov (elem_id, source, commit_sha, ingested_at, confidence) VALUES (?, 'tree-sitter', ?, ?, 'resolved')"
    );
    const updateMeta = this.db.prepare(
      "INSERT INTO olog_meta (key, value) VALUES ('commit_sha', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    const tx = this.db.transaction(() => {
      for (const e of elems) {
        insertElem.run(e.id, e.kind, e.name, e.module, e.span, e.attrs);
        insertProv.run(e.id, sha, Date.now());
      }
      for (const a of arrs) {
        try {
          insertArr.run(a.id, a.kind, a.src_id, a.dst_id, a.attrs);
        } catch {
        }
      }
      updateMeta.run(sha);
    });
    tx();
  }
  getElem(id) {
    const row = this.getElemStmt.get(id);
    if (!row) return null;
    return this.rowToElem(row);
  }
  getArr(id) {
    const row = this.getArrStmt.get(id);
    if (!row) return null;
    return this.rowToArr(row);
  }
  outgoing(srcId) {
    const rows = this.outgoingStmt.all(srcId);
    return rows.map((r) => this.rowToArr(r));
  }
  incoming(dstId) {
    const rows = this.incomingStmt.all(dstId);
    return rows.map((r) => this.rowToArr(r));
  }
  /** Derive virtual arrows that are no longer stored: inModule/locatedIn (≡ definedIn),
   *  contains (≡ inverse definedIn for files), imports (≡ inverse importsFrom for files). */
  outgoingDerived(elemId2) {
    const derived = [];
    const stored = this.outgoing(elemId2);
    for (const a of stored) {
      if (a.kind === "definedIn") {
        derived.push({ id: `${a.srcId}:inModule:${a.dstId}`, kind: "inModule", srcId: a.srcId, dstId: a.dstId, attrs: a.attrs });
        derived.push({ id: `${a.srcId}:locatedIn:${a.dstId}`, kind: "locatedIn", srcId: a.srcId, dstId: a.dstId, attrs: a.attrs });
      }
    }
    for (const a of this.incoming(elemId2)) {
      if (a.kind === "definedIn") {
        derived.push({ id: `${elemId2}:contains:${a.srcId}`, kind: "contains", srcId: elemId2, dstId: a.srcId, attrs: a.attrs });
      }
      if (a.kind === "importsFrom") {
        derived.push({ id: `${elemId2}:imports:${a.srcId}`, kind: "imports", srcId: elemId2, dstId: a.srcId, attrs: a.attrs });
      }
    }
    return derived;
  }
  getElemsByModule(module) {
    const rows = this.db.prepare(
      "SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE module = ?"
    ).all(module);
    return rows.map((r) => this.rowToElem(r));
  }
  queryElements(opts) {
    const conditions = [];
    const params = [];
    if (opts.kind && opts.kind !== "any") {
      conditions.push("kind = ?");
      params.push(opts.kind);
    }
    if (opts.nameRegex) {
      conditions.push("name REGEXP ?");
      params.push(opts.nameRegex);
    }
    if (opts.moduleRegex) {
      conditions.push("module REGEXP ?");
      params.push(opts.moduleRegex);
    }
    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const sql = `SELECT id, kind, name, module, span, attrs FROM olog_elem ${where} ORDER BY module, name LIMIT ?`;
    params.push(opts.limit);
    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r) => this.rowToElem(r));
  }
  dumpCounts() {
    const elemRows = this.db.prepare("SELECT kind, COUNT(*) as count FROM olog_elem GROUP BY kind").all();
    const arrRows = this.db.prepare("SELECT kind, COUNT(*) as count FROM olog_arr GROUP BY kind").all();
    const totalElemRow = this.db.prepare("SELECT COUNT(*) as count FROM olog_elem").get();
    const totalArrRow = this.db.prepare("SELECT COUNT(*) as count FROM olog_arr").get();
    const elementCounts = {};
    for (const r of elemRows) {
      elementCounts[r.kind] = Number(r.count);
    }
    const arrowCounts = {};
    for (const r of arrRows) {
      arrowCounts[r.kind] = Number(r.count);
    }
    return {
      elementCounts,
      arrowCounts,
      totalElements: Number(totalElemRow?.count ?? 0),
      totalArrows: Number(totalArrRow?.count ?? 0)
    };
  }
  addEquation(eq) {
    this.insertEquationStmt.run(
      eq.id,
      eq.name,
      eq.humanMessage,
      JSON.stringify(eq.lhs),
      JSON.stringify(eq.rhs),
      eq.provenance ? JSON.stringify(eq.provenance) : null
    );
  }
  getEquations() {
    const rows = this.getEquationsStmt.all();
    return rows.map((r) => this.rowToEquation(r));
  }
  getEquationsForObject(objectId) {
    const pattern = `%${objectId}%`;
    const rows = this.getEquationsForObjectStmt.all(pattern, pattern);
    return rows.map((r) => this.rowToEquation(r));
  }
  addConstraint(constraint) {
    this.insertConstraintStmt.run(
      constraint.id,
      constraint.name,
      constraint.kind,
      constraint.message,
      JSON.stringify(constraint.config),
      constraint.provenance ? JSON.stringify(constraint.provenance) : null
    );
  }
  getConstraints() {
    const rows = this.getConstraintsStmt.all();
    return rows.map((r) => this.rowToConstraint(r));
  }
  addMotifTemplate(template) {
    this.insertMotifTemplateStmt.run(
      template.id,
      template.name,
      template.description,
      JSON.stringify(template.shape),
      JSON.stringify(template.equations),
      JSON.stringify(template.provenance),
      Date.now()
    );
  }
  getMotifTemplates() {
    const rows = this.db.prepare(
      "SELECT id, name, description, shape_json, equations_json, provenance_json, created_at FROM olog_motif_template"
    ).all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      shape: JSON.parse(r.shape_json),
      equations: r.equations_json ? JSON.parse(r.equations_json) : [],
      provenance: JSON.parse(r.provenance_json),
      createdAt: r.created_at
    }));
  }
  addMotifInstance(instance) {
    this.insertMotifInstanceStmt.run(
      instance.id,
      instance.templateId,
      JSON.stringify(instance.mappings),
      JSON.stringify(instance.provenance),
      Date.now()
    );
  }
  getMotifInstances(templateId) {
    const rows = this.db.prepare(
      "SELECT id, template_id, mappings_json, provenance_json, created_at FROM olog_motif_instance WHERE template_id = ?"
    ).all(templateId);
    return rows.map((r) => ({
      id: r.id,
      templateId: r.template_id,
      mappings: JSON.parse(r.mappings_json),
      provenance: JSON.parse(r.provenance_json),
      createdAt: r.created_at
    }));
  }
  traverse(opts) {
    return traverse(this.db, opts);
  }
  queryElementsWithConfidence(opts) {
    const conditions = [];
    const params = [];
    if (opts.kind && opts.kind !== "any") {
      conditions.push("e.kind = ?");
      params.push(opts.kind);
    }
    if (opts.nameRegex) {
      conditions.push("e.name REGEXP ?");
      params.push(opts.nameRegex);
    }
    if (opts.moduleRegex) {
      conditions.push("e.module REGEXP ?");
      params.push(opts.moduleRegex);
    }
    if (opts.minConfidence) {
      conditions.push("p.confidence = ?");
      params.push(opts.minConfidence);
    }
    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const join42 = opts.minConfidence ? " INNER JOIN olog_prov p ON e.id = p.elem_id" : "";
    const sql = `SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_elem e${join42} ${where} ORDER BY e.module, e.name LIMIT ?`;
    params.push(opts.limit);
    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r) => this.rowToElem(r));
  }
  getProvenance(elemId2) {
    const row = this.getProvenanceStmt.get(elemId2);
    if (!row) return null;
    return {
      source: row.source,
      commitSha: row.commit_sha,
      ingestedAt: row.ingested_at,
      confidence: row.confidence ?? "resolved"
    };
  }
  applyPlan(operations) {
    let applied = 0;
    let skipped = 0;
    const errors = [];
    const changes = [];
    const updateElemName = this.db.prepare(
      "UPDATE olog_elem SET name = ? WHERE id = ?"
    );
    const updateArrRefs = this.db.prepare(
      "UPDATE olog_arr SET id = ?, src_id = ?, dst_id = ? WHERE id = ?"
    );
    const updateElemModule = this.db.prepare(
      "UPDATE olog_elem SET module = ? WHERE id = ?"
    );
    const insertElem = this.db.prepare(
      "INSERT INTO olog_elem (id, kind, name, module, span, attrs) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertArr = this.db.prepare(
      "INSERT INTO olog_arr (id, kind, src_id, dst_id, attrs) VALUES (?, ?, ?, ?, ?)"
    );
    const deleteElem = this.db.prepare(
      "DELETE FROM olog_elem WHERE id = ?"
    );
    const deleteArr = this.db.prepare(
      "DELETE FROM olog_arr WHERE id = ?"
    );
    const findArrowsByElem = this.db.prepare(
      "SELECT id, kind, src_id, dst_id, attrs FROM olog_arr WHERE id LIKE ?"
    );
    const tx = this.db.transaction(() => {
      for (const op of operations) {
        try {
          switch (op.kind) {
            case "rename": {
              const elem = this.getElem(op.target);
              if (!elem) {
                skipped++;
                errors.push(`Element not found: ${op.target}`);
                break;
              }
              updateElemName.run(op.newName, op.target);
              const arrowPattern = `%${op.target}%`;
              const affectedArrows = findArrowsByElem.all(arrowPattern);
              for (const arr of affectedArrows) {
                const oldId = arr.id;
                const newId = arr.id.replace(`:${elem.name}:`, `:${op.newName}:`);
                if (newId !== oldId) {
                  updateArrRefs.run(newId, arr.src_id, arr.dst_id, oldId);
                }
              }
              applied++;
              changes.push({
                path: elem.module ?? "",
                line: 0,
                column: 0,
                oldText: elem.name,
                newText: op.newName
              });
              break;
            }
            case "move": {
              const moveElem = this.getElem(op.target);
              if (!moveElem) {
                skipped++;
                errors.push(`Element not found: ${op.target}`);
                break;
              }
              updateElemModule.run(op.newModule, op.target);
              applied++;
              changes.push({
                path: moveElem.module ?? "",
                line: 0,
                column: 0,
                oldText: moveElem.module ?? "",
                newText: op.newModule
              });
              break;
            }
            case "addSymbol": {
              const id = `manual:${op.module}:0:0:${op.symbolKind}:${op.name}`;
              insertElem.run(id, op.symbolKind, op.name, op.module, null, "{}");
              applied++;
              changes.push({
                path: op.module,
                line: 0,
                column: 0,
                oldText: "",
                newText: op.name
              });
              break;
            }
            case "removeSymbol": {
              const remElem = this.getElem(op.target);
              if (!remElem) {
                skipped++;
                errors.push(`Element not found: ${op.target}`);
                break;
              }
              deleteElem.run(op.target);
              applied++;
              changes.push({
                path: remElem.module ?? "",
                line: 0,
                column: 0,
                oldText: remElem.name,
                newText: ""
              });
              break;
            }
            case "addArrow": {
              const aid = `${op.src}:${op.arrowKind}:${op.dst}`;
              insertArr.run(aid, op.arrowKind, op.src, op.dst, "{}");
              applied++;
              changes.push({
                path: "",
                line: 0,
                column: 0,
                oldText: "",
                newText: `${op.arrowKind}: ${op.src} -> ${op.dst}`
              });
              break;
            }
            case "removeArrow": {
              deleteArr.run(op.arrowId);
              applied++;
              changes.push({
                path: "",
                line: 0,
                column: 0,
                oldText: op.arrowId,
                newText: ""
              });
              break;
            }
            case "addReexport": {
              const id = `projected:${op.module}:other:${op.name}`;
              insertElem.run(id, "other", op.name, op.module, null, "{}");
              const moduleElems = this.db.prepare(
                "SELECT id FROM olog_elem WHERE module = ? LIMIT 1"
              ).all(op.module);
              const firstModuleElem = moduleElems[0];
              if (firstModuleElem) {
                const arrId = `${firstModuleElem.id}:references:${id}`;
                insertArr.run(arrId, "references", firstModuleElem.id, id, "{}");
              }
              applied++;
              changes.push({
                path: op.module,
                line: 0,
                column: 0,
                oldText: "",
                newText: op.name
              });
              break;
            }
            case "amendType": {
              const elemRow = this.getElemStmt.get(op.target);
              if (!elemRow) {
                skipped++;
                errors.push(`Element not found: ${op.target}`);
                break;
              }
              const attrs = JSON.parse(elemRow.attrs);
              if (op.action === "addUnionMember") {
                if (!attrs[op.field]) {
                  attrs[op.field] = [];
                }
                if (Array.isArray(attrs[op.field])) {
                  attrs[op.field].push(op.value);
                }
              } else if (op.action === "addProperty") {
                attrs[op.field] = op.value;
              }
              this.db.prepare("UPDATE olog_elem SET attrs = ? WHERE id = ?").run(JSON.stringify(attrs), op.target);
              applied++;
              changes.push({
                path: elemRow.module ?? "",
                line: 0,
                column: 0,
                oldText: "",
                newText: `${op.field}: ${op.value}`
              });
              break;
            }
            default:
              skipped++;
              errors.push(`Unknown operation kind: ${op.kind}`);
              break;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(msg);
        }
      }
    });
    tx();
    return { applied, skipped, errors, changes };
  }
  addElement(elem) {
    this.insertElemStmt.run(
      elem.id,
      elem.kind,
      elem.name,
      elem.module,
      elem.span,
      JSON.stringify(elem.attrs)
    );
  }
  addArrow(arr) {
    this.insertArrStmt.run(
      arr.id,
      arr.kind,
      arr.srcId,
      arr.dstId,
      JSON.stringify(arr.attrs)
    );
  }
  addProvenance(elemId2, prov) {
    this.insertProvStmt.run(
      elemId2,
      prov.source,
      prov.commitSha,
      prov.ingestedAt,
      prov.confidence
    );
  }
  hasArrowKind(kind) {
    const row = this.hasArrowKindStmt.get(kind);
    return !!row;
  }
  /**
   * Load every arrow as lightweight {src_id, kind, dst_id} rows.
   * Used to build the in-memory adjacency map for fast mining.
   */
  loadAllArrows() {
    return this.db.prepare("SELECT src_id, kind, dst_id FROM olog_arr").all();
  }
  /**
   * Load every element's id, kind, and name.
   * Used for kind annotation and counterexample names during mining.
   */
  loadElemMeta() {
    const rows = this.db.prepare("SELECT id, kind, name FROM olog_elem").all();
    const map = /* @__PURE__ */ new Map();
    for (const r of rows) map.set(r.id, { kind: r.kind, name: r.name });
    return map;
  }
  /**
   * Get all distinct arrow kinds where either the source or destination element
   * is of one of the given element kinds.
   *
   * This is useful for mining: when you want to restrict path enumeration to
   * only arrow kinds that connect to domain objects (or any other element kind),
   * this method returns the relevant arrow kinds.
   *
   * @param elementKinds - Array of element kinds to filter by (e.g., ['domain'])
   * @returns Sorted array of distinct ArrowKind values
   */
  getArrowKindsForElementKinds(elementKinds) {
    if (elementKinds.length === 0) return [];
    const placeholders = elementKinds.map(() => "?").join(",");
    const sql = `
      SELECT DISTINCT a.kind
      FROM olog_arr a
      INNER JOIN olog_elem src ON a.src_id = src.id
      INNER JOIN olog_elem dst ON a.dst_id = dst.id
      WHERE src.kind IN (${placeholders})
         OR dst.kind IN (${placeholders})
      ORDER BY a.kind
    `;
    const params = [...elementKinds, ...elementKinds];
    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r) => r.kind);
  }
  createWorkingSet(name, planHash) {
    const id = randomUUID3();
    const now = Date.now();
    this.insertWorkingSetStmt.run(id, name, planHash ?? null, now, now);
    return id;
  }
  addToWorkingSet(setId, elemIds, arrIds) {
    const now = Date.now();
    let elementsAdded = 0;
    let arrowsAdded = 0;
    const tx = this.db.transaction(() => {
      for (const elemId2 of elemIds) {
        const result = this.insertWorkingSetElemStmt.run(setId, elemId2);
        elementsAdded += result.changes;
      }
      for (const arrId of arrIds) {
        const result = this.insertWorkingSetArrStmt.run(setId, arrId);
        arrowsAdded += result.changes;
      }
      this.db.prepare("UPDATE olog_working_set SET updated_at = ? WHERE id = ?").run(now, setId);
    });
    tx();
    return { elementsAdded, arrowsAdded };
  }
  getWorkingSet(setId, includeAnnotations) {
    const row = this.getWorkingSetStmt.get(setId);
    if (!row) return null;
    const elemRows = this.db.prepare(
      "SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_working_set_elem ws JOIN olog_elem e ON e.id = ws.elem_id WHERE ws.set_id = ?"
    ).all(setId);
    const arrRows = this.db.prepare(
      "SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs FROM olog_working_set_arr ws JOIN olog_arr a ON a.id = ws.arr_id WHERE ws.set_id = ?"
    ).all(setId);
    const notes = includeAnnotations !== false ? this.getAnnotations(setId) : [];
    return {
      id: row.id,
      name: row.name,
      planHash: row.plan_hash,
      elements: elemRows.map((r) => this.rowToElem(r)),
      arrows: arrRows.map((r) => this.rowToArr(r)),
      notes
    };
  }
  listWorkingSets() {
    const rows = this.db.prepare(
      `SELECT ws.id, ws.name, ws.plan_hash, ws.updated_at,
        (SELECT COUNT(*) FROM olog_working_set_elem WHERE set_id = ws.id) AS element_count,
        (SELECT COUNT(*) FROM olog_working_set_arr WHERE set_id = ws.id) AS arrow_count
       FROM olog_working_set ws ORDER BY ws.updated_at DESC`
    ).all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      planHash: r.plan_hash,
      elementCount: r.element_count,
      arrowCount: r.arrow_count,
      updatedAt: r.updated_at
    }));
  }
  deleteWorkingSet(setId) {
    this.deleteWorkingSetStmt.run(setId);
  }
  annotateWorkingSet(setId, targetId, note) {
    const now = Date.now();
    this.insertWorkingSetNoteStmt.run(setId, targetId, note, now);
    this.db.prepare("UPDATE olog_working_set SET updated_at = ? WHERE id = ?").run(now, setId);
    return { setId, targetId, note, updatedAt: now };
  }
  getAnnotations(setId, targetIds) {
    if (targetIds && targetIds.length > 0) {
      return targetIds.flatMap((tid) => {
        const row = this.getWorkingSetNoteStmt.get(setId, tid);
        return row ? [{ setId: row.set_id, targetId: row.target_id, note: row.note, updatedAt: row.updated_at }] : [];
      });
    }
    const rows = this.getWorkingSetNotesStmt.all(setId);
    return rows.map((r) => ({ setId: r.set_id, targetId: r.target_id, note: r.note, updatedAt: r.updated_at }));
  }
  deleteAnnotation(setId, targetId) {
    this.deleteWorkingSetNoteStmt.run(setId, targetId);
    this.db.prepare("UPDATE olog_working_set SET updated_at = ? WHERE id = ?").run(Date.now(), setId);
  }
  getWorkingSetElementIds(setId) {
    const rows = this.db.prepare(
      "SELECT elem_id FROM olog_working_set_elem WHERE set_id = ?"
    ).all(setId);
    return new Set(rows.map((r) => r.elem_id));
  }
  assertSyntheticArrow(setId, srcId, dstId, kind, source, note) {
    const srcExists = this.db.prepare("SELECT 1 FROM olog_elem WHERE id = ? LIMIT 1").get(srcId);
    if (!srcExists) throw new Error(`assertSyntheticArrow: srcId '${srcId}' not found in olog_elem`);
    const id = `syn:${randomUUID3()}`;
    this.insertSyntheticArrStmt.run(setId, id, kind, srcId, dstId ?? "", note ?? null, source);
    this.db.prepare("UPDATE olog_working_set SET updated_at = ? WHERE id = ?").run(Date.now(), setId);
    return id;
  }
  queryWorkingSetGraph(setId, opts) {
    const { kind, nameRegex, moduleRegex, arrows, direction = "out", includeAnnotations, source } = opts;
    let seedElems = this.db.prepare(
      "SELECT e.id, e.kind, e.name, e.module, e.span, e.attrs FROM olog_working_set_elem ws JOIN olog_elem e ON e.id = ws.elem_id WHERE ws.set_id = ?"
    ).all(setId).map((r) => this.rowToElem(r));
    if (kind) seedElems = seedElems.filter((e) => e.kind === kind);
    if (nameRegex) {
      const re = new RegExp(nameRegex);
      seedElems = seedElems.filter((e) => re.test(e.name));
    }
    if (moduleRegex) {
      const re = new RegExp(moduleRegex);
      seedElems = seedElems.filter((e) => e.module != null && re.test(e.module));
    }
    const syntheticRows = this.getSyntheticArrsStmt.all(setId);
    const allSyntheticArrows = syntheticRows.map((r) => ({ id: r.id, setId, kind: r.kind, srcId: r.src_id, dstId: r.dst_id || null, note: r.note, source: r.source, synthetic: true }));
    const filteredSyntheticArrows = source ? allSyntheticArrows.filter((a) => a.source === source) : allSyntheticArrows;
    if (!arrows || arrows.length === 0) {
      const realArrows2 = this.db.prepare(
        "SELECT a.id, a.kind, a.src_id, a.dst_id, a.attrs FROM olog_working_set_arr ws JOIN olog_arr a ON a.id = ws.arr_id WHERE ws.set_id = ?"
      ).all(setId).map((r) => this.rowToArr(r));
      const result2 = { elements: seedElems, arrows: realArrows2, syntheticArrows: filteredSyntheticArrows };
      if (includeAnnotations) this._attachAnnotations(setId, result2);
      return result2;
    }
    const seedIds = seedElems.map((e) => e.id);
    if (seedIds.length === 0) return { elements: [], arrows: [], syntheticArrows: [] };
    const col = direction === "out" ? "src_id" : "dst_id";
    const neighborCol = direction === "out" ? "dst_id" : "src_id";
    const idPh = seedIds.map(() => "?").join(", ");
    const kindPh = arrows.map(() => "?").join(", ");
    const realRows = this.db.prepare(
      `SELECT id, kind, src_id, dst_id, attrs FROM olog_arr WHERE ${col} IN (${idPh}) AND kind IN (${kindPh})`
    ).all(...seedIds, ...arrows);
    const realArrows = realRows.map((r) => this.rowToArr(r));
    const synRows = this.db.prepare(
      `SELECT id, kind, src_id, dst_id, note, source FROM olog_ws_synthetic_arr WHERE set_id = ? AND ${col} IN (${idPh}) AND kind IN (${kindPh})`
    ).all(setId, ...seedIds, ...arrows);
    const syntheticArrows = synRows.filter((r) => !source || r.source === source).map((r) => ({ id: r.id, setId, kind: r.kind, srcId: r.src_id, dstId: r.dst_id || null, note: r.note, source: r.source, synthetic: true }));
    const neighborIds = [
      ...realRows.map((r) => r[neighborCol]),
      ...synRows.map((r) => r[neighborCol])
    ];
    const allElemIds = [.../* @__PURE__ */ new Set([...seedIds, ...neighborIds])];
    const elemPh = allElemIds.map(() => "?").join(", ");
    const allElems = this.db.prepare(
      `SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE id IN (${elemPh})`
    ).all(...allElemIds).map((r) => this.rowToElem(r));
    const result = { elements: allElems, arrows: realArrows, syntheticArrows };
    if (includeAnnotations) this._attachAnnotations(setId, result);
    return result;
  }
  _attachAnnotations(setId, graph) {
    const notes = this.getAnnotations(setId);
    const notesMap = new Map(notes.map((n) => [n.targetId, n.note]));
    graph.elements = graph.elements.map((e) => ({ ...e, annotation: notesMap.get(e.id) ?? null }));
    graph.arrows = graph.arrows.map((a) => ({ ...a, annotation: notesMap.get(a.id) ?? null }));
    graph.syntheticArrows = graph.syntheticArrows.map((s) => ({ ...s, annotation: notesMap.get(s.id) ?? null }));
  }
  close() {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
    this.db.close();
  }
  rowToElem(row) {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      module: row.module,
      span: row.span,
      attrs: JSON.parse(row.attrs)
    };
  }
  rowToArr(row) {
    return {
      id: row.id,
      kind: row.kind,
      srcId: row.src_id,
      dstId: row.dst_id,
      attrs: JSON.parse(row.attrs)
    };
  }
  rowToEquation(row) {
    return {
      id: row.id,
      name: row.name,
      humanMessage: row.human_message,
      lhs: JSON.parse(row.lhs_json),
      rhs: JSON.parse(row.rhs_json),
      provenance: row.provenance_json ? JSON.parse(row.provenance_json) : null
    };
  }
  rowToConstraint(row) {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      message: row.message,
      config: row.config_json ? JSON.parse(row.config_json) : {},
      provenance: row.provenance_json ? JSON.parse(row.provenance_json) : null
    };
  }
};
var ELEM_KINDS = [
  "file",
  "module",
  "symbol",
  "callsite",
  "import",
  "type",
  "interface",
  "class",
  "enum",
  "function",
  "method",
  "const",
  "var",
  "namespace",
  "property",
  "domain",
  "other"
];
var ARROW_KINDS = [
  "extends",
  "implements",
  "calls",
  "imports",
  "exports",
  "references",
  "contains",
  "returns",
  "param",
  "typeof",
  "instanceof",
  "definedIn",
  "inModule",
  "memberOf",
  "callerOf",
  "calleeOf",
  "importsFrom",
  "locatedIn",
  "hasProperty",
  "hasType",
  "implementedAs",
  "proposedImplementation",
  "throws",
  "other"
];
var CONFIDENCE_RANK = {
  tentative: 0,
  unresolved: 1,
  resolved: 2
};
function evaluateConstraints(store2) {
  const violations = [];
  const constraints = store2.getConstraints();
  for (const constraint of constraints) {
    switch (constraint.kind) {
      case "existence":
        violations.push(...evaluateExistence(store2, constraint));
        break;
      case "layering":
        violations.push(...evaluateLayering(store2, constraint));
        break;
      case "monotonicity":
        violations.push(...evaluateMonotonicity(store2, constraint));
        break;
      case "totality":
        violations.push(...evaluateTotality(store2, constraint));
        break;
    }
  }
  return { valid: violations.length === 0, violations };
}
function evaluateExistence(store2, constraint) {
  const kind = constraint.config.kind;
  if (!kind) return [];
  const elements = store2.queryElements({ kind, limit: 1 });
  if (elements.length > 0) return [];
  return [
    {
      id: randomUUID4(),
      kind: "integrity",
      humanMessage: constraint.message ?? `Existence constraint "${constraint.name}" violated: no elements of kind "${kind}" exist`,
      involved: []
    }
  ];
}
function evaluateLayering(store2, constraint) {
  const rawLayers = constraint.config.layers;
  if (!rawLayers || rawLayers.length === 0) return [];
  const layers = rawLayers;
  const violations = [];
  function layerIndexOf(mod) {
    if (mod == null) return null;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer) continue;
      for (const pattern of layer) {
        if (new RegExp(pattern).test(mod)) return i;
      }
    }
    return null;
  }
  const allElems = store2.queryElements({ kind: "any", limit: 5e4 });
  for (const elem of allElems) {
    const srcLayer = layerIndexOf(elem.module);
    if (srcLayer === null) continue;
    const outgoing = store2.outgoing(elem.id);
    for (const arr of outgoing) {
      const dstElem = store2.getElem(arr.dstId);
      if (!dstElem) continue;
      const dstLayer = layerIndexOf(dstElem.module);
      if (dstLayer === null) continue;
      if (srcLayer < dstLayer) {
        violations.push({
          id: randomUUID4(),
          kind: "integrity",
          humanMessage: constraint.message ?? `Layering constraint "${constraint.name}" violated: "${elem.name}" (layer ${srcLayer}) references "${dstElem.name}" (layer ${dstLayer})`,
          involved: [elem.id, dstElem.id]
        });
      }
    }
  }
  return violations;
}
function evaluateMonotonicity(store2, constraint) {
  const violations = [];
  const allElems = store2.queryElements({ kind: "any", limit: 5e4 });
  for (const elem of allElems) {
    const srcProv = store2.getProvenance(elem.id);
    if (!srcProv) continue;
    const outgoing = store2.outgoing(elem.id);
    for (const arr of outgoing) {
      const dstProv = store2.getProvenance(arr.dstId);
      if (!dstProv) continue;
      if (CONFIDENCE_RANK[dstProv.confidence] > CONFIDENCE_RANK[srcProv.confidence]) {
        const dstElem = store2.getElem(arr.dstId);
        violations.push({
          id: randomUUID4(),
          kind: "integrity",
          humanMessage: constraint.message ?? `Monotonicity constraint "${constraint.name}" violated: "${elem.name}" (${srcProv.confidence}) \u2192 "${dstElem?.name ?? arr.dstId}" (${dstProv.confidence})`,
          involved: [elem.id, arr.dstId]
        });
      }
    }
  }
  return violations;
}
function evaluateTotality(store2, constraint) {
  const arrowKind = constraint.config.arrowKind;
  const domainKind = constraint.config.domainKind;
  if (!arrowKind || !domainKind) return [];
  const violations = [];
  const domainElems = store2.queryElements({ kind: domainKind, limit: 5e4 });
  for (const elem of domainElems) {
    const outgoing = store2.outgoing(elem.id);
    const matching = outgoing.filter((a) => a.kind === arrowKind);
    if (matching.length === 0) {
      violations.push({
        id: randomUUID4(),
        kind: "integrity",
        humanMessage: constraint.message ?? `Totality constraint "${constraint.name}" violated: "${elem.name}" has no outgoing "${arrowKind}" arrow`,
        involved: [elem.id]
      });
    } else if (matching.length > 1) {
      violations.push({
        id: randomUUID4(),
        kind: "integrity",
        humanMessage: constraint.message ?? `Totality constraint "${constraint.name}" violated: "${elem.name}" has ${matching.length} outgoing "${arrowKind}" arrows (expected exactly 1)`,
        involved: [elem.id, ...matching.map((a) => a.id)]
      });
    }
  }
  return violations;
}
function evaluatePathEquations(store2) {
  const violations = [];
  const equations = store2.getEquations();
  for (const eq of equations) {
    const result = evaluateEquation(eq, store2);
    if (!result.valid) {
      violations.push({
        id: randomUUID4(),
        kind: "equation",
        humanMessage: result.message,
        involved: result.involved
      });
    }
  }
  return { valid: violations.length === 0, violations };
}
function isSchemaElement(elem) {
  if (elem.kind === "domain") return "domain";
  if (elem.kind === "property") return "property";
  const schemaKind = elem.attrs?.schemaKind;
  if (typeof schemaKind === "string") return schemaKind;
  if (elem.kind === "other" && elem.module === null && elem.span === null) {
    const match = elem.name.match(/^(?:a|an)\s+(\S+)/);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}
function evaluateEquation(eq, store2) {
  const lhsSrc = store2.getElem(eq.lhs.src);
  if (!lhsSrc) {
    return {
      valid: true,
      involved: [],
      message: `Equation "${eq.name}": source "${eq.lhs.src}" not in store, skipping`
    };
  }
  const rhsSrc = store2.getElem(eq.rhs.src);
  if (!rhsSrc) {
    return {
      valid: true,
      involved: [],
      message: `Equation "${eq.name}": source "${eq.rhs.src}" not in store, skipping`
    };
  }
  const lhsSchemaKind = isSchemaElement(lhsSrc);
  if (lhsSchemaKind) {
    return evaluateSchemaEquation(eq, store2, lhsSchemaKind);
  }
  return evaluateConcreteEquation(eq, store2, lhsSrc.id);
}
function evaluateSchemaEquation(eq, store2, schemaKind) {
  const concreteElems = store2.queryElements({ kind: schemaKind, limit: 5e4 });
  if (concreteElems.length === 0) {
    return {
      valid: true,
      involved: [],
      message: `Equation "${eq.name}": no concrete elements of kind "${schemaKind}" found; skipping schema-level check`
    };
  }
  const allInvolved = [];
  const allMessages = [];
  for (const elem of concreteElems) {
    const result = evaluateConcreteEquation(eq, store2, elem.id);
    if (!result.valid) {
      allInvolved.push(...result.involved);
      allMessages.push(`  at "${elem.name}" (${elem.module ?? "unknown"}): ${result.message}`);
    }
  }
  if (allMessages.length === 0) {
    return { valid: true, involved: [], message: "" };
  }
  return {
    valid: false,
    involved: [...new Set(allInvolved)],
    message: `Equation "${eq.name}" violated for kind "${schemaKind}":
${allMessages.join("\n")}`
  };
}
function evaluateConcreteEquation(eq, store2, startId) {
  const lhsSteps = eq.lhs.arrows.map((kind) => ({
    kind,
    direction: "out"
  }));
  const rhsSteps = eq.rhs.arrows.map((kind) => ({
    kind,
    direction: "out"
  }));
  const lhsReached = followPath(store2, startId, lhsSteps);
  const rhsReached = followPath(store2, startId, rhsSteps);
  const lhsIds = new Set(lhsReached.map((e) => e.id));
  const rhsIds = new Set(rhsReached.map((e) => e.id));
  const lhsOnly = [...lhsIds].filter((id) => !rhsIds.has(id));
  const rhsOnly = [...rhsIds].filter((id) => !lhsIds.has(id));
  if (lhsOnly.length === 0 && rhsOnly.length === 0) {
    return { valid: true, involved: [...lhsIds, ...rhsIds], message: "" };
  }
  const involved = [.../* @__PURE__ */ new Set([...lhsIds, ...rhsIds])];
  const lhsNames = lhsReached.filter((e) => !rhsIds.has(e.id)).map((e) => e.name);
  const rhsNames = rhsReached.filter((e) => !lhsIds.has(e.id)).map((e) => e.name);
  let message = "";
  if (lhsNames.length > 0) {
    message += `LHS reaches [${lhsNames.join(", ")}] but RHS does not.`;
  }
  if (rhsNames.length > 0) {
    message += `RHS reaches [${rhsNames.join(", ")}] but LHS does not.`;
  }
  return { valid: false, involved, message };
}
function followPath(store2, startId, steps) {
  if (steps.length === 0) {
    const elem = store2.getElem(startId);
    return elem ? [elem] : [];
  }
  let currentIds = /* @__PURE__ */ new Set([startId]);
  for (const step of steps) {
    if (currentIds.size === 0) return [];
    const nextIds = /* @__PURE__ */ new Set();
    for (const id of currentIds) {
      const arrows = step.direction === "out" ? store2.outgoing(id) : store2.incoming(id);
      for (const arr of arrows) {
        if (arr.kind !== step.kind) continue;
        const reachedId = step.direction === "out" ? arr.dstId : arr.srcId;
        nextIds.add(reachedId);
      }
    }
    currentIds = nextIds;
  }
  const result = [];
  for (const id of currentIds) {
    const elem = store2.getElem(id);
    if (elem) result.push(elem);
  }
  return result;
}
function isNounPhrase(name) {
  const trimmed = name.trim();
  const withoutPrefix = trimmed.replace(/^(a|an|the)\s+/i, "");
  return /^[A-Z]/.test(withoutPrefix);
}
function validateEquation(eq, store2, proposedArrowKinds) {
  const errors = [];
  if (eq.lhs.src !== eq.rhs.src) {
    errors.push(
      `Equation "${eq.name}": lhs source (${eq.lhs.src}) does not match rhs source (${eq.rhs.src})`
    );
  }
  if (eq.lhs.tgt !== eq.rhs.tgt) {
    errors.push(
      `Equation "${eq.name}": lhs target (${eq.lhs.tgt}) does not match rhs target (${eq.rhs.tgt})`
    );
  }
  const proposedSet = new Set(proposedArrowKinds ?? []);
  const allArrowKinds = /* @__PURE__ */ new Set([...eq.lhs.arrows, ...eq.rhs.arrows]);
  for (const kind of allArrowKinds) {
    if (proposedSet.has(kind)) continue;
    if (!store2.hasArrowKind(kind)) {
      errors.push(
        `Equation "${eq.name}": arrow kind "${kind}" does not exist in the database or concurrent proposal`
      );
    }
  }
  return { valid: errors.length === 0, errors };
}
function elemId(module, line, col, kind, name) {
  return `module:${module}:${line}:${col}:${kind}:${name}`;
}
function arrowId(srcId, kind, dstId) {
  return `${srcId}:${kind}:${dstId}`;
}
function fileElemId(relativePath) {
  return `file:${relativePath}`;
}
function formatSpanId(relativePath, startLine, startCol, endLine, endCol) {
  return `${relativePath}:${startLine}:${startCol}-${endLine}:${endCol}`;
}
function parseSpan(span) {
  let m = span.match(/^(.+):(\d+):(\d+)-(\d+):(\d+)$/);
  if (m) {
    return {
      filePath: m[1],
      startLine: parseInt(m[2], 10),
      startCol: parseInt(m[3], 10),
      endLine: parseInt(m[4], 10),
      endCol: parseInt(m[5], 10)
    };
  }
  m = span.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
  if (m) {
    return {
      startLine: parseInt(m[1], 10),
      startCol: parseInt(m[2], 10),
      endLine: parseInt(m[3], 10),
      endCol: parseInt(m[4], 10)
    };
  }
  return null;
}
function filePathFromSpan(span) {
  const parsed = parseSpan(span);
  return parsed?.filePath ?? null;
}
var AdapterRegistry = class {
  adapters = /* @__PURE__ */ new Map();
  extensionMap = /* @__PURE__ */ new Map();
  /** Register a language adapter */
  register(adapter) {
    this.adapters.set(adapter.languageId, adapter);
    for (const ext of adapter.extensions) {
      this.extensionMap.set(ext, adapter);
    }
  }
  /** Look up the adapter for a given filename (by its extension) */
  getForFile(filename) {
    const ext = filename.substring(filename.lastIndexOf("."));
    return this.extensionMap.get(ext) ?? null;
  }
  /** Get all registered file extensions across all adapters */
  allExtensions() {
    return Array.from(this.extensionMap.keys());
  }
  /** Get all glob patterns across all adapters */
  allGlobPatterns() {
    return Array.from(this.adapters.values()).map((a) => a.globPattern);
  }
  /** Check if an adapter is registered for a given language id */
  hasAdapter(languageId) {
    return this.adapters.has(languageId);
  }
};
var defaultRegistry = void 0;
function setDefaultRegistry(registry) {
  defaultRegistry = registry;
}
function getDefaultRegistry() {
  return defaultRegistry;
}
var IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/.olog/**",
  "**/*.d.ts"
];
var ONE_MB = 1024 * 1024;
function ingestProject(projectRoot2, store2, registry) {
  const start2 = Date.now();
  let head;
  try {
    head = execSync("git rev-parse HEAD", { cwd: projectRoot2, encoding: "utf8" }).trim();
  } catch {
    head = "nogit";
  }
  if (head !== "nogit" && store2.isFresh(head)) {
    return {
      filesProcessed: 0,
      elementsCreated: 0,
      arrowsCreated: 0,
      durationMs: Date.now() - start2
    };
  }
  const result = runIngestion(projectRoot2, store2, head, registry);
  return { ...result, durationMs: Date.now() - start2 };
}
function ingestChangedFiles(projectRoot2, store2, registry) {
  const start2 = Date.now();
  const effectiveRegistry = registry ?? getDefaultRegistry();
  if (!effectiveRegistry) throw new Error("No adapter registry available.");
  setDefaultRegistry(effectiveRegistry);
  let head;
  try {
    head = execSync("git rev-parse HEAD", { cwd: projectRoot2, encoding: "utf8" }).trim();
  } catch {
    head = "nogit";
  }
  const gitChanged = /* @__PURE__ */ new Set();
  const storedSha = store2.commitSha();
  try {
    if (storedSha && storedSha !== "nogit" && storedSha !== head) {
      execSync(`git diff --name-only ${storedSha} ${head}`, { cwd: projectRoot2, encoding: "utf8" }).trim().split("\n").filter(Boolean).forEach((f) => gitChanged.add(f));
    }
    execSync("git status --porcelain", { cwd: projectRoot2, encoding: "utf8" }).trim().split("\n").filter(Boolean).forEach((line) => {
      const f = line.slice(3).trim();
      if (f) gitChanged.add(f);
    });
  } catch {
  }
  const ingestedModules = store2.getIngestedModules();
  const allFiles = discoverFiles(projectRoot2, effectiveRegistry);
  const filesToProcess = allFiles.filter((abs) => {
    const rel = relative(projectRoot2, abs);
    return !ingestedModules.has(rel) || gitChanged.has(rel);
  });
  if (filesToProcess.length === 0) {
    return { filesProcessed: 0, elementsCreated: 0, arrowsCreated: 0, durationMs: Date.now() - start2 };
  }
  for (const abs of filesToProcess) {
    const rel = relative(projectRoot2, abs);
    if (ingestedModules.has(rel)) store2.deleteModuleTreeSitterElements(rel);
  }
  const elems = [];
  const arrs = [];
  const pendingCrossFileArrows = [];
  const newNameToIds = /* @__PURE__ */ new Map();
  const createdModuleIds = /* @__PURE__ */ new Set();
  let filesProcessed = 0;
  for (const absolutePath of filesToProcess) {
    const rel = relative(projectRoot2, absolutePath);
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch {
      continue;
    }
    if (stats.size > 1024 * 1024) continue;
    let source;
    try {
      source = readFileSync2(absolutePath, "utf8");
    } catch {
      continue;
    }
    const adapter = effectiveRegistry.getForFile(absolutePath);
    if (!adapter) continue;
    let extracted;
    try {
      extracted = adapter.extractElements(adapter.createParser(absolutePath), source, adapter.queryPath(absolutePath), rel, projectRoot2);
    } catch (err) {
      console.error(`[olog] Failed to extract from ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const fileId = fileElemId(rel);
    elems.push({ id: fileId, kind: "file", name: basename(rel), module: rel, span: null, attrs: "{}" });
    const fileNameToId = /* @__PURE__ */ new Map();
    const seenArrowIds = /* @__PURE__ */ new Set();
    for (const rawElem of extracted.elements) {
      const coords = parseSpan(rawElem.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;
      const fullSpan = coords ? formatSpanId(rel, coords.startLine, coords.startCol, coords.endLine, coords.endCol) : rawElem.span;
      const id = elemId(rel, line, col, rawElem.kind, rawElem.name);
      const fileExisting = fileNameToId.get(rawElem.name) ?? [];
      fileExisting.push(id);
      fileNameToId.set(rawElem.name, fileExisting);
      const globalExisting = newNameToIds.get(rawElem.name) ?? [];
      globalExisting.push(id);
      newNameToIds.set(rawElem.name, globalExisting);
      elems.push({ id, kind: rawElem.kind, name: rawElem.name, module: rel, span: fullSpan, attrs: JSON.stringify(rawElem.attrs) });
    }
    for (const rawArrow of extracted.arrows) {
      if (rawArrow.kind === "importsFrom") {
        const srcId = (fileNameToId.get(rawArrow.srcName) ?? [])[0];
        const rawModule = rawArrow.attrs.module ?? rawArrow.dstModule;
        const resolvedModule = adapter.resolveImportSpecifier ? adapter.resolveImportSpecifier(rawModule, rel, projectRoot2) ?? rawModule : rawModule;
        const moduleId = `module:${resolvedModule}`;
        if (srcId) {
          if (!createdModuleIds.has(moduleId)) {
            createdModuleIds.add(moduleId);
            elems.push({ id: moduleId, kind: "module", name: resolvedModule, module: resolvedModule, span: null, attrs: "{}" });
          }
          const aid = arrowId(srcId, "importsFrom", moduleId);
          if (!seenArrowIds.has(aid)) {
            seenArrowIds.add(aid);
            arrs.push({ id: aid, kind: "importsFrom", src_id: srcId, dst_id: moduleId, attrs: JSON.stringify(rawArrow.attrs) });
          }
        }
      } else {
        const srcId = (fileNameToId.get(rawArrow.srcName) ?? [])[0];
        const dstId = (fileNameToId.get(rawArrow.dstName) ?? [])[0];
        if (srcId && dstId) {
          const aid = arrowId(srcId, rawArrow.kind, dstId);
          if (!seenArrowIds.has(aid)) {
            seenArrowIds.add(aid);
            arrs.push({ id: aid, kind: rawArrow.kind, src_id: srcId, dst_id: dstId, attrs: JSON.stringify(rawArrow.attrs) });
          }
        } else if (srcId && !dstId && rawArrow.dstName) {
          pendingCrossFileArrows.push({ kind: rawArrow.kind, srcId, dstName: rawArrow.dstName, dstModuleSuffix: rawArrow.dstModule ?? "", attrs: JSON.stringify(rawArrow.attrs) });
        }
      }
    }
    filesProcessed++;
  }
  const globalNameToIds = store2.getAllElemNameToIds();
  for (const [name, ids] of newNameToIds) {
    const existing = globalNameToIds.get(name) ?? [];
    for (const id of ids) if (!existing.includes(id)) existing.push(id);
    globalNameToIds.set(name, existing);
  }
  const dbIdToModule = store2.getAllElemIdToModule();
  const newElemIdToModule = /* @__PURE__ */ new Map();
  for (const e of elems) {
    if (e.module !== null && e.module !== void 0) newElemIdToModule.set(e.id, e.module);
  }
  const seenCrossIds = /* @__PURE__ */ new Set();
  for (const pending of pendingCrossFileArrows) {
    const candidates = globalNameToIds.get(pending.dstName) ?? [];
    let dstId;
    if (pending.dstModuleSuffix) {
      const matched = candidates.filter((id) => {
        const mod = newElemIdToModule.get(id) ?? dbIdToModule.get(id);
        return mod?.endsWith(pending.dstModuleSuffix) ?? false;
      });
      if (matched.length === 1) dstId = matched[0];
    } else if (candidates.length === 1) {
      dstId = candidates[0];
    }
    if (dstId && dstId !== pending.srcId) {
      const aid = arrowId(pending.srcId, pending.kind, dstId);
      if (!seenCrossIds.has(aid)) {
        seenCrossIds.add(aid);
        arrs.push({ id: aid, kind: pending.kind, src_id: pending.srcId, dst_id: dstId, attrs: pending.attrs });
      }
    }
  }
  store2.ingestFile(elems, arrs, head);
  return { filesProcessed, elementsCreated: elems.length, arrowsCreated: arrs.length, durationMs: Date.now() - start2 };
}
function reindexProject(projectRoot2, store2, registry) {
  const start2 = Date.now();
  let head;
  try {
    head = execSync("git rev-parse HEAD", { cwd: projectRoot2, encoding: "utf8" }).trim();
  } catch {
    head = "nogit";
  }
  const result = runIngestion(projectRoot2, store2, head, registry);
  return { ...result, durationMs: Date.now() - start2 };
}
function discoverFiles(projectRoot2, registry) {
  const patterns = registry.allGlobPatterns();
  let allFiles = [];
  for (const pattern of patterns) {
    allFiles = allFiles.concat(globSync(pattern, {
      cwd: projectRoot2,
      ignore: IGNORE_PATTERNS,
      absolute: true
    }));
  }
  return [...new Set(allFiles)];
}
function runIngestion(projectRoot2, store2, head, registry) {
  const effectiveRegistry = registry ?? getDefaultRegistry();
  if (!effectiveRegistry) {
    throw new Error("No adapter registry available. Register language adapters or pass a registry.");
  }
  setDefaultRegistry(effectiveRegistry);
  const files = discoverFiles(projectRoot2, effectiveRegistry);
  const elems = [];
  const arrs = [];
  let filesProcessed = 0;
  const createdModuleIds = /* @__PURE__ */ new Set();
  const filesToExtract = [];
  const pendingCrossFileArrows = [];
  const globalNameToIds = /* @__PURE__ */ new Map();
  const moduleToIds = /* @__PURE__ */ new Map();
  for (const absolutePath of files) {
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch (err) {
      console.error(
        `[olog] Failed to stat ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    if (stats.size > ONE_MB) {
      console.error(`[olog] Skipping ${absolutePath}: file size ${stats.size} exceeds 1MB limit`);
      continue;
    }
    let source;
    try {
      source = readFileSync2(absolutePath, "utf8");
    } catch (err) {
      console.error(
        `[olog] Failed to read ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    const relativePath = relative(projectRoot2, absolutePath);
    const adapter = effectiveRegistry.getForFile(absolutePath);
    if (!adapter) {
      console.error(`[olog] Skipping ${absolutePath}: no language adapter for extension`);
      continue;
    }
    const parser = adapter.createParser(absolutePath);
    const queryPath = adapter.queryPath(absolutePath);
    let extracted;
    try {
      extracted = adapter.extractElements(parser, source, queryPath, relativePath, projectRoot2);
    } catch (err) {
      console.error(
        `[olog] Failed to extract from ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    const fileId = fileElemId(relativePath);
    elems.push({
      id: fileId,
      kind: "file",
      name: basename(relativePath),
      module: relativePath,
      span: null,
      attrs: "{}"
    });
    const nameToId = /* @__PURE__ */ new Map();
    const seenArrowIds = /* @__PURE__ */ new Set();
    const elementIds = [];
    for (const rawElem of extracted.elements) {
      const coords = parseSpan(rawElem.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;
      const fullSpan = coords ? formatSpanId(relativePath, coords.startLine, coords.startCol, coords.endLine, coords.endCol) : rawElem.span;
      const id = elemId(relativePath, line, col, rawElem.kind, rawElem.name);
      const existing = nameToId.get(rawElem.name) ?? [];
      existing.push(id);
      nameToId.set(rawElem.name, existing);
      elementIds.push({ id, kind: rawElem.kind });
      const globalExisting = globalNameToIds.get(rawElem.name) ?? [];
      globalExisting.push(id);
      globalNameToIds.set(rawElem.name, globalExisting);
      const modExisting = moduleToIds.get(relativePath) ?? [];
      modExisting.push(id);
      moduleToIds.set(relativePath, modExisting);
      elems.push({
        id,
        kind: rawElem.kind,
        name: rawElem.name,
        module: relativePath,
        span: fullSpan,
        attrs: JSON.stringify(rawElem.attrs)
      });
    }
    const definitionKinds = /* @__PURE__ */ new Set(["function", "class", "interface", "type", "enum", "method"]);
    for (const { id, kind } of elementIds) {
      if (definitionKinds.has(kind)) {
        const aid = arrowId(id, "definedIn", fileId);
        if (!seenArrowIds.has(aid)) {
          seenArrowIds.add(aid);
          arrs.push({ id: aid, kind: "definedIn", src_id: id, dst_id: fileId, attrs: "{}" });
        }
      }
    }
    for (const rawArrow of extracted.arrows) {
      const arrowKindStr = rawArrow.kind;
      if (arrowKindStr === "importsFrom") {
        const srcId = (nameToId.get(rawArrow.srcName) ?? [])[0];
        const rawModule = rawArrow.attrs.module ?? rawArrow.dstModule;
        const resolvedModule = adapter.resolveImportSpecifier ? adapter.resolveImportSpecifier(rawModule, relativePath, projectRoot2) ?? rawModule : rawModule;
        const moduleId = `module:${resolvedModule}`;
        if (srcId) {
          if (!createdModuleIds.has(moduleId)) {
            createdModuleIds.add(moduleId);
            elems.push({
              id: moduleId,
              kind: "module",
              name: resolvedModule,
              module: resolvedModule,
              span: null,
              attrs: "{}"
            });
          }
          const aid = arrowId(srcId, "importsFrom", moduleId);
          if (!seenArrowIds.has(aid)) {
            seenArrowIds.add(aid);
            arrs.push({ id: aid, kind: "importsFrom", src_id: srcId, dst_id: moduleId, attrs: JSON.stringify(rawArrow.attrs) });
          }
        }
      } else {
        const srcId = (nameToId.get(rawArrow.srcName) ?? [])[0];
        const dstId = (nameToId.get(rawArrow.dstName) ?? [])[0];
        if (srcId && dstId) {
          const aid = arrowId(srcId, rawArrow.kind, dstId);
          if (!seenArrowIds.has(aid)) {
            seenArrowIds.add(aid);
            arrs.push({
              id: aid,
              kind: rawArrow.kind,
              src_id: srcId,
              dst_id: dstId,
              attrs: JSON.stringify(rawArrow.attrs)
            });
          }
        } else if (srcId && !dstId && rawArrow.dstName) {
          pendingCrossFileArrows.push({
            kind: rawArrow.kind,
            srcId,
            dstName: rawArrow.dstName,
            dstModuleSuffix: rawArrow.dstModule ?? "",
            attrs: JSON.stringify(rawArrow.attrs)
          });
        }
      }
    }
    for (const rawElem of extracted.elements) {
      if (rawElem.kind === "import") {
        const coords = parseSpan(rawElem.span);
        const line = coords?.startLine ?? 1;
        const col = coords?.startCol ?? 1;
        const id = elemId(relativePath, line, col, rawElem.kind, rawElem.name);
        const sourceModule = rawElem.attrs.sourceModule;
        if (sourceModule) {
          const resolvedSourceModule = adapter.resolveImportSpecifier ? adapter.resolveImportSpecifier(sourceModule, relativePath, projectRoot2) ?? sourceModule : sourceModule;
          const moduleId = `module:${resolvedSourceModule}`;
          if (!createdModuleIds.has(moduleId)) {
            createdModuleIds.add(moduleId);
            elems.push({
              id: moduleId,
              kind: "module",
              name: resolvedSourceModule,
              module: resolvedSourceModule,
              span: null,
              attrs: "{}"
            });
          }
          const ifAid = arrowId(id, "importsFrom", moduleId);
          if (!seenArrowIds.has(ifAid)) {
            seenArrowIds.add(ifAid);
            arrs.push({ id: ifAid, kind: "importsFrom", src_id: id, dst_id: moduleId, attrs: JSON.stringify({ module: resolvedSourceModule }) });
          }
        }
      }
    }
    const hasStructuredTypes = extracted.elements.some(
      (e) => e.kind === "interface" || e.kind === "type" || e.kind === "class"
    );
    if (hasStructuredTypes) {
      filesToExtract.push({ relativePath, source, adapter, nameToId });
    }
    filesProcessed++;
  }
  const globalNameToId = /* @__PURE__ */ new Map();
  for (const e of elems) {
    if (!globalNameToId.has(e.name)) {
      globalNameToId.set(e.name, e.id);
    }
  }
  const seenPropArrowIds = /* @__PURE__ */ new Set();
  for (const { relativePath, source, adapter: fileAdapter, nameToId: fileNameToId } of filesToExtract) {
    if (!fileAdapter.extractProperties) continue;
    let properties;
    try {
      const parser = fileAdapter.createParser(relativePath);
      properties = fileAdapter.extractProperties(parser, source, relativePath);
    } catch (err) {
      console.error(
        `[olog] Failed to extract properties from ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    for (const prop of properties) {
      const parentIds = fileNameToId.get(prop.parentName);
      const parentId = parentIds?.[0];
      if (!parentId) continue;
      const coords = parseSpan(prop.span);
      const line = coords?.startLine ?? 1;
      const col = coords?.startCol ?? 1;
      const propId = elemId(relativePath, line, col, "property", `${prop.parentName}.${prop.name}`);
      const fullSpan = coords ? formatSpanId(relativePath, coords.startLine, coords.startCol, coords.endLine, coords.endCol) : prop.span;
      elems.push({
        id: propId,
        kind: "property",
        name: `${prop.parentName}.${prop.name}`,
        module: relativePath,
        span: fullSpan,
        attrs: JSON.stringify({ typeText: prop.typeText, optional: prop.optional, readonly: prop.readonly })
      });
      const hpId = arrowId(parentId, "hasProperty", propId);
      if (!seenPropArrowIds.has(hpId)) {
        seenPropArrowIds.add(hpId);
        arrs.push({ id: hpId, kind: "hasProperty", src_id: parentId, dst_id: propId, attrs: "{}" });
      }
      const moId = arrowId(propId, "memberOf", parentId);
      if (!seenPropArrowIds.has(moId)) {
        seenPropArrowIds.add(moId);
        arrs.push({ id: moId, kind: "memberOf", src_id: propId, dst_id: parentId, attrs: "{}" });
      }
      for (const typeRef of prop.typeRefs) {
        const typeId = (fileNameToId.get(typeRef) ?? [])[0] ?? globalNameToId.get(typeRef);
        if (typeId && typeId !== propId) {
          const htId = arrowId(propId, "hasType", typeId);
          if (!seenPropArrowIds.has(htId)) {
            seenPropArrowIds.add(htId);
            arrs.push({ id: htId, kind: "hasType", src_id: propId, dst_id: typeId, attrs: "{}" });
          }
        }
      }
    }
  }
  const elemIdToModule = /* @__PURE__ */ new Map();
  for (const e of elems) {
    if (e.module !== null && e.module !== void 0) elemIdToModule.set(e.id, e.module);
  }
  const seenCrossFileArrowIds = /* @__PURE__ */ new Set();
  for (const pending of pendingCrossFileArrows) {
    const candidates = globalNameToIds.get(pending.dstName) ?? [];
    let dstId;
    if (pending.dstModuleSuffix) {
      const suffix = pending.dstModuleSuffix;
      const matched = candidates.filter((id) => elemIdToModule.get(id)?.endsWith(suffix) ?? false);
      if (matched.length === 1) dstId = matched[0];
    } else if (candidates.length === 1) {
      dstId = candidates[0];
    }
    if (dstId && dstId !== pending.srcId) {
      const aid = arrowId(pending.srcId, pending.kind, dstId);
      if (!seenCrossFileArrowIds.has(aid)) {
        seenCrossFileArrowIds.add(aid);
        arrs.push({ id: aid, kind: pending.kind, src_id: pending.srcId, dst_id: dstId, attrs: pending.attrs });
      }
    }
  }
  store2.ingestFull(elems, arrs, head);
  return {
    filesProcessed,
    elementsCreated: elems.length,
    arrowsCreated: arrs.length
  };
}
function offsetAt(source, line, col) {
  let currentLine = 1;
  let offset = 0;
  while (currentLine < line && offset < source.length) {
    const nl = source.indexOf("\n", offset);
    if (nl < 0) return source.length;
    offset = nl + 1;
    currentLine++;
  }
  return Math.min(offset + col - 1, source.length);
}
function applyEditsToString(source, edits) {
  const sorted = [...edits].sort((a, b) => {
    if (a.startLine !== b.startLine) return b.startLine - a.startLine;
    return b.startCol - a.startCol;
  });
  let result = source;
  for (const edit of sorted) {
    const startOffset = offsetAt(result, edit.startLine, edit.startCol);
    const endOffset = offsetAt(result, edit.endLine, edit.endCol);
    if (startOffset > endOffset) {
      throw new Error(`Invalid edit range in ${edit.filePath}: start > end`);
    }
    if (edit.oldText !== null) {
      const actual = result.slice(startOffset, endOffset);
      if (actual !== edit.oldText) {
        throw new Error(
          `oldText mismatch at ${edit.filePath}:${edit.startLine}:${edit.startCol}: expected "${edit.oldText}", found "${actual}"`
        );
      }
    }
    result = result.slice(0, startOffset) + edit.newText + result.slice(endOffset);
  }
  return result;
}
async function applySourceEdits(edits, projectRoot2, readFile, writeFile) {
  const { readFile: fsReadFile, writeFile: fsWriteFile } = await import("fs/promises");
  const { join: join42 } = await import("path");
  const readFn = readFile ?? (async (p) => fsReadFile(join42(projectRoot2, p), "utf8"));
  const writeFn = writeFile ?? (async (p, c) => fsWriteFile(join42(projectRoot2, p), c, "utf8"));
  let applied = 0;
  let skipped = 0;
  const errors = [];
  const snapshots = [];
  const affectedFiles = /* @__PURE__ */ new Set();
  const byFile = /* @__PURE__ */ new Map();
  for (const edit of edits) {
    const arr = byFile.get(edit.filePath) ?? [];
    arr.push(edit);
    byFile.set(edit.filePath, arr);
  }
  for (const [filePath, fileEdits] of byFile) {
    try {
      let content;
      try {
        content = await readFn(filePath);
      } catch {
        if (fileEdits.some((e) => e.oldText !== null)) {
          skipped += fileEdits.length;
          errors.push(`File not found: ${filePath}`);
          continue;
        }
        content = "";
      }
      snapshots.push({ filePath, originalContent: content });
      try {
        const newContent = applyEditsToString(content, fileEdits);
        await writeFn(filePath, newContent);
        applied += fileEdits.length;
        affectedFiles.add(filePath);
      } catch (editErr) {
        const msg = editErr instanceof Error ? editErr.message : String(editErr);
        skipped += fileEdits.length;
        errors.push(`${filePath}: ${msg}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped += fileEdits.length;
      errors.push(`${filePath}: ${msg}`);
    }
  }
  return { applied, skipped, errors, snapshots, affectedFiles: Array.from(affectedFiles) };
}
async function rollback(snapshots, projectRoot2) {
  const { writeFile: fsWriteFile } = await import("fs/promises");
  const { join: join42 } = await import("path");
  for (const snapshot of snapshots) {
    try {
      await fsWriteFile(join42(projectRoot2, snapshot.filePath), snapshot.originalContent, "utf8");
    } catch {
    }
  }
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function computeRenameEdits(store2, elementId, newName, readFile) {
  let edits = [];
  const warnings = [];
  const elem = store2.getElem(elementId);
  if (!elem) {
    warnings.push(`Element not found: ${elementId}`);
    return { edits, warnings };
  }
  if (elem.span) {
    const parsedSpan = parseSpan(elem.span);
    if (parsedSpan) {
      edits.push({
        filePath: elem.module ?? "",
        label: `rename declaration: ${elem.name} \u2192 ${newName}`,
        oldText: elem.name,
        newText: newName,
        startLine: parsedSpan.startLine,
        startCol: parsedSpan.startCol,
        endLine: parsedSpan.endLine,
        endCol: parsedSpan.endCol
      });
    }
  }
  const importElements = findImportReferences(store2, elem);
  for (const importElem of importElements) {
    if (importElem.span) {
      const parsedSpan = parseSpan(importElem.span);
      if (parsedSpan) {
        edits.push({
          filePath: importElem.module ?? "",
          label: `rename import: ${elem.name} \u2192 ${newName} in ${importElem.module}`,
          oldText: elem.name,
          newText: newName,
          startLine: parsedSpan.startLine,
          startCol: parsedSpan.startCol,
          endLine: parsedSpan.endLine,
          endCol: parsedSpan.endCol
        });
      }
    }
  }
  const callSites = findCallReferences(store2, elem, elementId);
  for (const callElem of callSites) {
    if (callElem.span) {
      const parsedSpan = parseSpan(callElem.span);
      if (parsedSpan) {
        edits.push({
          filePath: callElem.module ?? "",
          label: `rename reference: ${elem.name} \u2192 ${newName} in ${callElem.module}`,
          oldText: elem.name,
          newText: newName,
          startLine: parsedSpan.startLine,
          startCol: parsedSpan.startCol,
          endLine: parsedSpan.endLine,
          endCol: parsedSpan.endCol
        });
      }
    }
  }
  const seen = /* @__PURE__ */ new Set();
  edits = edits.filter((e) => {
    const key = `${e.filePath}:${e.startLine}:${e.startCol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { edits, warnings };
}
function findImportReferences(store2, elem) {
  const results = [];
  const candidates = store2.queryElements({ nameRegex: `^${escapeRegex(elem.name)}$`, kind: "import", limit: 500 });
  for (const candidate of candidates) {
    if (candidate.id === elem.id) continue;
    if (candidate.module === elem.module) continue;
    results.push(candidate);
  }
  return [...new Map(results.map((e) => [e.id, e])).values()];
}
function findCallReferences(store2, elem, elementId) {
  const results = [];
  const incoming = store2.incoming(elementId);
  for (const arr of incoming) {
    if (arr.kind === "callerOf" || arr.kind === "calleeOf") {
      const caller = store2.getElem(arr.srcId);
      if (caller) results.push(caller);
    }
  }
  const outgoing = store2.outgoing(elementId);
  for (const arr of outgoing) {
    if (arr.kind === "callerOf") {
      const callee = store2.getElem(arr.dstId);
      if (callee) results.push(callee);
    }
  }
  return [...new Map(results.map((e) => [e.id, e])).values()];
}
function findEnclosingDeclaration(source, filePath, identifierLine, identifierCol, kind, registry) {
  const adapter = registry.getForFile(filePath);
  if (!adapter) return null;
  const parser = adapter.createParser(filePath);
  const targetTypes = adapter.kindToNodeTypes[kind] ?? [];
  const tree = parser.parse(source);
  const targetRow = identifierLine - 1;
  const targetCol = identifierCol - 1;
  let node = tree.rootNode.descendantForPosition(
    { row: targetRow, column: targetCol },
    { row: targetRow, column: targetCol + 1 }
  );
  while (node && !targetTypes.includes(node.type)) {
    node = node.parent;
  }
  if (!node) {
    tree.delete?.();
    return null;
  }
  const range = {
    startLine: node.startPosition.row + 1,
    startCol: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endCol: node.endPosition.column + 1,
    text: node.text
  };
  tree.delete?.();
  return range;
}
function findImportStatement(source, startLine) {
  const lines = source.split("\n");
  if (startLine < 1 || startLine > lines.length) return null;
  let beginLine = startLine - 1;
  let endLine = beginLine;
  let braceDepth = 0;
  let foundFrom = false;
  for (let i = beginLine; i < lines.length; i++) {
    const line = lines[i];
    braceDepth += (line.match(/\{/g) || []).length;
    braceDepth -= (line.match(/\}/g) || []).length;
    if (line.includes(" from ")) foundFrom = true;
    if (foundFrom && braceDepth <= 0 && line.includes(";")) {
      endLine = i;
      break;
    }
    if (foundFrom && braceDepth <= 0 && i > beginLine) {
      endLine = i;
      break;
    }
    endLine = i;
  }
  const text = lines.slice(beginLine, endLine + 1).join("\n");
  const startCol = lines[beginLine].search(/\S/) + 1;
  return {
    startLine: beginLine + 1,
    startCol: startCol || 1,
    endLine: endLine + 1,
    endCol: lines[endLine].length + 1,
    text
  };
}
var IMPORT_REGEX = /^import\s+(type\s+)?/;
function parseImports(source) {
  const lines = source.split("\n");
  const imports = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(IMPORT_REGEX);
    if (!match) {
      i++;
      continue;
    }
    const isType = match[1] !== void 0;
    let fullText = line;
    let endLine = i + 1;
    if (!line.includes(" from ")) {
      while (endLine < lines.length && !lines[endLine].includes(" from ")) {
        endLine++;
      }
      if (endLine < lines.length) {
        endLine++;
        fullText = lines.slice(i, endLine).join("\n");
      }
    }
    const importInfo = parseSingleImport(fullText, i + 1);
    if (importInfo) {
      importInfo.isType = isType;
      if (endLine > i + 1) {
        importInfo.endLine = endLine;
        importInfo.endCol = lines[endLine - 1].length + 1;
      }
      imports.push(importInfo);
    }
    i = endLine;
  }
  return imports;
}
function parseSingleImport(text, lineNum) {
  const trimmed = text.trim();
  const namespaceMatch = trimmed.match(/^import\s+(type\s+)?\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
  if (namespaceMatch) {
    const aliasName = namespaceMatch[2];
    return {
      kind: "namespace",
      names: [{ original: aliasName, alias: aliasName }],
      sourcePath: namespaceMatch[3],
      isType: false,
      startLine: lineNum,
      startCol: 1,
      endLine: lineNum,
      endCol: trimmed.length + 1,
      fullText: text
    };
  }
  const namedMatch = trimmed.match(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/);
  if (namedMatch) {
    const namesStr = namedMatch[2];
    const sourcePath = namedMatch[3];
    const names = namesStr.split(",").map((s) => {
      const part = s.trim();
      const asMatch = part.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        return { original: asMatch[1], alias: asMatch[2] };
      }
      return part ? { original: part, alias: part } : null;
    }).filter((n) => n !== null);
    return {
      kind: "named",
      names,
      sourcePath,
      isType: false,
      startLine: lineNum,
      startCol: 1,
      endLine: lineNum,
      endCol: trimmed.length + 1,
      fullText: text
    };
  }
  const defaultMatch = trimmed.match(/^import\s+(type\s+)?(\w+)\s+from\s+['"]([^'"]+)['"]/);
  if (defaultMatch && !trimmed.includes("{")) {
    return {
      kind: "default",
      names: [{ original: defaultMatch[2], alias: defaultMatch[2] }],
      sourcePath: defaultMatch[3],
      isType: false,
      startLine: lineNum,
      startCol: 1,
      endLine: lineNum,
      endCol: trimmed.length + 1,
      fullText: text
    };
  }
  const sideEffectMatch = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
  if (sideEffectMatch) {
    return {
      kind: "side-effect",
      names: [],
      sourcePath: sideEffectMatch[1],
      isType: false,
      startLine: lineNum,
      startCol: 1,
      endLine: lineNum,
      endCol: trimmed.length + 1,
      fullText: text
    };
  }
  return null;
}
function findImportInsertionPoint(source) {
  const lines = source.split("\n");
  let lastImportLine = -1;
  let firstCodeLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("//") || line === "") continue;
    if (IMPORT_REGEX.test(line)) {
      lastImportLine = i;
    } else if (firstCodeLine === -1 && !line.startsWith("//")) {
      firstCodeLine = i;
    }
  }
  if (lastImportLine >= 0) {
    return lastImportLine + 1;
  }
  if (firstCodeLine >= 0) {
    return firstCodeLine;
  }
  return lines.length;
}
function formatNamedImport(names, sourcePath, isType) {
  const typePrefix = isType ? "type " : "";
  const nameParts = names.map((n) => n.alias !== n.original ? `${n.original} as ${n.alias}` : n.original);
  return `import ${typePrefix}{ ${nameParts.join(", ")} } from '${sourcePath}'`;
}
function computeRemoveSymbolEdits(store2, elementId, readFile) {
  const edits = [];
  const warnings = [];
  const elem = store2.getElem(elementId);
  if (!elem) {
    warnings.push(`Element not found: ${elementId}`);
    return { edits, warnings };
  }
  if (elem.span && elem.kind !== "import") {
    const parsedSpan = parseSpan(elem.span);
    if (parsedSpan) {
      edits.push({
        filePath: elem.module ?? "",
        label: `remove declaration: ${elem.name}`,
        oldText: null,
        // Will be filled during localize
        newText: "",
        startLine: parsedSpan.startLine,
        startCol: 1,
        endLine: parsedSpan.endLine,
        endCol: parsedSpan.endCol
      });
    }
  }
  if (elem.kind === "import") {
    const source = readFile(elem.module ?? "");
    if (source && elem.span) {
      const parsedSpan = parseSpan(elem.span);
      if (parsedSpan) {
        const importRange = findImportStatement(source, parsedSpan.startLine);
        if (importRange) {
          edits.push({
            filePath: elem.module ?? "",
            label: `remove import: ${elem.name}`,
            oldText: importRange.text,
            newText: "",
            startLine: importRange.startLine,
            startCol: importRange.startCol,
            endLine: importRange.endLine,
            endCol: importRange.endCol
          });
        }
      }
    }
  }
  const incoming = store2.incoming(elementId);
  const callers = incoming.filter((a) => a.kind === "callerOf" || a.kind === "calleeOf").map((a) => {
    const otherId = a.srcId === elementId ? a.dstId : a.srcId;
    return store2.getElem(otherId);
  }).filter((e) => e !== null);
  for (const caller of callers) {
    warnings.push(
      `Call site in ${caller.module ?? "unknown"} will break: element "${caller.name}" references "${elem.name}"`
    );
  }
  return { edits, warnings };
}
function computeRelativeImportPath(fromFile, toModule) {
  const fromDir = dirname2(fromFile);
  let rel = relative2(fromDir, toModule);
  if (!rel.startsWith(".")) {
    rel = "./" + rel;
  }
  return rel.replace(/\\/g, "/");
}
function filePathToModule(filePath) {
  return filePath.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "");
}
function moduleToFilePath(moduleId) {
  if (/\.\w+$/.test(moduleId)) return moduleId;
  return moduleId + ".ts";
}
var STUB_TEMPLATES = {
  function: (name) => `export function ${name}() {
  throw new Error('Not implemented');
}
`,
  method: (name) => `${name}() {
  throw new Error('Not implemented');
}
`,
  class: (name) => `export class ${name} {
  throw new Error('Not implemented');
}
`,
  interface: (name) => `export interface ${name} {}
`,
  type: (name) => `export type ${name} = never;
`,
  enum: (name) => `export enum ${name} {}
`,
  const: (name) => `export const ${name} = undefined;
`,
  var: (name) => `export var ${name}: any;
`
};
var CLJ_STUB_TEMPLATES = {
  function: (name) => `(defn ${name}
  []
  ;; TODO: implement
  )
`,
  method: (name) => `(defn ${name}
  [this]
  ;; TODO: implement
  )
`,
  class: (name) => `(defrecord ${name} []
  ;; TODO: add protocol implementations
  )
`,
  interface: (name) => `(defprotocol ${name}
  ;; TODO: define methods
  )
`,
  type: (name) => `(defrecord ${name} [])
`,
  const: (name) => `(def ${name} nil)
`,
  var: (name) => `(def ^:dynamic *${name}* nil)
`
};
function isClojureFile(path) {
  return /\.(clj|cljs|cljc)$/.test(path);
}
function computeAddSymbolEdits(store2, module, name, symbolKind, readFile) {
  const edits = [];
  const warnings = [];
  const clojure = isClojureFile(module);
  const templates = clojure ? CLJ_STUB_TEMPLATES : STUB_TEMPLATES;
  const templateFn = templates[symbolKind];
  if (!templateFn) {
    warnings.push(`Unknown symbol kind: ${symbolKind}. No stub template available.`);
    return { edits, warnings };
  }
  const stubText = templateFn(name);
  const source = readFile(module);
  if (source === null) {
    edits.push({
      filePath: module,
      label: `create file and add symbol: ${name}`,
      oldText: null,
      newText: stubText,
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 1
    });
  } else {
    let insertLine;
    if (clojure) {
      const lines = source.split("\n");
      let lastNonEmpty = lines.length - 1;
      while (lastNonEmpty > 0 && lines[lastNonEmpty].trim() === "") lastNonEmpty--;
      insertLine = lastNonEmpty + 1;
    } else {
      insertLine = findImportInsertionPoint(source);
    }
    edits.push({
      filePath: module,
      label: `add symbol: ${symbolKind} ${name}`,
      oldText: null,
      newText: "\n" + stubText,
      startLine: insertLine + 1,
      startCol: 1,
      endLine: insertLine + 1,
      endCol: 1
    });
  }
  return { edits, warnings };
}
function computeMoveEdits(store2, elementId, newModule, readFile) {
  const edits = [];
  const warnings = [];
  const elem = store2.getElem(elementId);
  if (!elem) {
    warnings.push(`Element not found: ${elementId}`);
    return { edits, warnings };
  }
  if (!elem.span || !elem.module) {
    warnings.push(`Element ${elementId} has no span or module`);
    return { edits, warnings };
  }
  const sourceModule = elem.module;
  const sourceContent = readFile(sourceModule);
  if (!sourceContent) {
    warnings.push(`Cannot read source file: ${sourceModule}`);
    return { edits, warnings };
  }
  const parsedSpan = parseSpan(elem.span);
  if (!parsedSpan) {
    warnings.push(`Cannot parse span: ${elem.span}`);
    return { edits, warnings };
  }
  const registry = getDefaultRegistry();
  if (!registry) {
    warnings.push(`No language adapter registry available for ${sourceModule}`);
    return { edits, warnings };
  }
  const declarationRange = findEnclosingDeclaration(
    sourceContent,
    sourceModule,
    parsedSpan.startLine,
    parsedSpan.startCol,
    elem.kind,
    registry
  );
  if (!declarationRange) {
    warnings.push(`Cannot find enclosing declaration for ${elem.name} in ${sourceModule}`);
    return { edits, warnings };
  }
  let declarationText = declarationRange.text;
  const oldModulePath = filePathToModule(sourceModule);
  const newModulePath = filePathToModule(newModule);
  const declImports = parseImports(declarationText);
  for (const imp of declImports) {
    if (imp.sourcePath.startsWith(".")) {
      const oldPath = imp.sourcePath;
      const targetModule = filePathToModule(imp.sourcePath.replace(/^\.\//, ""));
      const newPath = computeRelativeImportPath(newModule, imp.sourcePath);
      warnings.push(`Move may require updating import path: "${oldPath}" in moved declaration`);
    }
  }
  edits.push({
    filePath: sourceModule,
    label: `remove declaration: ${elem.name} from ${sourceModule}`,
    oldText: declarationText,
    newText: "",
    startLine: declarationRange.startLine,
    startCol: declarationRange.startCol,
    endLine: declarationRange.endLine,
    endCol: declarationRange.endCol
  });
  const targetContent = readFile(newModule);
  if (targetContent) {
    const insertLine = findImportInsertionPoint(targetContent);
    edits.push({
      filePath: newModule,
      label: `add declaration: ${elem.name} to ${newModule}`,
      oldText: null,
      newText: "\n" + declarationText + "\n",
      startLine: insertLine + 1,
      startCol: 1,
      endLine: insertLine + 1,
      endCol: 1
    });
    const targetImports = parseImports(targetContent);
    const importPath = computeRelativeImportPath(newModule, oldModulePath);
    const alreadyImports = targetImports.some((imp) => imp.sourcePath === importPath);
    if (!alreadyImports && declarationRange.text.includes("import ")) {
    }
  } else {
    edits.push({
      filePath: newModule,
      label: `create file and add declaration: ${elem.name}`,
      oldText: null,
      newText: declarationText + "\n",
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 1
    });
  }
  const importElements = store2.queryElements({
    nameRegex: `^${elem.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    kind: "import",
    limit: 500
  });
  for (const imp of importElements) {
    if (imp.module === sourceModule || imp.module === newModule) continue;
    const impContent = readFile(imp.module ?? "");
    if (!impContent) continue;
    const fileImports = parseImports(impContent);
    for (const fileImp of fileImports) {
      if (fileImp.sourcePath.endsWith(filePathToModule(sourceModule).replace(/^\.\//, "")) || fileImp.sourcePath === computeRelativeImportPath(imp.module ?? "", filePathToModule(sourceModule))) {
        const newImportPath = computeRelativeImportPath(imp.module ?? "", filePathToModule(newModule));
        const newImportText = formatNamedImport(fileImp.names, newImportPath, fileImp.isType);
        edits.push({
          filePath: imp.module ?? "",
          label: `update import path: ${fileImp.sourcePath} \u2192 ${newImportPath}`,
          oldText: fileImp.fullText.trim(),
          newText: newImportText,
          startLine: fileImp.startLine,
          startCol: fileImp.startCol,
          endLine: fileImp.endLine,
          endCol: fileImp.endCol
        });
      }
    }
  }
  return { edits, warnings };
}
function computeAddReexportEdits(store2, module, name, fromModule, readFile) {
  const edits = [];
  const warnings = [];
  const relativePath = computeRelativeImportPath(module, fromModule);
  const reexportLine = `export { ${name} } from '${relativePath}';`;
  const source = readFile(module);
  if (source === null) {
    edits.push({
      filePath: module,
      label: `create barrel file with re-export: ${name}`,
      oldText: null,
      newText: reexportLine + "\n",
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 1
    });
  } else {
    const lines = source.split("\n");
    let lastNonEmpty = lines.length - 1;
    while (lastNonEmpty > 0 && lines[lastNonEmpty].trim() === "") lastNonEmpty--;
    const insertLine = lastNonEmpty;
    edits.push({
      filePath: module,
      label: `add re-export: ${name}`,
      oldText: null,
      newText: "\n" + reexportLine,
      startLine: insertLine + 1,
      startCol: 1,
      endLine: insertLine + 1,
      endCol: 1
    });
  }
  return { edits, warnings };
}
function computeAmendTypeEdits(store2, target, field, action, value, readFile) {
  const edits = [];
  const warnings = [];
  const elem = store2.getElem(target);
  if (!elem) {
    warnings.push(`Element not found: ${target}`);
    return { edits, warnings };
  }
  if (!elem.span) {
    warnings.push(`Element has no span: ${target}`);
    return { edits, warnings };
  }
  const parsedSpan = parseSpan(elem.span);
  if (!parsedSpan) {
    warnings.push(`Failed to parse span: ${elem.span}`);
    return { edits, warnings };
  }
  const source = readFile(elem.module ?? "");
  if (source === null) {
    warnings.push(`Could not read file: ${elem.module}`);
    return { edits, warnings };
  }
  const lines = source.split("\n");
  if (action === "addUnionMember") {
    const typeLine = lines[parsedSpan.startLine - 1] ?? "";
    const endLineContent = lines[parsedSpan.endLine - 1] ?? "";
    const semicolonMatch = endLineContent.lastIndexOf(";", parsedSpan.endCol - 1);
    const equalsMatch = endLineContent.lastIndexOf("=", parsedSpan.endCol - 1);
    const insertPos = Math.max(semicolonMatch, equalsMatch);
    if (insertPos < 0) {
      warnings.push(`Could not find union termination for: ${target}`);
      return { edits, warnings };
    }
    const isStringLiteral = value.startsWith("'") || value.startsWith('"');
    const unionMember = isStringLiteral ? `| ${value}` : `| ${value}`;
    edits.push({
      filePath: elem.module ?? "",
      label: `add union member: ${value} to ${elem.name}`,
      oldText: endLineContent.slice(insertPos, insertPos + 1),
      newText: `${unionMember};`,
      startLine: parsedSpan.endLine,
      startCol: insertPos + 1,
      endLine: parsedSpan.endLine,
      endCol: insertPos + 2
    });
  } else if (action === "addProperty") {
    const endLineContent = lines[parsedSpan.endLine - 1] ?? "";
    const closingBracePos = endLineContent.lastIndexOf("}", parsedSpan.endCol - 1);
    if (closingBracePos < 0) {
      warnings.push(`Could not find interface closing brace for: ${target}`);
      return { edits, warnings };
    }
    const lineContent = lines[parsedSpan.startLine - 1] ?? "";
    const indentMatch = lineContent.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : "  ";
    const newProperty = `
${indent}${field}: unknown;`;
    edits.push({
      filePath: elem.module ?? "",
      label: `add property: ${field} to ${elem.name}`,
      oldText: "}",
      newText: newProperty + "\n}",
      startLine: parsedSpan.endLine,
      startCol: closingBracePos + 1,
      endLine: parsedSpan.endLine,
      endCol: closingBracePos + 2
    });
  }
  return { edits, warnings };
}
function expandOperation(store2, operation, readFile) {
  switch (operation.kind) {
    case "rename":
      return computeRenameEdits(store2, operation.target, operation.newName, readFile);
    case "move":
      return computeMoveEdits(store2, operation.target, operation.newModule, readFile);
    case "addSymbol":
      return computeAddSymbolEdits(store2, operation.module, operation.name, operation.symbolKind, readFile);
    case "removeSymbol":
      return computeRemoveSymbolEdits(store2, operation.target, readFile);
    case "addArrow": {
      return { edits: [], warnings: [`addArrow: ${operation.arrowKind} arrows do not currently affect source files`] };
    }
    case "removeArrow": {
      return { edits: [], warnings: [`removeArrow: arrow removal does not currently affect source files`] };
    }
    case "rewrite_body":
      return { edits: [], warnings: [] };
    case "addReexport":
      return computeAddReexportEdits(store2, operation.module, operation.name, operation.fromModule, readFile);
    case "amendType":
      return computeAmendTypeEdits(store2, operation.target, operation.field, operation.action, operation.value, readFile);
    default:
      return { edits: [], warnings: [`Unknown operation kind: ${operation.kind}`] };
  }
}
function expandAllOperations(store2, operations, readFile) {
  const allEdits = [];
  const allWarnings = [];
  const rewriteBodyModules = /* @__PURE__ */ new Set();
  for (const op of operations) {
    if (op.kind === "rewrite_body") {
      const module = store2.getElem(op.target)?.module;
      if (module) rewriteBodyModules.add(module);
    }
  }
  for (const op of operations) {
    if (op.kind === "addSymbol" && rewriteBodyModules.has(op.module)) {
      allWarnings.push(`addSymbol: skipping stub for "${op.name}" in "${op.module}" \u2014 rewrite_body targets same file`);
      continue;
    }
    const result = expandOperation(store2, op, readFile);
    allEdits.push(...result.edits);
    allWarnings.push(...result.warnings);
  }
  return { edits: allEdits, warnings: allWarnings };
}
function orderAndDetectConflicts(edits) {
  const conflicts = [];
  const byFile = /* @__PURE__ */ new Map();
  for (const edit of edits) {
    const arr = byFile.get(edit.filePath) ?? [];
    arr.push(edit);
    byFile.set(edit.filePath, arr);
  }
  for (const [, fileEdits] of byFile) {
    for (let i = 0; i < fileEdits.length; i++) {
      for (let j = i + 1; j < fileEdits.length; j++) {
        const a = fileEdits[i];
        const b = fileEdits[j];
        if (rangesOverlap(a, b)) {
          conflicts.push({
            edit1: a,
            edit2: b,
            message: `Overlapping edits at ${a.filePath}:${a.startLine}:${a.startCol} and ${b.filePath}:${b.startLine}:${b.startCol}`
          });
        }
      }
    }
  }
  const ordered = [...edits].sort((a, b) => {
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    if (a.startLine !== b.startLine) return b.startLine - a.startLine;
    return b.startCol - a.startCol;
  });
  return { ordered, conflicts };
}
function rangesOverlap(a, b) {
  if (a.filePath !== b.filePath) return false;
  const aStart = a.startLine * 1e4 + a.startCol;
  const aEnd = a.endLine * 1e4 + a.endCol;
  const bStart = b.startLine * 1e4 + b.startCol;
  const bEnd = b.endLine * 1e4 + b.endCol;
  return aStart < bEnd && bStart < aEnd;
}
function renderPlan(store2, operations, projectRoot2) {
  const readFile = (filePath) => {
    try {
      return readFileSync4(join2(projectRoot2, filePath), "utf8");
    } catch {
      return null;
    }
  };
  const { edits, warnings } = expandAllOperations(store2, operations, readFile);
  const { ordered, conflicts } = orderAndDetectConflicts(edits);
  const conflictEditIds = /* @__PURE__ */ new Set();
  for (const conflict of conflicts) {
    conflictEditIds.add(`${conflict.edit1.filePath}:${conflict.edit1.startLine}:${conflict.edit1.startCol}`);
    conflictEditIds.add(`${conflict.edit2.filePath}:${conflict.edit2.startLine}:${conflict.edit2.startCol}`);
  }
  const safeEdits = conflicts.length > 0 ? ordered.filter((e) => !conflictEditIds.has(`${e.filePath}:${e.startLine}:${e.startCol}`)) : ordered;
  const affectedFiles = [...new Set(safeEdits.map((e) => e.filePath))];
  return {
    edits: safeEdits,
    warnings,
    conflicts,
    affectedFiles
  };
}
function queryRelatedElements(store2, targetId, options) {
  const { direction, arrowKind, dedup = false } = options;
  const results = [];
  const seen = dedup ? /* @__PURE__ */ new Set() : null;
  const processArrows = (arrows, resolveSide) => {
    for (const arrow of arrows) {
      const elemId2 = resolveSide === "srcId" ? arrow.srcId : arrow.dstId;
      if (dedup && seen.has(elemId2)) continue;
      if (dedup) seen.add(elemId2);
      const elem = store2.getElem(elemId2);
      if (elem) {
        results.push({
          id: elem.id,
          name: elem.name,
          kind: elem.kind,
          module: elem.module,
          span: elem.span,
          attrs: elem.attrs
        });
      }
    }
  };
  if (direction === "outgoing" || direction === "both") {
    const arrows = store2.outgoing(targetId).filter((a) => a.kind === arrowKind);
    processArrows(arrows, "dstId");
  }
  if (direction === "incoming" || direction === "both") {
    const arrows = store2.incoming(targetId).filter((a) => a.kind === arrowKind);
    processArrows(arrows, "srcId");
  }
  return results;
}
function gatherMustCall(store2, targetId) {
  return queryRelatedElements(store2, targetId, { direction: "outgoing", arrowKind: "callerOf" }).map((elem) => ({
    id: elem.id,
    name: elem.name,
    kind: elem.kind,
    module: elem.module,
    span: elem.span,
    attrs: elem.attrs ?? {}
  }));
}
function gatherMustImplement(store2, targetId) {
  return queryRelatedElements(store2, targetId, { direction: "both", arrowKind: "implements" }).map((elem) => ({
    id: elem.id,
    name: elem.name,
    kind: elem.kind,
    module: elem.module,
    span: elem.span
  }));
}
function gatherUsedBy(store2, targetId) {
  return queryRelatedElements(store2, targetId, { direction: "incoming", arrowKind: "callerOf", dedup: true }).map((elem) => ({
    id: elem.id,
    name: elem.name,
    kind: elem.kind,
    module: elem.module,
    span: elem.span
  }));
}
function gatherImports(store2, targetModule) {
  const imports = [];
  const moduleElems = store2.queryElements({
    kind: "import",
    moduleRegex: `^${escapeRegex(targetModule)}$`,
    limit: 200
  });
  for (const imp of moduleElems) {
    const outgoing = store2.outgoing(imp.id);
    const importsFromArrow = outgoing.find((a) => a.kind === "importsFrom");
    imports.push({
      name: imp.name,
      sourceModule: importsFromArrow ? importsFromArrow.attrs?.sourceModule ?? null : null,
      targetModule: imp.module,
      ...imp.attrs && imp.attrs.rawRequire ? { rawText: imp.attrs.rawRequire } : {}
    });
  }
  return imports;
}
function getModuleElement(store2, modulePath) {
  const results = store2.queryElements({
    kind: "module",
    nameRegex: `^${escapeRegex(modulePath)}$`,
    limit: 1
  });
  return results[0] ?? null;
}
function getModuleFilePath(store2, modulePath) {
  const modElem = getModuleElement(store2, modulePath);
  if (!modElem) return null;
  return modulePath;
}
function gatherDomainContext(store2, targetId) {
  const ownConcepts = [];
  for (const arrow of store2.incoming(targetId)) {
    if (arrow.kind !== "implementedAs") continue;
    const domainElem = store2.getElem(arrow.srcId);
    if (!domainElem || domainElem.kind !== "domain") continue;
    const domainArrows = [];
    for (const a of store2.outgoing(domainElem.id)) {
      if (a.kind === "implementedAs") continue;
      const peer = store2.getElem(a.dstId);
      if (peer) domainArrows.push({ name: a.kind, direction: "outgoing", peerName: peer.name });
    }
    for (const a of store2.incoming(domainElem.id)) {
      if (a.kind === "implementedAs") continue;
      const peer = store2.getElem(a.srcId);
      if (peer && peer.kind === "domain") domainArrows.push({ name: a.kind, direction: "incoming", peerName: peer.name });
    }
    ownConcepts.push({ id: domainElem.id, name: domainElem.name, arrows: domainArrows });
  }
  const neighborConcepts = [];
  const seen = /* @__PURE__ */ new Set();
  const addNeighbor = (codeElemId, codeElemName, via) => {
    for (const a of store2.incoming(codeElemId)) {
      if (a.kind !== "implementedAs") continue;
      const domainElem = store2.getElem(a.srcId);
      if (!domainElem || domainElem.kind !== "domain") continue;
      const key = `${via}:${domainElem.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        neighborConcepts.push({ name: domainElem.name, via, codeElementName: codeElemName });
      }
    }
  };
  for (const a of store2.incoming(targetId)) {
    if (a.kind !== "callerOf") continue;
    const caller = store2.getElem(a.srcId);
    if (caller) addNeighbor(caller.id, caller.name, "caller");
  }
  for (const a of store2.outgoing(targetId)) {
    if (a.kind !== "callerOf") continue;
    const callee = store2.getElem(a.dstId);
    if (callee) addNeighbor(callee.id, callee.name, "callee");
  }
  if (ownConcepts.length === 0 && neighborConcepts.length === 0) return null;
  return { ownConcepts, neighborConcepts };
}
var SourceResolver = class {
  constructor(projectRoot2) {
    this.projectRoot = projectRoot2;
  }
  projectRoot;
  fileCache = /* @__PURE__ */ new Map();
  readSpan(filePath, span) {
    const parsed = parseSpan(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    const lines = source.split("\n");
    const start2 = Math.max(0, parsed.startLine - 1);
    const end = Math.min(lines.length, parsed.endLine);
    return lines.slice(start2, end).join("\n");
  }
  readContext(filePath, span, contextLines = 2) {
    const parsed = parseSpan(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    const lines = source.split("\n");
    const start2 = Math.max(0, parsed.startLine - 1 - contextLines);
    const end = Math.min(lines.length, parsed.endLine + contextLines);
    return lines.slice(start2, end).join("\n");
  }
  readDeclaration(filePath, span, kind) {
    const parsed = parseSpan(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    if (kind === "import") {
      const range2 = findImportStatement(source, parsed.startLine);
      return range2?.text ?? null;
    }
    const registry = getDefaultRegistry();
    if (!registry) return null;
    const range = findEnclosingDeclaration(
      source,
      filePath,
      parsed.startLine,
      parsed.startCol,
      kind,
      registry
    );
    return range?.text ?? null;
  }
  readSignature(filePath, span, kind) {
    const declaration = this.readDeclaration(filePath, span, kind);
    if (!declaration) return null;
    const firstBrace = declaration.indexOf("{");
    const firstSemicolon = declaration.indexOf(";");
    if (firstBrace >= 0 && (firstSemicolon < 0 || firstBrace < firstSemicolon)) {
      return declaration.slice(0, firstBrace).trim();
    }
    if (firstSemicolon >= 0) {
      return declaration.slice(0, firstSemicolon + 1).trim();
    }
    const firstNewline = declaration.indexOf("\n");
    if (firstNewline >= 0) {
      return declaration.slice(0, firstNewline).trim();
    }
    return declaration.trim();
  }
  readBody(filePath, span, kind, maxLines = 50) {
    const declaration = this.readDeclaration(filePath, span, kind);
    if (!declaration) return null;
    const firstBrace = declaration.indexOf("{");
    if (firstBrace < 0) return null;
    const body = declaration.slice(firstBrace);
    const lines = body.split("\n");
    if (lines.length <= maxLines) return body;
    return lines.slice(0, maxLines).join("\n") + "\n  // ... (truncated)";
  }
  readImportBlock(filePath) {
    const source = this.readFile(filePath);
    if (source === null) return [];
    const imports = parseImports(source);
    return imports.map((imp) => imp.fullText.trim());
  }
  computeImportStatement(symbolName, symbolModule, targetModule) {
    const fromFile = moduleToFilePath(targetModule);
    const relativePath = computeRelativeImportPath(fromFile, symbolModule);
    return `import { ${symbolName} } from '${relativePath}'`;
  }
  readFileContent(filePath, maxLines = 500) {
    const content = this.readFile(filePath);
    if (content === null) return null;
    const lines = content.split("\n");
    if (lines.length <= maxLines) return content;
    return lines.slice(0, maxLines).join("\n") + "\n// ... (truncated)";
  }
  /**
   * Read a window of source focused on a span: contextBefore lines above the
   * start of the span and contextAfter lines below the end, with an omission
   * comment if the file has content before the window.
   */
  readFocused(filePath, span, contextBefore = 25, contextAfter = 10) {
    const parsed = parseSpan(span);
    if (!parsed) return null;
    const source = this.readFile(filePath);
    if (source === null) return null;
    const lines = source.split("\n");
    const start2 = Math.max(0, parsed.startLine - 1 - contextBefore);
    const end = Math.min(lines.length, parsed.endLine + contextAfter);
    const prefix = start2 > 0 ? `; ... (lines 1\u2013${start2} omitted)
` : "";
    return prefix + lines.slice(start2, end).join("\n");
  }
  readFile(filePath) {
    const cached = this.fileCache.get(filePath);
    if (cached !== void 0) return cached;
    try {
      const content = readFileSync5(join3(this.projectRoot, filePath), "utf8");
      this.fileCache.set(filePath, content);
      return content;
    } catch {
      this.fileCache.set(filePath, null);
      return null;
    }
  }
};
function findAnalogues(store2, target, limit = 3, workingSetIds) {
  const targetCallees = getCalleeSet(store2, target);
  const candidates = store2.queryElements({
    kind: target.kind,
    limit: 200
  });
  const scored = [];
  for (const candidate of candidates) {
    if (candidate.id === target.id) continue;
    if (candidate.module === target.module) continue;
    const candidateCallees = getCalleeSet(store2, candidate);
    const intersectionSize = countIntersection(targetCallees, candidateCallees);
    const unionSize = targetCallees.size + candidateCallees.size - intersectionSize;
    const calleeSimilarity = unionSize === 0 ? 0 : intersectionSize / unionSize;
    const nameSimilarity = candidate.name === target.name ? 0.5 : 0;
    const WS_RELEVANCE_BONUS = 0.3;
    const wsBonus = workingSetIds?.has(candidate.id) ? WS_RELEVANCE_BONUS : 0;
    const similarity = Math.min(1, Math.max(calleeSimilarity, nameSimilarity) + wsBonus);
    if (similarity > 0) {
      scored.push({
        id: candidate.id,
        name: candidate.name,
        kind: candidate.kind,
        module: candidate.module,
        span: candidate.span,
        similarity
      });
    }
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}
function getCalleeSet(store2, elem) {
  const result = /* @__PURE__ */ new Set();
  const outgoing = store2.outgoing(elem.id);
  for (const arrow of outgoing) {
    if (arrow.kind === "callerOf" || arrow.kind === "calls") {
      result.add(arrow.dstId);
    }
  }
  return result;
}
function countIntersection(a, b) {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count++;
  }
  return count;
}
var TASK_CRITERIA = {
  write_function_body: [
    "Must compile without type errors.",
    "Must call every function listed in mustCall.",
    "Must return a value matching the signature.",
    "Must not change the function signature or exports.",
    "Must follow the coding patterns in the provided analogues."
  ],
  write_test: [
    "Must compile.",
    "Must import the target function.",
    "Must have at least one test case for each mustCall function.",
    "Must follow the test framework patterns in the analogues.",
    "Must be in a .test.ts or .spec.ts file."
  ],
  write_migration: [
    "Must compile.",
    "Must be idempotent (safe to run twice).",
    "Must use the project's database client (see analogues).",
    "Must include both up and down migrations if the framework requires it."
  ],
  rewrite_body: [
    "Must compile.",
    "Must preserve the existing signature and exports.",
    "Must call every function in mustCall.",
    "Must not introduce new dependencies not listed in the acceptance criteria.",
    "Must be strictly better than the current body per the criteria."
  ],
  write_documentation: [
    "Must be valid JSDoc/TSDoc.",
    "Must document all parameters.",
    "Must include @returns with type.",
    "Must include at least one @example if any analogue has examples.",
    "Must describe thrown errors."
  ]
};
function assembleBrief(store2, projectRoot2, task, targetId, opts = {}) {
  const { overrides, maxAnalogues = 3, snippetLines = 50, extraCriteria, rationale, setId } = opts;
  const target = store2.getElem(targetId);
  if (!target) {
    return { ok: false, error: `Element not found: ${targetId}` };
  }
  const targetModule = target.module;
  if (!targetModule) {
    return { ok: false, error: `Element has no module: ${targetId}` };
  }
  const resolver = new SourceResolver(projectRoot2);
  const filePath = getModuleFilePath(store2, targetModule) ?? localModuleToFilePath(targetModule);
  const targetSignature = resolver.readSignature(filePath, target.span ?? "", target.kind) ?? target.name;
  const targetDeclaration = resolver.readDeclaration(filePath, target.span ?? "", target.kind) ?? "";
  const bodyPlaceholder = extractBodyPlaceholder(targetDeclaration);
  const parsedSpan = target.span ? parseSpanSimple(target.span) : null;
  const mustCallEntries = overrides?.mustCall ? resolveElementList(store2, overrides.mustCall) : gatherMustCall(store2, targetId);
  const mustImplementEntries = overrides?.mustImplement ? resolveElementList(store2, overrides.mustImplement) : gatherMustImplement(store2, targetId);
  const usedByEntries = gatherUsedBy(store2, targetId);
  const importEntries = gatherImports(store2, targetModule);
  const shouldSkipAnalogues = overrides?.skipAnalogues === true || maxAnalogues === 0;
  const workingSetIds = setId ? store2.getWorkingSetElementIds(setId) : void 0;
  const analogueCandidates = shouldSkipAnalogues ? [] : overrides?.analogues ? resolveAnalogueList(store2, overrides.analogues) : findAnalogues(store2, target, maxAnalogues, workingSetIds);
  const resolvedMustCall = mustCallEntries.map((entry) => {
    const entryFilePath = getModuleFilePath(store2, entry.module ?? "") ?? localModuleToFilePath(entry.module ?? "");
    const calleeCallees = getDirectCallees(store2, entry.id).slice(0, 5).flatMap((tc) => {
      const tcFilePath = getModuleFilePath(store2, tc.module ?? "") ?? localModuleToFilePath(tc.module ?? "");
      const snippet = resolver.readBody(tcFilePath, tc.span ?? "", tc.kind, Math.ceil(snippetLines / 2)) ?? "";
      if (!snippet) return [];
      return [{ name: tc.name, module: tc.module ?? "", snippet }];
    });
    return {
      name: entry.name,
      signature: resolver.readSignature(entryFilePath, entry.span ?? "", entry.kind) ?? entry.name,
      importStatement: resolver.computeImportStatement(entry.name, entry.module ?? "", targetModule),
      calleeBodySnippet: resolver.readBody(entryFilePath, entry.span ?? "", entry.kind, snippetLines) ?? "",
      calleeCallees
    };
  });
  const resolvedMustImplement = mustImplementEntries.map((entry) => {
    const entryFilePath = getModuleFilePath(store2, entry.module ?? "") ?? localModuleToFilePath(entry.module ?? "");
    return {
      name: entry.name,
      fullDeclaration: resolver.readDeclaration(entryFilePath, entry.span ?? "", entry.kind) ?? entry.name,
      importStatement: resolver.computeImportStatement(entry.name, entry.module ?? "", targetModule)
    };
  });
  const resolvedUsedBy = usedByEntries.slice(0, overrides?.signatureChange ? 3 : void 0).map((entry) => {
    const entryFilePath = getModuleFilePath(store2, entry.module ?? "") ?? localModuleToFilePath(entry.module ?? "");
    if (overrides?.signatureChange) {
      return {
        name: entry.name,
        fullDeclaration: resolver.readDeclaration(entryFilePath, entry.span ?? "", entry.kind) ?? ""
      };
    }
    const callSiteSnippet = entry.span ? resolver.readSpan(entryFilePath, entry.span) ?? "" : "";
    return { name: entry.name, callSiteSnippet };
  });
  const resolvedImports = importEntries.map((imp) => {
    if (imp.rawText) return imp.rawText;
    if (imp.sourceModule) return `import { ${imp.name} } from '${imp.sourceModule}'`;
    return `import { ${imp.name} } from '...'`;
  });
  const importedModuleSuffixes = new Set(
    importEntries.map((imp) => imp.sourceModule).filter((m) => !!m)
  );
  const missingImports = mustCallEntries.filter((entry) => {
    if (!entry.module || entry.module === targetModule) return false;
    return ![...importedModuleSuffixes].some(
      (im) => im === entry.module || entry.module.endsWith(im) || im.endsWith(entry.module.split("/").pop() ?? "")
    );
  }).map((entry) => {
    const entryFilePath = getModuleFilePath(store2, entry.module ?? "") ?? localModuleToFilePath(entry.module ?? "");
    return {
      name: entry.name,
      module: entry.module ?? "",
      suggestedImport: resolver.computeImportStatement(entry.name, entry.module ?? "", targetModule)
    };
  });
  const resolvedAnalogues = analogueCandidates.map((candidate) => {
    const candidateFilePath = getModuleFilePath(store2, candidate.module ?? "") ?? localModuleToFilePath(candidate.module ?? "");
    const analogueCallees = getCalleeNames(store2, candidate.id);
    return {
      name: candidate.name,
      similarity: candidate.similarity,
      fullSource: resolver.readDeclaration(candidateFilePath, candidate.span ?? "", candidate.kind) ?? "",
      callees: analogueCallees,
      modulePath: candidate.module ?? ""
    };
  });
  const targetSpan = overrides?.lineRange ? `${overrides.lineRange.start}:0-${overrides.lineRange.end}:0` : target.span ?? "";
  const targetFileContent = targetSpan ? resolver.readFocused(filePath, targetSpan, 30, 15) ?? resolver.readFileContent(filePath, 500) ?? "" : resolver.readFileContent(filePath, 500) ?? "";
  const domainContext = gatherDomainContext(store2, targetId);
  const defaultCriteria = TASK_CRITERIA[task] ?? [];
  const acceptanceCriteria = [...defaultCriteria, ...extraCriteria ?? []];
  const commitSha = store2.commitSha();
  const provenanceConfidence = determineConfidence(store2, targetId);
  if (setId) {
    const elemIds = [
      targetId,
      ...mustCallEntries.map((e) => e.id),
      ...mustImplementEntries.map((e) => e.id),
      ...analogueCandidates.map((a) => a.id)
    ];
    store2.addToWorkingSet(setId, elemIds, []);
    for (const mc of mustCallEntries) {
      store2.assertSyntheticArrow(setId, targetId, mc.id, "shouldCall", "orchestrate", `Required by ${task} brief`);
    }
    for (const mi of mustImplementEntries) {
      store2.assertSyntheticArrow(setId, targetId, mi.id, "shouldImplement", "orchestrate");
    }
    for (const a of analogueCandidates) {
      store2.assertSyntheticArrow(setId, targetId, a.id, "analogueOf", "orchestrate", `similarity=${a.similarity.toFixed(2)}`);
    }
  }
  return {
    task,
    ...rationale !== void 0 ? { rationale } : {},
    ...setId !== void 0 ? { setId } : {},
    target: {
      id: target.id,
      name: target.name,
      kind: target.kind,
      module: targetModule,
      signature: targetSignature,
      bodyPlaceholder,
      filePath,
      lineRange: overrides?.lineRange ?? parsedSpan ?? { start: 1, end: 1 }
    },
    mustCall: resolvedMustCall,
    mustImplement: resolvedMustImplement,
    usedBy: resolvedUsedBy,
    importsInTargetFile: resolvedImports.length > 0 ? resolvedImports : resolver.readImportBlock(filePath),
    analogues: resolvedAnalogues,
    targetFileContent,
    domainContext,
    missingImports,
    acceptanceCriteria,
    provenance: {
      ologCommitSha: commitSha,
      confidence: provenanceConfidence,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  };
}
function extractBodyPlaceholder(declaration) {
  const firstBrace = declaration.indexOf("{");
  if (firstBrace < 0) return "";
  const lastBrace = declaration.lastIndexOf("}");
  if (lastBrace < 0) return declaration.slice(firstBrace);
  return declaration.slice(firstBrace, lastBrace + 1);
}
function resolveElementList(store2, ids) {
  const results = [];
  for (const id of ids) {
    const elem = store2.getElem(id);
    if (elem) {
      results.push({
        id: elem.id,
        name: elem.name,
        kind: elem.kind,
        module: elem.module,
        span: elem.span,
        attrs: elem.attrs
      });
    }
  }
  return results;
}
function resolveAnalogueList(store2, ids) {
  const results = [];
  for (const id of ids) {
    const elem = store2.getElem(id);
    if (elem) {
      results.push({
        id: elem.id,
        name: elem.name,
        kind: elem.kind,
        module: elem.module,
        span: elem.span,
        similarity: 1
        // manually overridden, max similarity
      });
    }
  }
  return results;
}
function getDirectCallees(store2, elemId2) {
  const seen = /* @__PURE__ */ new Set();
  const results = [];
  for (const arrow of store2.outgoing(elemId2)) {
    if (arrow.kind === "callerOf") {
      const callee = store2.getElem(arrow.dstId);
      if (callee && !seen.has(callee.id)) {
        seen.add(callee.id);
        results.push({ id: callee.id, name: callee.name, kind: callee.kind, module: callee.module, span: callee.span });
      }
    }
  }
  return results;
}
function getCalleeNames(store2, elemId2) {
  const names = [];
  const incoming = store2.incoming(elemId2);
  const callerOfArrows = incoming.filter((a) => a.kind === "callerOf");
  for (const arrow of callerOfArrows) {
    const csOutgoing = store2.outgoing(arrow.srcId);
    const calleeOfArrow = csOutgoing.find((a) => a.kind === "calleeOf");
    if (calleeOfArrow) {
      const callee = store2.getElem(calleeOfArrow.dstId);
      if (callee) names.push(callee.name);
    }
  }
  return names;
}
function determineConfidence(store2, targetId) {
  const prov = store2.getProvenance(targetId);
  if (!prov) return "unresolved";
  if (prov.confidence === "resolved") return "resolved";
  return "mixed";
}
function localModuleToFilePath(modulePath) {
  if (/\.\w+$/.test(modulePath)) return modulePath;
  return modulePath + ".ts";
}
function parseSpanSimple(span) {
  const parsed = parseSpan(span);
  if (!parsed) return null;
  return { start: parsed.startLine, end: parsed.endLine };
}

// src/index.ts
init_detect();

// src/tools/olog-query.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawnSync } from "child_process";
import { relative as relative3 } from "path";
function registerOlogQuery(server2, store2, projectRoot2) {
  const startByIdSchema = z.object({
    id: z.string().describe("Element ID to start from")
  });
  const startByFilterSchema = z.object({
    kind: z.enum(ELEM_KINDS).optional().describe("Element kind to filter by. Omit to match all kinds."),
    name: z.string().optional().describe(
      "Regex pattern matched against element name. Examples: '^handle', 'User', 'Button$'"
    ),
    module: z.string().optional().describe(
      "Regex pattern matched against module (relative file path). Examples: 'src/components', 'utils/'"
    )
  });
  server2.registerTool(
    "olog_query",
    {
      description: 'Query the ontology log for structural elements matching filters, or traverse the graph via multi-hop arrow following. Returns elements with their kind, name, module (file path), and span (location). Traversal returns both reached elements and the arrows traversed. Use the literal parameter to find all functions/definitions whose source contains a specific keyword, string, or symbol (e.g. ":task.type/bond-verification") \u2014 this performs a grep-backed search and returns the enclosing elements.',
      inputSchema: z.object({
        start: z.union([startByIdSchema, startByFilterSchema]).optional().describe(
          "Start element specification: either an exact element ID, or a filter (kind/name/module) to find starting element(s). When omitted, falls back to the top-level kind/name/module parameters."
        ),
        kind: z.enum([...ELEM_KINDS, "any"]).default("any").describe("Element kind to filter by. Use 'any' to match all kinds."),
        name: z.string().optional().describe(
          "Regex pattern matched against element name. Examples: '^handle', 'User', 'Button$'"
        ),
        module: z.string().optional().describe(
          "Regex pattern matched against module (relative file path). Examples: 'src/components', 'utils/'"
        ),
        arrows: z.array(z.enum(ARROW_KINDS)).optional().describe(
          "Ordered array of arrow kinds to traverse multi-hop. When provided, the tool performs graph traversal instead of a simple filter query."
        ),
        direction: z.enum(["out", "in"]).default("out").describe(
          'Direction for all arrow hops in a traversal. "out" follows natural direction (src -> dst); "in" reverses it (dst -> src).'
        ),
        minConfidence: z.enum(["resolved", "unresolved", "tentative"]).optional().describe(
          "Minimum provenance confidence level. For filter queries, requires an exact match. For traversals, filters arrows by exact confidence match."
        ),
        literal: z.string().optional().describe(
          'Fixed string to search for in source files (grep-backed). Returns elements whose source span contains the literal. Use for keyword/data literals not captured as structural arrows, e.g. ":task.type/bond-verification".'
        ),
        limit: z.number().int().min(1).max(500).default(50).describe("Maximum number of results to return")
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (args) => {
      try {
        if (args.literal) {
          const grep = spawnSync("grep", ["-rnF", "--", args.literal, "."], {
            cwd: projectRoot2,
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024
          });
          if (grep.error) {
            return { content: [{ type: "text", text: `grep error: ${grep.error.message}` }], isError: true };
          }
          const grepLines = (grep.stdout ?? "").split("\n").filter(Boolean);
          const fileLineHits = /* @__PURE__ */ new Map();
          for (const line of grepLines) {
            const m = line.match(/^(.+?):(\d+):/);
            if (!m) continue;
            const rel = relative3(projectRoot2, m[1].startsWith("/") ? m[1] : `${projectRoot2}/${m[1]}`);
            const lineNum = parseInt(m[2], 10);
            const set = fileLineHits.get(rel) ?? /* @__PURE__ */ new Set();
            set.add(lineNum);
            fileLineHits.set(rel, set);
          }
          const matched = [];
          const seen = /* @__PURE__ */ new Set();
          for (const [relPath, hitLines] of fileLineHits) {
            const elemsInFile = store2.queryElements({ moduleRegex: relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), limit: 2e3 });
            for (const elem of elemsInFile) {
              if (!elem.span || seen.has(elem.id)) continue;
              const sm = elem.span.match(/(\d+):\d+-(\d+):\d+$/);
              if (!sm) continue;
              const startLine = parseInt(sm[1], 10);
              const endLine = parseInt(sm[2], 10);
              for (const hit of hitLines) {
                if (hit >= startLine && hit <= endLine) {
                  seen.add(elem.id);
                  matched.push(elem);
                  break;
                }
              }
            }
          }
          return {
            content: [{ type: "text", text: JSON.stringify(matched.slice(0, args.limit), null, 2) }]
          };
        }
        if (args.arrows && args.arrows.length > 0) {
          let startIds;
          if (args.start && "id" in args.start) {
            startIds = [args.start.id];
          } else {
            const filter2 = args.start && "kind" in args.start ? args.start : { kind: args.kind, name: args.name, module: args.module };
            const queryOpts = { limit: args.limit };
            if (filter2.kind && filter2.kind !== "any") {
              queryOpts.kind = filter2.kind;
            }
            if (filter2.name !== void 0) {
              queryOpts.nameRegex = filter2.name;
            }
            if (filter2.module !== void 0) {
              queryOpts.moduleRegex = filter2.module;
            }
            const elems = store2.queryElements(queryOpts);
            if (elems.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: "No elements found matching start criteria"
                  }
                ]
              };
            }
            startIds = elems.map((e) => e.id);
          }
          const steps = args.arrows.map((kind) => ({
            kind,
            direction: args.direction
          }));
          const allElements = /* @__PURE__ */ new Map();
          const allArrows = /* @__PURE__ */ new Map();
          for (const startId of startIds) {
            const traverseOpts = {
              startId,
              steps
            };
            if (args.minConfidence) {
              traverseOpts.minConfidence = args.minConfidence;
            }
            const result = store2.traverse(traverseOpts);
            for (const elem of result.elements) {
              allElements.set(elem.id, elem);
            }
            for (const arr of result.arrows) {
              allArrows.set(arr.id, arr);
            }
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    elements: Array.from(allElements.values()),
                    arrows: Array.from(allArrows.values())
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        if (args.start && "id" in args.start) {
          const elem = store2.getElem(args.start.id);
          if (!elem) {
            return {
              content: [
                {
                  type: "text",
                  text: "Element not found"
                }
              ]
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(elem, null, 2)
              }
            ]
          };
        }
        const filter = args.start && "kind" in args.start ? args.start : { kind: args.kind, name: args.name, module: args.module };
        const opts = { limit: args.limit };
        if (filter.kind && filter.kind !== "any") {
          opts.kind = filter.kind;
        }
        if (filter.name !== void 0) {
          opts.nameRegex = filter.name;
        }
        if (filter.module !== void 0) {
          opts.moduleRegex = filter.module;
        }
        let rows;
        if (args.minConfidence) {
          rows = store2.queryElementsWithConfidence({
            ...opts,
            minConfidence: args.minConfidence
          });
        } else {
          rows = store2.queryElements(opts);
        }
        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No elements found matching criteria"
              }
            ]
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(rows, null, 2)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-inspect.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z2 } from "zod";
function registerOlogInspect(server2, store2, projectRoot2) {
  server2.registerTool(
    "olog_inspect",
    {
      description: "Get detailed information about a specific element by ID, including all its outgoing and incoming arrows (connections to other elements) and the source snippet of its body read directly from the file at its stored span. Use this instead of reading raw source files to understand what a function does.",
      inputSchema: z2.object({
        id: z2.string().describe("Element ID to inspect. Get IDs from olog_query results.")
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ id }) => {
      try {
        const element = store2.getElem(id);
        if (!element) {
          return {
            content: [
              {
                type: "text",
                text: `Element not found: ${id}`
              }
            ],
            isError: true
          };
        }
        const outgoing = [...store2.outgoing(id), ...store2.outgoingDerived(id)];
        const incoming = store2.incoming(id);
        const prov = store2.getProvenance(id);
        const provenance = prov ? [prov] : [];
        const equations = store2.getEquationsForObject(id);
        const allConstraints = store2.getConstraints();
        const elemKind = element.kind;
        const elemModule = element.module ?? "";
        const constraints = allConstraints.filter((c) => {
          if (!c.config || Object.keys(c.config).length === 0) return true;
          const configStr = JSON.stringify(c.config);
          return configStr.includes(elemKind) || configStr.includes(elemModule);
        });
        let sourceSnippet = null;
        if (element.span) {
          const filePath = filePathFromSpan(element.span) ?? element.module ?? "";
          if (filePath) {
            const resolver = new SourceResolver(projectRoot2);
            sourceSnippet = resolver.readFocused(filePath, element.span, 0, 0) ?? resolver.readSpan(filePath, element.span);
          }
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { element, sourceSnippet, outgoing, incoming, provenance, equations, constraints },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-overview.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z3 } from "zod";
function registerOlogOverview(server2, store2) {
  server2.registerTool(
    "olog_overview",
    {
      description: "Get a summary overview of the ontology log: element counts by kind, arrow counts by kind, and total counts. Useful for understanding what the olog knows about the codebase.",
      inputSchema: z3.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async () => {
      try {
        const counts = store2.dumpCounts();
        const commitSha = store2.commitSha();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ commitSha, ...counts }, null, 2)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-reindex.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z4 } from "zod";
function registerOlogReindex(server2, store2, projectRoot2) {
  server2.registerTool(
    "olog_reindex",
    {
      description: 'Refresh the structural model after code changes. mode="incremental" (default) processes only new and git-changed files \u2014 fast for routine use after editing. mode="full" drops and rebuilds everything from scratch \u2014 use when the olog seems stale or after large refactors.',
      inputSchema: z4.object({
        mode: z4.enum(["incremental", "full"]).default("incremental").describe(
          '"incremental" processes only new/changed files (fast). "full" wipes and rebuilds the entire index (slow but guaranteed fresh).'
        )
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false
      }
    },
    async ({ mode }) => {
      try {
        const registry = getDefaultRegistry();
        const result = mode === "full" ? reindexProject(projectRoot2, store2, registry) : ingestChangedFiles(projectRoot2, store2, registry);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ mode, ...result }, null, 2)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack ?? "" : "";
        return {
          content: [
            { type: "text", text: `Reindex failed: ${message}
${stack}` }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-apply.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z5 } from "zod";

// src/tools/olog-plan-store.ts
import { mkdirSync, readFileSync as readFileSync3, writeFileSync } from "fs";
import { join as join4 } from "path";
var planStore = /* @__PURE__ */ new Map();
function persistPlan(hash, plan, projectRoot2) {
  planStore.set(hash, plan);
  const dir = join4(projectRoot2, ".olog", "plans");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join4(dir, `${hash}.json`), JSON.stringify(plan, null, 2));
}
function loadPlan(hash, projectRoot2) {
  const cached = planStore.get(hash);
  if (cached) return cached;
  const filePath = join4(projectRoot2, ".olog", "plans", `${hash}.json`);
  try {
    const content = readFileSync3(filePath, "utf-8");
    const plan = JSON.parse(content);
    planStore.set(hash, plan);
    return plan;
  } catch {
    return void 0;
  }
}

// src/tools/olog-apply.ts
var planOperationSchema = z5.union([
  z5.object({ kind: z5.literal("rename"), target: z5.string(), newName: z5.string() }),
  z5.object({ kind: z5.literal("move"), target: z5.string(), newModule: z5.string() }),
  z5.object({ kind: z5.literal("addSymbol"), module: z5.string(), name: z5.string(), symbolKind: z5.string() }),
  z5.object({ kind: z5.literal("removeSymbol"), target: z5.string() }),
  z5.object({ kind: z5.literal("addArrow"), arrowKind: z5.string(), src: z5.string(), dst: z5.string() }),
  z5.object({ kind: z5.literal("removeArrow"), arrowId: z5.string() }),
  z5.object({ kind: z5.literal("addReexport"), module: z5.string(), name: z5.string(), fromModule: z5.string() }),
  z5.object({ kind: z5.literal("amendType"), target: z5.string(), field: z5.string(), action: z5.enum(["addUnionMember", "addProperty"]), value: z5.string() }),
  z5.object({ kind: z5.literal("rewrite_body"), target: z5.string(), rationale: z5.string() })
]);
var planSchema = z5.object({
  operations: z5.array(planOperationSchema),
  hash: z5.string(),
  rationale: z5.string()
});
function registerOlogApply(server2, store2, projectRoot2) {
  server2.registerTool(
    "olog_apply",
    {
      description: "Apply a validated plan to the olog graph. When render=true, also renders source-file edits and re-ingests. The plan must have been created by olog_plan and the hash must match. Supports rename, move, addSymbol, removeSymbol, addArrow, removeArrow, addReexport, amendType, and rewrite_body operations.",
      inputSchema: z5.object({
        plan: planSchema.describe("The plan object to apply, including its hash."),
        planHash: z5.string().describe("The expected hash of the plan. Must match plan.hash."),
        render: z5.boolean().default(false).describe("When true, also render source-file edits and apply them to disk, then re-ingest.")
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false
      }
    },
    async ({ plan, planHash, render }) => {
      try {
        if (!projectRoot2) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, reason: "projectRoot is required to load plans" }, null, 2)
              }
            ]
          };
        }
        const storedPlan = loadPlan(planHash, projectRoot2);
        if (!storedPlan) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, reason: "Plan not found" }, null, 2)
              }
            ]
          };
        }
        if (planHash !== plan.hash) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, reason: "Hash mismatch" }, null, 2)
              }
            ]
          };
        }
        const allOps = plan.operations;
        const mechanicalOps = allOps.filter((op) => op.kind !== "rewrite_body");
        const rewriteBodyOps = allOps.filter((op) => op.kind === "rewrite_body");
        const pendingDelegations = rewriteBodyOps.map((op) => ({
          target: op.target,
          task: "rewrite_body",
          rationale: op.rationale
        }));
        const result = store2.applyPlan(allOps);
        if (!render || !projectRoot2) {
          if (result.errors.length > 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ ok: false, reason: result.errors.join("; ") }, null, 2)
                }
              ]
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: true,
                    summary: `Applied ${result.applied} operations, skipped ${result.skipped}`,
                    changes: result.changes
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        const renderResult = renderPlan(store2, mechanicalOps, projectRoot2);
        if (renderResult.edits.length > 0) {
          const applyResult = await applySourceEdits(renderResult.edits, projectRoot2);
          if (applyResult.errors.length > 0) {
            await rollback(applyResult.snapshots, projectRoot2);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: false,
                      reason: "Source edit errors, rolled back",
                      dbResult: result,
                      editErrors: applyResult.errors,
                      renderWarnings: renderResult.warnings
                    },
                    null,
                    2
                  )
                }
              ]
            };
          }
          try {
            reindexProject(projectRoot2, store2, getDefaultRegistry());
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: true,
                      reindexed: true,
                      note: "Element IDs may have shifted due to re-ingestion. Re-query elements before subsequent operations.",
                      summary: `Applied ${result.applied} DB operations and ${applyResult.applied} source edits`,
                      dbChanges: result.changes,
                      sourceEdits: renderResult.edits.map((e) => ({
                        file: e.filePath,
                        label: e.label,
                        oldText: e.oldText,
                        newText: e.newText
                      })),
                      warnings: renderResult.warnings,
                      reingestWarning: `Re-ingest failed: ${msg}`,
                      pendingDelegations
                    },
                    null,
                    2
                  )
                }
              ]
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: true,
                    reindexed: true,
                    note: "Element IDs may have shifted due to re-ingestion. Re-query elements before subsequent operations.",
                    summary: `Applied ${result.applied} DB operations and ${applyResult.applied} source edits`,
                    dbChanges: result.changes,
                    sourceEdits: renderResult.edits.map((e) => ({
                      file: e.filePath,
                      label: e.label,
                      oldText: e.oldText,
                      newText: e.newText
                    })),
                    warnings: renderResult.warnings,
                    affectedFiles: applyResult.affectedFiles,
                    pendingDelegations
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        reindexProject(projectRoot2, store2, getDefaultRegistry());
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  reindexed: true,
                  note: "Element IDs may have shifted due to re-ingestion. Re-query elements before subsequent operations.",
                  summary: `Applied ${result.applied} DB operations (no source edits needed)`,
                  dbChanges: result.changes,
                  warnings: renderResult.warnings,
                  pendingDelegations
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, reason: message }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-plan.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z6 } from "zod";
import { createHash } from "crypto";
function registerOlogPlan(server2, store2, projectRoot2) {
  const operationSchema = z6.union([
    z6.object({
      kind: z6.literal("rename"),
      target: z6.string(),
      newName: z6.string()
    }),
    z6.object({
      kind: z6.literal("move"),
      target: z6.string(),
      newModule: z6.string()
    }),
    z6.object({
      kind: z6.literal("addSymbol"),
      module: z6.string(),
      name: z6.string(),
      symbolKind: z6.string()
    }),
    z6.object({
      kind: z6.literal("removeSymbol"),
      target: z6.string()
    }),
    z6.object({
      kind: z6.literal("addArrow"),
      arrowKind: z6.string(),
      src: z6.string(),
      dst: z6.string()
    }),
    z6.object({
      kind: z6.literal("removeArrow"),
      arrowId: z6.string()
    }),
    z6.object({
      kind: z6.literal("rewrite_body"),
      target: z6.string().describe("Element ID of the function/method whose body will be rewritten"),
      rationale: z6.string().describe("Why the body needs rewriting and what the intended change is")
    }),
    z6.object({
      kind: z6.literal("addReexport"),
      module: z6.string(),
      name: z6.string(),
      fromModule: z6.string()
    }),
    z6.object({
      kind: z6.literal("amendType"),
      target: z6.string().describe("Element ID of the type/interface to amend"),
      field: z6.string().describe("Name of the field/property to amend"),
      action: z6.enum(["addUnionMember", "addProperty"]).describe("Type of amendment"),
      value: z6.string().describe("Value to add (e.g. union member name or type string)")
    })
  ]);
  server2.registerTool(
    "olog_plan",
    {
      description: "Describe a set of structural changes as a plan with invariants. The plan is persisted to disk keyed by its hash for later validation and application.",
      inputSchema: z6.object({
        operations: z6.array(operationSchema).describe("List of planned structural operations"),
        rationale: z6.string().describe("Human-readable rationale for the plan")
      }),
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    async ({ operations, rationale }) => {
      try {
        const hash = createHash("sha256").update(JSON.stringify(operations)).digest("hex");
        const targetElementIds = /* @__PURE__ */ new Set();
        const targetKinds = /* @__PURE__ */ new Set();
        const targetModules = /* @__PURE__ */ new Set();
        for (const op of operations) {
          switch (op.kind) {
            case "rename":
            case "move":
            case "removeSymbol":
              targetElementIds.add(op.target);
              break;
            case "addSymbol":
              targetModules.add(op.module);
              targetKinds.add(op.symbolKind);
              break;
            case "addArrow":
              targetElementIds.add(op.src);
              targetElementIds.add(op.dst);
              break;
            case "removeArrow":
              break;
            case "rewrite_body":
              targetElementIds.add(op.target);
              break;
          }
        }
        for (const id of targetElementIds) {
          const elem = store2.getElem(id);
          if (elem) {
            targetKinds.add(elem.kind);
            if (elem.module) {
              targetModules.add(elem.module);
            }
          }
        }
        const equationsById = /* @__PURE__ */ new Map();
        for (const id of targetElementIds) {
          for (const eq of store2.getEquationsForObject(id)) {
            equationsById.set(eq.id, eq);
          }
        }
        const constraintsById = /* @__PURE__ */ new Map();
        for (const constraint of store2.getConstraints()) {
          const configStr = JSON.stringify(constraint.config);
          let matched = false;
          for (const kind of targetKinds) {
            if (configStr.includes(kind)) {
              matched = true;
              break;
            }
          }
          if (!matched) {
            for (const mod of targetModules) {
              if (configStr.includes(mod)) {
                matched = true;
                break;
              }
            }
          }
          if (matched) {
            constraintsById.set(constraint.id, constraint);
          }
        }
        const invariants = {
          equations: Array.from(equationsById.values()),
          constraints: Array.from(constraintsById.values())
        };
        const plan = {
          operations,
          hash,
          rationale,
          invariants
        };
        persistPlan(hash, plan, projectRoot2);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ok: true, plan: { operations, hash, invariants } },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-validate.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z7 } from "zod";
function fuzzyFindElement(store2, target) {
  const namePart = target.split(":").pop() ?? "";
  if (!namePart) return [];
  const candidates = store2.queryElements({ nameRegex: `^${escapeRegex(namePart)}$`, limit: 10 });
  return candidates.map((e) => ({ id: e.id, name: e.name, module: e.module, kind: e.kind }));
}
function notFoundMessage(target, context, candidates) {
  if (candidates.length === 1) {
    const c = candidates[0];
    return `${context}: element not found: "${target}". Did you mean "${c.id}" (${c.kind} "${c.name}" in ${c.module ?? "(root)"})?`;
  }
  if (candidates.length > 1) {
    const list = candidates.map((c) => `  "${c.id}" (${c.kind} "${c.name}" in ${c.module ?? "(root)"})`).join("\n");
    return `${context}: element not found: "${target}". Candidates by name:
${list}`;
  }
  return `${context}: element not found: "${target}"`;
}
var ProjectedState = class {
  constructor(store2, ops) {
    this.store = store2;
    for (const op of ops) {
      if (op.kind === "addSymbol") {
        const id = `projected:${op.module}:${op.symbolKind}:${op.name}`;
        this.addedElems.set(id, { id, kind: op.symbolKind, name: op.name, module: op.module });
      } else if (op.kind === "removeSymbol") {
        this.removedElemIds.add(op.target);
      } else if (op.kind === "rename") {
        this.renames.set(op.target, op.newName);
      } else if (op.kind === "move") {
        this.moves.set(op.target, op.newModule);
      } else if (op.kind === "addArrow") {
        this.addedArrIds.add(`${op.src}:${op.arrowKind}:${op.dst}`);
      } else if (op.kind === "removeArrow") {
        this.removedArrIds.add(op.arrowId);
      } else if (op.kind === "rewrite_body") {
      } else if (op.kind === "addReexport") {
        const id = `projected:${op.module}:other:${op.name}`;
        this.addedElems.set(id, { id, kind: "other", name: op.name, module: op.module });
      }
    }
  }
  store;
  addedElems = /* @__PURE__ */ new Map();
  removedElemIds = /* @__PURE__ */ new Set();
  renames = /* @__PURE__ */ new Map();
  moves = /* @__PURE__ */ new Map();
  addedArrIds = /* @__PURE__ */ new Set();
  removedArrIds = /* @__PURE__ */ new Set();
  elemExists(id) {
    if (this.removedElemIds.has(id)) return false;
    if (this.addedElems.has(id)) return true;
    return this.store.getElem(id) !== null;
  }
  arrowExists(id) {
    if (this.removedArrIds.has(id)) return false;
    if (this.addedArrIds.has(id)) return true;
    return this.store.getArr(id) !== null;
  }
  /** Returns IDs of arrows that will still reference elemId after the plan runs. */
  survivingArrowsFor(elemId2) {
    const fromStore = [
      ...this.store.outgoing(elemId2),
      ...this.store.incoming(elemId2)
    ].filter((a) => !this.removedArrIds.has(a.id)).map((a) => a.id);
    const fromPlan = [...this.addedArrIds].filter((arrId) => {
      const parts = arrId.split(":");
      return parts[0] === elemId2 || parts[parts.length - 1] === elemId2;
    });
    return [.../* @__PURE__ */ new Set([...fromStore, ...fromPlan])];
  }
  /**
   * Returns true if any element OTHER than excludeId will have the given name
   * in the given module after the plan runs.
   */
  nameConflicts(name, module, excludeId) {
    const stored = this.store.queryElements({
      nameRegex: `^${escapeRegex(name)}$`,
      limit: 500
    });
    for (const e of stored) {
      if (e.id === excludeId) continue;
      if (this.removedElemIds.has(e.id)) continue;
      const effectiveName = this.renames.get(e.id) ?? e.name;
      const effectiveModule = this.moves.get(e.id) ?? e.module;
      if (effectiveName === name && effectiveModule === module) return true;
    }
    for (const added of this.addedElems.values()) {
      if (added.id === excludeId) continue;
      if (added.name === name && added.module === module) return true;
    }
    return false;
  }
};
function registerOlogValidate(server2, store2, projectRoot2) {
  server2.registerTool(
    "olog_validate",
    {
      description: "Validate a plan against constraints. Returns {ok: true, plan} on success, or {ok: false, violations} on failure. Checks name uniqueness, referential integrity, path equations, and integrity constraints. All checks operate on the projected post-plan state, not the current store.",
      inputSchema: z7.object({
        planHash: z7.string().describe("Hash of the plan to validate (as returned by olog_plan)")
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ planHash }) => {
      try {
        const plan = loadPlan(planHash, projectRoot2);
        if (!plan) {
          return {
            content: [
              {
                type: "text",
                text: `Plan not found: ${planHash}. Use olog_plan to create a plan first.`
              }
            ],
            isError: true
          };
        }
        const violations = [];
        const ops = plan.operations;
        const projected = new ProjectedState(store2, ops);
        for (const op of ops) {
          if (op.kind === "rename") {
            const existing = store2.getElem(op.target);
            if (existing) {
              const effectiveModule = projected["moves"].get(op.target) ?? existing.module;
              if (projected.nameConflicts(op.newName, effectiveModule, op.target)) {
                violations.push({
                  id: crypto.randomUUID(),
                  kind: "uniqueness",
                  humanMessage: `rename: "${op.newName}" would conflict with an existing element in module "${effectiveModule ?? "(root)"}"`,
                  involved: [op.target]
                });
              }
            }
          }
          if (op.kind === "move") {
            if (!projected.elemExists(op.target)) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "notFound",
                humanMessage: notFoundMessage(op.target, "move", fuzzyFindElement(store2, op.target)),
                involved: [op.target]
              });
            }
          }
          if (op.kind === "addSymbol") {
            if (projected.nameConflicts(op.name, op.module, `projected:${op.module}:${op.symbolKind}:${op.name}`)) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "uniqueness",
                humanMessage: `addSymbol: "${op.name}" (${op.symbolKind}) would conflict with an existing element in "${op.module}"`,
                involved: []
              });
            }
          }
          if (op.kind === "removeSymbol") {
            const surviving = projected.survivingArrowsFor(op.target);
            if (surviving.length > 0) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "referential",
                humanMessage: `removeSymbol: "${op.target}" would still have ${surviving.length} arrow(s) after the plan runs`,
                involved: [op.target, ...surviving]
              });
            }
          }
          if (op.kind === "addArrow") {
            if (!projected.elemExists(op.src)) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "notFound",
                humanMessage: notFoundMessage(op.src, "addArrow src", fuzzyFindElement(store2, op.src)),
                involved: [op.src]
              });
            }
            if (!projected.elemExists(op.dst)) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "notFound",
                humanMessage: notFoundMessage(op.dst, "addArrow dst", fuzzyFindElement(store2, op.dst)),
                involved: [op.dst]
              });
            }
          }
          if (op.kind === "removeArrow") {
            if (!projected.arrowExists(op.arrowId)) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "notFound",
                humanMessage: `removeArrow: arrow not found: "${op.arrowId}"`,
                involved: [op.arrowId]
              });
            }
          }
          if (op.kind === "rewrite_body") {
            const elem = store2.getElem(op.target);
            if (!elem) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "notFound",
                humanMessage: notFoundMessage(op.target, "rewrite_body", fuzzyFindElement(store2, op.target)),
                involved: [op.target]
              });
            } else if (!elem.span) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "constraint",
                humanMessage: `rewrite_body: element "${elem.name}" has no span \u2014 cannot locate its source`,
                involved: [op.target]
              });
            }
            const conflicts = ops.filter(
              (o) => o !== op && (o.kind === "removeSymbol" || o.kind === "rename") && "target" in o && o.target === op.target
            );
            for (const conflict of conflicts) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "constraint",
                humanMessage: `rewrite_body: conflicts with "${conflict.kind}" on the same element "${op.target}"`,
                involved: [op.target]
              });
            }
          }
          if (op.kind === "amendType") {
            if (!projected.elemExists(op.target)) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "notFound",
                humanMessage: notFoundMessage(op.target, "amendType", fuzzyFindElement(store2, op.target)),
                involved: [op.target]
              });
            }
          }
          if (op.kind === "addReexport") {
            const moduleExists = store2.queryElements({
              moduleRegex: `^${escapeRegex(op.module)}$`,
              limit: 1
            });
            if (moduleExists.length === 0) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "notFound",
                humanMessage: `addReexport: module not found: "${op.module}"`,
                involved: []
              });
            } else if (projected.nameConflicts(op.name, op.module, "")) {
              violations.push({
                id: crypto.randomUUID(),
                kind: "uniqueness",
                humanMessage: `addReexport: "${op.name}" would conflict with an existing element in "${op.module}"`,
                involved: []
              });
            }
          }
        }
        const equationResult = evaluatePathEquations(store2);
        violations.push(...equationResult.violations);
        const constraintResult = evaluateConstraints(store2);
        violations.push(...constraintResult.violations);
        if (violations.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: true, plan }, null, 2)
              }
            ]
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, violations }, null, 2)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-propose-schema.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z8 } from "zod";
import { randomUUID as randomUUID5 } from "crypto";
var objectSchema = z8.object({
  kind: z8.string().describe("Element kind"),
  name: z8.string().describe("Element name (noun phrase)"),
  module: z8.string().optional().describe("Optional module path")
});
var arrowSchema = z8.object({
  name: z8.string().describe("Arrow kind/name"),
  domain: z8.string().describe("Domain element name"),
  codomain: z8.string().describe("Codomain element name"),
  total: z8.boolean().describe("Whether this is a total function")
});
var pathSchema = z8.object({
  src: z8.string().describe("Source element ID or name"),
  tgt: z8.string().describe("Target element ID or name"),
  arrows: z8.array(z8.string()).describe("Sequence of arrow kinds")
});
var equationSchema = z8.object({
  id: z8.string(),
  name: z8.string(),
  humanMessage: z8.string(),
  lhs: pathSchema,
  rhs: pathSchema
});
var provenanceSchema = z8.object({
  source: z8.enum(["tree-sitter", "lsp", "manual", "llm", "heuristic", "other"]),
  commitSha: z8.string(),
  ingestedAt: z8.number().optional(),
  confidence: z8.enum(["resolved", "unresolved", "tentative"])
});
var STANDARD_KINDS = [
  "file",
  "module",
  "symbol",
  "callsite",
  "import",
  "type",
  "interface",
  "class",
  "enum",
  "function",
  "method",
  "const",
  "var",
  "namespace",
  "domain",
  "property",
  "other"
];
function registerOlogProposeSchema(server2, store2) {
  server2.registerTool(
    "olog_propose_schema",
    {
      description: "Propose a new schema fragment to the olog. Validates noun phrases for objects, total-function semantics for arrows, and path equation composability. Stores accepted objects in olog_elem, arrows in olog_arr, equations in olog_equation, and provenance in olog_prov.",
      inputSchema: z8.object({
        objects: z8.preprocess((v) => typeof v === "string" ? JSON.parse(v) : v, z8.array(objectSchema)).default([]).describe("Objects to add to the schema. Omit or pass [] if adding only arrows/equations."),
        arrows: z8.preprocess((v) => typeof v === "string" ? JSON.parse(v) : v, z8.array(arrowSchema)).default([]).describe("Arrows to add to the schema. Omit or pass [] if adding only objects/equations."),
        equations: z8.preprocess((v) => typeof v === "string" ? JSON.parse(v) : v, z8.array(equationSchema)).default([]).describe("Path equations to add. Omit or pass [] if not adding equations."),
        provenance: provenanceSchema.describe("Provenance metadata for all proposed items")
      }),
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    async ({ objects, arrows, equations, provenance }) => {
      try {
        const errors = [];
        const added = { objects: 0, arrows: 0, equations: 0 };
        const objectMap = /* @__PURE__ */ new Map();
        for (const obj of objects) {
          if (!isNounPhrase(obj.name)) {
            errors.push(
              `Object "${obj.name}" is not a valid noun phrase (must start with uppercase after optional "a"/"an"/"the")`
            );
          }
          objectMap.set(obj.name, obj);
        }
        const arrowList = [];
        const proposedArrowKinds = /* @__PURE__ */ new Set();
        for (const arrow of arrows) {
          if (!arrow.total) {
            errors.push(
              `Arrow "${arrow.name}" is not total. Many-valued relationships must be reified before proposing.`
            );
            continue;
          }
          const domainElems = store2.queryElements({ nameRegex: `^${arrow.domain}$`, limit: 1 });
          const domainExists = domainElems.length > 0 || objectMap.has(arrow.domain);
          if (!domainExists) {
            errors.push(`Arrow "${arrow.name}": domain "${arrow.domain}" does not exist`);
            continue;
          }
          const codomainElems = store2.queryElements({ nameRegex: `^${arrow.codomain}$`, limit: 1 });
          const codomainExists = codomainElems.length > 0 || objectMap.has(arrow.codomain);
          if (!codomainExists) {
            errors.push(`Arrow "${arrow.name}": codomain "${arrow.codomain}" does not exist`);
            continue;
          }
          arrowList.push(arrow);
          proposedArrowKinds.add(arrow.name);
        }
        for (const eq of equations) {
          const result = validateEquation(eq, store2, Array.from(proposedArrowKinds));
          errors.push(...result.errors);
        }
        if (errors.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, errors }, null, 2)
              }
            ]
          };
        }
        const createdElemIds = /* @__PURE__ */ new Map();
        for (const obj of objects) {
          const id = randomUUID5();
          createdElemIds.set(obj.name, id);
          const kind = STANDARD_KINDS.includes(obj.kind) ? obj.kind : "other";
          const elem = {
            id,
            kind,
            name: obj.name,
            module: obj.module ?? null,
            span: null,
            attrs: {}
          };
          store2.addElement(elem);
          store2.addProvenance(id, {
            source: provenance.source,
            commitSha: provenance.commitSha,
            ingestedAt: provenance.ingestedAt ?? Date.now(),
            confidence: provenance.confidence
          });
          added.objects++;
        }
        for (const arrow of arrowList) {
          const domainId = createdElemIds.get(arrow.domain) ?? store2.queryElements({ nameRegex: `^${arrow.domain}$`, limit: 1 })[0]?.id;
          const codomainId = createdElemIds.get(arrow.codomain) ?? store2.queryElements({ nameRegex: `^${arrow.codomain}$`, limit: 1 })[0]?.id;
          if (!domainId || !codomainId) {
            errors.push(`Arrow "${arrow.name}": failed to resolve domain/codomain IDs`);
            continue;
          }
          const arr = {
            id: arrowId(domainId, arrow.name, codomainId),
            kind: arrow.name,
            srcId: domainId,
            dstId: codomainId,
            attrs: {}
          };
          store2.addArrow(arr);
          added.arrows++;
        }
        if (errors.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, errors }, null, 2)
              }
            ]
          };
        }
        for (const eq of equations) {
          const eqWithProv = {
            id: eq.id,
            name: eq.name,
            humanMessage: eq.humanMessage,
            lhs: eq.lhs,
            rhs: eq.rhs,
            provenance: {
              source: provenance.source,
              commitSha: provenance.commitSha,
              ingestedAt: provenance.ingestedAt ?? Date.now(),
              confidence: provenance.confidence
            }
          };
          store2.addEquation(eqWithProv);
          added.equations++;
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, added }, null, 2)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, errors: [message] }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-render.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z9 } from "zod";
function registerOlogRender(server2, store2, projectRoot2) {
  server2.registerTool(
    "olog_render",
    {
      description: "Preview the source-file edits that a validated plan would produce, without writing to disk. Returns SourceEdits grouped by file, with warnings for operations needing manual review.",
      inputSchema: z9.object({
        planHash: z9.string().describe("Hash of the validated plan to render (as returned by olog_plan)")
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ planHash }) => {
      try {
        const plan = loadPlan(planHash, projectRoot2);
        if (!plan) {
          return {
            content: [
              {
                type: "text",
                text: `Plan not found: ${planHash}. Use olog_plan to create a plan first.`
              }
            ],
            isError: true
          };
        }
        const result = renderPlan(store2, plan.operations, projectRoot2);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-delegate.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z10 } from "zod";
var TASK_TYPES = [
  "write_function_body",
  "write_test",
  "write_migration",
  "rewrite_body",
  "write_documentation"
];
function registerOlogDelegate(server2, store2, projectRoot2) {
  server2.registerTool(
    "olog_delegate",
    {
      description: "Assemble a fully-resolved structural brief for a text-generation subagent. Traverses the olog to collect signatures, call graphs, interface contracts, import paths, analogue source code, and domain model context. The brief includes a domainContext field: ownConcepts lists the domain concept(s) this code element implements (via implementedAs) along with their domain arrows, and neighborConcepts lists domain concepts reachable via callers and callees (Kan extension neighborhood). Both are null when no domain model exists yet \u2014 call olog_domain_discover first to populate it. Returns a self-contained brief that requires NO further olog queries \u2014 designed for consumption by a smaller/cheaper model that will write the actual code.",
      inputSchema: z10.object({
        task: z10.enum(TASK_TYPES).describe(
          "The type of text-generation task."
        ),
        target: z10.string().describe(
          'Element ID of the target entity (e.g., "symbol:src/auth.verifyJwt"). Use olog_query or olog_inspect to find the ID.'
        ),
        contextOverrides: z10.object({
          mustCall: z10.array(z10.string()).optional().describe(
            "Element IDs the implementation must call. Replaces automatically derived context."
          ),
          mustImplement: z10.array(z10.string()).optional().describe(
            "Element IDs of interfaces this implementation must satisfy. Replaces derived context."
          ),
          analogues: z10.array(z10.string()).optional().describe(
            "Element IDs of similar existing implementations. Replaces automatic discovery."
          )
        }).optional().describe(
          "Manual overrides for structural context. When provided, these REPLACE the automatically derived values (not merge)."
        ),
        acceptanceCriteria: z10.array(z10.string()).optional().describe(
          "Additional acceptance criteria, merged with task-type defaults."
        ),
        maxAnalogues: z10.number().int().min(0).max(5).default(3).describe(
          "Maximum number of analogue implementations to include."
        ),
        snippetLines: z10.number().int().min(10).max(200).default(50).describe(
          "Maximum lines of source code per snippet."
        ),
        lineRange: z10.object({
          start: z10.number(),
          end: z10.number()
        }).optional().describe(
          "Line range to narrow focus within a file."
        ),
        skipAnalogues: z10.boolean().optional().describe(
          "Skip analogue discovery; overrides maxAnalogues to 0."
        ),
        signatureChange: z10.boolean().optional().describe(
          "Allow signature changes in generated code."
        ),
        rationale: z10.string().optional().describe(
          "Why this body rewrite is needed. Passed through to the delegation brief so the edit agent understands the intent. Populate from pendingDelegations[].rationale returned by olog_apply."
        ),
        setId: z10.string().optional().describe(
          "Working set ID from the current planning session. When provided: (1) elements already in the working set get a relevance bonus in analogue selection, (2) the brief's shouldCall/shouldImplement/analogueOf relationships are written as synthetic arrows into the working set so the planning agent can inspect them, (3) the edit agent can assert discoveredDependency arrows back to the working set."
        )
      }),
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    async ({ task, target, contextOverrides, acceptanceCriteria, maxAnalogues, snippetLines, lineRange, skipAnalogues, signatureChange, rationale, setId }) => {
      try {
        const effectiveMaxAnalogues = skipAnalogues ? 0 : maxAnalogues;
        const overrides = contextOverrides ? {
          ...contextOverrides.mustCall ? { mustCall: contextOverrides.mustCall } : {},
          ...contextOverrides.mustImplement ? { mustImplement: contextOverrides.mustImplement } : {},
          ...contextOverrides.analogues ? { analogues: contextOverrides.analogues } : {},
          ...lineRange ? { lineRange } : {},
          ...skipAnalogues !== void 0 ? { skipAnalogues } : {},
          ...signatureChange !== void 0 ? { signatureChange } : {}
        } : void 0;
        const briefOpts = {
          ...overrides !== void 0 ? { overrides } : {},
          ...effectiveMaxAnalogues !== void 0 ? { maxAnalogues: effectiveMaxAnalogues } : {},
          ...snippetLines !== void 0 ? { snippetLines } : {},
          ...acceptanceCriteria !== void 0 ? { extraCriteria: acceptanceCriteria } : {},
          ...rationale !== void 0 ? { rationale } : {},
          ...setId !== void 0 ? { setId } : {}
        };
        const result = assembleBrief(store2, projectRoot2, task, target, briefOpts);
        if ("ok" in result && result.ok === false) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2)
              }
            ],
            isError: true
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, error: message }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-dot-domain.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z11 } from "zod";
function dotId(name) {
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function registerOlogDotDomain(server2, store2) {
  server2.registerTool(
    "olog_dot_domain",
    {
      description: 'Export the domain subgraph as Graphviz DOT for debugging the spec. Returns a DOT string renderable with `dot -Tsvg`. Scoped to "domain" elements only; pass setId to overlay the working-set synthetic arrows on top.',
      inputSchema: z11.object({
        setId: z11.string().optional().describe("Working set ID \u2014 when provided, synthetic arrows from that set are included in the graph"),
        nameRegex: z11.string().optional().describe('Regex to filter element names (e.g. "^Order")'),
        moduleRegex: z11.string().optional().describe("Regex to filter by module path")
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ setId, nameRegex, moduleRegex }) => {
      try {
        const allElems = store2.queryElements({
          kind: "domain",
          ...nameRegex !== void 0 ? { nameRegex } : {},
          ...moduleRegex !== void 0 ? { moduleRegex } : {},
          limit: 1e4
        });
        const elemIds = new Set(allElems.map((e) => e.id));
        const lines = ["digraph olog {", "  rankdir=LR;", "  node [shape=box];", ""];
        for (const elem of allElems) {
          const label = elem.module ? `${elem.name}\\n[${elem.module}]` : elem.name;
          lines.push(`  ${dotId(elem.id)} [label=${dotId(label)}];`);
        }
        lines.push("");
        const seenArrows = /* @__PURE__ */ new Set();
        for (const elem of allElems) {
          for (const arr of store2.outgoing(elem.id)) {
            if (!elemIds.has(arr.dstId)) continue;
            if (seenArrows.has(arr.id)) continue;
            seenArrows.add(arr.id);
            lines.push(`  ${dotId(elem.id)} -> ${dotId(arr.dstId)} [label=${dotId(arr.kind)}];`);
          }
        }
        if (setId) {
          const graph = store2.queryWorkingSetGraph(setId, {});
          for (const arr of graph.syntheticArrows) {
            if (!arr.dstId) continue;
            const id = `syn_${arr.id}`;
            if (seenArrows.has(id)) continue;
            seenArrows.add(id);
            lines.push(`  ${dotId(arr.srcId)} -> ${dotId(arr.dstId)} [label=${dotId(arr.kind)} style=dashed color=blue];`);
          }
        }
        lines.push("}");
        return {
          content: [{ type: "text", text: lines.join("\n") }]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true
        };
      }
    }
  );
}

// src/tools/olog-ws.ts
import "@modelcontextprotocol/sdk/server/mcp.js";
import { z as z12 } from "zod";
function registerOlogWs(server2, store2) {
  server2.registerTool(
    "olog_ws_open",
    {
      description: "Open a new working set for the current planning session. Returns a setId to pass to olog_ws_add and olog_ws_query. Call once at the start of Phase 1.",
      inputSchema: z12.object({
        name: z12.string().describe('Human-readable name for this working set (e.g. "refactor-auth-plan")'),
        planHash: z12.string().optional().describe("Plan hash to associate with this working set")
      }),
      annotations: { idempotentHint: false }
    },
    async (args) => {
      try {
        const setId = store2.createWorkingSet(args.name, args.planHash);
        return { content: [{ type: "text", text: JSON.stringify({ setId }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );
  server2.registerTool(
    "olog_ws_add",
    {
      description: "Add elements and/or arrows to an open working set. Pass the IDs returned by olog_query, olog_inspect, or olog_explore. Deduplicates automatically.",
      inputSchema: z12.object({
        setId: z12.string().describe("Working set ID returned by olog_ws_open"),
        elementIds: z12.array(z12.string()).default([]).describe("Element IDs to add"),
        arrowIds: z12.array(z12.string()).default([]).describe("Arrow IDs to add")
      }),
      annotations: { idempotentHint: true }
    },
    async (args) => {
      try {
        const result = store2.addToWorkingSet(args.setId, args.elementIds, args.arrowIds);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );
  server2.registerTool(
    "olog_ws_query",
    {
      description: "Query the working set as a graph. Without arrows/direction: returns accumulated elements, real arrows, and synthetic arrows. With arrows/direction: performs one-hop traversal from matching seed elements through both main olog arrows and synthetic arrows, returning the reachable subgraph. Synthetic arrows (synthetic: true) are inferences asserted by explore agents. Check this before calling olog_explore \u2014 skip the explore call if the element is already here.",
      inputSchema: z12.object({
        setId: z12.string().describe("Working set ID"),
        kind: z12.string().optional().describe("Filter seed elements by kind"),
        nameRegex: z12.string().optional().describe("Regex filter on element name"),
        moduleRegex: z12.string().optional().describe("Regex filter on element module"),
        arrows: z12.array(z12.string()).optional().describe('Arrow kinds to follow for traversal (e.g. ["callerOf", "calls", "structurallyDependsOn"])'),
        direction: z12.enum(["in", "out"]).optional().describe('Traversal direction: "out" follows arrows where seed is source, "in" follows arrows where seed is destination'),
        includeAnnotations: z12.boolean().optional().describe("Include annotations on elements and arrows"),
        source: z12.string().optional().describe('Filter synthetic arrows by source (e.g. "orient", "orchestrate", "implement", "elicit", "propose_functor", "legacy")')
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (args) => {
      try {
        const graphOpts = {};
        if (args.kind !== void 0) graphOpts.kind = args.kind;
        if (args.nameRegex !== void 0) graphOpts.nameRegex = args.nameRegex;
        if (args.moduleRegex !== void 0) graphOpts.moduleRegex = args.moduleRegex;
        if (args.arrows !== void 0) graphOpts.arrows = args.arrows;
        if (args.direction !== void 0) graphOpts.direction = args.direction;
        if (args.includeAnnotations !== void 0) graphOpts.includeAnnotations = args.includeAnnotations;
        if (args.source !== void 0) graphOpts.source = args.source;
        const graph = store2.queryWorkingSetGraph(args.setId, graphOpts);
        return {
          content: [{ type: "text", text: JSON.stringify(graph, null, 2) }]
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );
  server2.registerTool(
    "olog_ws_drop",
    {
      description: "Delete a working set when the planning session is complete.",
      inputSchema: z12.object({
        setId: z12.string().describe("Working set ID to delete")
      }),
      annotations: { idempotentHint: true }
    },
    async (args) => {
      try {
        store2.deleteWorkingSet(args.setId);
        return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );
  server2.registerTool(
    "olog_ws_assert",
    {
      description: "Assert a synthetic arrow into the working set \u2014 an inferred structural relationship not yet modeled as a real olog arrow. Use when you discover a relationship through querying (e.g. a de facto dependency, a gateway pattern, an unmodeled implementedAs) that would be lost if only stored in prose. Synthetic arrows appear in olog_ws_query traversal results with synthetic: true.",
      inputSchema: z12.object({
        setId: z12.string().describe("Working set ID"),
        srcId: z12.string().describe("Source element ID (must exist in olog_elem)"),
        dstId: z12.string().optional().describe("Destination element ID (must exist in olog_elem). Omit when the dependency was discovered but its olog element ID is unknown."),
        kind: z12.string().describe('Arrow kind \u2014 free-text, e.g. "structurallyDependsOn", "gatekeepedBy", "coordinatesWith", or a standard ArrowKind you verified empirically'),
        source: z12.enum(["elicit", "orient", "orchestrate", "implement", "propose_functor", "legacy"]).describe("Which agent role asserted this arrow"),
        note: z12.string().optional().describe("Explanation of why this relationship holds \u2014 what evidence supports this inference")
      }),
      annotations: { idempotentHint: false }
    },
    async (args) => {
      try {
        const id = store2.assertSyntheticArrow(args.setId, args.srcId, args.dstId, args.kind, args.source, args.note);
        const result = { id, setId: args.setId, kind: args.kind, srcId: args.srcId, dstId: args.dstId ?? null, note: args.note ?? null, source: args.source, synthetic: true };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );
  server2.registerTool(
    "olog_ws_annotate",
    {
      description: "Attach, update, or delete a note on a working set element or arrow. When delete is true, removes the annotation. Otherwise, upserts the note text (replaces any existing note for the same target).",
      inputSchema: z12.object({
        setId: z12.string().describe("Working set ID"),
        targetId: z12.string().describe("ID of the element or arrow to annotate"),
        note: z12.string().describe("Note text to attach"),
        delete: z12.boolean().default(false).describe("When true, removes the annotation")
      }),
      annotations: { idempotentHint: true }
    },
    async (args) => {
      try {
        if (args.delete) {
          store2.deleteAnnotation(args.setId, args.targetId);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
        }
        const result = store2.annotateWorkingSet(args.setId, args.targetId, args.note);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );
}

// src/index.ts
if (process.argv[2] === "init") {
  const { runInit: runInit2 } = await Promise.resolve().then(() => (init_init(), init_exports));
  await runInit2();
  process.exit(0);
}
var ADAPTER_CLASS = {
  typescript: "TypeScriptAdapter",
  clojure: "ClojureAdapter"
};
var projectRoot = process.env.OLOG_ROOT || process.cwd();
var ologDir = join6(projectRoot, ".olog");
try {
  mkdirSync3(ologDir, { recursive: true });
} catch (err) {
  console.error(
    `[olog] Failed to create ${ologDir}: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}
var dbPath = join6(ologDir, "olog.sqlite");
var store = new OlogStore(dbPath);
var languages = [];
var server = new McpServer13(
  { name: "olog-mcp", version: "0.0.1" },
  {
    instructions: `Structural olog for ${projectRoot}. Name and module parameters accept JS regex. Call olog_overview first for orientation.`,
    capabilities: { logging: {} }
  }
);
registerOlogQuery(server, store, projectRoot);
registerOlogInspect(server, store, projectRoot);
registerOlogOverview(server, store);
registerOlogReindex(server, store, projectRoot);
registerOlogProposeSchema(server, store);
registerOlogPlan(server, store, projectRoot);
registerOlogValidate(server, store, projectRoot);
registerOlogApply(server, store, projectRoot);
registerOlogRender(server, store, projectRoot);
registerOlogDelegate(server, store, projectRoot);
registerOlogDotDomain(server, store);
registerOlogWs(server, store);
var transport = new StdioServerTransport();
await server.connect(transport);
console.error("[olog] MCP server connected on stdio");
await new Promise((resolve2) => setImmediate(resolve2));
console.error(`[olog] Starting ingestion for ${projectRoot}...`);
var start = Date.now();
try {
  const adapterRegistry = new AdapterRegistry();
  setDefaultRegistry(adapterRegistry);
  const rawLanguages = process.env.OLOG_LANGUAGES;
  languages = rawLanguages ? rawLanguages.split(",").map((s) => s.trim()).filter(Boolean) : detectLanguages(projectRoot);
  for (const lang of languages) {
    try {
      const mod = await import(`@olog/lang-${lang}`);
      const className = ADAPTER_CLASS[lang];
      const AdapterClass = className ? mod[className] : mod.default;
      if (typeof AdapterClass === "function") {
        if (typeof mod.init === "function") await mod.init();
        adapterRegistry.register(new AdapterClass());
        console.error(`[olog] Loaded ${lang} adapter`);
      } else {
        console.error(`[olog] Warning: no adapter class found in @olog/lang-${lang}`);
      }
    } catch (err) {
      console.error(`[olog] Warning: could not load @olog/lang-${lang}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const result = ingestProject(projectRoot, store, adapterRegistry);
  console.error(
    `[olog] Ingestion complete in ${Date.now() - start}ms: ${result.filesProcessed} files, ${result.elementsCreated} elements, ${result.arrowsCreated} arrows`
  );
} catch (err) {
  console.error(
    `[olog] Ingestion failed: ${err instanceof Error ? err.message : String(err)}`
  );
}
var cleanup = () => {
  try {
    store.close();
  } catch {
  }
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
//# sourceMappingURL=index.js.map