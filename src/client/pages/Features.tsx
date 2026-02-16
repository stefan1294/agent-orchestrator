import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ResumeDialog from '../components/ResumeDialog';
import RetryDialog from '../components/RetryDialog';
import { fetchFeatures, retryFeature, resumeFeature } from '../hooks/useApi';
import { useStore } from '../store';
import type { Feature } from '../types';

type FilterStatus = 'all' | 'open' | 'verifying' | 'passed' | 'failed';

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '-';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes === 0) return `${secs}s`;
  return `${minutes}m ${secs}s`;
}

function formatRelativeTime(date: string): string {
  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function Features() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [selectedResumeFeature, setSelectedResumeFeature] = useState<Feature | null>(null);

  const { features, setFeatures } = useStore();

  useEffect(() => {
    const loadFeatures = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchFeatures();
        setFeatures(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load features');
      } finally {
        setLoading(false);
      }
    };

    if (features.length === 0) {
      loadFeatures();
    } else {
      setLoading(false);
    }
  }, [features.length, setFeatures]);

  const handleRetrySubmit = async (featureId: number, extraContext: string) => {
    try {
      await retryFeature(featureId, extraContext);
      setSelectedFeature(null);
      const data = await fetchFeatures();
      setFeatures(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry feature');
    }
  };

  const handleResumeSubmit = async (featureId: number, prompt: string) => {
    try {
      await resumeFeature(featureId, prompt);
      setSelectedResumeFeature(null);
      const data = await fetchFeatures();
      setFeatures(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume feature');
    }
  };

  const filtered = features
    .filter((f) => {
      if (filter === 'all') return true;
      return f.status === filter;
    })
    .sort((a, b) => a.id - b.id);

  const statusBadgeClasses = (status: string) => {
    switch (status) {
      case 'passed':
        return 'px-2 py-1 rounded text-xs font-medium bg-green-950 text-green-200 border border-green-800';
      case 'failed':
        return 'px-2 py-1 rounded text-xs font-medium bg-red-950 text-red-200 border border-red-800';
      case 'verifying':
        return 'px-2 py-1 rounded text-xs font-medium bg-blue-950 text-blue-200 border border-blue-800 animate-pulse';
      default:
        return 'px-2 py-1 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700';
    }
  };

  const categoryBadgeClasses = (category?: string) => {
    switch (category) {
      case 'environment':
        return 'px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-950 text-orange-300 border border-orange-800';
      case 'test_only':
        return 'px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-950 text-yellow-300 border border-yellow-800';
      case 'implementation':
        return 'px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-950 text-red-300 border border-red-800';
      case 'verification':
        return 'px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-950 text-blue-300 border border-blue-800';
      default:
        return 'px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-800 text-gray-400 border border-gray-700';
    }
  };

  const categoryLabel = (category?: string) => {
    switch (category) {
      case 'environment': return 'ENV';
      case 'test_only': return 'TEST ONLY';
      case 'implementation': return 'IMPL';
      case 'verification': return 'VERIFY';
      default: return 'UNKNOWN';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-400">Loading features...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-red-950 text-red-200 rounded-lg border border-red-800">
          {error}
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold text-white mb-6">Features</h1>

        <div className="flex gap-2 mb-6">
          {(['all', 'open', 'verifying', 'passed', 'failed'] as FilterStatus[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto border border-gray-800 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <th className="px-4 py-3 text-left text-gray-300 font-semibold">ID</th>
              <th className="px-4 py-3 text-left text-gray-300 font-semibold">Category</th>
              <th className="px-4 py-3 text-left text-gray-300 font-semibold">Name</th>
              <th className="px-4 py-3 text-left text-gray-300 font-semibold">Status</th>
              <th className="px-4 py-3 text-left text-gray-300 font-semibold">Reason</th>
              <th className="px-4 py-3 text-left text-gray-300 font-semibold">Branch</th>
              <th className="px-4 py-3 text-left text-gray-300 font-semibold">Last Run</th>
              <th className="px-4 py-3 text-left text-gray-300 font-semibold">Duration</th>
              <th className="px-4 py-3 text-left text-gray-300 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((feature) => {
              const ls = feature.latestSession;

              return (
                <tr
                  key={feature.id}
                  className="border-b border-gray-800 hover:bg-gray-900 transition"
                >
                  <td className="px-4 py-3 text-gray-200 font-mono text-xs">{feature.id}</td>
                  <td className="px-4 py-3 text-gray-400">{feature.category}</td>
                  <td className="px-4 py-3 text-gray-200">{feature.name}</td>
                  <td className="px-4 py-3">
                    <span className={statusBadgeClasses(feature.status)}>
                      {feature.status.charAt(0).toUpperCase() + feature.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {feature.status === 'failed' && feature.failure_reason ? (
                      <div className="flex flex-col gap-1">
                        <span className={categoryBadgeClasses(feature.failure_category)}>
                          {categoryLabel(feature.failure_category)}
                        </span>
                        <span className="text-gray-400 text-xs truncate max-w-[200px]" title={feature.failure_reason}>
                          {feature.failure_reason}
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-600">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                    {ls?.branch || '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {ls?.started_at ? formatRelativeTime(ls.started_at) : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatDuration(ls?.duration_ms)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {ls && (
                        <button
                          onClick={() => navigate(`/sessions/${ls.id}`)}
                          className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition"
                        >
                          View
                        </button>
                      )}
                      {(feature.status === 'failed' || (feature.status === 'open' && feature.latestSession)) && (
                        <button
                          onClick={() => setSelectedResumeFeature(feature)}
                          className="text-xs px-2 py-1 rounded bg-blue-900 text-blue-200 hover:bg-blue-800 transition"
                        >
                          Resume
                        </button>
                      )}
                      {feature.status === 'failed' && (
                        <button
                          onClick={() => setSelectedFeature(feature)}
                          className="text-xs px-2 py-1 rounded bg-amber-900 text-amber-200 hover:bg-amber-800 transition"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          No features found for this filter.
        </div>
      )}

      {selectedFeature && (
        <RetryDialog
          feature={selectedFeature}
          onClose={() => setSelectedFeature(null)}
          onRetry={handleRetrySubmit}
        />
      )}

      {selectedResumeFeature && (
        <ResumeDialog
          feature={selectedResumeFeature}
          onClose={() => setSelectedResumeFeature(null)}
          onResume={handleResumeSubmit}
        />
      )}
    </div>
  );
}
