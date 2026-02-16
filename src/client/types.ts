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
  latestSession?: SessionSummary | null;
}

export interface SessionSummary {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  branch: string;
  error_message: string | null;
}

export interface Session {
  id: string;
  feature_id: number;
  featureName?: string;
  track: string;
  branch: string;
  status: 'running' | 'passed' | 'failed' | 'error';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  prompt: string;
  retry_info: string | null;
  full_output: string | null;
  structured_messages: AgentMessage[] | null;
  error_message: string | null;
}

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

export interface TrackStatus {
  name: string;
  currentFeature: Feature | null;
  currentSessionId: string | null;
  queued: number;
  completed: number;
  failed: number;
}

export interface SettingDefinition {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'tags' | 'json';
  value: string;
  defaultValue: string;
  options?: string[];
  group: string;
  description?: string;
  recommendation?: string;
}

export interface ProjectStatus {
  configured: boolean;
  projectRoot: string | null;
  projectName: string | null;
}

export interface TrackDefinition {
  name: string;
  categories: string[];
  color?: string;
  isDefault?: boolean;
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
