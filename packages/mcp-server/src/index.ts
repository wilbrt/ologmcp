import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OlogStore, ingestProject } from '@olog/core';
import { registerOlogQuery } from './tools/olog-query.js';
import { registerOlogInspect } from './tools/olog-inspect.js';
import { registerOlogDump } from './tools/olog-dump.js';
import { registerOlogReindex } from './tools/olog-reindex.js';

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
    instructions: `This server provides a structural model (ontology log) of the TypeScript codebase at ${projectRoot}. Use olog_query to search for elements by kind/name/module. Use olog_inspect to get details and connections for a specific element. Use olog_dump for an overview. Use olog_reindex to refresh after code changes. The name and module parameters in olog_query accept JavaScript regex patterns.`,
    capabilities: { logging: {} },
  }
);

registerOlogQuery(server, store);
registerOlogInspect(server, store);
registerOlogDump(server, store);
registerOlogReindex(server, store, projectRoot);

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
