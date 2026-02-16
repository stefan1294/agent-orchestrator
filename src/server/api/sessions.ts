import { Router } from 'express';
import type { Orchestrator } from '../services/orchestrator.js';

export function createSessionsRouter(orchestrator: Orchestrator): Router {
  const router = Router();

  // GET /api/sessions — paginated list
  router.get('/', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const featureId = req.query.featureId ? parseInt(req.query.featureId as string) : undefined;
    const track = req.query.track as string | undefined;
    const status = req.query.status as string | undefined;

    const db = orchestrator.getSessionDB();
    const sessions = db.getSessions({ limit, offset, featureId, track, status });
    const total = db.getSessionCount({ featureId, track, status });

    res.json({ sessions, total, limit, offset });
  });

  // GET /api/sessions/:id — single session with full output
  router.get('/:id', async (req, res) => {
    const session = orchestrator.getSessionDB().getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Look up feature name
    const feature = await orchestrator.getFeatureStore().getFeature(session.feature_id);

    // Parse structured_messages from JSON string
    const parsed = {
      ...session,
      featureName: feature?.name || `Feature #${session.feature_id}`,
      structured_messages: session.structured_messages ? JSON.parse(session.structured_messages) : [],
    };

    res.json({ session: parsed });
  });

  return router;
}
