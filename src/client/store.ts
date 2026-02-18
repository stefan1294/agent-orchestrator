import { create } from 'zustand';
import type { Feature, Session, OrchestratorStatus, AgentMessage } from './types';

export interface CriticalAlert {
  track: string;
  reason: string;
  consecutiveFailures: number;
  message: string;
  timestamp: string;
}

interface OrchestratorStore {
  // State
  features: Feature[];
  sessions: Session[];
  status: OrchestratorStatus;
  liveOutput: Map<string, AgentMessage[]>; // sessionId -> messages
  criticalAlerts: CriticalAlert[];
  newCategories: string[];

  // Actions
  setFeatures: (features: Feature[]) => void;
  updateFeature: (feature: Feature) => void;
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (session: Session) => void;
  setStatus: (status: OrchestratorStatus) => void;
  appendLiveOutput: (sessionId: string, message: AgentMessage) => void;
  clearLiveOutput: (sessionId: string) => void;
  addCriticalAlert: (alert: CriticalAlert) => void;
  dismissCriticalAlert: (index: number) => void;
  setNewCategories: (cats: string[]) => void;
  clearNewCategories: () => void;
}

export const useStore = create<OrchestratorStore>((set) => ({
  features: [],
  sessions: [],
  status: { state: 'stopped', tracks: [], startedAt: null },
  liveOutput: new Map(),
  criticalAlerts: [],
  newCategories: [],

  setFeatures: (features) => set({ features }),

  updateFeature: (updated) => set((state) => ({
    features: state.features.map(f => f.id === updated.id ? updated : f),
  })),

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) => set((state) => ({
    sessions: [session, ...state.sessions],
  })),

  updateSession: (updated) => set((state) => ({
    sessions: state.sessions.map(s => s.id === updated.id ? updated : s),
  })),

  setStatus: (status) => set({ status }),

  appendLiveOutput: (sessionId, message) => set((state) => {
    const newMap = new Map(state.liveOutput);
    const existing = newMap.get(sessionId) || [];
    newMap.set(sessionId, [...existing, message]);
    return { liveOutput: newMap };
  }),

  clearLiveOutput: (sessionId) => set((state) => {
    const newMap = new Map(state.liveOutput);
    newMap.delete(sessionId);
    return { liveOutput: newMap };
  }),

  addCriticalAlert: (alert) => set((state) => ({
    criticalAlerts: [...state.criticalAlerts, alert],
  })),

  dismissCriticalAlert: (index) => set((state) => ({
    criticalAlerts: state.criticalAlerts.filter((_, i) => i !== index),
  })),

  setNewCategories: (cats) => set({ newCategories: cats }),
  clearNewCategories: () => set({ newCategories: [] }),
}));
