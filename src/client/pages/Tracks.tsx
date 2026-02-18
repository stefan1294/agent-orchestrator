import { useEffect, useState } from 'react';
import TrackSetup from '../components/TrackSetup';
import { fetchFeatures, fetchSettings, updateSettings } from '../hooks/useApi';
import type { TrackDefinition } from '../types';

export default function Tracks() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [detectedCategories, setDetectedCategories] = useState<string[]>([]);
  const [currentTracks, setCurrentTracks] = useState<TrackDefinition[]>([]);
  const [allValues, setAllValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const [settingsData, featuresData] = await Promise.all([fetchSettings(), fetchFeatures()]);

        const vals: Record<string, string> = {};
        for (const s of settingsData) {
          vals[s.key] = s.value;
        }
        setAllValues(vals);

        const categories = [...new Set(featuresData.map(f => f.category).filter(Boolean))];
        setDetectedCategories(categories);

        const tracksSetting = settingsData.find(s => s.key === 'tracks');
        if (tracksSetting) {
          try {
            setCurrentTracks(JSON.parse(tracksSetting.value));
          } catch { /* ignore */ }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tracks');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async (tracks: TrackDefinition[]) => {
    try {
      setError(null);
      setSuccess(null);
      const updated = await updateSettings({ ...allValues, tracks: JSON.stringify(tracks) });
      const vals: Record<string, string> = {};
      for (const s of updated) {
        vals[s.key] = s.value;
      }
      setAllValues(vals);
      setCurrentTracks(tracks);
      setSuccess('Track configuration saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save tracks');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-400">Loading tracks...</div>
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

      {success && (
        <div className="p-4 bg-green-950 text-green-200 rounded-lg border border-green-800">
          {success}
        </div>
      )}

      <TrackSetup
        detectedCategories={detectedCategories}
        existingTracks={currentTracks}
        onSave={handleSave}
        saveLabel="Save Tracks"
      />
    </div>
  );
}
