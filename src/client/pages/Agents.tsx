import { Bot, Clock, GitBranch, CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useEffect, useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchFeatures, fetchStatus } from '../hooks/useApi';
import { useStore } from '../store';
import type { TrackStatus, AgentMessage } from '../types';

function useElapsedTime(startedAt: string | null | undefined): string {
  const [elapsed, setElapsed] = useState('0s');

  useEffect(() => {
    if (!startedAt) {
      setElapsed('0s');
      return;
    }

    const update = () => {
      const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setElapsed(m > 0 ? `${m}m ${s}s` : `${s}s`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return elapsed;
}

function AgentOutputStream({ messages }: { messages: AgentMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const toggleExpanded = (index: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Waiting for output...
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {messages.map((msg, i) => {
        const isExpanded = expandedItems.has(i);

        if (msg.type === 'assistant' && msg.content) {
          return (
            <div key={i} className="border-l-2 border-emerald-600 pl-3 py-1">
              <p className="text-gray-200 text-xs leading-relaxed">{msg.content.substring(0, 300)}{msg.content.length > 300 ? '...' : ''}</p>
            </div>
          );
        }

        if (msg.type === 'tool_use') {
          return (
            <div key={i} className="border-l-2 border-blue-600 pl-3 py-1">
              <button
                onClick={() => toggleExpanded(i)}
                className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors text-xs font-mono"
              >
                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {msg.tool_name}
              </button>
              {isExpanded && msg.tool_input && (
                <pre className="mt-1 ml-4 text-[10px] text-gray-500 bg-gray-900/50 rounded p-2 overflow-x-auto max-h-32">
                  {typeof msg.tool_input === 'string' ? msg.tool_input : JSON.stringify(msg.tool_input, null, 2)}
                </pre>
              )}
            </div>
          );
        }

        if (msg.type === 'tool_result') {
          return (
            <div key={i} className="border-l-2 border-gray-700 pl-3 py-1">
              <button
                onClick={() => toggleExpanded(i)}
                className="flex items-center gap-1.5 text-gray-500 hover:text-gray-400 transition-colors text-xs font-mono"
              >
                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                result
              </button>
              {isExpanded && msg.tool_result && (
                <pre className="mt-1 ml-4 text-[10px] text-gray-600 bg-gray-900/50 rounded p-2 overflow-x-auto max-h-32">
                  {msg.tool_result.substring(0, 2000)}
                </pre>
              )}
            </div>
          );
        }

        return (
          <div key={i} className="border-l-2 border-gray-700 pl-3 py-1">
            <span className="text-gray-600 text-xs">[{msg.type}]</span>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

function AgentCard({
  track,
  trackStatus,
  resume,
}: {
  track: string;
  trackStatus?: TrackStatus;
  resume?: { featureId: number; track: string; requestedAt: string } | null;
}) {
  const liveOutput = useStore((s) => s.liveOutput);
  const sessions = useStore((s) => s.sessions);

  const isActive = !!trackStatus?.currentFeature;
  const isPausedForResume = !!resume && resume.track !== track;
  const currentFeature = trackStatus?.currentFeature;
  const currentSessionId = trackStatus?.currentSessionId;

  const messages = useMemo(() => {
    if (!currentSessionId) return [];
    return liveOutput.get(currentSessionId) || [];
  }, [liveOutput, currentSessionId]);

  // Find the latest session for timing info
  const currentSession = useMemo(() => {
    if (!currentSessionId) return null;
    return sessions.find((s) => s.id === currentSessionId) ?? null;
  }, [sessions, currentSessionId]);

  const elapsed = useElapsedTime(isActive ? (currentSession?.started_at ?? new Date().toISOString()) : null);

  // Use config color or generate deterministic one from track name
  const trackLabel = `${track.charAt(0).toUpperCase() + track.slice(1)} Agent`;

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      {/* Agent Header */}
      <div className={`px-5 py-4 border-b border-gray-800 bg-gray-900`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gray-800 border border-gray-700">
              <Bot className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{trackLabel}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                {isActive ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-green-400">Running</span>
                  </>
                ) : isPausedForResume ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-xs text-blue-300">Paused for resume</span>
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 rounded-full bg-gray-600" />
                    <span className="text-xs text-gray-500">Idle</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 text-gray-400">
              <Loader2 className="w-3.5 h-3.5" />
              <span>{trackStatus?.queued ?? 0} queued</span>
            </div>
            <div className="flex items-center gap-1.5 text-green-400">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>{trackStatus?.completed ?? 0}</span>
            </div>
            <div className="flex items-center gap-1.5 text-red-400">
              <XCircle className="w-3.5 h-3.5" />
              <span>{trackStatus?.failed ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Current Feature Info */}
        {isActive && currentFeature && (
          <div className={`mt-3 p-3 rounded-lg bg-gray-950 border border-gray-800`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-white">
                #{currentFeature.id} — {currentFeature.name}
              </span>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {elapsed}
                </span>
                {currentSessionId && (
                  <Link
                    to={`/sessions/${currentSessionId}`}
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Details
                  </Link>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500">{currentFeature.description}</p>
            {currentSession?.branch && (
              <div className="flex items-center gap-1 mt-2 text-xs text-gray-600">
                <GitBranch className="w-3 h-3" />
                <span className="font-mono">{currentSession.branch}</span>
              </div>
            )}
          </div>
        )}

        {!isActive && (
          <div className="mt-3 p-3 rounded-lg bg-gray-950 border border-gray-800 text-center">
            <p className="text-sm text-gray-600">
              {isPausedForResume
                ? 'Paused while resume feature runs on the other track.'
                : (trackStatus?.queued ?? 0) > 0
                  ? 'Waiting to start next feature...'
                  : 'No features in queue'}
            </p>
          </div>
        )}
      </div>

      {/* Live Output Stream */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-950 font-mono min-h-0">
        <AgentOutputStream messages={messages} />
      </div>
    </div>
  );
}

export default function Agents() {
  const { status, setFeatures, setStatus } = useStore();

  useEffect(() => {
    const loadData = async () => {
      try {
        const [featuresData, statusData] = await Promise.all([
          fetchFeatures(),
          fetchStatus(),
        ]);
        setFeatures(featuresData);
        setStatus(statusData);
      } catch {
        // Dashboard handles error display; agents page just tries to load
      }
    };

    loadData();
  }, [setFeatures, setStatus]);

  const tracks = status.tracks ?? [];
  const resume = status.resume ?? null;
  const isRunning = status.state === 'running';

  // Dynamic grid: 1 col for 1 track, 2 for 2, 3 for 3+
  const gridCols = tracks.length <= 1 ? 'grid-cols-1' : tracks.length === 2 ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div className="h-[calc(100vh-5rem)] flex flex-col gap-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Live Agents</h1>
        <div className="flex items-center gap-2 text-sm">
          {isRunning ? (
            <span className="flex items-center gap-2 text-green-400">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Orchestrator running
            </span>
          ) : (
            <span className="text-gray-500">Orchestrator stopped</span>
          )}
        </div>
      </div>

      {resume && (
        <div className="p-4 bg-blue-950/40 text-blue-200 rounded-lg border border-blue-900">
          Resume in progress: Feature #{resume.featureId} is prioritized on the {resume.track} track.
          Other tracks will pause before starting their next feature.
        </div>
      )}

      {/* Dynamic Agent View */}
      <div className={`grid ${gridCols} gap-4 flex-1 min-h-0`}>
        {tracks.map((t) => (
          <AgentCard key={t.name} track={t.name} trackStatus={t} resume={resume} />
        ))}
        {tracks.length === 0 && (
          <div className="flex items-center justify-center text-gray-600 text-sm">
            No tracks configured. Add tracks in Settings.
          </div>
        )}
      </div>
    </div>
  );
}
