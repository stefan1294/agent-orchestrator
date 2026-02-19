import { readFile, writeFile, unlink } from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import type { ProjectConfig } from './project-config.js';

interface McpServerEntry {
  type: string;
  command: string;
  args: string[];
}

interface McpJsonFile {
  mcpServers: Record<string, McpServerEntry>;
}

function mcpJsonPath(projectRoot: string): string {
  return path.join(projectRoot, '.mcp.json');
}

async function readMcpJson(projectRoot: string): Promise<McpJsonFile> {
  try {
    const content = await readFile(mcpJsonPath(projectRoot), 'utf-8');
    return JSON.parse(content) as McpJsonFile;
  } catch {
    return { mcpServers: {} };
  }
}

async function writeMcpJson(projectRoot: string, data: McpJsonFile): Promise<void> {
  await writeFile(mcpJsonPath(projectRoot), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Add the browser MCP entry to the project's .mcp.json.
 * Preserves any existing entries. Creates the file if it doesn't exist.
 */
export async function addBrowserMcpToProject(projectRoot: string, config: ProjectConfig): Promise<void> {
  const serverName = config.browser.mcpServerName;
  const data = await readMcpJson(projectRoot);

  data.mcpServers[serverName] = {
    type: 'stdio',
    command: 'npx',
    args: ['-y', config.browser.mcpPackage, ...config.browser.mcpArgs],
  };

  await writeMcpJson(projectRoot, data);
  logger.info(`Added '${serverName}' to .mcp.json`);
}

/**
 * Remove the browser MCP entry from the project's .mcp.json.
 * Preserves other entries. If no entries remain, deletes the file.
 */
export async function removeBrowserMcpFromProject(projectRoot: string, config: ProjectConfig): Promise<void> {
  const serverName = config.browser.mcpServerName;
  const data = await readMcpJson(projectRoot);

  if (!(serverName in data.mcpServers)) {
    return; // nothing to remove
  }

  delete data.mcpServers[serverName];

  if (Object.keys(data.mcpServers).length === 0) {
    try {
      await unlink(mcpJsonPath(projectRoot));
      logger.info(`Removed .mcp.json (no entries remaining)`);
    } catch {
      // file didn't exist, that's fine
    }
  } else {
    await writeMcpJson(projectRoot, data);
    logger.info(`Removed '${serverName}' from .mcp.json`);
  }
}

/**
 * Check if the browser MCP entry exists in the project's .mcp.json.
 */
export async function isBrowserMcpInProject(projectRoot: string, config: ProjectConfig): Promise<boolean> {
  const data = await readMcpJson(projectRoot);
  return config.browser.mcpServerName in data.mcpServers;
}
