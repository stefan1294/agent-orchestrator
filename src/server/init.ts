#!/usr/bin/env node

import { exec as execCb } from 'child_process';
import { readFile, stat, writeFile, appendFile } from 'fs/promises';
import path from 'path';
import * as readline from 'readline';
import { promisify } from 'util';
import { getDefaultConfig, saveProjectConfig, type ProjectConfig } from './services/project-config.js';
import { detectProject } from './services/project-detector.js';

const exec = promisify(execCb);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string, defaultValue?: string): Promise<string> {
  const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function log(message: string): void {
  console.log(message);
}

function heading(text: string): void {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${text}`);
  console.log('='.repeat(50));
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();

  heading('Orchestrator Init');
  log(`\nProject root: ${projectRoot}`);
  log('Detecting project type...\n');

  // Step 1: Detect project
  const detection = await detectProject(projectRoot);
  log(`  Framework: ${detection.framework}`);
  log(`  Language:  ${detection.language}`);
  if (detection.features.length > 0) {
    log(`  Features:  ${detection.features.join(', ')}`);
  }

  // Step 2: Confirm or adjust settings
  heading('Project Settings');

  const config: ProjectConfig = {
    ...getDefaultConfig(),
    ...detection.config,
    worktree: {
      ...getDefaultConfig().worktree,
      ...(detection.config.worktree || {}),
    },
    agent: {
      ...getDefaultConfig().agent,
      ...(detection.config.agent || {}),
    },
    prompts: {
      ...getDefaultConfig().prompts,
      ...(detection.config.prompts || {}),
    },
    browser: {
      ...getDefaultConfig().browser,
      ...(detection.config.browser || {}),
    },
  };

  // Override critical patterns if detected
  if (detection.config.criticalPatterns) {
    config.criticalPatterns = detection.config.criticalPatterns;
  }

  config.projectName = await ask('Project name', config.projectName || path.basename(projectRoot));

  // Detect current branch and ask where to create the base branch from
  let currentBranch = 'main';
  try {
    const { stdout } = await exec('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot });
    currentBranch = stdout.trim();
  } catch { /* not a git repo or git not available */ }

  config.baseBranch = await ask(
    'Base branch for AI work (feature branches are created from and merged into this)',
    config.baseBranch
  );

  if (config.baseBranch !== currentBranch) {
    const sourceBranch = await ask(
      `Create '${config.baseBranch}' from which branch?`,
      currentBranch
    );

    // Check if baseBranch already exists
    let branchExists = false;
    try {
      await exec(`git rev-parse --verify ${config.baseBranch}`, { cwd: projectRoot });
      branchExists = true;
    } catch { /* branch doesn't exist */ }

    if (!branchExists) {
      const create = await ask(`Branch '${config.baseBranch}' does not exist. Create it from '${sourceBranch}' now? (y/n)`, 'y');
      if (create.toLowerCase() === 'y') {
        try {
          await exec(`git branch ${config.baseBranch} ${sourceBranch}`, { cwd: projectRoot });
          log(`  Created branch '${config.baseBranch}' from '${sourceBranch}'`);
        } catch (err) {
          log(`  Warning: Could not create branch — ${err instanceof Error ? err.message : err}`);
          log(`  You can create it manually: git checkout -b ${config.baseBranch} ${sourceBranch}`);
        }
      } else {
        log(`  Skipped. Create it before starting the orchestrator: git checkout -b ${config.baseBranch} ${sourceBranch}`);
      }
    } else {
      log(`  Branch '${config.baseBranch}' already exists`);
    }
  }

  config.featuresFile = await ask('Features file', config.featuresFile);
  config.instructionsFile = await ask('Instructions file for the orchestrator', config.instructionsFile);
  config.appUrl = await ask('App URL (used for testing features after merge)', config.appUrl);

  // Tracks are configured in the dashboard on first start (not during init).
  // Keep a single default track; tracksConfigured stays false.
  config.tracks = [{ name: 'default', categories: [], color: '#8b5cf6', isDefault: true }];

  // Step 3: Worktree settings (confirm Docker detection)
  heading('Worktree Settings');

  if (config.worktree.dockerService) {
    log(`\nDetected Docker service: ${config.worktree.dockerService}`);
    const useDocker = await ask('Use Docker for worktree commands? (y/n)', 'y');
    if (useDocker.toLowerCase() !== 'y') {
      config.worktree.dockerService = null;
      config.worktree.dockerWorkDir = null;
    }
  }

  const symlinkDirs = await ask(
    'Directories to symlink into worktrees',
    config.worktree.symlinkDirs.join(',')
  );
  config.worktree.symlinkDirs = symlinkDirs.split(',').map((d) => d.trim()).filter(Boolean);

  // Step 5: Agent configuration
  heading('Agent Configuration');
  log('\nSupported agents: claude, codex, gemini (experimental)');
  log('The preferred agent runs first. Fallback agents are tried on rate limit.\n');

  const preferred = await ask('Preferred agent', config.agent.preferred);
  config.agent.preferred = (['claude', 'codex', 'gemini'].includes(preferred) ? preferred : 'claude') as 'claude' | 'codex' | 'gemini';

  const fallbackStr = await ask(
    'Fallback agents on rate limit (comma-separated, or "none" to disable)',
    config.agent.fallbackAgents.length > 0 ? config.agent.fallbackAgents.join(',') : 'none'
  );
  config.agent.fallbackAgents = fallbackStr.toLowerCase() === 'none'
    ? []
    : fallbackStr
        .split(',')
        .map((a) => a.trim())
        .filter((a) => ['claude', 'codex', 'gemini'].includes(a) && a !== config.agent.preferred);

  // Step 6: Browser verification
  heading('Browser Verification');
  log('\nBrowser verification uses Chrome DevTools MCP to verify UI features');
  log('(navigate pages, click buttons, fill forms, take screenshots).\n');

  const enableBrowser = await ask('Enable browser-based verification? (y/n)', 'n');
  if (enableBrowser.toLowerCase() === 'y') {
    config.browser.enabled = true;
    log('  Browser verification enabled.');
    log('  If features require authentication, include login instructions in your feature steps.');
  } else {
    config.browser.enabled = false;
  }

  // Step 7: Save config
  heading('Summary');
  log(`\n  Project:     ${config.projectName}`);
  log(`  Framework:   ${detection.framework}`);
  log(`  Base branch: ${config.baseBranch}`);
  log(`  Tracks:      (configured in dashboard on first start)`);
  log(`  App URL:     ${config.appUrl || '(not set)'}`);
  log(`  Docker:      ${config.worktree.dockerService || 'none'}`);
  log(`  Symlinks:    ${config.worktree.symlinkDirs.join(', ') || 'none'}`);
  log(`  Agent:       ${config.agent.preferred}`);
  log(`  Fallbacks:   ${config.agent.fallbackAgents.length > 0 ? config.agent.fallbackAgents.join(', ') : 'none (will wait on rate limit)'}`);
  log(`  Browser:     ${config.browser.enabled ? 'enabled' : 'disabled'}`);

  const confirm = await ask('\nSave .orchestrator/config.json? (y/n)', 'y');
  if (confirm.toLowerCase() === 'y') {
    await saveProjectConfig(projectRoot, config);
    log('\nSaved .orchestrator/config.json');

    // Ensure .orchestrator/database/ is in the project's .gitignore
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const gitignoreEntry = '.orchestrator/database/';
    let gitignoreExists = false;
    try {
      await stat(gitignorePath);
      gitignoreExists = true;
    } catch { /* doesn't exist */ }

    if (gitignoreExists) {
      const content = await readFile(gitignorePath, 'utf-8');
      if (!content.includes(gitignoreEntry)) {
        const separator = content.endsWith('\n') ? '' : '\n';
        await appendFile(gitignorePath, `${separator}${gitignoreEntry}\n`, 'utf-8');
        log(`  Added '${gitignoreEntry}' to .gitignore`);
      }
    } else {
      const createIt = await ask('.gitignore not found. Create one with orchestrator database entry? (y/n)', 'y');
      if (createIt.toLowerCase() === 'y') {
        await writeFile(gitignorePath, `${gitignoreEntry}\n`, 'utf-8');
        log(`  Created .gitignore with '${gitignoreEntry}'`);
      }
    }

    log('\nNext steps:');
    log('  1. Create a features.json file (see examples/features.example.json)');
    log('  2. Start the orchestrator:');
    log('     npx agent-orchestrator start');
    log('\nTo customize prompts, create files in the .orchestrator/ directory:');
    log('  .orchestrator/implementation.md');
    log('  .orchestrator/verification.md');
    log('  .orchestrator/fix.md');
  } else {
    log('\nAborted. No files were created.');
  }

  rl.close();
}

main().catch((err) => {
  console.error('Error:', err);
  rl.close();
  process.exit(1);
});
