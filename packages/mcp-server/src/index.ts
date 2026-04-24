import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OlogStore, ingestProject } from '@olog/core';
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
try {
  const result = ingestProject(projectRoot, store);
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
    instructions: `This server provides a structural model (ontology log) of the TypeScript codebase at ${projectRoot}. Tools: olog_query (search/filter/traverse), olog_inspect (details+provenance), olog_dump (overview), olog_reindex (refresh), olog_propose_schema (extend schema), olog_plan (describe changes), olog_validate (check plans), olog_apply (execute plans), olog_render (preview source edits). The name and module parameters accept JavaScript regex patterns.`,
    capabilities: { logging: {} },
  }
);

registerOlogQuery(server, store);
registerOlogInspect(server, store);
registerOlogDump(server, store);
registerOlogReindex(server, store, projectRoot);
registerOlogProposeSchema(server, store);
registerOlogPlan(server, store);
registerOlogValidate(server, store);
registerOlogApply(server, store, projectRoot);
registerOlogRender(server, store, projectRoot);
registerOlogDelegate(server, store, projectRoot);

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
