import { readFile, stat } from 'fs/promises';
import path from 'path';
import type { ProjectConfig } from './project-config.js';
import { getDefaultConfig } from './project-config.js';

export interface DetectionResult {
  framework: string;
  language: string;
  features: string[];   // e.g. ['docker', 'inertia', 'vite', 'sail']
  config: Partial<ProjectConfig>;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath: string): Promise<any> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function hasDependency(projectRoot: string, file: string, dep: string): Promise<boolean> {
  const json = await readJsonFile(path.join(projectRoot, file));
  if (!json) return false;

  const allDeps = {
    ...json.dependencies,
    ...json.devDependencies,
    ...json.require,
    ...json['require-dev'],
  };
  return dep in (allDeps || {});
}

export async function detectProject(projectRoot: string): Promise<DetectionResult> {
  const features: string[] = [];

  // Check for Docker
  const hasDocker =
    (await fileExists(path.join(projectRoot, 'compose.yaml'))) ||
    (await fileExists(path.join(projectRoot, 'docker-compose.yml'))) ||
    (await fileExists(path.join(projectRoot, 'docker-compose.yaml'))) ||
    (await fileExists(path.join(projectRoot, 'Dockerfile')));
  if (hasDocker) features.push('docker');

  // ─── Laravel Detection ───────────────────────────────────────

  const hasComposer = await fileExists(path.join(projectRoot, 'composer.json'));
  if (hasComposer) {
    const isLaravel = await hasDependency(projectRoot, 'composer.json', 'laravel/framework');
    if (isLaravel) {
      features.push('laravel');

      const hasSail = await hasDependency(projectRoot, 'composer.json', 'laravel/sail');
      if (hasSail) features.push('sail');

      const hasInertia = await hasDependency(projectRoot, 'composer.json', 'inertiajs/inertia-laravel');
      if (hasInertia) features.push('inertia');

      const hasPackageJson = await fileExists(path.join(projectRoot, 'package.json'));
      if (hasPackageJson) {
        const hasVite = await hasDependency(projectRoot, 'package.json', 'vite');
        if (hasVite) features.push('vite');

        const hasReact = await hasDependency(projectRoot, 'package.json', 'react');
        if (hasReact) features.push('react');

        const hasVue = await hasDependency(projectRoot, 'package.json', 'vue');
        if (hasVue) features.push('vue');
      }

      return buildLaravelConfig(projectRoot, features);
    }
  }

  // ─── Node.js / React / Next.js / Vue / Svelte Detection ─────

  const hasPackageJson = await fileExists(path.join(projectRoot, 'package.json'));
  if (hasPackageJson) {
    const hasNext = await hasDependency(projectRoot, 'package.json', 'next');
    if (hasNext) {
      features.push('next');
      return buildNextConfig(projectRoot, features);
    }

    const hasNuxt = await hasDependency(projectRoot, 'package.json', 'nuxt');
    if (hasNuxt) {
      features.push('nuxt');
      return buildNodeConfig(projectRoot, 'Nuxt', features);
    }

    const hasSvelte = await hasDependency(projectRoot, 'package.json', 'svelte');
    if (hasSvelte) {
      features.push('svelte');
      return buildNodeConfig(projectRoot, 'SvelteKit', features);
    }

    const hasVue = await hasDependency(projectRoot, 'package.json', 'vue');
    if (hasVue) {
      features.push('vue');
      return buildNodeConfig(projectRoot, 'Vue', features);
    }

    const hasReact = await hasDependency(projectRoot, 'package.json', 'react');
    if (hasReact) {
      features.push('react');
      return buildNodeConfig(projectRoot, 'React', features);
    }

    const hasExpress = await hasDependency(projectRoot, 'package.json', 'express');
    if (hasExpress) {
      features.push('express');
      return buildNodeConfig(projectRoot, 'Express', features);
    }

    // Generic Node.js
    return buildNodeConfig(projectRoot, 'Node.js', features);
  }

  // ─── Python Detection ────────────────────────────────────────

  const hasPyproject = await fileExists(path.join(projectRoot, 'pyproject.toml'));
  const hasRequirements = await fileExists(path.join(projectRoot, 'requirements.txt'));

  if (hasPyproject || hasRequirements) {
    // Simple detection from pyproject.toml or requirements.txt
    let isDjango = false;
    let isFlask = false;
    let isFastAPI = false;

    if (hasRequirements) {
      try {
        const content = await readFile(path.join(projectRoot, 'requirements.txt'), 'utf-8');
        isDjango = /^django[>=<\s]/mi.test(content);
        isFlask = /^flask[>=<\s]/mi.test(content);
        isFastAPI = /^fastapi[>=<\s]/mi.test(content);
      } catch { /* ignore */ }
    }

    if (hasPyproject) {
      try {
        const content = await readFile(path.join(projectRoot, 'pyproject.toml'), 'utf-8');
        isDjango = isDjango || /django/i.test(content);
        isFlask = isFlask || /flask/i.test(content);
        isFastAPI = isFastAPI || /fastapi/i.test(content);
      } catch { /* ignore */ }
    }

    if (isDjango) {
      features.push('django');
      return buildPythonConfig(projectRoot, 'Django', features);
    }
    if (isFlask) {
      features.push('flask');
      return buildPythonConfig(projectRoot, 'Flask', features);
    }
    if (isFastAPI) {
      features.push('fastapi');
      return buildPythonConfig(projectRoot, 'FastAPI', features);
    }

    return buildPythonConfig(projectRoot, 'Python', features);
  }

  // ─── Ruby / Rails Detection ──────────────────────────────────

  const hasGemfile = await fileExists(path.join(projectRoot, 'Gemfile'));
  if (hasGemfile) {
    try {
      const content = await readFile(path.join(projectRoot, 'Gemfile'), 'utf-8');
      const isRails = /gem\s+['"]rails['"]/.test(content);
      if (isRails) {
        features.push('rails');
        return buildRailsConfig(projectRoot, features);
      }
    } catch { /* ignore */ }
    return buildRubyConfig(projectRoot, features);
  }

  // ─── Go Detection ────────────────────────────────────────────

  const hasGoMod = await fileExists(path.join(projectRoot, 'go.mod'));
  if (hasGoMod) {
    features.push('go');
    return buildGoConfig(projectRoot, features);
  }

  // ─── Fallback ────────────────────────────────────────────────

  return {
    framework: 'Unknown',
    language: 'unknown',
    features,
    config: getDefaultConfig(),
  };
}

// ─── Config Builders ─────────────────────────────────────────────

function buildLaravelConfig(projectRoot: string, features: string[]): DetectionResult {
  const hasSail = features.includes('sail');
  const hasDocker = features.includes('docker');

  const config: Partial<ProjectConfig> = {
    baseBranch: 'ai-develop',
    worktree: {
      symlinkDirs: ['vendor', 'node_modules'],
      copyFiles: ['.mcp.json', '.env'],
      preserveFiles: ['features.json', 'orchestrator-progress.txt'],
      setupScript: null,
      setupScriptName: hasSail ? 'sail-worktree' : 'run-worktree',
      dockerService: hasSail ? 'laravel.test' : (hasDocker ? 'app' : null),
      dockerWorkDir: hasDocker ? '/var/www/html/' : null,
      dockerComposeFile: 'compose.yaml',
    },
    criticalPatterns: [
      { pattern: 'ECONNREFUSED.*:8[0-9]{3}', label: 'Web server not running' },
      { pattern: 'php artisan.*failed|artisan.*error|php.*not found', label: 'PHP/Laravel not available' },
      { pattern: 'SQLSTATE|mysql.*refused|cannot connect.*database|Connection refused.*3306|Connection refused.*5432', label: 'Database not reachable' },
      { pattern: 'Cannot connect to the Docker daemon|docker.*not running', label: 'Docker not running' },
      { pattern: 'npm ERR!|node:.*MODULE_NOT_FOUND', label: 'Node/npm issue' },
      { pattern: 'ECONNREFUSED.*:5173|ECONNREFUSED.*:5174|Vite.*not running', label: 'Vite dev server not running' },
    ],
  };

  const frontend = features.includes('react') ? 'React' : features.includes('vue') ? 'Vue' : '';
  const inertia = features.includes('inertia') ? ' + Inertia.js' : '';
  const framework = `Laravel${inertia}${frontend ? ` + ${frontend}` : ''}`;

  return {
    framework,
    language: 'PHP',
    features,
    config,
  };
}

function buildNextConfig(_projectRoot: string, features: string[]): DetectionResult {
  const hasDocker = features.includes('docker');

  return {
    framework: 'Next.js',
    language: 'TypeScript/JavaScript',
    features,
    config: {
      baseBranch: 'ai-develop',
      worktree: {
        symlinkDirs: ['node_modules', '.next'],
        copyFiles: ['.mcp.json', '.env', '.env.local'],
        preserveFiles: ['features.json', 'orchestrator-progress.txt'],
        setupScript: null,
        setupScriptName: 'run-worktree',
        dockerService: hasDocker ? 'app' : null,
        dockerWorkDir: hasDocker ? '/app/' : null,
        dockerComposeFile: 'docker-compose.yml',
      },
      criticalPatterns: [
        { pattern: 'ECONNREFUSED.*:3000', label: 'Next.js dev server not running' },
        { pattern: 'npm ERR!|node:.*MODULE_NOT_FOUND', label: 'Node/npm issue' },
        { pattern: 'Cannot connect to the Docker daemon|docker.*not running', label: 'Docker not running' },
      ],
    },
  };
}

function buildNodeConfig(_projectRoot: string, framework: string, features: string[]): DetectionResult {
  return {
    framework,
    language: 'TypeScript/JavaScript',
    features,
    config: {
      baseBranch: 'ai-develop',
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
        { pattern: 'npm ERR!|node:.*MODULE_NOT_FOUND', label: 'Node/npm issue' },
        { pattern: 'ECONNREFUSED', label: 'Server not running' },
      ],
    },
  };
}

