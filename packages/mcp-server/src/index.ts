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
import { registerOlogOverview } from './tools/olog-overview.js';
import { registerOlogReindex } from './tools/olog-reindex.js';
import { registerOlogApply } from './tools/olog-apply.js';
import { registerOlogPlan } from './tools/olog-plan.js';
import { registerOlogValidate } from './tools/olog-validate.js';
import { registerOlogProposeSchema } from './tools/olog-propose-schema.js';
import { registerOlogRender } from './tools/olog-render.js';
import { registerOlogDelegate } from './tools/olog-delegate.js';
import { registerOlogDot } from './tools/olog-dot.js';
import { registerOlogWs } from './tools/olog-ws.js';

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

let languages: string[] = [];

const server = new McpServer(
  { name: 'olog-mcp', version: '0.0.1' },
  {
    instructions: `Structural olog for ${projectRoot}. Name and module parameters accept JS regex. Call olog_overview first for orientation.`,
    capabilities: { logging: {} },
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
registerOlogDot(server, store);
registerOlogWs(server, store);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[olog] MCP server connected on stdio');

// Yield so the initialize response is flushed before synchronous ingestion blocks the event loop
await new Promise<void>((resolve) => setImmediate(resolve));

console.error(`[olog] Starting ingestion for ${projectRoot}...`);
const start = Date.now();
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
}

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
