import { spawn, exec as execCb } from 'child_process';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import * as readline from 'readline';
import { promisify } from 'util';
import type { Server } from 'socket.io';
import type { Feature, AgentMessage } from '../types.js';
import { logger } from '../utils/logger.js';
import type { ProjectConfig } from './project-config.js';

const exec = promisify(execCb);

interface ExecutionResult {
  success: boolean;
  output: string;
  messages: AgentMessage[];
  error?: string;
  stderr?: string;
  analysisOutput?: string;
  analysisError?: string;
  agentUsed?: AgentName;
}

type AgentName = 'claude' | 'codex' | 'gemini';

interface AgentAttemptResult extends ExecutionResult {
  exitCode?: number | null;
}

export class AgentExecutor {
  private projectRoot: string;
  private io: Server;
  private config: ProjectConfig;

  constructor(projectRoot: string, io: Server, config: ProjectConfig) {
    this.projectRoot = projectRoot;
    this.io = io;
    this.config = config;
  }

  async executeSession(
    sessionId: string,
    feature: Feature,
    track: string,
    isRetry: boolean,
    extraContext?: string,
    workingDir?: string,
    shouldStop?: () => boolean
  ): Promise<ExecutionResult> {
    const cwd = workingDir || this.projectRoot;
    logger.info(`[${sessionId}] Starting execution for feature: ${feature.name} (cwd: ${cwd})`);

    const basePrompt = this.buildPrompt(feature, isRetry, extraContext, cwd);
    logger.debug(`[${sessionId}] Prompt: ${basePrompt}`);

    const combinedMessages: AgentMessage[] = [];
    let combinedOutput = '';
    let combinedStderr = '';
    let lastError: string | undefined;
    let lastAttemptOutput = '';
    let lastAttemptError: string | undefined;
    const preferredAgent = this.getPreferredAgent();
    const agentFallbackOrder = this.getAgentFallbackOrder();
    const rateLimitWaitMs = this.getRateLimitWaitMs();
    const rateLimitedAgents = new Set<AgentName>();
    let lastRateLimitedAgent: AgentName | null = null;

    try {
      let currentAgent: AgentName = preferredAgent;
      let currentPrompt: string = basePrompt;
      let lastAgentUsed: AgentName = currentAgent;

      while (true) {
        if (shouldStop?.()) {
          const stopMessage = 'Stopped by user';
          logger.warn(`[${sessionId}] ${stopMessage}`);
          return {
            success: false,
            output: combinedOutput,
            messages: combinedMessages,
            error: stopMessage,
            stderr: combinedStderr,
            agentUsed: lastAgentUsed,
          };
        }

        logger.info(`[${sessionId}] Starting agent run with ${currentAgent}`);
        const startMessage: AgentMessage = {
          type: 'system',
          timestamp: new Date().toISOString(),
          agent: currentAgent,
          content: `Agent run started: ${currentAgent}`,
        };
        combinedMessages.push(startMessage);
        this.io.emit('agent:output', { sessionId, message: startMessage });

        const attempt = await this.spawnAgentProcess(
          currentAgent,
          sessionId,
          currentPrompt,
          cwd,
          shouldStop
        );

        lastAgentUsed = currentAgent;
        lastAttemptOutput = attempt.output;
        lastAttemptError = attempt.error;
        combinedOutput += `\n[${currentAgent} output]\n${attempt.output}`;
        if (attempt.stderr) {
          combinedOutput += `\n[${currentAgent} stderr]\n${attempt.stderr}`;
        }
        combinedStderr += attempt.stderr || '';
        combinedMessages.push(...attempt.messages);
        lastError = attempt.error;

        if (attempt.success) {
          return {
            success: true,
            output: combinedOutput,
            messages: combinedMessages,
            stderr: combinedStderr,
            analysisOutput: lastAttemptOutput,
            agentUsed: lastAgentUsed,
          };
        }

        if (this.isAgentUnavailable(attempt)) {
          logger.warn(`[${sessionId}] ${currentAgent} not available: ${attempt.error || 'unknown error'}`);

          // Try next available agent in fallback order
          const nextAgent = agentFallbackOrder.find(a => a !== currentAgent && !rateLimitedAgents.has(a));
          if (nextAgent) {
            const previousAgent = currentAgent;
            currentAgent = nextAgent;
            const switchMessage: AgentMessage = {
              type: 'system',
              timestamp: new Date().toISOString(),
              agent: currentAgent,
              content: `Agent switch: ${previousAgent} -> ${currentAgent} (unavailable)`,
            };
            combinedMessages.push(switchMessage);
            this.io.emit('agent:output', { sessionId, message: switchMessage });
            continue;
          }

          // All agents unavailable but some were rate-limited — wait and retry preferred
          if (lastRateLimitedAgent) {
            logger.warn(`[${sessionId}] Waiting before retrying ${preferredAgent} due to rate limit`);
            const waitResult = await this.waitWithStop(rateLimitWaitMs, shouldStop, sessionId);
            if (!waitResult) {
              return {
                success: false,
                output: combinedOutput,
                messages: combinedMessages,
                error: 'Stopped by user',
                stderr: combinedStderr,
                analysisOutput: lastAttemptOutput,
                analysisError: lastAttemptError,
                agentUsed: lastAgentUsed,
              };
            }
            rateLimitedAgents.clear();
            lastRateLimitedAgent = null;
            currentAgent = preferredAgent;
            continue;
          }

          return {
            success: false,
            output: combinedOutput,
            messages: combinedMessages,
            error: attempt.error || 'Agent command unavailable',
            stderr: combinedStderr,
            analysisOutput: lastAttemptOutput,
            analysisError: lastAttemptError,
            agentUsed: lastAgentUsed,
          };
        }

        if (this.isRateLimitError(attempt, currentAgent)) {
          logger.warn(`[${sessionId}] Rate limit detected for ${currentAgent}`);
          rateLimitedAgents.add(currentAgent);
          lastRateLimitedAgent = currentAgent;

          // Try the next agent that isn't rate-limited
          const nextAgent = agentFallbackOrder.find(a => !rateLimitedAgents.has(a));
          if (nextAgent) {
            const previousAgent = currentAgent;
            currentAgent = nextAgent;
            const repoContext = await this.getRepoContext(cwd);
            currentPrompt = this.buildPromptWithContext(basePrompt, lastAttemptOutput, lastAttemptError, repoContext);
            const switchMessage: AgentMessage = {
              type: 'system',
              timestamp: new Date().toISOString(),
              agent: currentAgent,
              content: `Agent switch: ${previousAgent} -> ${currentAgent} (rate limit)`,
            };
            combinedMessages.push(switchMessage);
            this.io.emit('agent:output', { sessionId, message: switchMessage });
            logger.warn(`[${sessionId}] Switching to ${currentAgent}`);
            continue;
          }

          // All agents rate-limited — wait and reset
          logger.warn(
            `[${sessionId}] All agents rate-limited. Waiting ${Math.round(rateLimitWaitMs / 60000)} minutes before retry.`
          );
          const waitResult = await this.waitWithStop(rateLimitWaitMs, shouldStop, sessionId);
          if (!waitResult) {
            return {
              success: false,
              output: combinedOutput,
              messages: combinedMessages,
              error: 'Stopped by user',
              stderr: combinedStderr,
              analysisOutput: lastAttemptOutput,
              analysisError: lastAttemptError,
              agentUsed: lastAgentUsed,
            };
          }
          rateLimitedAgents.clear();
          currentAgent = preferredAgent;
          continue;
        }

        return {
          success: false,
          output: combinedOutput,
          messages: combinedMessages,
          error: lastError || 'Agent execution failed',
          stderr: combinedStderr,
          analysisOutput: lastAttemptOutput,
          analysisError: lastAttemptError,
          agentUsed: lastAgentUsed,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[${sessionId}] Error during execution: ${errorMessage}`);

      return {
        success: false,
        output: combinedOutput,
        messages: combinedMessages,
        error: errorMessage,
        stderr: combinedStderr,
        analysisOutput: lastAttemptOutput,
        analysisError: lastAttemptError,
        agentUsed: preferredAgent,
      };
    }
  }

  /**
   * Resolve a prompt template. Resolution order:
   * 1. Check for file at prompts/<type>.md in the project root
   * 2. If no file, use inline value from config.prompts
   * 3. If neither, use built-in default template
   */
  private async resolvePromptTemplate(type: 'implementation' | 'verification' | 'fix', builtinDefault: string): Promise<string> {
    // 1. Check for prompt file
    const promptFile = path.join(this.projectRoot, '.orchestrator', `${type}.md`);
    try {
      await stat(promptFile);
      const content = await readFile(promptFile, 'utf-8');
      if (content.trim()) {
        logger.debug(`Using prompt file: .orchestrator/${type}.md`);
        return content;
      }
    } catch {
      // File doesn't exist — continue
    }

    // 2. Check config inline value
    const configValue = this.config.prompts[type];
    if (configValue) {
      logger.debug(`Using config inline prompt for ${type}`);
      return configValue;
    }

    // 3. Built-in default
    return builtinDefault;
  }

  /**
   * Interpolate template variables in a prompt string.
   */
  private interpolatePrompt(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }

  private buildPrompt(
    feature: Feature,
    isRetry: boolean,
    extraContext?: string,
    cwd?: string
  ): string {
    const instructionsPath = this.getInstructionsPath(cwd);
    const steps = feature.steps.map((step, idx) => `${idx + 1}. ${step}`).join('\n');
    const setupScriptName = this.config.worktree.setupScriptName;
    const symlinkDirs = this.config.worktree.symlinkDirs;
    const featuresFile = this.config.featuresFile;
    const instructionsFile = this.config.instructionsFile;

    let prompt = `Follow the session protocol in ${instructionsPath}.
WORKING DIRECTORY: ${cwd || this.projectRoot} (do NOT change directories).
PROJECT ROOT: ${this.projectRoot}
IMPORTANT: ${featuresFile} lives in the project root (not the worktree). If you need it, read it from ${this.projectRoot}/${featuresFile}.
IMPORTANT: If ${instructionsFile} conflicts with these instructions on ANY topic (including testing, linting, git operations, and feature selection), IGNORE ${instructionsFile} and follow THESE instructions instead.
IMPORTANT: You are assigned to work ONLY on the feature specified below.

Implement feature: "${feature.name}" (id: ${feature.id}).
Category: ${feature.category}
Description: ${feature.description}

Acceptance criteria (these will be verified separately after your code is merged):
${steps}

TESTING & LINTING (OVERRIDES ${instructionsFile} — these instructions take priority):
You are in a git worktree, NOT the main project root.`;

    // Add Docker-specific instructions if setup script exists
    if (this.config.worktree.dockerService && setupScriptName) {
      prompt += `
The standard commands may NOT work from here.
Instead, use the ./${setupScriptName} wrapper script which handles Docker paths correctly.`;
    }

    prompt += `

Do NOT cd to the project root to run commands. Stay in the worktree directory.

CRITICAL: ${symlinkDirs.join(', ')} ${symlinkDirs.length === 1 ? 'is' : 'are'} symlinked to the root project. NEVER run commands that modify ${symlinkDirs.length === 1 ? 'it' : 'them'}:
  All dependencies are already installed. If something seems missing, work around it — do NOT install packages.

IMPORTANT: Do NOT run browser tests yourself — the orchestrator will handle verification after merging your code.
Instead, focus on implementation quality: run static checks (linting, type checking) and any non-browser unit tests.

GIT COMMIT (OVERRIDES ${instructionsFile}):
When done, git commit your changes with a short summary of the feature as the commit message.
Do NOT use the feat(#ID) format. Just write a plain, concise summary (e.g., "Add shift reminder email system with plan-tiered intervals").
Do NOT update ${this.config.progressFile} — the orchestrator handles progress tracking automatically.`;

    if (isRetry && extraContext) {
      prompt = `${extraContext}\n\n${prompt}`;
    }

    return prompt;
  }

  private getInstructionsPath(cwd?: string): string {
    const base = this.projectRoot;
    const target = path.join(base, this.config.instructionsFile);
    if (!cwd) return this.config.instructionsFile;
    const rel = path.relative(cwd, target);
    return rel || this.config.instructionsFile;
  }

  private buildPromptWithContext(
    basePrompt: string,
    lastOutput: string,
    lastError?: string,
    repoContext?: string
  ): string {
    const outputTail = lastOutput ? lastOutput.slice(-6000) : '';
    const errorTail = lastError ? lastError.slice(-1000) : '';
    const contextParts: string[] = [];
    contextParts.push('CONTEXT FROM PREVIOUS AGENT RUN (most recent):');
    if (errorTail) {
      contextParts.push(`Error:\n${errorTail}`);
    }
    if (outputTail) {
      contextParts.push(`Output (tail):\n${outputTail}`);
    }
    if (repoContext) {
      contextParts.push(`Repo state:\n${repoContext}`);
    }
    contextParts.push('Use this context to continue without repeating work.');
    return `${contextParts.join('\n\n')}\n\n${basePrompt}`;
  }

  private async getRepoContext(cwd: string): Promise<string> {
    const sections: string[] = [];
    try {
      const status = (await exec('git status --porcelain', { cwd })).stdout.trim();
      sections.push(`git status --porcelain:\n${status || '(clean)'}`);
    } catch (err) {
      sections.push(`git status --porcelain: failed (${String(err)})`);
    }

    try {
      const diffStat = (await exec('git diff --stat', { cwd })).stdout.trim();
      sections.push(`git diff --stat:\n${diffStat || '(no diff)'}`);
    } catch (err) {
      sections.push(`git diff --stat: failed (${String(err)})`);
    }

    try {
      const log = (await exec('git log -1 --oneline', { cwd })).stdout.trim();
      sections.push(`git log -1 --oneline:\n${log || '(no commits)'}`);
    } catch (err) {
      sections.push(`git log -1 --oneline: failed (${String(err)})`);
    }

    const combined = sections.join('\n\n');
    return combined.length > 3000 ? combined.slice(0, 3000) + '\n...[truncated]' : combined;
  }

  private spawnAgentProcess(
    agent: AgentName,
    sessionId: string,
    prompt: string,
    cwd: string,
    shouldStop?: () => boolean
  ): Promise<AgentAttemptResult> {
    return new Promise((resolve) => {
      const { command, args } = this.getAgentCommand(agent, prompt);

      // Augment PATH so agent can find project-local binaries
      const pathDirs: string[] = [];
      for (const dir of this.config.worktree.symlinkDirs) {
        // Add common bin subdirectories for each symlinked dir
        const binSuffix = dir === 'vendor' ? 'bin' : dir === 'node_modules' ? '.bin' : 'bin';
        pathDirs.push(path.join(cwd, dir, binSuffix));
        pathDirs.push(path.join(this.projectRoot, dir, binSuffix));
      }
      pathDirs.push(process.env.PATH || '');
      const augmentedPath = pathDirs.join(':');

      const proc = spawn(command, args, {
        cwd,
        env: { ...process.env, PATH: augmentedPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const messages: AgentMessage[] = [];
      let rawOutput = '';
      let stderr = '';

      const rl = readline.createInterface({
        input: proc.stdout!,
        crlfDelay: Infinity,
      });

      let stopInterval: NodeJS.Timeout | null = null;
      if (shouldStop) {
        stopInterval = setInterval(() => {
          if (shouldStop() && !proc.killed) {
            logger.warn(`[${sessionId}] Stop requested — terminating ${agent} process`);
            proc.kill('SIGTERM');
            setTimeout(() => {
              if (!proc.killed) {
                proc.kill('SIGKILL');
              }
            }, 2000);
          }
        }, 500);
      }

      proc.stderr!.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        logger.debug(`[${sessionId}] stderr: ${chunk}`);
      });

      rl.on('line', (line) => {
        rawOutput += line + '\n';

        if (line.trim() === '') {
          return;
        }

        try {
          const parsed = JSON.parse(line);
          const parsedMessages = this.parseAgentMessage(parsed, agent);

          for (const message of parsedMessages) {
            messages.push(message);
            this.io.emit('agent:output', { sessionId, message });

            // Log key events
            if (message.type === 'tool_use') {
              logger.info(
                `[${sessionId}] Tool call: ${message.tool_name}`
              );
            } else if (message.type === 'assistant') {
              if (message.content) {
                logger.debug(
                  `[${sessionId}] Assistant message: ${message.content.substring(0, 100)}...`
                );
              }
            }
          }
        } catch (parseError) {
          // Skip non-JSON lines
          const fallbackMessage: AgentMessage = {
            type: 'assistant',
            timestamp: new Date().toISOString(),
            agent,
            content: line,
            raw: line,
          };
          messages.push(fallbackMessage);
          this.io.emit('agent:output', { sessionId, message: fallbackMessage });
          logger.debug(`[${sessionId}] Captured non-JSON line: ${line.substring(0, 50)}`);
        }
      });

      rl.on('close', () => {
        // Process has finished reading stdout
      });

      proc.on('exit', (code) => {
        if (stopInterval) clearInterval(stopInterval);
        logger.info(
          `[${sessionId}] ${agent} process exited with code: ${code}`
        );

        if (stderr) {
          logger.error(`[${sessionId}] Process stderr: ${stderr}`);
        }

        const result: AgentAttemptResult = {
          success: code === 0,
          output: rawOutput,
          messages,
          error: code === 0 ? undefined : `Process exited with code ${code}`,
          stderr,
          exitCode: code,
        };

        resolve(result);
      });

      proc.on('error', (error) => {
        if (stopInterval) clearInterval(stopInterval);
        logger.error(`[${sessionId}] Process error: ${error.message}`);
        const result: AgentAttemptResult = {
          success: false,
          output: rawOutput,
          messages,
          error: error.message,
          stderr,
          exitCode: null,
        };
        resolve(result);
      });
    });
  }

  private getPreferredAgent(): AgentName {
    const pref = this.config.agent.preferred;
    if (pref === 'codex' || pref === 'gemini') return pref;
    return 'claude';
  }

  /**
   * Get the ordered list of agents to try on rate limit.
   * Preferred agent first, then configured fallback agents.
   * If fallbackAgents is empty, only the preferred agent is used (no fallback).
   */
  private getAgentFallbackOrder(): AgentName[] {
    const preferred = this.getPreferredAgent();
    const validAgents: AgentName[] = ['claude', 'codex', 'gemini'];
    const fallbacks = (this.config.agent.fallbackAgents || [])
      .filter((a): a is AgentName => validAgents.includes(a as AgentName) && a !== preferred);
    return [preferred, ...fallbacks];
  }

  private getRateLimitWaitMs(): number {
    const ms = this.config.agent.rateLimitWaitMs;
    return Number.isFinite(ms) && ms > 0 ? ms : 600000;
  }

  private parseArgs(raw: string): string[] | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry));
      }
    } catch {
      // fall through to whitespace split
    }
    return raw.split(/\s+/).filter(Boolean);
  }

  private getAgentCommand(agent: AgentName, prompt: string): { command: string; args: string[] } {
    if (agent === 'codex') {
      const command = this.config.agent.codexCommand || 'codex';
      const customArgs = this.parseArgs(this.config.agent.codexArgs);
      const defaultArgs = [
        '--no-alt-screen',
        'exec',
        '--full-auto',
        '--json',
        '{{PROMPT}}',
      ];
      const args = this.applyPromptToArgs(customArgs ?? defaultArgs, prompt);
      return { command, args };
    }

    if (agent === 'gemini') {
      // Gemini CLI support is experimental and not tested.
      // Uses -p for headless mode and stream-json for JSONL output.
      const command = this.config.agent.geminiCommand || 'gemini';
      const customArgs = this.parseArgs(this.config.agent.geminiArgs);
      const defaultArgs = [
        '-p',
        '{{PROMPT}}',
        '--output-format',
        'stream-json',
        '--yolo',
      ];
      const args = this.applyPromptToArgs(customArgs ?? defaultArgs, prompt);
      return { command, args };
    }

    const command = this.config.agent.claudeCommand || 'claude';
    const customArgs = this.parseArgs(this.config.agent.claudeArgs);
    const maxTurns = String(this.config.agent.maxTurnsImplementation);
    const allowedTools = this.config.agent.allowedTools;
    const defaultArgs = [
      '-p',
      prompt,
      '--verbose',
      '--max-turns',
      maxTurns,
      '--output-format',
      'stream-json',
      '--allowedTools',
      allowedTools,
    ];
    const args = this.applyPromptToArgs(customArgs ?? defaultArgs, prompt);
    return { command, args };
  }

  /**
   * Get CLI command for verification-only agent.
   * Uses restricted tools (no Edit) so the agent can only observe and report.
   */
  private getVerificationAgentCommand(agent: AgentName, prompt: string): { command: string; args: string[] } {
    if (agent === 'codex' || agent === 'gemini') {
      return this.getAgentCommand(agent, prompt);
    }

    const command = this.config.agent.claudeCommand || 'claude';
    const maxTurns = String(this.config.agent.maxTurnsVerification);
    const allowedTools = this.config.agent.allowedToolsVerification;
    const args = [
      '-p',
      prompt,
      '--verbose',
      '--max-turns',
      maxTurns,
      '--output-format',
      'stream-json',
      '--allowedTools',
      allowedTools,
    ];
    return { command, args };
  }

  private applyPromptToArgs(args: string[], prompt: string): string[] {
    const replaced = args.map((arg) => arg.replace(/\{\{PROMPT\}\}/g, prompt));
    const hasPrompt = replaced.some((arg) => arg.includes(prompt));
    if (hasPrompt) {
      return replaced;
    }
    return [...replaced, prompt];
  }

  private isRateLimitError(result: AgentAttemptResult, agent: AgentName): boolean {
    if (result.exitCode === 0) return false;

    const combined = `${result.output}\n${result.stderr || ''}\n${result.error || ''}`;
    const rateSignals: RegExp[] = [
      /rate limit/i,
      /too many requests/i,
      /429\b/i,
      /quota/i,
      /exceeded.*quota/i,
      /usage limit/i,
      /limit.*reached/i,
      /hit your limit/i,
      /usage exceeded/i,
      /token limit/i,
      /requests?.*limit/i,
      /overloaded/i,
      /capacity/i,
      /temporarily unavailable/i,
      /try again later/i,
    ];
    const matchesRateSignal = rateSignals.some((pattern) => pattern.test(combined));

    if (agent === 'claude') {
      return matchesRateSignal || /anthropic|claude/i.test(combined);
    }

    if (agent === 'gemini') {
      return matchesRateSignal || /google|gemini/i.test(combined);
    }

    // Codex: be stricter to avoid false positives
    const matchesAgent = /openai|codex|oai/i.test(combined);
    const has429 = /429\b/.test(combined);
    return matchesRateSignal && (matchesAgent || has429);
  }

  private isAgentUnavailable(result: AgentAttemptResult): boolean {
    const combined = `${result.error || ''}\n${result.stderr || ''}`;
    return /ENOENT|not found|No such file or directory|command not found/i.test(combined);
  }

  private async waitWithStop(ms: number, shouldStop: (() => boolean) | undefined, sessionId: string): Promise<boolean> {
    const interval = 5000;
    let remaining = ms;
    while (remaining > 0) {
      if (shouldStop?.()) {
        logger.warn(`[${sessionId}] Stop requested during rate limit wait`);
        return false;
      }
      const sleepMs = Math.min(interval, remaining);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
      remaining -= sleepMs;
    }
    return true;
  }

  /**
   * Parse a single line of verbose stream-json output into AgentMessage(s).
   *
   * Verbose stream-json format:
   *   {"type":"system","subtype":"init","session_id":"...","tools":[...]}
   *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."},{"type":"tool_use","name":"Edit","input":{...}}]}}
   *   {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]}}
   *   {"type":"result","subtype":"success","result":"...","cost_usd":0.123}
   */
  private parseAgentMessage(raw: any, agent?: AgentName): AgentMessage[] {
    if (!raw || !raw.type) {
      return [];
    }

    const timestamp = new Date().toISOString();
    const results: AgentMessage[] = [];

    const extractTextBlocks = (value: any): string[] => {
      if (!value) return [];
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) {
        return value.flatMap((entry) => extractTextBlocks(entry));
      }
      if (typeof value === 'object') {
        if (typeof value.text === 'string') return [value.text];
        if (typeof value.output_text === 'string') return [value.output_text];
        if (typeof value.delta === 'string') return [value.delta];
        if (typeof value.message === 'string') return [value.message];
        if (typeof value.content === 'string') return [value.content];
        if (Array.isArray(value.content)) return extractTextBlocks(value.content);
        if (value.item) return extractTextBlocks(value.item);
        if (value.data) return extractTextBlocks(value.data);
      }
      return [];
    };

    // Handle verbose format: type=assistant with message.content array
    if (raw.type === 'assistant' && raw.message?.content && Array.isArray(raw.message.content)) {
      for (const block of raw.message.content) {
        if (block.type === 'text' && block.text) {
          results.push({
            type: 'assistant',
            timestamp,
            agent,
            content: block.text,
          });
        } else if (block.type === 'tool_use') {
          results.push({
            type: 'tool_use',
            timestamp,
            agent,
            tool_name: block.name,
            tool_input: block.input,
          });
        }
      }
      if (results.length > 0) return results;
    }

    // Handle verbose format: type=user with tool_result blocks
    if (raw.type === 'user' && raw.message?.content && Array.isArray(raw.message.content)) {
      for (const block of raw.message.content) {
        if (block.type === 'tool_result') {
          const content = block.content;
          let resultText: string;
          if (typeof content === 'string') {
            resultText = content;
          } else if (Array.isArray(content)) {
            // Content can be an array of text blocks
            resultText = content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n');
          } else {
            resultText = JSON.stringify(content);
          }
          results.push({
            type: 'tool_result',
            timestamp,
            agent,
            tool_result: resultText,
          });
        }
      }
      if (results.length > 0) return results;
    }

    // Handle verbose format: type=result (final result)
    if (raw.type === 'result') {
      return [{
        type: 'result',
        timestamp,
        agent,
        content: raw.result || (raw.subtype === 'success' ? 'Completed successfully' : `Ended: ${raw.subtype}`),
      }];
    }

    // Handle verbose format: type=system (init info)
    if (raw.type === 'system') {
      return [{
        type: 'system',
        timestamp,
        agent,
        content: raw.subtype || 'system',
      }];
    }

    // Legacy non-verbose format: type=message with content array
    if (raw.type === 'message' && raw.content && Array.isArray(raw.content)) {
      for (const block of raw.content) {
        if (block.type === 'text' && block.text) {
          results.push({ type: 'assistant', timestamp, agent, content: block.text });
        } else if (block.type === 'tool_use') {
          results.push({ type: 'tool_use', timestamp, agent, tool_name: block.name, tool_input: block.input });
        }
      }
      if (results.length > 0) return results;
    }

    // Legacy: direct tool_result
    if (raw.type === 'tool_result') {
      return [{
        type: 'tool_result',
        timestamp,
        agent,
        tool_result: typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content),
      }];
    }

    // Codex JSONL: use item.* events as readable system updates
    if (typeof raw.type === 'string' && raw.type.startsWith('item.')) {
      const itemText = extractTextBlocks(raw.item);
      if (itemText.length > 0) {
        return itemText.map((text) => ({
          type: 'assistant',
          timestamp,
          agent,
          content: text,
        }));
      }
      return [{
        type: 'system',
        timestamp,
        agent,
        content: raw.type,
      }];
    }

    // Codex JSONL: message content is often in `message` or `content`
    if (raw.message && typeof raw.message === 'string') {
      return [{
        type: 'assistant',
        timestamp,
        agent,
        content: raw.message,
      }];
    }

    if (raw.content && typeof raw.content === 'string') {
      return [{
        type: 'assistant',
        timestamp,
        agent,
        content: raw.content,
      }];
    }

    if (raw.delta && typeof raw.delta === 'string') {
      return [{
        type: 'assistant',
        timestamp,
        agent,
        content: raw.delta,
      }];
    }

    if (raw.message && Array.isArray(raw.message.content)) {
      const textBlocks = extractTextBlocks(raw.message.content);
      if (textBlocks.length > 0) {
        return textBlocks.map((text) => ({
          type: 'assistant',
          timestamp,
          agent,
          content: text,
        }));
      }
    }

    if (raw.content && Array.isArray(raw.content)) {
      const textBlocks = extractTextBlocks(raw.content);
      if (textBlocks.length > 0) {
        return textBlocks.map((text) => ({
          type: 'assistant',
          timestamp,
          agent,
          content: text,
        }));
      }
    }

    // Fallback: capture whatever we got
    return [{
      type: raw.type,
      timestamp,
      agent,
      content: raw.content
        ? (typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content))
        : undefined,
    }];
  }

  // ─── Verification Phase ──────────────────────────────────────────

  /**
   * Build a verification-only prompt. The agent will verify the feature
   * against the live app (which now has the merged code) in the main project root.
   */
  buildVerificationPrompt(feature: Feature): string {
    const steps = feature.steps.map((step, idx) => `${idx + 1}. ${step}`).join('\n');
    const appUrl = this.config.appUrl || 'http://localhost:3000';
    const browserEnabled = this.config.browser.enabled;

    let verificationApproach: string;

    if (browserEnabled) {
      verificationApproach = `VERIFICATION APPROACH:
- You have Chrome DevTools MCP tools available: navigate, click, fill, type, screenshot, evaluate, and more.
- Use browser tools for UI verification: navigate to pages, check elements, fill forms, click buttons, take screenshots.
- Use Bash commands for backend verification: curl API calls, database queries, CLI commands, running tests.
- If verification steps include login credentials or authentication, use the browser tools to log in first before verifying authenticated pages.
- Be thorough but efficient — combine browser and CLI verification as appropriate.`;
    } else {
      verificationApproach = `VERIFICATION APPROACH:
- Use Bash commands to verify: curl API calls, database queries, CLI commands, running tests, etc.
- Check logs, config, or any other observable side effects.
- Be thorough but efficient.`;
    }

    return `VERIFICATION ONLY — Do NOT modify any source code files.

You are running in the main project root where the application is live.
The code for feature "${feature.name}" (id: ${feature.id}) has just been merged into the base branch.

The app URL is: ${appUrl}

Verify the following steps work correctly:

${steps}

${verificationApproach}

REPORT RESULTS:
Print structured output for each verification step: "STEP N: PASS/FAIL - description"

Rules:
- If ALL steps pass, exit successfully.
- If any step fails, describe exactly what failed and why, then exit with failure.
- Do NOT modify any source code files. Only create temporary scripts in /tmp/.`;
  }

  /**
   * Execute a verification session in the main project root.
   * Uses the specified agent to verify (same agent as implementation).
   */
  async executeVerification(
    sessionId: string,
    feature: Feature,
    agent: AgentName,
    shouldStop?: () => boolean
  ): Promise<ExecutionResult> {
    const cwd = this.projectRoot;
    const prompt = this.buildVerificationPrompt(feature);

    logger.info(`[${sessionId}] Starting verification for feature: ${feature.name} (cwd: ${cwd})`);
    logger.debug(`[${sessionId}] Verification prompt: ${prompt.substring(0, 200)}...`);

    return new Promise((resolve) => {
      const { command, args } = this.getVerificationAgentCommand(agent, prompt);

      const verifyPathDirs: string[] = [];
      for (const dir of this.config.worktree.symlinkDirs) {
        const binSuffix = dir === 'vendor' ? 'bin' : dir === 'node_modules' ? '.bin' : 'bin';
        verifyPathDirs.push(path.join(cwd, dir, binSuffix));
      }
      verifyPathDirs.push(process.env.PATH || '');
      const augmentedPath = verifyPathDirs.join(':');

      const proc = spawn(command, args, {
        cwd,
        env: { ...process.env, PATH: augmentedPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const messages: AgentMessage[] = [];
      let rawOutput = '';
      let stderr = '';

      const rl = readline.createInterface({
        input: proc.stdout!,
        crlfDelay: Infinity,
      });

      let stopInterval: NodeJS.Timeout | null = null;
      if (shouldStop) {
        stopInterval = setInterval(() => {
          if (shouldStop() && !proc.killed) {
            logger.warn(`[${sessionId}] Stop requested — terminating verification`);
            proc.kill('SIGTERM');
            setTimeout(() => {
              if (!proc.killed) proc.kill('SIGKILL');
            }, 2000);
          }
        }, 500);
      }

      proc.stderr!.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        logger.debug(`[${sessionId}] verification stderr: ${chunk}`);
      });

      rl.on('line', (line) => {
        rawOutput += line + '\n';
        if (line.trim() === '') return;

        try {
          const parsed = JSON.parse(line);
          const parsedMessages = this.parseAgentMessage(parsed, agent);
          for (const message of parsedMessages) {
            messages.push(message);
            this.io.emit('agent:output', { sessionId, message });
          }
        } catch {
          const fallbackMessage: AgentMessage = {
            type: 'assistant',
            timestamp: new Date().toISOString(),
            agent,
            content: line,
            raw: line,
          };
          messages.push(fallbackMessage);
          this.io.emit('agent:output', { sessionId, message: fallbackMessage });
          logger.debug(`[${sessionId}] Captured non-JSON verification line`);
        }
      });

      proc.on('exit', (code) => {
        if (stopInterval) clearInterval(stopInterval);
        logger.info(`[${sessionId}] Verification exited with code: ${code}`);
        if (stderr) {
          rawOutput += `\n[stderr]\n${stderr}`;
        }

        resolve({
          success: code === 0,
          output: rawOutput,
          messages,
          error: code === 0 ? undefined : `Verification exited with code ${code}`,
          stderr,
          agentUsed: agent,
        });
      });

      proc.on('error', (error) => {
        if (stopInterval) clearInterval(stopInterval);
        logger.error(`[${sessionId}] Verification process error: ${error.message}`);
        resolve({
          success: false,
          output: rawOutput,
          messages,
          error: error.message,
          stderr,
          agentUsed: agent,
        });
      });
    });
  }

  // ─── Fix Phase (after verification failure) ──────────────────────

  /**
   * Build a prompt for the fix agent that runs after verification failed.
   * Includes the failure output so the agent knows exactly what to fix.
   */
  buildFixPrompt(feature: Feature, verificationOutput: string, attempt: number, maxAttempts: number): string {
    const steps = feature.steps.map((step, idx) => `${idx + 1}. ${step}`).join('\n');
    const outputTail = verificationOutput.slice(-6000);

    return `FIX REQUIRED — Verification attempt ${attempt}/${maxAttempts} failed for feature "${feature.name}" (id: ${feature.id}).

The feature code has been merged to the base branch and tested, but the following verification steps did NOT all pass:

${steps}

Here is the verification output (tail):
---
${outputTail}
---

Your task:
1. Read the verification output carefully to understand what failed and why.
2. You are working in the feature branch worktree (NOT the base branch). Fix the code so that ALL verification steps will pass.
3. If you need ${this.config.featuresFile}, read it from ${this.projectRoot}/${this.config.featuresFile} (not the worktree).
4. Run any static checks (linting, type checking) to make sure your fix doesn't break anything.
5. Do NOT run verification yourself — the orchestrator will re-verify after you commit.
6. Git add and commit your fix (the orchestrator will push).

Focus only on fixing what the verification reported as failing. Do not refactor unrelated code.`;
  }

  /**
   * Execute a fix session in the worktree after verification failure.
   * The agent gets the verification failure output and fixes the code.
   */
  async executeFix(
    sessionId: string,
    feature: Feature,
    verificationOutput: string,
    attempt: number,
    maxAttempts: number,
    worktreePath: string,
    agent: AgentName,
    shouldStop?: () => boolean
  ): Promise<ExecutionResult> {
    const prompt = this.buildFixPrompt(feature, verificationOutput, attempt, maxAttempts);

    logger.info(`[${sessionId}] Starting fix session (attempt ${attempt}/${maxAttempts}) for feature: ${feature.name}`);

    return new Promise((resolve) => {
      const { command, args } = this.getAgentCommand(agent, prompt);

      const fixPathDirs: string[] = [];
      for (const dir of this.config.worktree.symlinkDirs) {
        const binSuffix = dir === 'vendor' ? 'bin' : dir === 'node_modules' ? '.bin' : 'bin';
        fixPathDirs.push(path.join(worktreePath, dir, binSuffix));
        fixPathDirs.push(path.join(this.projectRoot, dir, binSuffix));
      }
      fixPathDirs.push(process.env.PATH || '');
      const augmentedPath = fixPathDirs.join(':');

      const proc = spawn(command, args, {
        cwd: worktreePath,
        env: { ...process.env, PATH: augmentedPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const messages: AgentMessage[] = [];
      let rawOutput = '';
      let stderr = '';

      const rl = readline.createInterface({
        input: proc.stdout!,
        crlfDelay: Infinity,
      });

      let stopInterval: NodeJS.Timeout | null = null;
      if (shouldStop) {
        stopInterval = setInterval(() => {
          if (shouldStop() && !proc.killed) {
            logger.warn(`[${sessionId}] Stop requested — terminating fix agent`);
            proc.kill('SIGTERM');
            setTimeout(() => {
              if (!proc.killed) proc.kill('SIGKILL');
            }, 2000);
          }
        }, 500);
      }

      proc.stderr!.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
      });

      rl.on('line', (line) => {
        rawOutput += line + '\n';
        if (line.trim() === '') return;

        try {
          const parsed = JSON.parse(line);
          const parsedMessages = this.parseAgentMessage(parsed, agent);
          for (const message of parsedMessages) {
            messages.push(message);
            this.io.emit('agent:output', { sessionId, message });
          }
        } catch {
          const fallbackMessage: AgentMessage = {
            type: 'assistant',
            timestamp: new Date().toISOString(),
            agent,
            content: line,
            raw: line,
          };
          messages.push(fallbackMessage);
          this.io.emit('agent:output', { sessionId, message: fallbackMessage });
        }
      });

      proc.on('exit', (code) => {
        if (stopInterval) clearInterval(stopInterval);
        logger.info(`[${sessionId}] Fix agent exited with code: ${code}`);
        if (stderr) {
          rawOutput += `\n[stderr]\n${stderr}`;
        }

        resolve({
          success: code === 0,
          output: rawOutput,
          messages,
          error: code === 0 ? undefined : `Fix agent exited with code ${code}`,
          stderr,
        });
      });

      proc.on('error', (error) => {
        if (stopInterval) clearInterval(stopInterval);
        logger.error(`[${sessionId}] Fix process error: ${error.message}`);
        resolve({
          success: false,
          output: rawOutput,
          messages,
          error: error.message,
          stderr,
        });
      });
    });
  }
}
