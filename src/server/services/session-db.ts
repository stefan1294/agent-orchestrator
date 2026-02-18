import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

export interface Session {
  id: string;
  feature_id: number;
  track: string;
  branch: string;
  status: 'running' | 'passed' | 'failed' | 'error';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  prompt: string;
  retry_info: string | null;
  full_output: string | null;
  structured_messages: string | null;
  error_message: string | null;
  created_at: string;
}

export interface GetSessionsOptions {
  limit?: number;
  offset?: number;
  featureId?: number;
  track?: string;
  status?: string;
}

export interface GetSessionCountFilters {
  featureId?: number;
  track?: string;
  status?: string;
}

export class SessionDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  async initDatabase(): Promise<void> {

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        feature_id INTEGER NOT NULL,
        track TEXT NOT NULL,
        branch TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        prompt TEXT NOT NULL,
        retry_info TEXT,
        full_output TEXT,
        structured_messages TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_feature ON sessions(feature_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_track ON sessions(track);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    `;

    this.db.exec(createTableSQL);

    // Legacy settings table removed — all config is now in .orchestrator/config.json
  }

  createSession(session: Omit<Session, 'created_at'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, feature_id, track, branch, status, started_at, finished_at,
        duration_ms, prompt, retry_info, full_output, structured_messages, error_message
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      session.id,
      session.feature_id,
      session.track,
      session.branch,
      session.status,
      session.started_at,
      session.finished_at,
      session.duration_ms,
      session.prompt,
      session.retry_info,
      session.full_output,
      session.structured_messages,
      session.error_message
    );
  }

  updateSession(id: string, updates: Partial<Session>): void {
    const allowedFields = [
      'feature_id',
      'track',
      'branch',
      'status',
      'started_at',
      'finished_at',
      'duration_ms',
      'prompt',
      'retry_info',
      'full_output',
      'structured_messages',
      'error_message',
    ];

    const updateFields = Object.keys(updates).filter((key) =>
      allowedFields.includes(key)
    );

    if (updateFields.length === 0) {
      return;
    }

    const setClause = updateFields.map((field) => `${field} = ?`).join(', ');
    const values = updateFields.map((field) => updates[field as keyof Session]);

    const stmt = this.db.prepare(`
      UPDATE sessions SET ${setClause} WHERE id = ?
    `);

    stmt.run(...values, id);
  }

  getSession(id: string): Session | undefined {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    return stmt.get(id) as Session | undefined;
  }

  getSessions(options: GetSessionsOptions = {}): Session[] {
    let query = 'SELECT * FROM sessions WHERE 1 = 1';
    const params: (string | number)[] = [];

    if (options.featureId !== undefined) {
      query += ' AND feature_id = ?';
      params.push(options.featureId);
    }

    if (options.track !== undefined) {
      query += ' AND track = ?';
      params.push(options.track);
    }

    if (options.status !== undefined) {
      query += ' AND status = ?';
      params.push(options.status);
    }

    query += ' ORDER BY started_at DESC';

    if (options.limit !== undefined) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset !== undefined) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Session[];
  }

  getLatestSessionForFeature(featureId: number): Session | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE feature_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `);
    return stmt.get(featureId) as Session | undefined;
  }

  getSessionCount(filters?: GetSessionCountFilters): number {
    let query = 'SELECT COUNT(*) as count FROM sessions WHERE 1 = 1';
    const params: (string | number)[] = [];

    if (filters?.featureId !== undefined) {
      query += ' AND feature_id = ?';
      params.push(filters.featureId);
    }

    if (filters?.track !== undefined) {
      query += ' AND track = ?';
      params.push(filters.track);
    }

    if (filters?.status !== undefined) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    const stmt = this.db.prepare(query);
    const result = stmt.get(...params) as { count: number };
    return result.count;
  }

  close(): void {
    this.db.close();
  }
}
