import { Router } from 'express';
import type { Orchestrator } from '../services/orchestrator.js';

export function createFeaturesRouter(orchestrator: Orchestrator): Router {
  const router = Router();

  // GET /api/features — return all features with latest session info
  router.get('/', async (req, res) => {
    try {
      const features = await orchestrator.getFeatureStore().loadFeatures();
      const db = orchestrator.getSessionDB();

      // Attach latest session info to each feature
      const enriched = features.map(f => {
        const latestSession = db.getLatestSessionForFeature(f.id);
        return {
          ...f,
          latestSession: latestSession ? {
            id: latestSession.id,
            status: latestSession.status,
            started_at: latestSession.started_at,
            finished_at: latestSession.finished_at,
            duration_ms: latestSession.duration_ms,
            branch: latestSession.branch,
            error_message: latestSession.error_message,
          } : null,
        };
      });

      res.json({ features: enriched });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
