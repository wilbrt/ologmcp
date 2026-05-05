import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OlogStore } from '@olog/core';
import { registerOlogMineEquations } from './tools/olog-mine-equations.js';
import { registerOlogDomainDiscover } from './tools/olog-domain-discover.js';
import { registerOlogDiscoverMotifs } from './tools/olog-discover-motifs.js';

const projectRoot = process.env.OLOG_ROOT || process.cwd();

const ologDir = join(projectRoot, '.olog');
try {
  mkdirSync(ologDir, { recursive: true });
} catch (err) {
  console.error(
    `[olog-mining] Failed to create ${ologDir}: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}

// Open the existing DB — ingestion is owned by the core olog server.
const dbPath = join(ologDir, 'olog.sqlite');
const store = new OlogStore(dbPath);

const server = new McpServer(
  { name: 'olog-mining', version: '0.0.1' },
  {
    instructions: `Heavy analysis tools for the olog at ${projectRoot}. Reads the DB ingested by the core olog server. Tools: olog_mine_equations (discover path equations; use touchingElementKinds=["domain"] to focus on domain-level structure), olog_domain_discover (iterative domain modeling: start/refine/commit), olog_discover_motifs (structural motif discovery: start/refine/commit).`,
    capabilities: { logging: {} },
  }
);

registerOlogMineEquations(server, store);
registerOlogDomainDiscover(server, store);
registerOlogDiscoverMotifs(server, store);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[olog-mining] MCP server connected on stdio');

const cleanup = () => {
  try {
    store.close();
  } catch {
    // Ignore errors during cleanup
  }
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
