export { serveViewer, type ServeViewerOptions } from './server.js';
export { toCytoscapeGraph, KIND_COLORS, type CytoscapeGraph } from './graph.js';
export { ViewerRouter } from './routes/sets.js';

import { join } from 'node:path';
import { OlogStore } from '@olog/core';
import { serveViewer } from './server.js';

function parseArgs(): { port: number; dbPath: string } {
  const args = process.argv.slice(2);
  let port = 3210;
  let dbPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && i + 1 < args.length) {
      port = parseInt(args[++i]!, 10);
    } else if (args[i] === '--db' && i + 1 < args.length) {
      dbPath = args[++i]!;
    }
  }

  const ologRoot = process.env.OLOG_ROOT || process.cwd();
  const resolvedDbPath = dbPath ?? join(ologRoot, '.olog', 'olog.sqlite');

  return { port, dbPath: resolvedDbPath };
}

const { port, dbPath } = parseArgs();
const store = new OlogStore(dbPath);

serveViewer(store, { port }).catch((err) => {
  console.error(`[olog-viewer] Failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
