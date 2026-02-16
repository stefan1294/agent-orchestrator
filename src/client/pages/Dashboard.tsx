import { useEffect, useState } from 'react';
import ResumeDialog from '../components/ResumeDialog';
import RetryDialog from '../components/RetryDialog';
import StatsBanner from '../components/StatsBanner';
import TrackPanel from '../components/TrackPanel';
import { fetchFeatures, fetchStatus, fetchConfig, retryFeature, resumeFeature } from '../hooks/useApi';
import { useStore } from '../store';
import type { Feature, TrackDefinition } from '../types';

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [selectedResumeFeature, setSelectedResumeFeature] = useState<Feature | null>(null);
  const [trackDefinitions, setTrackDefinitions] = useState<TrackDefinition[]>([]);

  const { features, status, setFeatures, setStatus } = useStore();

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-400">Loading dashboard...</div>
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

      {status.resume && (
        <div className="p-4 bg-blue-950/40 text-blue-200 rounded-lg border border-blue-900">
          Resume in progress: Feature #{status.resume.featureId} is prioritized on the {status.resume.track} track.
          Other tracks will pause before starting their next feature.
        </div>
      )}

      <StatsBanner />

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
