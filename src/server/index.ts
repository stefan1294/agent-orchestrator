import fs from 'fs';
import { stat } from 'fs/promises';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { createConfigRouter } from './api/config.js';
import { createControlRouter } from './api/control.js';
import { createFeaturesRouter } from './api/features.js';
import { createResumeRouter } from './api/resume.js';
import { createRetryRouter } from './api/retry.js';
import { createSessionsRouter } from './api/sessions.js';
import { createSettingsRouter } from './api/settings.js';
import { Orchestrator } from './services/orchestrator.js';
import { loadProjectConfig, type ProjectConfig } from './services/project-config.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3001');

// ─── Parse --project CLI argument ────────────────────────────────

function parseProjectArg(): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) {
      return path.resolve(args[i + 1]);
    }
    if (args[i].startsWith('--project=')) {
      return path.resolve(args[i].split('=')[1]);
    }
  }
  // Also accept PROJECT_ROOT env var as fallback
  if (process.env.PROJECT_ROOT) {
    return path.resolve(process.env.PROJECT_ROOT);
  }
  return null;
}

// ─── Express + Socket.IO setup ───────────────────────────────────

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// ─── Mutable state: orchestrator is created when a project is configured ──

let orchestrator: Orchestrator | null = null;
let currentProjectRoot: string | null = null;
let routesMounted = false;

// ─── Mount orchestrator API routes ───────────────────────────────

function mountOrchestratorRoutes(orch: Orchestrator): void {
  if (routesMounted) return;
  app.use('/api/features', createFeaturesRouter(orch));
  app.use('/api/sessions', createSessionsRouter(orch));
  app.use('/api', createControlRouter(orch));
  app.use('/api/retry', createRetryRouter(orch));
  app.use('/api/resume', createResumeRouter(orch));
  app.use('/api/settings', createSettingsRouter(orch));
  app.use('/api/config', createConfigRouter(orch));
  routesMounted = true;
}

// ─── Initialize orchestrator for a project path ─────────────────

async function initializeProject(projectPath: string): Promise<{ config: ProjectConfig }> {
  const config = await loadProjectConfig(projectPath);

  orchestrator = new Orchestrator(projectPath, io, config);
  await orchestrator.getSessionDB().initDatabase();

  currentProjectRoot = projectPath;
  mountOrchestratorRoutes(orchestrator);

  logger.info(`Project initialized: ${projectPath}`);
  logger.info(`Project name: ${config.projectName || '(unnamed)'}`);

  return { config };
}

// ─── Project setup API (always available) ────────────────────────

// GET /api/project — returns current project status
app.get('/api/project', (_req, res) => {
  res.json({
    configured: !!orchestrator,
    projectRoot: currentProjectRoot,
    projectName: orchestrator?.getConfig().projectName || null,
  });
});

// POST /api/project — set project path from GUI
app.post('/api/project', async (req, res) => {
  const { projectRoot: newPath } = req.body;

  if (!newPath || typeof newPath !== 'string') {
    res.status(400).json({ error: 'projectRoot is required' });
    return;
  }

  const resolved = path.resolve(newPath);

  // Validate directory exists
  try {
    const s = await stat(resolved);
    if (!s.isDirectory()) {
      res.status(400).json({ error: `Not a directory: ${resolved}` });
      return;
    }
  } catch {
    res.status(400).json({ error: `Directory not found: ${resolved}` });
    return;
  }

  // Try to load config
  try {
    const { config } = await initializeProject(resolved);
    res.json({
      configured: true,
      projectRoot: resolved,
      projectName: config.projectName,
    });
  } catch (err: any) {
    res.status(400).json({
      error: err.message || 'Failed to initialize project',
      needsInit: err.name === 'ConfigNotFoundError',
    });
  }
});

// ─── Guard: return 503 for orchestrator routes when no project ──

app.use('/api', (req, res, next) => {
  // Allow project setup endpoints through
  if (req.path === '/project' || req.path.startsWith('/project/')) {
    return next();
  }
  if (!orchestrator) {
    res.status(503).json({
      error: 'No project configured',
      needsSetup: true,
    });
    return;
  }
  next();
});

// ─── Serve built frontend in production ──────────────────────────

const clientDist = path.join(__dirname, '..', '..', 'dist', 'client');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    }
  });
}

// ─── Socket.IO connection handling ───────────────────────────────

io.on('connection', (socket) => {
  logger.info(`Dashboard client connected: ${socket.id}`);

  // Send current status on connect (or empty status if no project)
  if (orchestrator) {
    socket.emit('orchestrator:status', orchestrator.getStatus());
  } else {
    socket.emit('orchestrator:status', { state: 'stopped', tracks: [], startedAt: null });
  }

  socket.on('disconnect', () => {
    logger.debug(`Dashboard client disconnected: ${socket.id}`);
  });
});

// ─── Startup ─────────────────────────────────────────────────────

const projectArg = parseProjectArg();

if (projectArg) {
  try {
    await initializeProject(projectArg);
  } catch (err: any) {
    if (err.name === 'ConfigNotFoundError') {
      logger.warn(`No orchestrator.config.json found in ${projectArg}`);
      logger.warn('Run "npx agent-orchestrator init" in the project directory, or configure via the GUI.');
    } else {
      logger.error(`Failed to initialize project: ${err.message}`);
    }
    // Don't exit — start in setup mode so user can configure via GUI
  }
}

httpServer.listen(PORT, () => {
  logger.info(`Orchestrator dashboard running at http://localhost:${PORT}`);
  if (currentProjectRoot) {
    logger.info(`Project root: ${currentProjectRoot}`);
  } else {
    logger.info('No project configured. Open the dashboard to set one up, or restart with --project <path>.');
  }
});
