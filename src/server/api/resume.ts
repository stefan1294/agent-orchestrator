import { Router } from 'express';
import type { Orchestrator } from '../services/orchestrator.js';

export function createResumeRouter(orchestrator: Orchestrator): Router {
  const router = Router();

  // POST /api/resume/:featureId
  router.post('/:featureId', async (req, res) => {
    try {
      const featureId = parseInt(req.params.featureId);
      const { prompt } = req.body || {};

      if (isNaN(featureId)) {
        return res.status(400).json({ error: 'Invalid feature ID' });
      }

      await orchestrator.resumeFeature(featureId, prompt || '');
      res.json({ message: `Feature ${featureId} queued for resume` });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
