import { readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

// ─── Track Definition ────────────────────────────────────────────

export interface TrackDefinition {
  name: string;
  categories: string[];   // feature categories routed to this track
  color?: string;          // hex color for UI (e.g. "#8b5cf6")
  isDefault?: boolean;     // catch-all for features that don't match any category
}

// ─── Worktree Configuration ──────────────────────────────────────

export interface WorktreeConfig {
  symlinkDirs: string[];   // gitignored dirs to symlink into worktrees
  copyFiles: string[];     // files to copy into worktrees
  preserveFiles: string[]; // files preserved across git operations
  setupScript: string | null; // shell script content to create in worktree (null = skip)
  setupScriptName: string; // filename for the setup script
  dockerService: string | null; // Docker service name (e.g. "laravel.test"), null if no Docker
  dockerWorkDir: string | null; // Docker working directory (e.g. "/var/www/html/"), null if no Docker
  dockerComposeFile: string | null; // Docker compose file path relative to project root
}

// ─── Critical Pattern ────────────────────────────────────────────

export interface CriticalPattern {
  pattern: string;  // regex pattern string
  label: string;
}

// ─── Prompt Templates ────────────────────────────────────────────

export interface PromptTemplates {
  implementation: string | null;  // null = use built-in default
  verification: string | null;
  fix: string | null;
}

// ─── Agent Configuration ─────────────────────────────────────────

export interface AgentConfig {
  preferred: 'claude' | 'codex' | 'gemini';   // which agent to try first
  fallbackAgents: string[];        // agents to try on rate limit, in order (e.g. ['codex']). Empty = no fallback, just wait.
  claudeCommand: string;           // path or command name for Claude CLI
  claudeArgs: string;              // custom args (JSON array or space-separated), empty = defaults
  codexCommand: string;            // path or command name for Codex CLI
  codexArgs: string;               // custom args (JSON array or space-separated), empty = defaults
  geminiCommand: string;           // path or command name for Gemini CLI (experimental, not tested)
  geminiArgs: string;              // custom args (JSON array or space-separated), empty = defaults
  maxTurnsImplementation: number;
  maxTurnsVerification: number;
  allowedTools: string;            // comma-separated tool list for implementation
  allowedToolsVerification: string; // comma-separated tool list for verification
  rateLimitWaitMs: number;         // how long to wait after hitting rate limit
}

// ─── Verification Configuration ─────────────────────────────────

export interface VerificationConfig {
  maxAttempts: number;             // max verification + fix cycles
  delayMs: number;                 // wait after merge before verification (hot-reload)
  disabled: boolean;               // skip verification entirely
}

// ─── Full Project Configuration ──────────────────────────────────

export interface ProjectConfig {
  projectName: string;
  baseBranch: string;
  featuresFile: string;
  progressFile: string;
  instructionsFile: string;
  appUrl: string;

  tracks: TrackDefinition[];
  worktree: WorktreeConfig;
  criticalPatterns: CriticalPattern[];
  prompts: PromptTemplates;
  agent: AgentConfig;
  verification: VerificationConfig;
}

// ─── Defaults ────────────────────────────────────────────────────

const DEFAULT_CONFIG: ProjectConfig = {
  projectName: '',
  baseBranch: 'ai-develop',
  featuresFile: 'features.json',
  progressFile: 'orchestrator-progress.txt',
  instructionsFile: 'ORCHESTRATOR.md',
  appUrl: '',

  tracks: [
    { name: 'track-1', categories: [], color: '#8b5cf6', isDefault: true },
  ],

  worktree: {
    symlinkDirs: ['node_modules'],
    copyFiles: ['.mcp.json', '.env'],
    preserveFiles: ['features.json', 'orchestrator-progress.txt'],
    setupScript: null,
    setupScriptName: 'run-worktree',
    dockerService: null,
    dockerWorkDir: null,
    dockerComposeFile: null,
  },

  criticalPatterns: [
    { pattern: 'ECONNREFUSED', label: 'Server not running' },
    { pattern: 'Cannot connect to the Docker daemon|docker.*not running', label: 'Docker not running' },
    { pattern: 'npm ERR!|node:.*MODULE_NOT_FOUND', label: 'Node/npm issue' },
  ],

  prompts: {
    implementation: null,
    verification: null,
    fix: null,
  },

  agent: {
    preferred: 'claude',
    fallbackAgents: ['codex'],
    claudeCommand: 'claude',
    claudeArgs: '',
    codexCommand: 'codex',
    codexArgs: '',
    geminiCommand: 'gemini',
    geminiArgs: '',
    maxTurnsImplementation: 40,
    maxTurnsVerification: 20,
    allowedTools: 'Bash,Read,Write,Edit',
    allowedToolsVerification: 'Bash,Read,Write',
    rateLimitWaitMs: 600000,
  },

  verification: {
    maxAttempts: 3,
    delayMs: 5000,
    disabled: false,
  },
};

// ─── Config File Name ────────────────────────────────────────────

export const CONFIG_FILE_NAME = 'orchestrator.config.json';

// ─── Deep Merge ──────────────────────────────────────────────────

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal !== undefined &&
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal) &&
      targetVal !== null
    ) {
      result[key] = deepMerge(targetVal as any, sourceVal as any);
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}

