import type { Feature, Session, OrchestratorStatus, SettingDefinition, TrackDefinition, ProjectStatus } from '../types';

const API_BASE = '/api';

async function apiRequest(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status} ${res.statusText}`);
  }
  return res;
}

export async function fetchFeatures(): Promise<Feature[]> {
  const res = await apiRequest(`${API_BASE}/features`);
  const data = await res.json();
  return data.features ?? [];
}

export async function fetchSessions(params?: { limit?: number; offset?: number; featureId?: number }): Promise<{ sessions: Session[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  if (params?.featureId) query.set('featureId', String(params.featureId));
  const res = await apiRequest(`${API_BASE}/sessions?${query}`);
  return res.json();
}

export async function fetchSession(id: string): Promise<Session> {
  const res = await apiRequest(`${API_BASE}/sessions/${id}`);
  const data = await res.json();
  return data.session;
}

export async function startOrchestrator(): Promise<void> {
  await apiRequest(`${API_BASE}/start`, { method: 'POST' });
}

export async function stopOrchestrator(): Promise<void> {
  await apiRequest(`${API_BASE}/stop`, { method: 'POST' });
}

export async function retryFeature(featureId: number, extraContext: string): Promise<void> {
  await apiRequest(`${API_BASE}/retry/${featureId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ extraContext }),
  });
}

export async function resumeFeature(featureId: number, prompt: string): Promise<void> {
  await apiRequest(`${API_BASE}/resume/${featureId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

export async function fetchStatus(): Promise<OrchestratorStatus> {
  const res = await apiRequest(`${API_BASE}/status`);
  return res.json();
}

export async function fetchSettings(): Promise<SettingDefinition[]> {
  const res = await apiRequest(`${API_BASE}/settings`);
  const data = await res.json();
  return data.settings ?? [];
}

export async function updateSettings(settings: Record<string, string>): Promise<SettingDefinition[]> {
  const res = await apiRequest(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  const data = await res.json();
  return data.settings ?? [];
}

export async function fetchConfig(): Promise<{ projectName: string; tracks: TrackDefinition[] }> {
  const res = await apiRequest(`${API_BASE}/config`);
  return res.json();
}

export async function fetchProject(): Promise<ProjectStatus> {
  const res = await apiRequest(`${API_BASE}/project`);
  return res.json();
}

export async function setProject(projectRoot: string): Promise<ProjectStatus> {
  const res = await apiRequest(`${API_BASE}/project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectRoot }),
  });
  return res.json();
}