function buildPythonConfig(_projectRoot: string, framework: string, features: string[]): DetectionResult {
  const hasDocker = features.includes('docker');

  return {
    framework,
    language: 'Python',
    features,
    config: {
      baseBranch: 'ai-develop',
      worktree: {
        symlinkDirs: ['.venv', 'venv'],
        copyFiles: ['.mcp.json', '.env'],
        preserveFiles: ['features.json', 'orchestrator-progress.txt'],
        setupScript: null,
        setupScriptName: 'run-worktree',
        dockerService: hasDocker ? 'app' : null,
        dockerWorkDir: hasDocker ? '/app/' : null,
        dockerComposeFile: 'docker-compose.yml',
      },
      criticalPatterns: [
        { pattern: 'ModuleNotFoundError|ImportError', label: 'Python module not found' },
        { pattern: 'ECONNREFUSED', label: 'Server not running' },
        { pattern: 'Cannot connect to the Docker daemon|docker.*not running', label: 'Docker not running' },
      ],
    },
  };
}

function buildRailsConfig(_projectRoot: string, features: string[]): DetectionResult {
  const hasDocker = features.includes('docker');

  return {
    framework: 'Rails',
    language: 'Ruby',
    features,
    config: {
      baseBranch: 'ai-develop',
      worktree: {
        symlinkDirs: ['vendor/bundle', 'node_modules'],
        copyFiles: ['.mcp.json', '.env'],
        preserveFiles: ['features.json', 'orchestrator-progress.txt'],
        setupScript: null,
        setupScriptName: 'run-worktree',
        dockerService: hasDocker ? 'app' : null,
        dockerWorkDir: hasDocker ? '/app/' : null,
        dockerComposeFile: 'docker-compose.yml',
      },
      criticalPatterns: [
        { pattern: 'LoadError|Bundler::GemNotFound', label: 'Ruby gem not found' },
        { pattern: 'ECONNREFUSED.*:3000', label: 'Rails server not running' },
        { pattern: 'Cannot connect to the Docker daemon|docker.*not running', label: 'Docker not running' },
      ],
    },
  };
}

