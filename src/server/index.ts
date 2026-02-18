import fs from 'fs';
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
import { runBrowserPreflight } from './services/browser-preflight.js';
import { loadProjectConfig } from './services/project-config.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3001');
const projectRoot = path.resolve(process.cwd());

// ─── Load config (fail fast if missing) ─────────────────────────

let config;
try {
  config = await loadProjectConfig(projectRoot);
} catch (err: any) {
  if (err.name === 'ConfigNotFoundError') {
    logger.error(`No .orchestrator/config.json found in ${projectRoot}`);
    logger.error('Run "npx agent-orchestrator init" first.');
  } else {
    logger.error(`Failed to load config: ${err.message}`);
  }
  process.exit(1);
}

// ─── Browser verification preflight (interactive, runs in terminal) ──

if (config.browser.enabled) {
  logger.info('Browser verification enabled — checking MCP installation...');
  const preflightOk = await runBrowserPreflight(config, true);
  if (!preflightOk) {
    logger.warn('Chrome DevTools MCP not installed for all agents — disabling browser verification.');
    config.browser.enabled = false;
  }
}

// ─── Express + Socket.IO setup ───────────────────────────────────

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// ─── Initialize orchestrator ─────────────────────────────────────

const orchestrator = new Orchestrator(projectRoot, io, config);
await orchestrator.getSessionDB().initDatabase();

logger.info(`Project initialized: ${projectRoot}`);
logger.info(`Project name: ${config.projectName || '(unnamed)'}`);

// ─── Mount API routes ────────────────────────────────────────────

app.get('/api/project', (_req, res) => {
  res.json({
    configured: true,
    projectRoot,
    projectName: config.projectName || null,
  });
});

app.use('/api/features', createFeaturesRouter(orchestrator));
app.use('/api/sessions', createSessionsRouter(orchestrator));
app.use('/api', createControlRouter(orchestrator));
app.use('/api/retry', createRetryRouter(orchestrator));
app.use('/api/resume', createResumeRouter(orchestrator));
app.use('/api/settings', createSettingsRouter(orchestrator));
app.use('/api/config', createConfigRouter(orchestrator));

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
  socket.emit('orchestrator:status', orchestrator.getStatus());

  socket.on('disconnect', () => {
    logger.debug(`Dashboard client disconnected: ${socket.id}`);
  });
});

// ─── Start server ────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  logger.info(`Orchestrator dashboard running at http://localhost:${PORT}`);
  logger.info(`Project root: ${projectRoot}`);
});
