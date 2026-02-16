export interface Feature {
  id: number;
  category: string;
  name: string;
  description: string;
  steps: string[];
  status: 'open' | 'verifying' | 'passed' | 'failed';
  failure_reason?: string;
  failure_category?: 'environment' | 'test_only' | 'implementation' | 'verification' | 'unknown';
  progress?: string;
}

export interface FeaturesFile {
  features: Feature[];
}

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
  structured_messages: string | null;  // JSON array
  error_message: string | null;
  created_at: string;
}

export interface QueueItem {
  featureId: number;
  isRetry: boolean;
  extraContext?: string;
  previousSessionId?: string;
}

export interface TrackStatus {
  name: string;
  currentFeature: Feature | null;
  currentSessionId: string | null;
  queued: number;
  completed: number;
  failed: number;
}

export interface OrchestratorStatus {
  state: 'stopped' | 'running' | 'stopping';
  tracks: TrackStatus[];
  startedAt: string | null;
  resume?: {
    featureId: number;
    track: string;
    requestedAt: string;
  } | null;
}

export type OrchestratorState = 'stopped' | 'running' | 'stopping';

export interface AgentMessage {
  type: string;
  timestamp: string;
  agent?: 'claude' | 'codex' | 'gemini' | 'system';
  content?: string;
  tool_name?: string;
  tool_input?: any;
  tool_result?: string;
  raw?: any;
}
