import { Router } from 'express';
import type { Orchestrator } from '../services/orchestrator.js';
import { saveProjectConfig } from '../services/project-config.js';

interface SettingSchema {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'tags' | 'json';
  defaultValue: string;
  group: string;
  options?: string[];
  description?: string;
  recommendation?: string;
}

const SETTINGS_SCHEMA: SettingSchema[] = [
  // ─── Project ───────────────────────────────────────────────────
  {
    key: 'projectName',
    label: 'Project Name',
    type: 'text',
    defaultValue: '',
    group: 'Project',
    description: 'Name of the project. Used for display purposes.',
  },
  {
    key: 'baseBranch',
    label: 'Base Branch',
    type: 'text',
    defaultValue: 'ai-develop',
    group: 'Project',
    description: 'Branch to create feature branches from and merge back to.',
    recommendation: "The default 'ai-develop' keeps AI-generated changes separate from your team's main and develop branches. Review and merge into your real branch manually.",
  },
  {
    key: 'featuresFile',
    label: 'Features File',
    type: 'text',
    defaultValue: 'features.json',
    group: 'Project',
    description: 'Path to the features JSON file relative to project root.',
  },
  {
    key: 'progressFile',
    label: 'Progress File',
    type: 'text',
    defaultValue: 'orchestrator-progress.txt',
    group: 'Project',
    description: 'Path to the progress log file relative to project root.',
  },
  {
    key: 'instructionsFile',
    label: 'Instructions File',
    type: 'text',
    defaultValue: 'ORCHESTRATOR.md',
    group: 'Project',
    description: 'Path to the orchestrator instructions file. Agents also auto-load their native file (CLAUDE.md, AGENTS.md, GEMINI.md) separately.',
  },
  {
    key: 'appUrl',
    label: 'App URL',
    type: 'text',
    defaultValue: '',
    group: 'Project',
    description: 'Application URL for verification (e.g., http://localhost:3000).',
    recommendation: 'Set this so verification agents know where to find the running app.',
  },

  // ─── Tracks ────────────────────────────────────────────────────
  {
    key: 'tracks',
    label: 'Track Definitions',
    type: 'json',
    defaultValue: JSON.stringify([
      { name: 'track-1', categories: [], color: '#8b5cf6', isDefault: true },
    ]),
    group: 'Tracks',
    description: 'Define parallel tracks. Each track processes features matching its categories. One track should be marked as default (catch-all).',
    recommendation: 'Start with 1-2 tracks. Add more if your features have distinct categories that benefit from parallelism.',
  },

  // ─── Git & Worktree ────────────────────────────────────────────
  {
    key: 'worktree.symlinkDirs',
    label: 'Symlink Directories',
    type: 'tags',
    defaultValue: 'node_modules',
    group: 'Git & Worktree',
    description: 'Large gitignored directories to symlink into worktrees instead of copying (e.g., vendor, node_modules, .venv).',
  },
  {
    key: 'worktree.copyFiles',
    label: 'Copy Files',
    type: 'tags',
    defaultValue: '.mcp.json,.env',
    group: 'Git & Worktree',
    description: 'Files to copy into worktrees so agents can access them (e.g., .mcp.json, .env).',
  },
  {
    key: 'worktree.preserveFiles',
    label: 'Preserve Files',
    type: 'tags',
    defaultValue: 'features.json,orchestrator-progress.txt',
    group: 'Git & Worktree',
    description: 'Files to back up and restore across git checkout/merge/reset operations.',
  },
  {
    key: 'worktree.setupScriptName',
    label: 'Setup Script Name',
    type: 'text',
    defaultValue: 'run-worktree',
    group: 'Git & Worktree',
    description: 'Filename for the auto-generated worktree wrapper script.',
  },
  {
    key: 'worktree.dockerService',
    label: 'Docker Service',
    type: 'text',
    defaultValue: '',
    group: 'Git & Worktree',
    description: 'Docker Compose service name for running commands (e.g., "laravel.test"). Leave empty if not using Docker.',
  },
  {
    key: 'worktree.dockerWorkDir',
    label: 'Docker Work Dir',
    type: 'text',
    defaultValue: '',
    group: 'Git & Worktree',
    description: 'Working directory inside the Docker container (e.g., "/var/www/html/"). Leave empty if not using Docker.',
  },
  {
    key: 'worktree.dockerComposeFile',
    label: 'Docker Compose File',
    type: 'text',
    defaultValue: 'compose.yaml',
    group: 'Git & Worktree',
    description: 'Path to Docker Compose file relative to project root.',
  },
  {
    key: 'criticalPatterns',
    label: 'Critical Patterns',
    type: 'json',
    defaultValue: JSON.stringify([
      { pattern: 'ECONNREFUSED.*:8[0-9]{3}', label: 'Web server not running' },
      { pattern: 'Cannot connect to the Docker daemon|docker.*not running', label: 'Docker not running' },
      { pattern: 'npm ERR!|node:.*MODULE_NOT_FOUND', label: 'Node/npm issue' },
    ]),
    group: 'Git & Worktree',
    description: 'Regex patterns that indicate critical infrastructure failures. If 2 consecutive features fail with the same pattern, the track auto-pauses.',
  },

  // ─── Agent Configuration ───────────────────────────────────────
  {
    key: 'agent.preferred',
    label: 'Preferred Agent',
    type: 'select',
    defaultValue: 'claude',
    group: 'Agent',
    options: ['claude', 'codex', 'gemini'],
    description: 'Which AI agent to use for implementation. Gemini support is experimental.',
  },
  {
    key: 'agent.fallbackAgents',
    label: 'Fallback Agents',
    type: 'tags',
    defaultValue: 'codex',
    group: 'Agent',
    description: 'Agents to try when the preferred agent hits a rate limit, in order. Leave empty to disable fallback (will wait and retry the preferred agent instead).',
  },
  {
    key: 'agent.claudeCommand',
    label: 'Claude Command',
    type: 'text',
    defaultValue: 'claude',
    group: 'Agent',
    description: 'Path or command name for the Claude CLI.',
  },
  {
    key: 'agent.claudeArgs',
    label: 'Claude Args',
    type: 'text',
    defaultValue: '',
    group: 'Agent',
    description: 'Custom arguments for Claude CLI (JSON array or space-separated). Empty = use defaults.',
  },
  {
    key: 'agent.codexCommand',
    label: 'Codex Command',
    type: 'text',
    defaultValue: 'codex',
    group: 'Agent',
    description: 'Path or command name for the Codex CLI.',
  },
  {
    key: 'agent.codexArgs',
    label: 'Codex Args',
    type: 'text',
    defaultValue: '',
    group: 'Agent',
    description: 'Custom arguments for Codex CLI (JSON array or space-separated). Empty = use defaults.',
  },
  {
    key: 'agent.geminiCommand',
    label: 'Gemini Command',
    type: 'text',
    defaultValue: 'gemini',
    group: 'Agent',
    description: 'Path or command name for the Gemini CLI. Experimental — not tested.',
  },
  {
    key: 'agent.geminiArgs',
    label: 'Gemini Args',
    type: 'text',
    defaultValue: '',
    group: 'Agent',
    description: 'Custom arguments for Gemini CLI (JSON array or space-separated). Empty = use defaults.',
  },
  {
    key: 'agent.maxTurnsImplementation',
    label: 'Max Turns (Implementation)',
    type: 'number',
    defaultValue: '40',
    group: 'Agent',
    description: 'Maximum agent conversation turns for the implementation phase.',
    recommendation: '40 works well for most features. Increase for very complex features.',
  },
  {
    key: 'agent.maxTurnsVerification',
    label: 'Max Turns (Verification)',
    type: 'number',
    defaultValue: '20',
    group: 'Agent',
    description: 'Maximum agent conversation turns for the verification phase.',
  },
  {
    key: 'agent.allowedTools',
    label: 'Allowed Tools (Implementation)',
    type: 'text',
    defaultValue: 'Bash,Read,Write,Edit',
    group: 'Agent',
    description: 'Comma-separated list of tools the agent can use during implementation.',
  },
  {
    key: 'agent.allowedToolsVerification',
    label: 'Allowed Tools (Verification)',
    type: 'text',
    defaultValue: 'Bash,Read,Write',
    group: 'Agent',
    description: 'Comma-separated list of tools the agent can use during verification.',
  },
  {
    key: 'agent.rateLimitWaitMs',
    label: 'Rate Limit Wait (ms)',
    type: 'number',
    defaultValue: '600000',
    group: 'Agent',
    description: 'How long to wait (in ms) before retrying after hitting an agent rate limit.',
    recommendation: '600000 (10 minutes) works well for most API plans.',
  },

  // ─── Prompts ───────────────────────────────────────────────────
  {
    key: 'prompts.implementation',
    label: 'Implementation Prompt',
    type: 'textarea',
    defaultValue: '',
    group: 'Prompts',
    description: 'Custom prompt template for implementation phase. Supports {{FEATURE_NAME}}, {{FEATURE_ID}}, {{CWD}}, {{PROJECT_ROOT}}, {{APP_URL}}, {{BASE_BRANCH}}, {{STEPS}}, {{INSTRUCTIONS_FILE}} variables. Leave empty to use built-in default.',
    recommendation: 'The built-in prompt works well. Only customize if you need framework-specific instructions.',
  },
  {
    key: 'prompts.verification',
    label: 'Verification Prompt',
    type: 'textarea',
    defaultValue: '',
    group: 'Prompts',
    description: 'Custom prompt template for verification phase. Same variables as implementation. Leave empty to use built-in default.',
  },
  {
    key: 'prompts.fix',
    label: 'Fix Prompt',
    type: 'textarea',
    defaultValue: '',
    group: 'Prompts',
    description: 'Custom prompt template for fix phase (after verification failure). Leave empty to use built-in default.',
  },

  // ─── Verification ──────────────────────────────────────────────
  {
    key: 'verification.maxAttempts',
    label: 'Verify Max Attempts',
    type: 'number',
    defaultValue: '3',
    group: 'Verification',
    description: 'Maximum number of verification + fix cycles before marking a feature as failed.',
    recommendation: '3 attempts gives a good balance between thoroughness and efficiency.',
  },
  {
    key: 'verification.delayMs',
    label: 'Verify Delay (ms)',
    type: 'number',
    defaultValue: '5000',
    group: 'Verification',
    description: 'Wait time (in ms) after merging code before running verification, to allow for server hot-reload.',
  },
  {
    key: 'verification.disabled',
    label: 'Disable Verification',
    type: 'boolean',
    defaultValue: 'false',
    group: 'Verification',
    description: 'Skip verification entirely. Features will be marked as passed after implementation.',
    recommendation: 'Only disable for API-only or backend-only projects without a UI to verify.',
  },
];

