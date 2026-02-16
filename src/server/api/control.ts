import { Router } from 'express';
import type { Orchestrator } from '../services/orchestrator.js';
import { logger } from '../utils/logger.js';

export function createControlRouter(orchestrator: Orchestrator): Router {
  const router = Router();

  // GET /api/status
  router.get('/status', (req, res) => {
    res.json(orchestrator.getStatus());
  });

  // POST /api/start
  router.post('/start', async (req, res) => {
    try {
      // Start in background, don't await completion
      orchestrator.start().catch(err => {
        logger.error('Orchestrator error:', err);
      });
      res.json({ message: 'Orchestrator started', state: 'running' });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /api/stop
  router.post('/stop', async (req, res) => {
    try {
      await orchestrator.stop();
      res.json({ message: 'Stopping after current sessions finish', state: 'stopping' });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
