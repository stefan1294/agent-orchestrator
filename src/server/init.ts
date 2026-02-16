#!/usr/bin/env node

import { exec as execCb } from 'child_process';
import path from 'path';
import * as readline from 'readline';
import { promisify } from 'util';
import { getDefaultConfig, saveProjectConfig, type ProjectConfig, type TrackDefinition } from './services/project-config.js';
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
  config.appUrl = await ask('App URL for verification (e.g., http://localhost:3000)', config.appUrl);

  // Step 3: Track configuration
  heading('Track Configuration');
  log('\nTracks allow parallel feature processing. Each track runs independently.');
  log('Features are routed to tracks based on their category.\n');

  const trackCountStr = await ask('How many parallel tracks?', '2');
  const trackCount = Math.max(1, Math.min(5, parseInt(trackCountStr, 10) || 2));

  const tracks: TrackDefinition[] = [];
  const defaultColors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  for (let i = 0; i < trackCount; i++) {
    log(`\n--- Track ${i + 1} of ${trackCount} ---`);
    const defaultName = i === 0 && trackCount > 1 ? 'marketing' : i === 0 ? 'main' : i === 1 ? 'core' : `track-${i + 1}`;
    const name = await ask('Track name', defaultName);
    const categoriesStr = await ask(
      'Feature categories for this track (comma-separated, empty for catch-all)',
      i === 0 && trackCount > 1 ? name : ''
    );
    const categories = categoriesStr
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    const isDefault = categories.length === 0 || i === trackCount - 1;

    tracks.push({
      name,
      categories,
      color: defaultColors[i % defaultColors.length],
      isDefault,
    });
  }

  // Ensure at least one track is marked as default
  if (!tracks.some((t) => t.isDefault)) {
    tracks[tracks.length - 1].isDefault = true;
  }

  config.tracks = tracks;

  // Step 4: Worktree settings (confirm Docker detection)
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
    'Fallback agents on rate limit (comma-separated, or empty to disable)',
    config.agent.fallbackAgents.join(',')
  );
  config.agent.fallbackAgents = fallbackStr
    .split(',')
    .map((a) => a.trim())
    .filter((a) => ['claude', 'codex', 'gemini'].includes(a) && a !== config.agent.preferred);

  // Step 6: Save config
  heading('Summary');
  log(`\n  Project:     ${config.projectName}`);
  log(`  Framework:   ${detection.framework}`);
  log(`  Base branch: ${config.baseBranch}`);
  log(`  Tracks:      ${config.tracks.map((t) => t.name).join(', ')}`);
  log(`  App URL:     ${config.appUrl || '(not set)'}`);
  log(`  Docker:      ${config.worktree.dockerService || 'none'}`);
  log(`  Symlinks:    ${config.worktree.symlinkDirs.join(', ') || 'none'}`);
  log(`  Agent:       ${config.agent.preferred}`);
  log(`  Fallbacks:   ${config.agent.fallbackAgents.length > 0 ? config.agent.fallbackAgents.join(', ') : 'none (will wait on rate limit)'}`);

  const confirm = await ask('\nSave orchestrator.config.json? (y/n)', 'y');
  if (confirm.toLowerCase() === 'y') {
    await saveProjectConfig(projectRoot, config);
    log('\nSaved orchestrator.config.json');
    log('\nNext steps:');
    log('  1. Create a features.json file (see examples/features.example.json)');
    log('  2. Start the orchestrator:');
    log('     npx agent-orchestrator start');
    log('\nTo customize prompts, create files in prompts/ directory:');
    log('  prompts/implementation.md');
    log('  prompts/verification.md');
    log('  prompts/fix.md');
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
