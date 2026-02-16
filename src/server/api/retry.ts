import { Router } from 'express';
import type { Orchestrator } from '../services/orchestrator.js';

export function createRetryRouter(orchestrator: Orchestrator): Router {
  const router = Router();

  // POST /api/retry/:featureId
  router.post('/:featureId', async (req, res) => {
    try {
      const featureId = parseInt(req.params.featureId);
      const { extraContext } = req.body || {};

      if (isNaN(featureId)) {
        return res.status(400).json({ error: 'Invalid feature ID' });
      }

      await orchestrator.retryFeature(featureId, extraContext || '');
      res.json({ message: `Feature ${featureId} queued for retry` });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
