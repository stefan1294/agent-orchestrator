import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import LiveOutput from '../components/LiveOutput';
import MessageViewer from '../components/MessageViewer';
import { fetchSession } from '../hooks/useApi';
import type { Session } from '../types';

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleString();
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '-';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (minutes === 0) return `${secs}s`;
  return `${minutes}m ${secs}s`;
}

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'output' | 'messages'>('output');

  useEffect(() => {
    const loadSession = async () => {
      if (!id) return;

      try {
        setLoading(true);
        setError(null);
        const data = await fetchSession(id);
        setSession(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      } finally {
        setLoading(false);
      }
    };

    loadSession();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-400">Loading session...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-4"
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <div className="p-4 bg-red-950 text-red-200 rounded-lg border border-red-800">
          {error}
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-4"
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <div className="text-gray-400">Session not found.</div>
      </div>
    );
  }

  const isRunning = session.status === 'running';

  const statusBadgeClasses = () => {
    switch (session.status) {
      case 'passed':
        return 'px-3 py-1 rounded-full text-sm font-medium bg-green-950 text-green-200 border border-green-800';
      case 'failed':
        return 'px-3 py-1 rounded-full text-sm font-medium bg-red-950 text-red-200 border border-red-800';
      case 'running':
        return 'px-3 py-1 rounded-full text-sm font-medium bg-blue-950 text-blue-200 border border-blue-800';
      default:
        return 'px-3 py-1 rounded-full text-sm font-medium bg-gray-800 text-gray-300 border border-gray-700';
    }
  };

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-blue-400 hover:text-blue-300"
      >
        <ArrowLeft size={18} />
        Back
      </button>

      <div className="space-y-2">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold text-white">{session.featureName || `Feature #${session.feature_id}`}</h1>
          <span className={statusBadgeClasses()}>{session.status}</span>
        </div>
        <p className="text-gray-400 font-mono text-sm">{session.id}</p>
        {session.branch && (
          <p className="text-gray-400 text-sm">
            Branch: <span className="font-mono">{session.branch}</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <p className="text-gray-400 text-sm mb-1">Started At</p>
          <p className="text-gray-100 font-mono text-sm">
            {formatDate(session.started_at)}
          </p>
        </div>
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <p className="text-gray-400 text-sm mb-1">Finished At</p>
          <p className="text-gray-100 font-mono text-sm">
            {session.finished_at ? formatDate(session.finished_at) : '-'}
          </p>
        </div>
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <p className="text-gray-400 text-sm mb-1">Duration</p>
          <p className="text-gray-100 font-mono text-sm">
            {formatDuration(session.duration_ms)}
          </p>
        </div>
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <p className="text-gray-400 text-sm mb-1">Track</p>
          <p className="text-gray-100 font-mono text-sm">
            {session.track || '-'}
          </p>
        </div>
      </div>

      {session.retry_info && (
        <div className="p-4 rounded-lg bg-yellow-950 border border-yellow-800">
          <p className="text-yellow-200">
            <span className="font-semibold">Retry Info:</span> {session.retry_info}
          </p>
        </div>
      )}

      {session.error_message && (
        <div className="p-4 rounded-lg bg-red-950 border border-red-800">
          <p className="text-red-200">
            <span className="font-semibold">Error:</span> {session.error_message}
          </p>
        </div>
      )}

      {isRunning ? (
        <div>
          <h2 className="text-xl font-semibold text-white mb-4">Live Output</h2>
          <LiveOutput sessionId={session.id} />
        </div>
      ) : (
        <div>
          <div className="flex gap-2 border-b border-gray-800 mb-6">
            <button
              onClick={() => setActiveTab('output')}
              className={`px-4 py-2 font-medium transition ${
                activeTab === 'output'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              Output
            </button>
            <button
              onClick={() => setActiveTab('messages')}
              className={`px-4 py-2 font-medium transition ${
                activeTab === 'messages'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              Messages
            </button>
          </div>

          {activeTab === 'output' && (
            <div className="rounded-lg bg-gray-950 border border-gray-800 overflow-hidden">
              <pre className="p-4 overflow-auto max-h-96 text-xs text-gray-300 font-mono whitespace-pre-wrap break-words">
                {session.full_output || 'No output available.'}
              </pre>
            </div>
          )}

          {activeTab === 'messages' && (
            <MessageViewer messages={session.structured_messages || []} />
          )}
        </div>
      )}
    </div>
  );
}
