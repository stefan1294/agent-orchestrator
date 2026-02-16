import { Router } from 'express';
import type { Orchestrator } from '../services/orchestrator.js';

export function createConfigRouter(orchestrator: Orchestrator): Router {
  const router = Router();

  // GET /api/config - returns track definitions and project metadata
  router.get('/', (_req, res) => {
    const config = orchestrator.getConfig();
    res.json({
      projectName: config.projectName,
      baseBranch: config.baseBranch,
      tracks: config.tracks,
      appUrl: config.appUrl,
      instructionsFile: config.instructionsFile,
      featuresFile: config.featuresFile,
    });
  });

  return router;
}
