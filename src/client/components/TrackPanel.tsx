import { Eye, Zap } from 'lucide-react';
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Feature, TrackStatus } from '../types';
import FeatureCard from './FeatureCard';

interface Props {
  track: string;
  color?: string;   // hex color e.g. "#8b5cf6"
  features: Feature[];
  trackStatus?: TrackStatus;
  onRetry?: (featureId: number) => void;
  onResume?: (featureId: number) => void;
}

// Default color palette for tracks without explicit colors
const DEFAULT_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

function getTrackColor(track: string, explicitColor?: string): string {
  if (explicitColor) return explicitColor;
  // Deterministic color from track name hash
  let hash = 0;
  for (let i = 0; i < track.length; i++) {
    hash = ((hash << 5) - hash + track.charCodeAt(i)) | 0;
  }
  return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
}

const TrackPanel: React.FC<Props> = ({
  track,
  color,
  features,
  trackStatus,
  onRetry,
  onResume,
}) => {
  const trackFeatures = features;
  const trackColor = getTrackColor(track, color);

  const { running, queued, passed, failed } = useMemo(() => {
    const currentFeatureId = trackStatus?.currentFeature?.id;
    const running = currentFeatureId
      ? trackFeatures.filter((f) => f.id === currentFeatureId)
      : [];
    const queued = trackFeatures.filter(
      (f) => f.status === 'open' && f.id !== currentFeatureId
    );
    const passed = trackFeatures.filter((f) => f.status === 'passed');
    const failed = trackFeatures.filter((f) => f.status === 'failed');

    return { running, queued, passed, failed };
  }, [trackFeatures, trackStatus]);

  const completedCount = passed.length;
  const totalCount = trackFeatures.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const trackLabel = track.charAt(0).toUpperCase() + track.slice(1);

  return (
    <div className="bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
      {/* Header */}
      <div className="bg-gray-800 px-6 py-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold" style={{ color: trackColor }}>{trackLabel} Track</h2>
          <span className="text-sm text-gray-400">
            {completedCount}/{totalCount} completed
          </span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className="h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%`, backgroundColor: trackColor }}
          ></div>
        </div>
      </div>

      <div className="p-6 space-y-8">
        {/* Currently Running */}
        {running.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-5 h-5 text-amber-400" />
              <h3 className="text-lg font-semibold text-white">Currently Running</h3>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            </div>
            <div className="space-y-3">
              {running.map((feature) => (
                <div key={feature.id} className="relative">
                  <FeatureCard
                    feature={feature}
                    compact
                    showRetry={false}
                  />
                  {feature.latestSession && (
                    <Link
                      to={`/sessions/${feature.latestSession.id}`}
                      className="absolute top-2 right-2 p-2 text-gray-400 hover:text-blue-400 transition-colors"
                      title="View live output"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Queue */}
        {queued.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">Queue</h3>
            <div className="space-y-3">
              {queued.map((feature) => (
                <FeatureCard
                  key={feature.id}
                  feature={feature}
                  compact
                  showRetry={false}
                  showResume={true}
                  onResume={onResume}
                />
              ))}
            </div>
          </div>
        )}

        {/* Completed */}
        {passed.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">
              Completed ({passed.length})
            </h3>
            <div className="space-y-3">
              {passed.map((feature) => (
                <FeatureCard
                  key={feature.id}
                  feature={feature}
                  compact
                  showRetry={false}
                />
              ))}
            </div>
          </div>
        )}

        {/* Failed */}
        {failed.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">
              Failed ({failed.length})
            </h3>
            <div className="space-y-3">
              {failed.map((feature) => (
                <FeatureCard
                  key={feature.id}
                  feature={feature}
                  compact
                  showRetry={true}
                  onRetry={onRetry}
                  showResume={true}
                  onResume={onResume}
                />
              ))}
            </div>
          </div>
        )}

        {trackFeatures.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-400">No features in this track</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrackPanel;
