import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OlogStore } from '@olog/core';
import { registerOlogWsAssertOnly } from './tools/olog-ws.js';

const projectRoot = process.env.OLOG_ROOT || process.cwd();

const ologDir = join(projectRoot, '.olog');
try {
  mkdirSync(ologDir, { recursive: true });
} catch (err) {
  console.error(
    `[olog-ws-assert] Failed to create ${ologDir}: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}

const dbPath = join(ologDir, 'olog.sqlite');
const store = new OlogStore(dbPath);

const server = new McpServer(
  { name: 'olog-ws-assert', version: '0.0.1' },
  {
    instructions: `Single-tool server: exposes only olog_ws_assert. Use this from the implement agent to record discovered dependencies back to the working set.`,
    capabilities: { logging: {} },
  }
);

registerOlogWsAssertOnly(server, store);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[olog-ws-assert] MCP server connected on stdio');

const cleanup = () => {
  try { store.close(); } catch { /* ignore */ }
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
