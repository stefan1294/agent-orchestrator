import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ResumeDialog from '../components/ResumeDialog';
import RetryDialog from '../components/RetryDialog';
import StatsBanner from '../components/StatsBanner';
import TrackPanel from '../components/TrackPanel';
import TrackSetup from '../components/TrackSetup';
import { fetchFeatures, fetchStatus, fetchConfig, retryFeature, resumeFeature, configureTracks } from '../hooks/useApi';
import { useStore } from '../store';
import type { Feature, TrackDefinition } from '../types';

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [selectedResumeFeature, setSelectedResumeFeature] = useState<Feature | null>(null);
  const [trackDefinitions, setTrackDefinitions] = useState<TrackDefinition[]>([]);

  const { features, status, setFeatures, setStatus, newCategories, clearNewCategories } = useStore();

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const [featuresData, statusData, configData] = await Promise.all([
          fetchFeatures(),
          fetchStatus(),
          fetchConfig(),
        ]);
        setFeatures(featuresData);
        setStatus(statusData);
        setTrackDefinitions(configData.tracks || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [setFeatures, setStatus]);

  const handleRetry = (featureId: number) => {
    const feature = features.find((f) => f.id === featureId);
    if (feature) setSelectedFeature(feature);
  };

  const handleResume = (featureId: number) => {
    const feature = features.find((f) => f.id === featureId);
    if (feature) setSelectedResumeFeature(feature);
  };

  const handleRetrySubmit = async (fId: number, extraContext: string) => {
    try {
      await retryFeature(fId, extraContext);
      setSelectedFeature(null);
      const [featuresData, statusData] = await Promise.all([
        fetchFeatures(),
        fetchStatus(),
      ]);
      setFeatures(featuresData);
      setStatus(statusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry feature');
    }
  };

  const handleResumeSubmit = async (fId: number, prompt: string) => {
    try {
      await resumeFeature(fId, prompt);
      setSelectedResumeFeature(null);
      const [featuresData, statusData] = await Promise.all([
        fetchFeatures(),
        fetchStatus(),
      ]);
      setFeatures(featuresData);
      setStatus(statusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume feature');
    }
  };

  // Build track data dynamically from definitions
  const trackData = trackDefinitions.map((def) => {
    const trackFeatures = def.isDefault
      ? features.filter((f) => {
          // Default track gets features that don't match any explicit track category
          const explicitCategories = trackDefinitions
            .filter((d) => !d.isDefault)
            .flatMap((d) => d.categories);
          return !explicitCategories.includes(f.category);
        })
      : features.filter((f) => def.categories.includes(f.category));

    const trackStatus = status.tracks?.find((t) => t.name === def.name);

    return { def, features: trackFeatures, trackStatus };
  });

  // Dynamic grid layout based on track count
  const gridCols =
    trackData.length === 1
      ? 'grid-cols-1 max-w-3xl mx-auto'
      : trackData.length === 2
        ? 'grid-cols-2'
        : trackData.length >= 3
          ? 'grid-cols-3'
          : 'grid-cols-2';

  const handleConfigureTracks = async (tracks: TrackDefinition[]) => {
    try {
      setError(null);
      await configureTracks(tracks);
      // Refetch status — orchestrator transitions to 'running'
      const [statusData, configData] = await Promise.all([fetchStatus(), fetchConfig()]);
      setStatus(statusData);
      setTrackDefinitions(configData.tracks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to configure tracks');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-400">Loading dashboard...</div>
      </div>
    );
  }

  // Setup state: show track configuration instead of normal dashboard
  if (status.state === 'setup') {
    return (
      <div className="space-y-8">
        {error && (
          <div className="p-4 bg-red-950 text-red-200 rounded-lg border border-red-800">
            {error}
          </div>
        )}
        <TrackSetup
          detectedCategories={status.detectedCategories || []}
          onSave={handleConfigureTracks}
          saveLabel="Save & Start"
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="p-4 bg-red-950 text-red-200 rounded-lg border border-red-800">
          {error}
        </div>
      )}

      {newCategories.length > 0 && (
        <div className="p-4 bg-amber-950/40 text-amber-200 rounded-lg border border-amber-900 flex items-start justify-between gap-4">
          <div>
            New categories detected: <span className="font-medium">{newCategories.join(', ')}</span>.
            They'll be processed by the default track.{' '}
            <Link to="/tracks" className="underline hover:text-amber-100">Configure tracks</Link>
          </div>
          <button onClick={clearNewCategories} className="text-amber-400 hover:text-amber-200 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {status.resume && (
        <div className="p-4 bg-blue-950/40 text-blue-200 rounded-lg border border-blue-900">
          Resume in progress: Feature #{status.resume.featureId} is prioritized on the {status.resume.track} track.
          Other tracks will pause before starting their next feature.
        </div>
      )}

      <StatsBanner />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Tracks</h2>
        <Link to="/tracks" className="text-sm text-gray-400 hover:text-white transition-colors">
          Configure tracks
        </Link>
      </div>

      <div className={`grid ${gridCols} gap-6`}>
        {trackData.map(({ def, features: trackFeatures, trackStatus }) => (
          <TrackPanel
            key={def.name}
            track={def.name}
            color={def.color}
            features={trackFeatures}
            trackStatus={trackStatus}
            onRetry={handleRetry}
            onResume={handleResume}
          />
        ))}
      </div>

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