// ─── Load Config ─────────────────────────────────────────────────

export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

  try {
    await stat(configPath);
  } catch {
    throw new ConfigNotFoundError(projectRoot);
  }

  const raw = await readFile(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
  const merged = deepMerge(DEFAULT_CONFIG, parsed);
  logger.info(`Loaded project config from ${CONFIG_FILE_NAME}`);
  return merged;
}

export class ConfigNotFoundError extends Error {
  constructor(projectRoot: string) {
    super(
      `No ${CONFIG_FILE_NAME} found in ${projectRoot}.\n` +
      `Run 'npx agent-orchestrator init' in your project directory to create one.`
    );
    this.name = 'ConfigNotFoundError';
  }
}

// ─── Save Config ─────────────────────────────────────────────────

export async function saveProjectConfig(projectRoot: string, config: ProjectConfig): Promise<void> {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  logger.info(`Saved project config to ${CONFIG_FILE_NAME}`);
}

// ─── Get Default Config ──────────────────────────────────────────

export function getDefaultConfig(): ProjectConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

// ─── Generate Docker Worktree Script ─────────────────────────────

export function generateDockerWorktreeScript(config: ProjectConfig): string | null {
  if (!config.worktree.dockerService || !config.worktree.dockerWorkDir) {
    return null;
  }

  const composeFile = config.worktree.dockerComposeFile || 'compose.yaml';
  const service = config.worktree.dockerService;
  const dockerWorkDir = config.worktree.dockerWorkDir.replace(/\/$/, '');

  return `#!/bin/bash
# ${config.worktree.setupScriptName}: Run commands from a git worktree inside Docker.
# Auto-generated by the orchestrator. Do not edit.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Walk up to find project root (.git directory, not .git file from worktree)
PROJECT_ROOT="$SCRIPT_DIR"
while [ ! -d "$PROJECT_ROOT/.git" ] && [ "$PROJECT_ROOT" != "/" ]; do
    PROJECT_ROOT="$(dirname "$PROJECT_ROOT")"
done
REL_PATH="$(python3 -c "import os.path; print(os.path.relpath('$SCRIPT_DIR', '$PROJECT_ROOT'))")"
DOCKER_PATH="${dockerWorkDir}/$REL_PATH"
docker compose -f "$PROJECT_ROOT/${composeFile}" --env-file "$PROJECT_ROOT/.env" exec -T -w "$DOCKER_PATH" ${service} "$@"
`;
}

// ─── Compile Critical Patterns ───────────────────────────────────

export function compileCriticalPatterns(config: ProjectConfig): Array<{ pattern: RegExp; label: string }> {
  return config.criticalPatterns.map(({ pattern, label }) => ({
    pattern: new RegExp(pattern, 'i'),
    label,
  }));
}
