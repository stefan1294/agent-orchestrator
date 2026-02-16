#!/usr/bin/env node

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  console.log(`
agent-orchestrator - Multi-track AI coding agent orchestrator

Usage:
  agent-orchestrator init                 Initialize config in current directory
  agent-orchestrator [start] [options]    Start the orchestrator dashboard
  agent-orchestrator --help               Show this help message
  agent-orchestrator --version            Show version

Start options:
  --project <path>    Path to the project directory (default: current directory)
  --port <number>     Port for the dashboard (default: 3001, or PORT env var)

Examples:
  cd /path/to/my-project
  npx agent-orchestrator init
  npx agent-orchestrator start

  # Or with explicit project path:
  npx agent-orchestrator start --project /path/to/my-project

Environment variables:
  PORT                Server port (default: 3001)
  PROJECT_ROOT        Project directory (alternative to --project)
`);
}

async function printVersion(): Promise<void> {
  const pkgPath = path.join(__dirname, '..', '..', 'package.json');
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    console.log(`agent-orchestrator v${pkg.version}`);
  } catch {
    console.log('agent-orchestrator (unknown version)');
  }
}

async function main(): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    await printVersion();
    process.exit(0);
  }

  if (command === 'init') {
    await import('./init.js');
    return;
  }

  if (!command || command === 'start') {
    // Default to cwd if no --project flag or PROJECT_ROOT env
    const hasProjectFlag = args.includes('--project') || args.some(a => a.startsWith('--project='));
    if (!hasProjectFlag && !process.env.PROJECT_ROOT) {
      process.env.PROJECT_ROOT = process.cwd();
    }

    // Handle --port flag
    const portIdx = args.indexOf('--port');
    if (portIdx !== -1 && args[portIdx + 1]) {
      process.env.PORT = args[portIdx + 1];
    }
    const portEq = args.find(a => a.startsWith('--port='));
    if (portEq) {
      process.env.PORT = portEq.split('=')[1];
    }

    await import('./index.js');
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error('Run "agent-orchestrator --help" for usage information.');
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
