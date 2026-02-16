import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';
import { useStore } from '../store';
import type { Feature, Session, AgentMessage, OrchestratorStatus } from '../types';

let socket: Socket | null = null;

export function useSocket() {
  const { updateFeature, addSession, updateSession, setStatus, appendLiveOutput, addCriticalAlert } = useStore();

  useEffect(() => {
    if (socket) return;

    socket = io(window.location.origin);

    socket.on('feature:updated', (feature: Feature) => {
      updateFeature(feature);
    });

    socket.on('session:started', (session: Session) => {
      addSession(session);
    });

    socket.on('session:finished', (session: Session) => {
      updateSession(session);
    });

    socket.on('orchestrator:status', (status: OrchestratorStatus) => {
      setStatus(status);
    });

    socket.on('agent:output', ({ sessionId, message }: { sessionId: string; message: AgentMessage }) => {
      appendLiveOutput(sessionId, message);
    });

    socket.on('track:critical_failure', (data: { track: string; reason: string; consecutiveFailures: number; message: string }) => {
      addCriticalAlert({
        ...data,
        timestamp: new Date().toISOString(),
      });
    });

    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, []);
}
