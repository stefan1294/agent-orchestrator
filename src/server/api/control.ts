import { Router } from 'express';
import type { Orchestrator } from '../services/orchestrator.js';
import type { TrackDefinition } from '../services/project-config.js';
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

  // POST /api/tracks/configure
  router.post('/tracks/configure', async (req, res) => {
    try {
      const { tracks } = req.body as { tracks: TrackDefinition[] };

      // Validation
      if (!Array.isArray(tracks) || tracks.length === 0) {
        res.status(400).json({ error: 'At least 1 track is required' });
        return;
      }
      if (tracks.length > 5) {
        res.status(400).json({ error: 'Maximum 5 tracks allowed' });
        return;
      }

      const defaultTracks = tracks.filter(t => t.isDefault);
      if (defaultTracks.length !== 1) {
        res.status(400).json({ error: 'Exactly 1 track must be marked as default' });
        return;
      }

      const names = tracks.map(t => t.name);
      if (new Set(names).size !== names.length) {
        res.status(400).json({ error: 'Track names must be unique' });
        return;
      }

      for (const track of tracks) {
        if (!track.name || !track.name.trim()) {
          res.status(400).json({ error: 'All tracks must have a name' });
          return;
        }
      }

      orchestrator.configureTracks(tracks);
      res.json({ message: 'Tracks configured', status: orchestrator.getStatus() });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
