import { exec as execCb } from 'child_process';
import { mkdir, symlink, readlink, unlink, stat, copyFile, access, chmod, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { Mutex } from '../utils/lock.js';
import { logger } from '../utils/logger.js';
import { slugify } from '../utils/slugify.js';
import type { ProjectConfig } from './project-config.js';
import { generateDockerWorktreeScript } from './project-config.js';

const exec = promisify(execCb);

export interface PreparedBranch {
  branchName: string;
  worktreePath: string;
}

export class GitManager {
  private projectRoot: string;
  private worktreesDir: string;
  private config: ProjectConfig;
  // Mutex protects operations on the shared .git directory
  // (branch creation, worktree add/remove, merge)
  private gitMutex: Mutex;

  constructor(projectRoot: string, config: ProjectConfig) {
    this.projectRoot = projectRoot;
    this.config = config;
    this.worktreesDir = path.join(projectRoot, '.worktrees');
    this.gitMutex = new Mutex();
  }

  // Preserve files list from config
  private get PRESERVE_FILES(): string[] {
    return this.config.worktree.preserveFiles;
  }

  private async execGit(cmd: string, cwd?: string): Promise<string> {
    const workDir = cwd || this.projectRoot;
    try {
      const { stdout } = await exec(cmd, { cwd: workDir });
      return stdout.trim();
    } catch (error) {
      logger.error(`Git command failed: ${cmd} (cwd: ${workDir})`, error);
      throw error;
    }
  }

  /**
   * Backup files that must survive git checkout/merge/reset operations.
   * Returns a map of relative path → file contents.
   */
  private async backupPreservedFiles(): Promise<Map<string, string>> {
    const backups = new Map<string, string>();
    for (const file of this.PRESERVE_FILES) {
      const filePath = path.join(this.projectRoot, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        backups.set(file, content);
        logger.debug(`Backed up ${file} before git operation`);
      } catch {
        // File doesn't exist — nothing to backup
      }
    }
    return backups;
  }

  /**
   * Restore previously backed-up files after git operations.
   */
  private async restorePreservedFiles(backups: Map<string, string>): Promise<void> {
    for (const [file, content] of backups) {
      const filePath = path.join(this.projectRoot, file);
      try {
        await writeFile(filePath, content, 'utf-8');
        logger.debug(`Restored ${file} after git operation`);
      } catch (err) {
        logger.error(`Failed to restore ${file} after git operation`, err);
      }
    }
  }

  /**
   * Initialize the worktrees directory and ensure main repo is on develop.
   * Call once at orchestrator start.
   */
  async init(): Promise<void> {
    await mkdir(this.worktreesDir, { recursive: true });

    await this.gitMutex.acquire();
    try {
      // Backup features.json etc before any git operations that touch the working tree
      const backups = await this.backupPreservedFiles();

      // Clean up any stale worktrees from a previous run
      await this.execGit('git worktree prune');

      // Stash any uncommitted changes left over from previous runs
      // (e.g. restorePreservedFiles writes, agents cd-ing to project root)
      // Without this, checkout/pull can fail on a dirty working tree.
      const status = await this.execGit('git status --porcelain');
      if (status.trim()) {
        logger.info('Stashing leftover uncommitted changes before init');
        await this.execGit('git stash --include-untracked');
      }

      // Ensure baseBranch exists — create it from HEAD if it doesn't
      const baseBranch = this.config.baseBranch;
      const baseBranchExists = await this.branchExistsUnsafe(baseBranch);
      if (!baseBranchExists) {
        const currentBranch = await this.execGit('git rev-parse --abbrev-ref HEAD');
        logger.info(`Branch '${baseBranch}' does not exist — creating it from '${currentBranch}'`);
        await this.execGit(`git checkout -b ${baseBranch}`);
      } else {
        await this.execGit(`git checkout ${baseBranch}`);
      }

      // Pull latest if the branch has a remote tracking branch
      try {
        await this.execGit(`git pull origin ${baseBranch}`);
      } catch {
        // Remote branch may not exist yet (fresh local branch) — that's fine
        logger.info(`No remote branch 'origin/${baseBranch}' found — skipping pull`);
      }

      // Restore preserved files (checkout/pull may have overwritten them)
      await this.restorePreservedFiles(backups);

      logger.info(`Main repo on ${baseBranch} and ready`);
    } finally {
      this.gitMutex.release();
    }
  }

  /**
   * Prepare a branch for a feature and create a worktree for the track.
   *
   * Each track gets its own worktree at .worktrees/<track>/
   * so both tracks can work simultaneously on different branches.
   *
   * Returns the branch name and the worktree path (the cwd for the agent).
   */
  async prepareBranch(
    track: string,
    featureId: number,
    featureName: string,
    isRetry: boolean
  ): Promise<PreparedBranch> {
    const branchName = `feature/${featureId}-${slugify(featureName)}`;
    const worktreePath = path.join(this.worktreesDir, track);

    await this.gitMutex.acquire();
    try {
      // 1. Remove any existing worktree for this track (from previous feature)
      await this.removeWorktreeUnsafe(track);

      // 2. Check if branch already exists
      const exists = await this.branchExistsUnsafe(branchName);

      const baseBranch = this.config.baseBranch;

      if (!isRetry && !exists) {
        // New feature: create worktree with a new branch based on baseBranch
        await this.execGit(
          `git worktree add -b ${branchName} "${worktreePath}" ${baseBranch}`
        );
        logger.info(`Created new worktree + branch: ${branchName} at ${worktreePath}`);
      } else if (exists) {
        // Branch exists (retry, or re-run of a previously failed feature)
        await this.execGit(
          `git worktree add "${worktreePath}" ${branchName}`
        );
        logger.info(`Created worktree on existing branch: ${branchName} at ${worktreePath}`);
      } else {
        // Retry but branch doesn't exist — create fresh from baseBranch
        await this.execGit(
          `git worktree add -b ${branchName} "${worktreePath}" ${baseBranch}`
        );
        logger.warn(`Retry requested but branch didn't exist — created new: ${branchName}`);
      }

      // Post-setup: symlink dependencies and copy config files into worktree
      await this.setupWorktreeEnvironment(worktreePath);

      return { branchName, worktreePath };
    } finally {
      this.gitMutex.release();
    }
  }

  /**
   * Remove the worktree for a track. Safe to call even if it doesn't exist.
   */
  async cleanupWorktree(track: string): Promise<void> {
    await this.gitMutex.acquire();
    try {
      await this.removeWorktreeUnsafe(track);
    } finally {
      this.gitMutex.release();
    }
  }

  /**
   * Merge a feature branch into develop locally (NO push).
   * Returns the pre-merge commit SHA so we can revert if verification fails.
   */
  async mergeLocally(branch: string): Promise<string> {
    await this.gitMutex.acquire();
    try {
      const baseBranch = this.config.baseBranch;
      logger.info(`Starting local merge of ${branch} to ${baseBranch}`);

      // Backup preserved files BEFORE any git operation that could overwrite them
      const backups = await this.backupPreservedFiles();

      // Clean preserved files from working tree so checkout/pull/merge don't
      // see a dirty working tree (which would cause merge to fail).
      for (const file of this.PRESERVE_FILES) {
        try {
          await this.execGit(`git checkout -- ${file}`);
        } catch { /* file may not be tracked — that's fine */ }
      }

      // Ensure main repo is on baseBranch and up to date
      await this.execGit(`git checkout ${baseBranch}`);
      try {
        await this.execGit(`git pull origin ${baseBranch}`);
      } catch {
        // Remote branch may not exist yet — that's fine
      }

      // Capture pre-merge SHA for potential revert
      const preMergeSha = await this.execGit('git rev-parse HEAD');

      try {
        await this.execGit(`git merge ${branch} --no-edit`);
      } catch (mergeError) {
        // Abort so main repo stays clean
        try {
          await this.execGit('git merge --abort');
        } catch { /* ignore */ }

        // Restore preserved files after abort
        await this.restorePreservedFiles(backups);

        logger.error(`Merge conflict or failure for ${branch}`, mergeError);
        throw new Error(
          `Failed to merge ${branch} into ${baseBranch}. ` +
          `This may indicate a merge conflict or incompatible changes. ` +
          `Please review the branch and resolve conflicts manually.`
        );
      }

      // Restore preserved files ONLY after merge is complete
      await this.restorePreservedFiles(backups);

      logger.info(`Merged ${branch} to ${baseBranch} locally (not pushed). Pre-merge SHA: ${preMergeSha}`);
      return preMergeSha;
    } finally {
      this.gitMutex.release();
    }
  }

  /**
   * Push develop to origin. Call after verification passes.
   */
  async pushBaseBranch(): Promise<void> {
    await this.gitMutex.acquire();
    try {
      const baseBranch = this.config.baseBranch;
      await this.execGit(`git push origin ${baseBranch}`);
      logger.info(`Pushed ${baseBranch} to origin`);
    } finally {
      this.gitMutex.release();
    }
  }

  /** @deprecated Use pushBaseBranch() instead */
  async pushDevelop(): Promise<void> {
    return this.pushBaseBranch();
  }

  /**
   * Revert a merge by resetting develop to the pre-merge commit.
   * Call after verification fails.
   */
  async revertMerge(preMergeSha: string): Promise<void> {
    await this.gitMutex.acquire();
    try {
      const backups = await this.backupPreservedFiles();

      const baseBranch = this.config.baseBranch;
      logger.info(`Reverting ${baseBranch} to pre-merge state: ${preMergeSha}`);
      await this.execGit(`git checkout ${baseBranch}`);
      await this.execGit(`git reset --hard ${preMergeSha}`);

      await this.restorePreservedFiles(backups);
      logger.info(`Successfully reverted ${baseBranch} to ${preMergeSha}`);
    } finally {
      this.gitMutex.release();
    }
  }

  /**
   * Convenience: merge + push in one step (backward compat).
   */
  async mergeAndPush(branch: string): Promise<void> {
    await this.mergeLocally(branch);
    await this.pushBaseBranch();
  }

  /** @deprecated Use mergeAndPush() instead */
  async mergeToDevelop(branch: string): Promise<void> {
    return this.mergeAndPush(branch);
  }

  /**
   * Update a feature branch by merging the latest develop into it.
   * This prevents merge conflicts when parallel tracks have moved develop forward.
   * Must be called BEFORE mergeLocally() to ensure the feature branch is up-to-date.
   */
  async updateFeatureBranch(worktreePath: string): Promise<void> {
    await this.gitMutex.acquire();
    try {
      const baseBranch = this.config.baseBranch;
      logger.info(`Updating feature branch in ${worktreePath} with latest ${baseBranch}`);
      try {
        await this.execGit(`git merge ${baseBranch} --no-edit`, worktreePath);
        logger.info(`Successfully merged ${baseBranch} into feature branch at ${worktreePath}`);
      } catch (mergeError) {
        // Conflict — abort and throw descriptive error
        try {
          await this.execGit('git merge --abort', worktreePath);
        } catch { /* ignore */ }
        const errorMsg = mergeError instanceof Error ? mergeError.message : String(mergeError);
        throw new Error(
          `Failed to merge ${baseBranch} into feature branch at ${worktreePath}. ` +
          `This likely means both tracks modified the same files. Error: ${errorMsg}`
        );
      }
    } finally {
      this.gitMutex.release();
    }
  }

  async getCurrentBranch(cwd?: string): Promise<string> {
    return this.execGit('git rev-parse --abbrev-ref HEAD', cwd);
  }

  async commitAllIfDirty(worktreePath: string, message: string): Promise<boolean> {
    await this.gitMutex.acquire();
    try {
      const status = await this.execGit('git status --porcelain', worktreePath);
      if (!status.trim()) {
        return false;
      }
      await this.execGit('git add -A', worktreePath);
      await this.execGit(`git commit -m "${message.replace(/"/g, '\\"')}"`, worktreePath);
      return true;
    } finally {
      this.gitMutex.release();
    }
  }

  async getBranchStatus(branch: string, worktreePath: string): Promise<{ aheadCount: number; clean: boolean }> {
    await this.gitMutex.acquire();
    try {
      await this.execGit(`git rev-parse --verify ${branch}`);
      const baseBranch = this.config.baseBranch;
      const aheadRaw = await this.execGit(`git rev-list --count ${baseBranch}..${branch}`);
      const aheadCount = Number.parseInt(aheadRaw, 10) || 0;
      const status = await this.execGit('git status --porcelain', worktreePath);
      const clean = status.trim().length === 0;
      return { aheadCount, clean };
    } finally {
      this.gitMutex.release();
    }
  }

  /**
   * Set up the worktree environment so the agent can actually run:
   * - Symlink vendor/, node_modules/ from projectRoot (gitignored but needed)
   * - Copy .mcp.json so Claude CLI can discover MCP servers
   * - Fix permissions on .git/worktrees/<track>/ to prevent index.lock EPERM
   */
  private async setupWorktreeEnvironment(worktreePath: string): Promise<void> {
    const track = path.basename(worktreePath);

    // 1. Symlink gitignored directories from projectRoot
    //    Use RELATIVE symlinks so they resolve correctly both on the host
    //    AND inside Docker containers (where absolute paths differ).
    for (const dir of this.config.worktree.symlinkDirs) {
      const source = path.join(this.projectRoot, dir);
      const target = path.join(worktreePath, dir);
      const relativeSource = path.relative(worktreePath, source);
      try {
        await stat(source);
        // Source exists — create symlink in worktree
        try {
          // Check if target already exists (shouldn't after fresh checkout, but be safe)
          const existing = await stat(target).catch(() => null);
          if (existing) {
            // If it's already a symlink pointing to the right place, skip
            try {
              const linkTarget = await readlink(target);
              if (linkTarget === relativeSource) continue;
            } catch { /* not a symlink */ }
            // Remove whatever's there
            await unlink(target).catch(() => {});
          }
          await symlink(relativeSource, target, 'dir');
          logger.debug(`Symlinked ${dir}/ -> ${relativeSource} into worktree ${track}`);
        } catch (linkErr) {
          logger.warn(`Failed to symlink ${dir}/ into worktree ${track}: ${linkErr}`);
        }
      } catch {
        // Source doesn't exist in projectRoot — skip
        logger.debug(`${dir}/ not found in projectRoot, skipping symlink for worktree ${track}`);
      }
    }

    // 2. Copy config files so the agent can find MCP servers, env vars, etc.
    for (const file of this.config.worktree.copyFiles) {
      const source = path.join(this.projectRoot, file);
      const target = path.join(worktreePath, file);
      try {
        await stat(source);
        await copyFile(source, target);
        logger.debug(`Copied ${file} into worktree ${track}`);
      } catch {
        // Source doesn't exist — skip
        logger.debug(`${file} not found in projectRoot, skipping copy for worktree ${track}`);
      }
    }

    // 3. Fix permissions on .git/worktrees/<track>/ directory
    //    The index.lock EPERM error happens when the spawned agent process
    //    can't write to this shared git metadata directory
    const gitWorktreeMetaDir = path.join(this.projectRoot, '.git', 'worktrees', track);
    try {
      await stat(gitWorktreeMetaDir);
      // Make the directory and its contents readable/writable
      await chmod(gitWorktreeMetaDir, 0o755);
      // Also fix individual files inside so the spawned agent can create index.lock
      try {
        await exec(`chmod -R u+rw "${gitWorktreeMetaDir}"`);
      } catch { /* best effort */ }
      logger.debug(`Fixed permissions on .git/worktrees/${track}/`);
    } catch {
      logger.debug(`.git/worktrees/${track}/ not found, skipping permission fix`);
    }

    // 4. Clean up any stale index.lock from a previous crashed run
    const staleLock = path.join(gitWorktreeMetaDir, 'index.lock');
    try {
      await stat(staleLock);
      await unlink(staleLock);
      logger.info(`Removed stale index.lock in .git/worktrees/${track}/`);
    } catch {
      // No stale lock — good
    }

    // 5. Create worktree setup script (e.g. Docker wrapper)
    //    The script content comes from config or is auto-generated from Docker settings.
    const scriptContent = this.config.worktree.setupScript ?? generateDockerWorktreeScript(this.config);
    const scriptName = this.config.worktree.setupScriptName;

    if (scriptContent && scriptName) {
      const scriptPath = path.join(worktreePath, scriptName);
      try {
        await writeFile(scriptPath, scriptContent, { mode: 0o755 });
        logger.debug(`Created ${scriptName} wrapper in worktree ${track}`);
      } catch (err) {
        logger.warn(`Failed to create ${scriptName} in worktree ${track}: ${err}`);
      }

      // 6. Add setup script to .git/info/exclude so git ignores it
      const excludeFile = path.join(this.projectRoot, '.git', 'info', 'exclude');
      try {
        let excludeContent = '';
        try {
          excludeContent = await readFile(excludeFile, 'utf-8');
        } catch { /* file may not exist */ }
        if (!excludeContent.includes(scriptName)) {
          const newLine = excludeContent.endsWith('\n') || excludeContent === '' ? '' : '\n';
          await writeFile(excludeFile, excludeContent + newLine + scriptName + '\n', 'utf-8');
          logger.debug(`Added ${scriptName} to .git/info/exclude`);
        }
      } catch (err) {
        logger.warn(`Failed to update .git/info/exclude: ${err}`);
      }
    }
  }

  // --- Internal helpers (call only when mutex is already held) ---

  private async branchExistsUnsafe(branch: string): Promise<boolean> {
    try {
      await this.execGit(`git rev-parse --verify ${branch}`);
      return true;
    } catch {
      return false;
    }
  }

  private async removeWorktreeUnsafe(track: string): Promise<void> {
    const worktreePath = path.join(this.worktreesDir, track);
    try {
      await this.execGit(`git worktree remove "${worktreePath}" --force`);
      logger.debug(`Removed worktree at ${worktreePath}`);
    } catch {
      // Worktree doesn't exist — that's fine
    }
    try {
      await this.execGit('git worktree prune');
    } catch { /* ignore */ }
  }
}
