import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OlogStore, ingestProject, AdapterRegistry, setDefaultRegistry } from '@olog/core';
import { detectLanguages } from './detect.js';

if (process.argv[2] === 'init') {
  const { runInit } = await import('./init.js');
  await runInit();
  process.exit(0);
}

const ADAPTER_CLASS: Record<string, string> = {
  typescript: 'TypeScriptAdapter',
  clojure: 'ClojureAdapter',
};
import { registerOlogQuery } from './tools/olog-query.js';
import { registerOlogInspect } from './tools/olog-inspect.js';
import { registerOlogDump } from './tools/olog-dump.js';
import { registerOlogReindex } from './tools/olog-reindex.js';
import { registerOlogApply } from './tools/olog-apply.js';
import { registerOlogPlan } from './tools/olog-plan.js';
import { registerOlogValidate } from './tools/olog-validate.js';
import { registerOlogProposeSchema } from './tools/olog-propose-schema.js';
import { registerOlogRender } from './tools/olog-render.js';
import { registerOlogDelegate } from './tools/olog-delegate.js';
import { registerOlogMineEquations } from './tools/olog-mine-equations.js';
import { registerOlogDomainDiscover } from './tools/olog-domain-discover.js';
import { registerOlogDiscoverMotifs } from './tools/olog-discover-motifs.js';
import { registerOlogDot } from './tools/olog-dot.js';

const projectRoot = process.env.OLOG_ROOT || process.cwd();

const ologDir = join(projectRoot, '.olog');
try {
  mkdirSync(ologDir, { recursive: true });
} catch (err) {
  console.error(
    `[olog] Failed to create ${ologDir}: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}

const dbPath = join(ologDir, 'olog.sqlite');
const store = new OlogStore(dbPath);

console.error(`[olog] Starting ingestion for ${projectRoot}...`);
const start = Date.now();
let languages: string[] = [];
try {
  const adapterRegistry = new AdapterRegistry();
  setDefaultRegistry(adapterRegistry);

  const rawLanguages = process.env.OLOG_LANGUAGES;
  languages = rawLanguages
    ? rawLanguages.split(',').map((s) => s.trim()).filter(Boolean)
    : detectLanguages(projectRoot);

  for (const lang of languages) {
    try {
      const mod = await import(`@olog/lang-${lang}`);
      const className = ADAPTER_CLASS[lang];
      const AdapterClass = className ? mod[className] : mod.default;
      if (typeof AdapterClass === 'function') {
        if (typeof mod.init === 'function') await mod.init(); 
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
  store.close();
  process.exit(1);
}

const server = new McpServer(
  { name: 'olog-mcp', version: '0.0.1' },
  {
    instructions: `This server provides a structural model (ontology log) of the codebase at ${projectRoot} (languages: ${languages.join(', ')}). Tools: olog_query (search/filter/traverse), olog_inspect (details+provenance), olog_dump (overview), olog_reindex (refresh), olog_propose_schema (extend schema), olog_plan (describe changes), olog_validate (check plans), olog_apply (execute plans), olog_render (preview source edits), olog_dot (export domain graph as Graphviz DOT), olog_mine_equations (discover path equations in the olog graph; use touchingElementKinds=["domain"] to focus on domain-level structure), olog_domain_discover (iterative domain modeling: discovers domain objects from interface/type/class elements, proposes arrows from field types and extends/implements relationships, links to already-committed domain elements across sessions — use action=start/refine/commit), olog_discover_motifs (motif discovery: discovers recurring structural motifs via ego-graph extraction, shape abstraction, and frequency grouping — use action=start/refine/commit). The name and module parameters accept JavaScript regex patterns. Domain modeling workflow: (1) start a session with optional scopeRegex, (2) refine candidates by accepting/rejecting/renaming, (3) commit to persist domain elements and arrows to the olog. Subsequent sessions on broader scopes will automatically cross-link to elements committed in prior sessions.`,
    capabilities: { logging: {} },
  }
);

registerOlogQuery(server, store, projectRoot);
registerOlogInspect(server, store, projectRoot);
registerOlogDump(server, store);
registerOlogReindex(server, store, projectRoot);
registerOlogProposeSchema(server, store);
registerOlogPlan(server, store, projectRoot);
registerOlogValidate(server, store, projectRoot);
registerOlogApply(server, store, projectRoot);
registerOlogRender(server, store, projectRoot);
registerOlogDelegate(server, store, projectRoot);
registerOlogMineEquations(server, store);
registerOlogDomainDiscover(server, store);
registerOlogDiscoverMotifs(server, store);
registerOlogDot(server, store);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[olog] MCP server connected on stdio');

const cleanup = () => {
  try {
    store.close();
  } catch {
    // Ignore errors during cleanup — we're shutting down anyway
  }
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
