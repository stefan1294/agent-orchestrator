import { readFile } from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import type { Server } from 'socket.io';
import type { OrchestratorState, OrchestratorStatus, TrackStatus, Feature, AgentMessage } from '../types.js';
import { Mutex } from '../utils/lock.js';
import { logger } from '../utils/logger.js';
import { AgentExecutor } from './agent-executor.js';
import { FeatureStore } from './feature-store.js';
import { GitManager } from './git-manager.js';
import type { ProjectConfig, TrackDefinition } from './project-config.js';
import { compileCriticalPatterns, saveProjectConfig } from './project-config.js';
import { QueueManager } from './queue-manager.js';
import { SessionDB, type Session as DbSession } from './session-db.js';

// Patterns that indicate the feature was implemented but tests failed
const TEST_ONLY_PATTERNS: Array<RegExp> = [
  /test.*fail|tests.*fail|assertion.*fail/i,
  /browser.*test.*fail/i,
  /expected.*but.*received|expect\(.*\)\.to/i,
  /verification.*fail|could not verify/i,
];

const RATE_LIMIT_PATTERNS: Array<RegExp> = [
  /rate limit/i,
  /too many requests/i,
  /\b429\b/i,
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
interface FailureAnalysis {
  reason: string;
  category: 'environment' | 'test_only' | 'implementation' | 'verification' | 'rate_limit' | 'unknown';
  isCritical: boolean;
  criticalLabel?: string;
}

interface ResumeRequest {
  featureId: number;
  track: string;
  requestedAt: string;
}

export class Orchestrator {
  private state: OrchestratorState = 'stopped';
  private startedAt: string | null = null;
  private trackStatus: Map<string, TrackStatus> = new Map();

  // Track consecutive critical failures per track
  private consecutiveCriticalFailures: Map<string, number> = new Map();
  private lastCriticalLabel: Map<string, string> = new Map();

  // Compiled critical patterns from config
  private criticalPatterns: Array<{ pattern: RegExp; label: string }> = [];

  private featureStore: FeatureStore;
  private sessionDB: SessionDB;
  private gitManager: GitManager;
  private queueManager: QueueManager;
  private agentExecutor: AgentExecutor;

  private projectRoot: string;
  private config: ProjectConfig;
  private io: Server;
  private resumeRequest: ResumeRequest | null = null;

  // Setup state: tracks not yet configured
  private setupResolver: ((tracks: TrackDefinition[]) => void) | null = null;
  private detectedCategories: string[] = [];

  // Verification mutex: only one track can merge+verify at a time.
  // Separate from git-manager's gitMutex (which protects individual git ops).
  private verificationMutex: Mutex;

  constructor(projectRoot: string, io: Server, config: ProjectConfig) {
    this.projectRoot = projectRoot;
    this.config = config;
    this.io = io;

    this.criticalPatterns = compileCriticalPatterns(config);

    this.featureStore = new FeatureStore(path.join(projectRoot, config.featuresFile));
    this.sessionDB = new SessionDB(path.join(projectRoot, '.orchestrator', 'database', 'orchestrator.db'));
    this.gitManager = new GitManager(projectRoot, config);
    this.queueManager = new QueueManager(config.tracks);
    this.agentExecutor = new AgentExecutor(projectRoot, io, config);
    this.verificationMutex = new Mutex();
  }

  getConfig(): ProjectConfig {
    return this.config;
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  private appendSessionMessages(sessionId: string, messages: AgentMessage[]): void {
    if (messages.length === 0) return;
    const session = this.sessionDB.getSession(sessionId);
    if (!session) return;

    let existing: AgentMessage[] = [];
    if (session.structured_messages) {
      try {
        existing = JSON.parse(session.structured_messages) as AgentMessage[];
      } catch {
        existing = [];
      }
    }

    const updated = [...existing, ...messages];
    this.sessionDB.updateSession(sessionId, {
      structured_messages: JSON.stringify(updated),
    });
  }

  private emitSessionMessage(sessionId: string, message: AgentMessage): void {
    this.io.emit('agent:output', { sessionId, message });
    this.appendSessionMessages(sessionId, [message]);
  }

  async start(): Promise<void> {
    if (this.state === 'running') {
      throw new Error('Orchestrator is already running');
    }

    this.state = 'running';
    this.startedAt = new Date().toISOString();

    // Reset critical failure tracking
    this.consecutiveCriticalFailures.clear();
    this.lastCriticalLabel.clear();

    try {
      // Initialize git worktrees and ensure main repo on develop
      await this.gitManager.init();
      logger.info('Git manager initialized with worktrees');

      // Load features from feature store
      const features = await this.featureStore.loadFeatures();
      logger.info(`Loaded ${features.length} features from feature store`);

      // Extract unique categories from features
      const allCategories = [...new Set(features.map(f => f.category).filter(Boolean))];

      // Check if tracks need to be configured
      if (!this.config.tracksConfigured) {
        // First start: enter setup state and wait for user to configure tracks
        this.state = 'setup';
        this.detectedCategories = allCategories;
        logger.info(`Tracks not configured — entering setup state with ${allCategories.length} detected categories: ${allCategories.join(', ')}`);
        this.emitStatus();

        // Wait for configureTracks() to be called from the API
        const tracks = await new Promise<TrackDefinition[]>((resolve) => {
          this.setupResolver = resolve;
        });

        // Apply the configured tracks
        this.config.tracks = tracks;
        this.config.tracksConfigured = true;
        await saveProjectConfig(this.projectRoot, this.config);
        logger.info(`Tracks configured: ${tracks.map(t => t.name).join(', ')}`);

        // Re-initialize queue manager with new tracks
        this.queueManager = new QueueManager(this.config.tracks);

        // Transition to running
        this.state = 'running';
        this.setupResolver = null;
        this.detectedCategories = [];
      } else {
        // Subsequent start: check for new categories not in any track
        const configuredCategories = this.config.tracks.flatMap(t => t.categories);
        const newCategories = allCategories.filter(c => !configuredCategories.includes(c));

        if (newCategories.length > 0) {
          logger.info(`New categories detected: ${newCategories.join(', ')}. They will be routed to the default track.`);
          this.io.emit('tracks:new_categories', { categories: newCategories });
        }
      }

      // Initialize queues with loaded features
      this.queueManager.initializeQueues(features);
      logger.info('Initialized queues with features');

      // Initialize track statuses from config
      for (const trackDef of this.config.tracks) {
        const queueStatus = this.queueManager.getQueueStatus(trackDef.name);
        this.trackStatus.set(trackDef.name, {
          name: trackDef.name,
          currentFeature: null,
          currentSessionId: null,
          queued: queueStatus.queued + queueStatus.retryQueued + queueStatus.resumeQueued,
          completed: 0,
          failed: 0,
        });
      }

      logger.info(`Initialized ${this.config.tracks.length} track(s): ${this.config.tracks.map(t => t.name).join(', ')}`);

      // Emit initial status
      this.emitStatus();

      // Run all tracks in parallel
      await Promise.all(
        this.config.tracks.map(t => this.runTrack(t.name))
      );

      // Both tracks finished
      this.state = 'stopped';
      this.emitStatus();
      logger.info('Orchestrator completed all tracks');
    } catch (error) {
      this.state = 'stopped';
      logger.error('Error during orchestrator start', error);
      this.emitStatus();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.state = 'stopping';
    logger.info('Orchestrator stopping');
    this.emitStatus();
    // Don't kill running processes — just prevent new dequeues
  }

  async retryFeature(featureId: number, extraContext: string): Promise<void> {
    try {
      // Load feature to get its category
      const features = await this.featureStore.loadFeatures();
      const feature = features.find(f => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature with id ${featureId} not found`);
      }

      // Determine track
      const track = this.queueManager.getTrack(feature);

      // Get latest session for this feature from DB
      const latestSession = this.sessionDB.getLatestSessionForFeature(featureId);

      // Build resume context so the agent continues where it left off
      // (combines user's extra context with previous session history)
      const resumeContext = this.buildResumeContext(feature, extraContext, latestSession);

      // Reset feature status to 'open' in feature store (clears failure info)
      await this.featureStore.updateFeatureStatus(featureId, 'open');

      // Enqueue retry with full resume context
      this.queueManager.enqueueRetry(featureId, track, resumeContext, latestSession?.id);

      logger.info(`Feature ${featureId} enqueued for retry with resume context from previous session`);

      // Emit feature updated event
      const updatedFeature = { ...feature, status: 'open' as const, failure_reason: undefined, failure_category: undefined };
      this.io.emit('feature:updated', updatedFeature);
    } catch (error) {
      logger.error(`Error retrying feature ${featureId}`, error);
      throw error;
    }
  }

  async resumeFeature(featureId: number, prompt: string): Promise<void> {
    if (this.state !== 'running') {
      throw new Error('Orchestrator must be running to resume a feature');
    }

    // Load feature
    const feature = await this.featureStore.getFeature(featureId);
    if (!feature) {
      throw new Error(`Feature with id ${featureId} not found`);
    }

    const track = this.queueManager.getTrack(feature);
    const latestSession = this.sessionDB.getLatestSessionForFeature(featureId);
    const resumeContext = this.buildResumeContext(feature, prompt, latestSession);

    // Enqueue resume with highest priority
    this.queueManager.enqueueResume(featureId, track, resumeContext, latestSession?.id);

    // Pause other tracks while resume is pending
    this.resumeRequest = {
      featureId,
      track,
      requestedAt: new Date().toISOString(),
    };

    logger.info(`Feature ${featureId} queued for resume on track ${track}`);
    this.emitStatus();
  }

  configureTracks(tracks: TrackDefinition[]): void {
    if (this.state !== 'setup' || !this.setupResolver) {
      throw new Error('Cannot configure tracks: orchestrator is not in setup state');
    }
    this.setupResolver(tracks);
  }

  getDetectedCategories(): string[] {
    return this.detectedCategories;
  }

  getStatus(): OrchestratorStatus {
    const tracks: TrackStatus[] = [];
    for (const [, status] of this.trackStatus) {
      tracks.push(status);
    }

    const result: OrchestratorStatus = {
      state: this.state,
      startedAt: this.startedAt,
      tracks,
      resume: this.resumeRequest
        ? { ...this.resumeRequest }
        : null,
    };

    if (this.state === 'setup' && this.detectedCategories.length > 0) {
      result.detectedCategories = this.detectedCategories;
    }

    return result;
  }

  getFeatureStore(): FeatureStore {
    return this.featureStore;
  }

  getSessionDB(): SessionDB {
    return this.sessionDB;
  }

  private emitStatus(): void {
    this.io.emit('orchestrator:status', this.getStatus());
  }

  /**
   * Analyze agent output and error to determine WHY a feature failed.
   */
  private analyzeFailure(output: string, error?: string): FailureAnalysis {
    const combined = `${output}\n${error || ''}`;

    // Check for critical infrastructure patterns
    for (const { pattern, label } of this.criticalPatterns) {
      if (pattern.test(combined)) {
        return {
          reason: label,
          category: 'environment',
          isCritical: true,
          criticalLabel: label,
        };
      }
    }

    // Check for test-only failures (implementation done, tests failed)
    for (const pattern of TEST_ONLY_PATTERNS) {
      if (pattern.test(combined)) {
        return {
          reason: 'Implementation complete but verification/tests failed',
          category: 'test_only',
          isCritical: false,
        };
      }
    }

    // Check for rate limit failures
    for (const pattern of RATE_LIMIT_PATTERNS) {
      if (pattern.test(combined)) {
        return {
          reason: 'Rate limit reached',
          category: 'rate_limit',
          isCritical: false,
        };
      }
    }

    // Try to extract a short reason from the last error-ish lines
    const lines = combined.split('\n').filter(l => l.trim());
    const errorLines = lines.filter(l =>
      /error|fail|fatal|exception|cannot|unable/i.test(l)
    );

    if (errorLines.length > 0) {
      // Take the last meaningful error line, truncated
      const lastError = errorLines[errorLines.length - 1].trim().substring(0, 200);
      return {
        reason: lastError,
        category: 'implementation',
        isCritical: false,
      };
    }

    return {
      reason: error || 'Unknown failure',
      category: 'unknown',
      isCritical: false,
    };
  }

  private async runTrack(track: string): Promise<void> {
    logger.info(`Starting track: ${track}`);

    while (this.state === 'running') {
      try {
        await this.waitWhileResumeActive(track);

        // 1. Dequeue next item from queueManager
        const queueItem = this.queueManager.dequeue(track);

        // 2. If null (queue empty), wait and poll for retries/resumes
        if (!queueItem) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        // 3. Load the feature from featureStore
        const features = await this.featureStore.loadFeatures();
        const fullFeature = features.find(f => f.id === queueItem.featureId);

        if (!fullFeature) {
          logger.warn(`Feature ${queueItem.featureId} not found in feature store`);
          continue;
        }

        // 4. Update trackStatus — set currentFeature
        const status = this.trackStatus.get(track);
        if (status) {
          status.currentFeature = fullFeature;
        }

        // 5. Emit socket events
        this.emitStatus();

        // 6. Prepare git branch + worktree via gitManager
        const { branchName, worktreePath } = await this.gitManager.prepareBranch(
          track,
          fullFeature.id,
          fullFeature.name,
          queueItem.isRetry
        );
        logger.info(`Prepared branch: ${branchName} in worktree: ${worktreePath}`);

        // 7. Create session record in DB (status: 'running')
        const sessionId = nanoid();
        const startTime = Date.now();

        // Build the prompt for storage
        const prompt = `Implement feature: "${fullFeature.name}" (id: ${fullFeature.id})`;

        this.sessionDB.createSession({
          id: sessionId,
          feature_id: fullFeature.id,
          track,
          branch: branchName,
          status: 'running',
          started_at: new Date().toISOString(),
          finished_at: null,
          duration_ms: null,
          prompt,
          retry_info: queueItem.extraContext || null,
          full_output: null,
          structured_messages: null,
          error_message: null,
        });

        logger.info(`Created session ${sessionId} for feature ${fullFeature.id}`);

        // Update track status with current session ID
        if (status) {
          status.currentSessionId = sessionId;
        }
        this.emitStatus();

        // 8. Emit session:started
        this.io.emit('session:started', {
          id: sessionId,
          feature_id: fullFeature.id,
          track,
          branch: branchName,
          status: 'running',
          started_at: new Date().toISOString(),
        });

        // 9. Execute agent via agentExecutor (runs in worktree directory)
        let agentResult;
        try {
          agentResult = await this.agentExecutor.executeSession(
            sessionId,
            fullFeature,
            track,
            queueItem.isRetry,
            queueItem.extraContext,
            worktreePath,
            () => this.state !== 'running'
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Agent execution failed for session ${sessionId}`, error);
          agentResult = {
            success: false,
            output: '',
            messages: [],
            error: errorMessage,
          };
        }

        const implementationAgent = agentResult.agentUsed === 'codex' ? 'codex' : 'claude';

        // ─── PHASE 1 RESULT: Determine implementation status ───
        // Implementation success = agent exited cleanly (code 0)
        const implementationSucceeded = agentResult.success;
        let finalStatus: 'passed' | 'failed' | 'error' = implementationSucceeded ? 'passed' : 'error';
        let failureAnalysis: FailureAnalysis | null = null;

        // If implementation failed, analyze the failure
        if (!implementationSucceeded) {
          const analysisOutput = agentResult.analysisOutput ?? agentResult.output;
          const analysisError = agentResult.analysisError ?? agentResult.error;
          failureAnalysis = this.analyzeFailure(analysisOutput, analysisError);
          finalStatus = agentResult.error ? 'error' : 'failed';

          if (failureAnalysis.category !== 'rate_limit') {
            const progress = this.buildProgressSummary(
              fullFeature, sessionId, 'failed', Date.now() - startTime, branchName, failureAnalysis.reason
            );
            try {
              await this.featureStore.updateFeatureStatus(
                fullFeature.id,
                'failed',
                failureAnalysis.reason,
                failureAnalysis.category,
                progress
              );
            } catch (updateErr) {
              logger.warn(`Could not update feature ${fullFeature.id} failure info: ${updateErr}`);
            }
          }

          logger.info(`Feature ${fullFeature.id} implementation failed: [${failureAnalysis.category}] ${failureAnalysis.reason}`);
        }

        // Calculate implementation duration
        const durationMs = Date.now() - startTime;

        // Update implementation session in DB
        this.sessionDB.updateSession(sessionId, {
          status: implementationSucceeded ? 'passed' : (agentResult.error ? 'error' : 'failed'),
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          full_output: agentResult.output || null,
          structured_messages: agentResult.messages.length > 0
            ? JSON.stringify(agentResult.messages)
            : null,
          error_message: failureAnalysis
            ? `[${failureAnalysis.category}] ${failureAnalysis.reason}`
            : (agentResult.error || null),
        });

        logger.info(`Implementation session ${sessionId} completed: ${implementationSucceeded ? 'success' : 'failed'}`);

        // Emit implementation session:finished
        const finishedSession = this.sessionDB.getSession(sessionId);
        if (finishedSession) {
          this.io.emit('session:finished', finishedSession);
        }

        // Clear resume request if this was the resumed feature
        if (this.resumeRequest && this.resumeRequest.featureId === fullFeature.id) {
          logger.info(`Resume completed for feature ${fullFeature.id}`);
          this.resumeRequest = null;
          this.emitStatus();
        }

        // Enforce: must have committed code before merge/verify.
        // If worktree is dirty, auto-commit to avoid losing code.
        let branchStatus;
        try {
          const commitMsg = `feat(#${fullFeature.id}): ${fullFeature.name}`;
          const didCommit = await this.gitManager.commitAllIfDirty(worktreePath, commitMsg);
          if (didCommit) {
            this.emitSessionMessage(sessionId, {
              type: 'system',
              agent: 'system',
              timestamp: new Date().toISOString(),
              content: `Auto-committed uncommitted changes on ${branchName}: "${commitMsg}"`,
            });
          }

          branchStatus = await this.gitManager.getBranchStatus(branchName, worktreePath);
          if (branchStatus.aheadCount === 0) {
            const message = `No commits found on branch ${branchName}. Stopping orchestrator to prevent wasted runs.`;
            this.emitSessionMessage(sessionId, {
              type: 'system',
              agent: 'system',
              timestamp: new Date().toISOString(),
              content: message,
            });
            await this.featureStore.updateFeatureStatus(fullFeature.id, 'failed', message, 'implementation');
            this.io.emit('feature:updated', { ...fullFeature, status: 'failed', failure_reason: message, failure_category: 'implementation' });
            await this.stop();
            continue;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const message = `Failed to validate/commit branch ${branchName}: ${errMsg}. Stopping orchestrator.`;
          this.emitSessionMessage(sessionId, {
            type: 'system',
            agent: 'system',
            timestamp: new Date().toISOString(),
            content: message,
          });
          await this.featureStore.updateFeatureStatus(fullFeature.id, 'failed', message, 'implementation');
          this.io.emit('feature:updated', { ...fullFeature, status: 'failed', failure_reason: message, failure_category: 'implementation' });
          await this.stop();
          continue;
        }

        // ─── PHASE 2: Merge + Verify (even if implementation failed, as long as commits exist) ───
        if (branchStatus?.aheadCount && branchStatus.aheadCount > 0) {
          const verifyResult = await this.verifyAndMerge(fullFeature, branchName, sessionId, worktreePath, implementationAgent);

          if (verifyResult.passed) {
            finalStatus = 'passed';
            this.consecutiveCriticalFailures.set(track, 0);
            this.lastCriticalLabel.delete(track);
          } else {
            finalStatus = 'failed';
            failureAnalysis = {
              reason: verifyResult.reason || 'Verification failed',
              category: 'verification' as any,
              isCritical: false,
            };
          }
        }

        // Re-load from canonical source for the updated feature object
        const updatedFeatures = await this.featureStore.loadFeatures();
        const updatedFeature = updatedFeatures.find(f => f.id === fullFeature.id);

        const isRateLimit = failureAnalysis?.category === 'rate_limit';

        // 16. If failed/error: check for critical failures
        if ((finalStatus === 'failed' || finalStatus === 'error') && !isRateLimit) {
          if (failureAnalysis?.isCritical) {
            const count = (this.consecutiveCriticalFailures.get(track) ?? 0) + 1;
            this.consecutiveCriticalFailures.set(track, count);
            this.lastCriticalLabel.set(track, failureAnalysis.criticalLabel!);

            logger.warn(
              `[CRITICAL] Track ${track}: consecutive critical failure #${count} — ${failureAnalysis.criticalLabel}`
            );

            // If 2+ consecutive critical failures, pause the track
            if (count >= 2) {
              logger.error(
                `[CRITICAL] Track ${track} PAUSED: ${count} consecutive critical failures (${failureAnalysis.criticalLabel}). ` +
                `All remaining features will likely fail. Fix the environment and retry.`
              );

              // Emit a special alert to the dashboard
              this.io.emit('track:critical_failure', {
                track,
                reason: failureAnalysis.criticalLabel,
                consecutiveFailures: count,
                message: `Track "${track}" auto-paused: ${failureAnalysis.criticalLabel}. Fix the issue and restart.`,
              });

              // Break out of the track loop — don't process more features
              if (status) {
                status.currentFeature = null;
                status.currentSessionId = null;
              }
              this.emitStatus();
              break;
            }
          } else {
            // Non-critical failure: reset the counter
            this.consecutiveCriticalFailures.set(track, 0);
            this.lastCriticalLabel.delete(track);
          }

          // Pause before next feature if it failed fast
          if (durationMs < 10_000) {
            logger.warn(`Feature ${fullFeature.id} failed in ${durationMs}ms — pausing 5s before next feature`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }

        // If rate-limited, pause and re-enqueue resume without failing the feature
        if (isRateLimit) {
          logger.warn(`Feature ${fullFeature.id} rate-limited — re-queueing after wait`);
          this.queueManager.enqueueResume(
            fullFeature.id,
            track,
            `Rate limit reached. Retry after wait. ${failureAnalysis?.reason ?? ''}`,
            sessionId
          );
          await this.waitRateLimitDelay();
        }

        // 17. Update trackStatus
        if (status) {
          if (finalStatus === 'passed') {
            status.completed += 1;
          } else if (!isRateLimit) {
            status.failed += 1;
          }
          status.currentFeature = null;
          status.currentSessionId = null;

          // Update queued count
          const queueStatus = this.queueManager.getQueueStatus(track);
          status.queued = queueStatus.queued + queueStatus.retryQueued + queueStatus.resumeQueued;
        }

        // 18. Clean up worktree for this track (before next feature creates a new one)
        try {
          await this.gitManager.cleanupWorktree(track);
        } catch (cleanupErr) {
          logger.warn(`Failed to clean up worktree for track ${track}`, cleanupErr);
        }

        // 19. Emit feature:updated and orchestrator:status
        if (updatedFeature && !isRateLimit) {
          this.io.emit('feature:updated', updatedFeature);
        }

        this.emitStatus();
      } catch (error) {
        logger.error(`Error in track ${track} main loop`, error);

        // Try to update track status
        const status = this.trackStatus.get(track);
        if (status) {
          status.failed += 1;
          status.currentFeature = null;
          status.currentSessionId = null;
        }

        this.emitStatus();

        // Pause before retrying to prevent rapid failures
        logger.warn(`Track ${track} encountered error — pausing 5s before next feature`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        // Continue to next feature instead of crashing the track
      }
    }

    // Track finished
    const finalStatus = this.trackStatus.get(track);
    if (finalStatus) {
      finalStatus.currentFeature = null;
      finalStatus.currentSessionId = null;
    }

    this.emitStatus();
    logger.info(`Track ${track} completed`, {
      stats: finalStatus,
    });
  }

  private getRateLimitWaitMs(): number {
    const ms = this.config.agent.rateLimitWaitMs;
    return Number.isFinite(ms) && ms > 0 ? ms : 600000;
  }

  private async waitRateLimitDelay(): Promise<void> {
    const waitMs = this.getRateLimitWaitMs();
    const interval = 5000;
    let remaining = waitMs;
    while (remaining > 0 && this.state === 'running') {
      const sleepMs = Math.min(interval, remaining);
      await new Promise(resolve => setTimeout(resolve, sleepMs));
      remaining -= sleepMs;
    }
  }

  private async waitWhileResumeActive(track: string): Promise<void> {
    if (!this.resumeRequest) {
      return;
    }

    if (this.resumeRequest.track === track) {
      return;
    }

    logger.info(
      `Track ${track} paused while resume is active for feature ${this.resumeRequest.featureId}`
    );

    while (this.state === 'running' && this.resumeRequest && this.resumeRequest.track !== track) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  private buildResumeContext(feature: Feature, prompt: string, latestSession?: DbSession): string {
    const parts: string[] = [];
    parts.push(`RESUME: Continue work on feature "${feature.name}" (id: ${feature.id}).`);
    parts.push('Ignore the ORCHESTRATOR.md instruction to only work the first open feature for this session.');

    if (prompt?.trim()) {
      parts.push(`User prompt: ${prompt.trim()}`);
    }

    if (latestSession) {
      parts.push(`Previous session id: ${latestSession.id}`);
      parts.push(`Previous status: ${latestSession.status}`);
      if (latestSession.error_message) {
        parts.push(`Previous error: ${latestSession.error_message}`);
      }
      if (latestSession.structured_messages) {
        try {
          const parsed = JSON.parse(latestSession.structured_messages) as Array<{ type?: string; content?: string; tool_name?: string; tool_result?: string }>;
          const tail = parsed.slice(-20).map((msg) => {
            if (msg.type === 'tool_use' && msg.tool_name) {
              return `[tool_use] ${msg.tool_name}`;
            }
            if (msg.type === 'tool_result' && msg.tool_result) {
              return `[tool_result] ${msg.tool_result.substring(0, 400)}`;
            }
            if (msg.content) {
              return `[${msg.type ?? 'message'}] ${msg.content.substring(0, 800)}`;
            }
            return `[${msg.type ?? 'message'}]`;
          }).join('\n');
          if (tail) {
            parts.push(`Recent structured messages (tail):\n${tail}`);
          }
        } catch (err) {
          logger.warn(`Failed to parse structured messages for resume context: ${err}`);
        }
      } else if (latestSession.full_output) {
        const tail = latestSession.full_output.slice(-4000);
        parts.push(`Previous output (tail):\n${tail}`);
      }
    }

    parts.push('Resume from the current repo state. Continue where it left off.');
    return parts.join('\n\n');
  }

  /**
   * Build a progress summary string for a completed feature session.
   */
  private buildProgressSummary(
    feature: Feature,
    sessionId: string,
    status: 'passed' | 'failed',
    durationMs: number,
    branchName: string,
    failureReason?: string
  ): string {
    const date = new Date().toISOString().split('T')[0];
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    const duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    const lines = [
      `Session: ${date} | ${status.toUpperCase()} | ${duration}`,
      `Branch: ${branchName} | Session: ${sessionId}`,
    ];

    if (failureReason) {
      lines.push(`Reason: ${failureReason}`);
    }

    return lines.join('\n');
  }

  // ─── Phase 2: Merge, Push, then Verify ──────────────────────────────

  /**
   * Push-first verify-fix loop:
   *
   *  1. Acquire lock → merge feature branch to develop → push (GUARANTEED)
   *  2. Wait for server hot-reload
   *  3. Run verification agent
   *  4. If passes → release lock → mark passed → done
   *  5. If fails → run fix agent (commits to develop) → push fix → re-verify
   *  6. After max attempts → release lock → mark verification_failed (code stays on develop)
   *
   * The merge+push is ALWAYS completed first so the pipeline never stalls.
   * Even if all verification attempts fail, the code remains on develop
   * and subsequent features can build on it.
   */
  private async verifyAndMerge(
    feature: Feature,
    branchName: string,
    implementationSessionId: string,
    worktreePath: string,
    implementationAgent: 'claude' | 'codex' | 'gemini'
  ): Promise<{ passed: boolean; reason?: string }> {
    if (this.state !== 'running') {
      return { passed: false, reason: 'Orchestrator stopped' };
    }

    const maxAttempts = this.config.verification.maxAttempts;
    const propagationDelay = this.config.verification.delayMs;
    const disableVerification = this.config.verification.disabled;
    const verifyStartedAt = Date.now();

    // ── Step 1: Acquire merge lock ──
    logger.info(`Feature ${feature.id} — waiting for merge lock...`);
    await this.verificationMutex.acquire();
    logger.info(`Feature ${feature.id} acquired merge lock`);

    // ── Step 2: Verify-fix loop ──
    let lastReason = '';
    let lastVerifyOutput = '';

    const totalAttempts = disableVerification ? 1 : maxAttempts;
    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      if (this.state !== 'running') {
        this.verificationMutex.release();
        return { passed: false, reason: 'Orchestrator stopped' };
      }

      // Merge + push before each verification attempt (latest fixes)
      try {
        // Update feature branch with latest develop before merging.
        // This prevents merge conflicts when another track has already merged to develop.
        try {
          await this.gitManager.updateFeatureBranch(worktreePath);
        } catch (updateErr) {
          const updateMsg = updateErr instanceof Error ? updateErr.message : String(updateErr);
          logger.warn(`Feature ${feature.id} — updateFeatureBranch failed: ${updateMsg}. Proceeding with merge anyway.`);
          this.emitSessionMessage(implementationSessionId, {
            type: 'system',
            agent: 'system',
            timestamp: new Date().toISOString(),
            content: `Warning: could not update feature branch with latest develop: ${updateMsg}`,
          });
        }

        this.emitSessionMessage(implementationSessionId, {
          type: 'system',
          agent: 'system',
          timestamp: new Date().toISOString(),
          content: `Merging branch ${branchName} into develop (attempt ${attempt}/${maxAttempts})...`,
        });

        await this.gitManager.mergeLocally(branchName);

        this.emitSessionMessage(implementationSessionId, {
          type: 'system',
          agent: 'system',
          timestamp: new Date().toISOString(),
          content: `Merge complete. Pushing develop (attempt ${attempt}/${maxAttempts})...`,
        });

        await this.gitManager.pushBaseBranch();

        this.emitSessionMessage(implementationSessionId, {
          type: 'system',
          agent: 'system',
          timestamp: new Date().toISOString(),
          content: `Push complete. Develop updated (attempt ${attempt}/${maxAttempts}).`,
        });

        logger.info(`Feature ${feature.id} merged ${branchName} to develop and pushed`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Feature ${feature.id} merge/push failed: ${errorMessage}`);

        this.emitSessionMessage(implementationSessionId, {
          type: 'system',
          agent: 'system',
          timestamp: new Date().toISOString(),
          content: `Merge/push failed: ${errorMessage}`,
        });

        this.verificationMutex.release();
        logger.info(`Feature ${feature.id} released merge lock (merge failed)`);

        await this.featureStore.updateFeatureStatus(feature.id, 'failed', `Merge failed: ${errorMessage}`, 'verification');
        this.io.emit('feature:updated', { ...feature, status: 'failed', failure_reason: `Merge failed: ${errorMessage}`, failure_category: 'verification' });
        await this.stop();
        return { passed: false, reason: `Merge failed: ${errorMessage}` };
      }

      if (!disableVerification) {
        // Update status to 'verifying'
        try {
          await this.featureStore.updateFeatureStatus(feature.id, 'verifying');
          this.io.emit('feature:updated', { ...feature, status: 'verifying' });
        } catch { /* best effort */ }
      }

      if (disableVerification) {
        this.verificationMutex.release();
        logger.info(`Feature ${feature.id} verification skipped (ORCHESTRATOR_DISABLE_VERIFICATION=1). Released lock.`);
        const progress = this.buildProgressSummary(
          feature, implementationSessionId, 'passed', Date.now() - verifyStartedAt, branchName
        );
        await this.featureStore.updateFeatureStatus(feature.id, 'passed', undefined, undefined, progress);
        this.io.emit('feature:updated', { ...feature, status: 'passed', progress, failure_reason: undefined, failure_category: undefined });
        return { passed: true };
      }

      // Wait for server hot-reload
      logger.info(`Feature ${feature.id} verification attempt ${attempt}/${maxAttempts} — waiting ${propagationDelay}ms for hot-reload...`);
      await new Promise(resolve => setTimeout(resolve, propagationDelay));

      // Create verification session
      const verifySessionId = `verify-${nanoid()}`;
      this.sessionDB.createSession({
        id: verifySessionId,
        feature_id: feature.id,
        track: 'verification',
        branch: branchName,
        status: 'running',
        started_at: new Date().toISOString(),
        finished_at: null,
        duration_ms: null,
        prompt: this.agentExecutor.buildVerificationPrompt(feature),
        retry_info: `Attempt ${attempt}/${maxAttempts}. Implementation session: ${implementationSessionId}`,
        full_output: null,
        structured_messages: null,
        error_message: null,
      });

      this.io.emit('session:started', {
        id: verifySessionId,
        feature_id: feature.id,
        track: 'verification',
        branch: branchName,
        status: 'running',
        started_at: new Date().toISOString(),
      });

      // Run verification agent in project root
      const verifyStartTime = Date.now();
      const verifyResult = await this.agentExecutor.executeVerification(
        verifySessionId,
        feature,
        implementationAgent,
        () => this.state !== 'running'
      );
      const verifyDurationMs = Date.now() - verifyStartTime;

      // Check output for FAIL verdict (agents often exit 0 even when reporting failures)
      const outputHasFailVerdict = /\bVERDICT:\s*FAIL/i.test(verifyResult.output || '')
        || /\bSTEP\s+\d+:\s*FAIL/i.test(verifyResult.output || '');
      const verifyPassed = verifyResult.success && !outputHasFailVerdict;

      // Update verification session in DB
      this.sessionDB.updateSession(verifySessionId, {
        status: verifyPassed ? 'passed' : 'failed',
        finished_at: new Date().toISOString(),
        duration_ms: verifyDurationMs,
        full_output: verifyResult.output || null,
        structured_messages: verifyResult.messages.length > 0 ? JSON.stringify(verifyResult.messages) : null,
        error_message: verifyPassed ? null : (verifyResult.error || 'Verification failed'),
      });

      const verifyFinished = this.sessionDB.getSession(verifySessionId);
      if (verifyFinished) {
        this.io.emit('session:finished', verifyFinished);
      }

      // ── Handle verification result ──
      if (outputHasFailVerdict && verifyResult.success) {
        logger.warn(`Feature ${feature.id} agent exited 0 but output contains FAIL verdict — treating as failed`);
      }

      if (verifyPassed) {
        // ✅ PASSED
        this.verificationMutex.release();
        logger.info(`Feature ${feature.id} PASSED verification on attempt ${attempt}. Released lock.`);

        const progress = this.buildProgressSummary(
          feature, implementationSessionId, 'passed', Date.now() - verifyStartedAt, branchName
        );
        await this.featureStore.updateFeatureStatus(feature.id, 'passed', undefined, undefined, progress);
        this.io.emit('feature:updated', { ...feature, status: 'passed', progress, failure_reason: undefined, failure_category: undefined });
        return { passed: true };
      }

      // ❌ FAILED — try to fix (code stays on develop, no revert)
      lastReason = verifyResult.error || 'Verification failed';
      lastVerifyOutput = verifyResult.output || '';
      logger.warn(`Feature ${feature.id} FAILED verification attempt ${attempt}: ${lastReason}`);

      // Run fix agent in worktree if we have attempts remaining
      if (attempt < maxAttempts && this.state === 'running') {
        logger.info(`Feature ${feature.id} — running fix agent in worktree (attempt ${attempt}/${maxAttempts})`);

        const fixSessionId = `fix-${nanoid()}`;
        this.sessionDB.createSession({
          id: fixSessionId,
          feature_id: feature.id,
          track: 'fix',
          branch: branchName,
          status: 'running',
          started_at: new Date().toISOString(),
          finished_at: null,
          duration_ms: null,
          prompt: this.agentExecutor.buildFixPrompt(feature, lastVerifyOutput, attempt, maxAttempts),
          retry_info: `Fix after verification attempt ${attempt}`,
          full_output: null,
          structured_messages: null,
          error_message: null,
        });

        this.io.emit('session:started', {
          id: fixSessionId,
          feature_id: feature.id,
          track: 'fix',
          branch: branchName,
          status: 'running',
          started_at: new Date().toISOString(),
        });

        // Fix agent runs in feature worktree
        const fixStartTime = Date.now();
        const fixResult = await this.agentExecutor.executeFix(
          fixSessionId,
          feature,
          lastVerifyOutput,
          attempt,
          maxAttempts,
          worktreePath,
          implementationAgent,
          () => this.state !== 'running'
        );
        const fixDurationMs = Date.now() - fixStartTime;

        this.sessionDB.updateSession(fixSessionId, {
          status: fixResult.success ? 'passed' : 'failed',
          finished_at: new Date().toISOString(),
          duration_ms: fixDurationMs,
          full_output: fixResult.output || null,
          structured_messages: fixResult.messages.length > 0 ? JSON.stringify(fixResult.messages) : null,
          error_message: fixResult.success ? null : (fixResult.error || null),
        });

        const fixFinished = this.sessionDB.getSession(fixSessionId);
        if (fixFinished) {
          this.io.emit('session:finished', fixFinished);
        }

        if (fixResult.success) {
          logger.info(`Feature ${feature.id} fix completed. Will re-merge/re-push before next verify.`);
        } else {
          logger.warn(`Fix agent failed for feature ${feature.id}. Will still try verification again.`);
        }

        // Auto-commit any leftover changes from fix to avoid losing work
        try {
          const fixCommitMsg = `fix(#${feature.id}): verification fix for "${feature.name}"`;
          const didCommit = await this.gitManager.commitAllIfDirty(worktreePath, fixCommitMsg);
          if (didCommit) {
            this.emitSessionMessage(implementationSessionId, {
              type: 'system',
              agent: 'system',
              timestamp: new Date().toISOString(),
              content: `Auto-committed fix changes on ${branchName}: "${fixCommitMsg}"`,
            });
          }
        } catch (commitErr) {
          const errMsg = commitErr instanceof Error ? commitErr.message : String(commitErr);
          this.emitSessionMessage(implementationSessionId, {
            type: 'system',
            agent: 'system',
            timestamp: new Date().toISOString(),
            content: `Failed to auto-commit fix changes: ${errMsg}. Stopping orchestrator.`,
          });
          await this.stop();
          this.verificationMutex.release();
          return { passed: false, reason: `Fix commit failed: ${errMsg}` };
        }
      }
    }

    // All attempts exhausted — code is still on develop, just mark verification status
    this.verificationMutex.release();
    logger.warn(`Feature ${feature.id} verification failed after ${maxAttempts} attempts. Code remains on develop. Released lock.`);

    const failReason = `Verification failed after ${maxAttempts} attempts (code merged): ${lastReason}`;
    const progress = this.buildProgressSummary(
      feature, implementationSessionId, 'failed', Date.now() - verifyStartedAt, branchName, failReason
    );
    await this.featureStore.updateFeatureStatus(
      feature.id,
      'failed',
      failReason,
      'verification',
      progress
    );
    this.io.emit('feature:updated', {
      ...feature,
      status: 'failed',
      failure_reason: failReason,
      failure_category: 'verification',
      progress,
    });

    return { passed: false, reason: `Verification failed after ${maxAttempts} attempts: ${lastReason}` };
  }
}