function buildRubyConfig(_projectRoot: string, features: string[]): DetectionResult {
  return {
    framework: 'Ruby',
    language: 'Ruby',
    features,
    config: {
      baseBranch: 'ai-develop',
      worktree: {
        symlinkDirs: ['vendor/bundle'],
        copyFiles: ['.mcp.json', '.env'],
        preserveFiles: ['features.json', 'orchestrator-progress.txt'],
        setupScript: null,
        setupScriptName: 'run-worktree',
        dockerService: null,
        dockerWorkDir: null,
        dockerComposeFile: null,
      },
    },
  };
}

function buildGoConfig(_projectRoot: string, features: string[]): DetectionResult {
  const hasDocker = features.includes('docker');

  return {
    framework: 'Go',
    language: 'Go',
    features,
    config: {
      baseBranch: 'ai-develop',
      worktree: {
        symlinkDirs: [],
        copyFiles: ['.mcp.json', '.env'],
        preserveFiles: ['features.json', 'orchestrator-progress.txt'],
        setupScript: null,
        setupScriptName: 'run-worktree',
        dockerService: hasDocker ? 'app' : null,
        dockerWorkDir: hasDocker ? '/app/' : null,
        dockerComposeFile: 'docker-compose.yml',
      },
      criticalPatterns: [
        { pattern: 'ECONNREFUSED', label: 'Server not running' },
        { pattern: 'Cannot connect to the Docker daemon|docker.*not running', label: 'Docker not running' },
      ],
    },
  };
}