function getNestedValue(obj: any, key: string): any {
  const parts = key.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function setNestedValue(obj: any, key: string, value: any): void {
  const parts = key.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function getSettingValue(schema: SettingSchema, configObj: any): string {
  const value = getNestedValue(configObj, schema.key);
  if (value !== undefined && value !== null) {
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'boolean') return String(value);
    return String(value);
  }
  return schema.defaultValue;
}

function parseSettingValue(schema: SettingSchema, rawValue: string): any {
  switch (schema.type) {
    case 'number':
      return Number(rawValue);
    case 'boolean':
      return rawValue === 'true' || rawValue === '1';
    case 'tags':
      return rawValue.split(',').map(s => s.trim()).filter(Boolean);
    case 'json':
      try { return JSON.parse(rawValue); } catch { return rawValue; }
    default:
      return rawValue;
  }
}

export function createSettingsRouter(orchestrator: Orchestrator): Router {
  const router = Router();

  // GET /api/settings
  router.get('/', (_req, res) => {
    const config = orchestrator.getConfig();
    const settings = SETTINGS_SCHEMA.map((schema) => ({
      ...schema,
      value: getSettingValue(schema, config),
    }));
    res.json({ settings });
  });

  // PUT /api/settings
  router.put('/', async (req, res) => {
    const { settings } = req.body as { settings: Record<string, string> };

    if (!settings || typeof settings !== 'object') {
      res.status(400).json({ error: 'Request body must contain a "settings" object' });
      return;
    }

    const config = orchestrator.getConfig();

    for (const [key, value] of Object.entries(settings)) {
      const schema = SETTINGS_SCHEMA.find(s => s.key === key);
      if (!schema) continue;

      const parsed = parseSettingValue(schema, String(value));
      setNestedValue(config, key, parsed);
    }

    // Persist to orchestrator.config.json
    try {
      await saveProjectConfig(orchestrator.getProjectRoot(), config);
    } catch (err) {
      console.error('Failed to save config file:', err);
      res.status(500).json({ error: 'Failed to save config file' });
      return;
    }

    // Return updated settings
    const updated = SETTINGS_SCHEMA.map((schema) => ({
      ...schema,
      value: getSettingValue(schema, config),
    }));
    res.json({ settings: updated });
  });

  return router;
}
