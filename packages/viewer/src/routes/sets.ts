import type { OlogStore } from '@olog/core';
import { Router, type Request, type Response } from 'express';
import { toCytoscapeGraph } from '../graph.js';

/**
 * ViewerRouter creates an Express Router with endpoints for:
 *   GET /api/sets              — list all working sets
 *   GET /api/sets/:id          — get single working set metadata
 *   GET /api/sets/:id/graph    — get working set graph as Cytoscape JSON
 *   GET /api/sets/:id/stream   — SSE stream of working set changes
 */
export class ViewerRouter {
  private store: OlogStore;
  private router: Router;

  constructor(store: OlogStore) {
    this.store = store;
    this.router = Router();
    this.setupRoutes();
  }

  getRouter(): Router {
    return this.router;
  }

  private setupRoutes(): void {
    this.router.get('/api/sets', this.listSets.bind(this));
    this.router.get('/api/sets/:id', this.getSet.bind(this));
    this.router.get('/api/sets/:id/graph', this.getGraph.bind(this));
    this.router.get('/api/sets/:id/stream', this.stream.bind(this));
  }

  /** GET /api/sets — list all working sets */
  private listSets(_req: Request, res: Response): void {
    try {
      const sets = this.store.listWorkingSets();
      res.json(sets);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** GET /api/sets/:id — get single working set metadata */
  private getSet(req: Request, res: Response): void {
    try {
      const id = req.params.id as string;
      const ws = this.store.getWorkingSet(id, true);
      if (!ws) {
        res.status(404).json({ error: 'Working set not found' });
        return;
      }
      res.json(ws);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** GET /api/sets/:id/graph — get working set graph as Cytoscape JSON */
  private getGraph(req: Request, res: Response): void {
    try {
      const id = req.params.id as string;
      const opts: Record<string, any> = {};

      // Support optional traversal query parameters:
      //   ?arrows=callerOf,calls&direction=out
      const arrowsParam = req.query.arrows;
      if (typeof arrowsParam === 'string') {
        opts.arrows = arrowsParam.split(',');
      }
      const directionParam = req.query.direction;
      if (typeof directionParam === 'string') {
        opts.direction = directionParam;
      }
      const kindParam = req.query.kind;
      if (typeof kindParam === 'string') {
        opts.kind = kindParam;
      }
      const nameRegexParam = req.query.nameRegex;
      if (typeof nameRegexParam === 'string') {
        opts.nameRegex = nameRegexParam;
      }
      const moduleRegexParam = req.query.moduleRegex;
      if (typeof moduleRegexParam === 'string') {
        opts.moduleRegex = moduleRegexParam;
      }
      opts.includeAnnotations = true;

      const graph = this.store.queryWorkingSetGraph(id, opts);
      const cytoGraph = toCytoscapeGraph(graph);
      res.json(cytoGraph);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * GET /api/sets/:id/stream — SSE endpoint
   * Polls the working set's updated_at every 1 second and pushes
   * an event when it changes. Also sends a heartbeat every 15 seconds.
   */
  private stream(req: Request, res: Response): void {
    const id = req.params.id as string;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    let lastUpdatedAt: number | null = null;

    // Initial fetch to get current updated_at
    try {
      const sets = this.store.listWorkingSets();
      const ws = sets.find((s: any) => s.id === id);
      if (ws) {
        lastUpdatedAt = ws.updatedAt;
      }
    } catch {
      // Ignore — will retry on next poll
    }

    // Poll every 1 second
    const pollInterval = setInterval(() => {
      try {
        const sets = this.store.listWorkingSets();
        const ws = sets.find((s: any) => s.id === id);
        if (!ws) {
          // Working set was deleted
          res.write(`event: deleted\ndata: {"setId":"${id}"}\n\n`);
          res.end();
          clearInterval(pollInterval);
          clearInterval(heartbeatInterval);
          return;
        }
        if (lastUpdatedAt === null || ws.updatedAt !== lastUpdatedAt) {
          lastUpdatedAt = ws.updatedAt;
          res.write(`event: updated\ndata: ${JSON.stringify({ setId: id, updatedAt: ws.updatedAt })}\n\n`);
        }
      } catch {
        // Ignore — will retry on next poll
      }
    }, 1000);

    // Heartbeat every 15 seconds
    const heartbeatInterval = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    // Cleanup on close
    req.on('close', () => {
      clearInterval(pollInterval);
      clearInterval(heartbeatInterval);
    });
  }
}
