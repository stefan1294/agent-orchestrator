import { exec as execCb } from 'child_process';
import * as readline from 'readline';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import type { ProjectConfig } from './project-config.js';

const exec = promisify(execCb);

type AgentName = 'claude' | 'codex' | 'gemini';

function askUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

/**
 * Check if the Chrome DevTools MCP server is registered for a given agent.
 */
async function isMcpInstalled(agent: AgentName, serverName: string, config: ProjectConfig): Promise<boolean> {
  const command = getAgentCommand(agent, config);
  try {
    const { stdout } = await exec(`${command} mcp list`, { timeout: 15000 });
    return stdout.includes(serverName);
  } catch {
    return false;
  }
}

/**
 * Get the CLI command name for an agent from config.
 */
function getAgentCommand(agent: AgentName, config: ProjectConfig): string {
  switch (agent) {
    case 'claude': return config.agent.claudeCommand || 'claude';
    case 'codex': return config.agent.codexCommand || 'codex';
    case 'gemini': return config.agent.geminiCommand || 'gemini';
  }
}

/**
 * Build the install command for registering the MCP server with a given agent.
 */
function buildInstallCommand(agent: AgentName, config: ProjectConfig): string {
  const command = getAgentCommand(agent, config);
  const serverName = config.browser.mcpServerName;
  const mcpPackage = config.browser.mcpPackage;
  const mcpArgs = config.browser.mcpArgs;

  const npxArgs = ['npx', '-y', mcpPackage, ...mcpArgs].join(' ');

  switch (agent) {
    case 'claude':
      return `${command} mcp add ${serverName} --scope user -- ${npxArgs}`;
    case 'codex':
      return `${command} mcp add ${serverName} -- ${npxArgs}`;
    case 'gemini':
      return `${command} mcp add -s user ${serverName} -- ${npxArgs}`;
  }
}

/**
 * Attempt to install the MCP server for a given agent, prompting the user first.
 * Returns true if the MCP is installed after this function completes.
 */
async function ensureMcpForAgent(agent: AgentName, config: ProjectConfig): Promise<boolean> {
  const serverName = config.browser.mcpServerName;

  // Check if already installed
  if (await isMcpInstalled(agent, serverName, config)) {
    logger.info(`Chrome DevTools MCP already installed for ${agent}`);
    return true;
  }

  // Prompt user
  const answer = await askUser(
    `Chrome DevTools MCP is not installed for ${agent}. Install it? (y/n) `
  );

  if (answer !== 'y' && answer !== 'yes') {
    logger.info(`User declined MCP install for ${agent}`);
    return false;
  }

  // Run install command
  const installCmd = buildInstallCommand(agent, config);
  logger.info(`Installing Chrome DevTools MCP for ${agent}: ${installCmd}`);

  try {
    await exec(installCmd, { timeout: 30000 });
    logger.info(`Chrome DevTools MCP installed for ${agent}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to install Chrome DevTools MCP for ${agent}: ${msg}`);
    return false;
  }
}

/**
 * Run the browser preflight check for all configured agents.
 *
 * For each active agent (preferred + fallbacks), checks if the Chrome DevTools
 * MCP server is registered and offers to install it if missing.
 *
 * Returns true if ALL configured agents have the MCP installed.
 * Returns false if any agent is missing it (since any agent could be used for verification).
 */
export async function runBrowserPreflight(config: ProjectConfig): Promise<boolean> {
  const agents: AgentName[] = [config.agent.preferred];

  for (const fallback of config.agent.fallbackAgents) {
    if (['claude', 'codex', 'gemini'].includes(fallback) && fallback !== config.agent.preferred) {
      agents.push(fallback as AgentName);
    }
  }

  let allInstalled = true;

  for (const agent of agents) {
    const installed = await ensureMcpForAgent(agent, config);
    if (!installed) {
      allInstalled = false;
    }
  }

  return allInstalled;
}
