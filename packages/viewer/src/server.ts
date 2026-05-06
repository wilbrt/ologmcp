import type { OlogStore } from '@olog/core';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ViewerRouter } from './routes/sets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServeViewerOptions {
  port?: number;
}

/**
 * Start the olog viewer HTTP server.
 *
 * Serves:
 * - Static frontend from the public/ directory
 * - REST API under /api/sets/*
 * - SSE stream under /api/sets/:id/stream
 *
 * @param store  An opened OlogStore instance (read-only access)
 * @param options  Optional configuration (port defaults to 3210)
 * @returns The running http.Server instance
 */
export async function serveViewer(store: OlogStore, options?: ServeViewerOptions): Promise<import('http').Server> {
  const port = options?.port ?? 3210;
  const app = express();

  // CORS for development (frontend may be served from different origin)
  app.use(cors());
  app.use(express.json());

  // API routes
  const viewerRouter = new ViewerRouter(store);
  app.use(viewerRouter.getRouter());

  // Static frontend — resolve relative to this source file so it works
  // both in development (via tsx) and in production (dist/)
  const publicDir = path.resolve(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  // SPA fallback: serve index.html for any non-API, non-file route
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  const server = app.listen(port, () => {
    console.error(`[olog-viewer] Listening on http://localhost:${port}`);
  });

  return server;
}
