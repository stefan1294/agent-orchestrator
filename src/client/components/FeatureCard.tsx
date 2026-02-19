import { CheckCircle2, XCircle, Circle, RotateCcw, FastForward } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';
import type { Feature } from '../types';

interface Props {
  feature: Feature;
  showRetry?: boolean;
  onRetry?: (featureId: number) => void;
  showResume?: boolean;
  onResume?: (featureId: number) => void;
  compact?: boolean;
}

const FeatureCard: React.FC<Props> = ({
  feature,
  showRetry = false,
  onRetry,
  showResume = false,
  onResume,
  compact = false,
}) => {
  const getStatusIcon = () => {
    switch (feature.status) {
      case 'passed':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'open':
      default:
        return <Circle className="w-5 h-5 text-gray-500" />;
    }
  };

  const getDuration = () => {
    if (!feature.latestSession?.started_at || !feature.latestSession?.finished_at) {
      return null;
    }

    const start = new Date(feature.latestSession.started_at).getTime();
    const end = new Date(feature.latestSession.finished_at).getTime();
    const seconds = Math.floor((end - start) / 1000);

    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
        {getStatusIcon()}
        <div className="flex-1 min-w-0">
          {feature.latestSession ? (
            <Link to={`/sessions/${feature.latestSession.id}`} className="text-white font-medium truncate block hover:text-blue-400 hover:underline">
              {feature.name}
            </Link>
          ) : (
            <p className="text-white font-medium truncate">{feature.name}</p>
          )}
        </div>
        {feature.category && (
          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded whitespace-nowrap">
            {feature.category}
          </span>
        )}
        {feature.latestSession && (
          <span className="text-xs text-gray-400 whitespace-nowrap">{getDuration()}</span>
        )}
        {showResume && (feature.status === 'failed' || (feature.status === 'open' && feature.latestSession)) && (
          <button
            onClick={() => onResume?.(feature.id)}
            className="ml-2 p-1.5 text-gray-400 hover:text-blue-400 transition-colors"
            title="Resume feature"
          >
            <FastForward className="w-4 h-4" />
          </button>
        )}
        {showRetry && feature.status === 'failed' && (
          <button
            onClick={() => onRetry?.(feature.id)}
            className="ml-2 p-1.5 text-gray-400 hover:text-amber-400 transition-colors"
            title="Retry feature"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
      <div className="flex items-start gap-3 mb-2">
        {getStatusIcon()}
        <div className="flex-1 min-w-0">
          {feature.latestSession ? (
            <Link to={`/sessions/${feature.latestSession.id}`} className="text-white font-semibold text-lg truncate block hover:text-blue-400 hover:underline">
              {feature.name}
            </Link>
          ) : (
            <p className="text-white font-semibold text-lg truncate">{feature.name}</p>
          )}
          {feature.description && (
            <p className="text-gray-400 text-sm line-clamp-2 mt-1">{feature.description}</p>
          )}
        </div>
        {showResume && (feature.status === 'failed' || (feature.status === 'open' && feature.latestSession)) && (
          <button
            onClick={() => onResume?.(feature.id)}
            className="p-1.5 text-gray-400 hover:text-blue-400 transition-colors flex-shrink-0"
            title="Resume feature"
          >
            <FastForward className="w-5 h-5" />
          </button>
        )}
        {showRetry && feature.status === 'failed' && (
          <button
            onClick={() => onRetry?.(feature.id)}
            className="p-1.5 text-gray-400 hover:text-amber-400 transition-colors flex-shrink-0"
            title="Retry feature"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        )}
      </div>

      {feature.progress && (
        <pre className="text-xs text-gray-400 mt-2 whitespace-pre-wrap bg-gray-900 rounded p-2 font-mono">
          {feature.progress}
        </pre>
      )}

      <div className="flex items-center gap-4 mt-3 flex-wrap">
        {feature.category && (
          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded">
            {feature.category}
          </span>
        )}
        {feature.latestSession?.branch && (
          <span className="text-xs text-gray-400">
            Branch: <span className="font-mono">{feature.latestSession.branch}</span>
          </span>
        )}
        {feature.latestSession && (
          <span className="text-xs text-gray-400">
            {getDuration()}
          </span>
        )}
      </div>
    </div>
  );
};

export default FeatureCard;
