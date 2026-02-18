import { Plus, Trash2, Save } from 'lucide-react';
import { useState } from 'react';
import type { TrackDefinition } from '../types';

const TRACK_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

interface TrackSetupProps {
  detectedCategories: string[];
  existingTracks?: TrackDefinition[];
  onSave: (tracks: TrackDefinition[]) => void;
  saveLabel?: string;
}

export default function TrackSetup({ detectedCategories, existingTracks, onSave, saveLabel = 'Save & Start' }: TrackSetupProps) {
  const [tracks, setTracks] = useState<TrackDefinition[]>(
    existingTracks && existingTracks.length > 0 && existingTracks[0].name !== 'default'
      ? existingTracks
      : [{ name: 'track-1', categories: [], color: TRACK_COLORS[0], isDefault: true }]
  );
  const [error, setError] = useState<string | null>(null);

  const assignedCategories = tracks.flatMap(t => t.categories);
  const unassignedCategories = detectedCategories.filter(c => !assignedCategories.includes(c));

  const updateTrack = (index: number, updates: Partial<TrackDefinition>) => {
    setTracks(prev => prev.map((t, i) => i === index ? { ...t, ...updates } : t));
    setError(null);
  };

  const addTrack = () => {
    if (tracks.length >= 5) return;
    setTracks(prev => [
      ...prev,
      {
        name: `track-${prev.length + 1}`,
        categories: [],
        color: TRACK_COLORS[prev.length % TRACK_COLORS.length],
        isDefault: false,
      },
    ]);
  };

  const removeTrack = (index: number) => {
    if (tracks.length <= 1) return;
    setTracks(prev => {
      const next = prev.filter((_, i) => i !== index);
      // If we removed the default, make the first one default
      if (!next.some(t => t.isDefault) && next.length > 0) {
        next[0].isDefault = true;
      }
      return next;
    });
  };

  const toggleDefault = (index: number) => {
    setTracks(prev => prev.map((t, i) => ({ ...t, isDefault: i === index })));
  };

  const toggleCategory = (trackIndex: number, category: string) => {
    setTracks(prev => prev.map((t, i) => {
      if (i !== trackIndex) {
        // Remove from other tracks if reassigning
        return { ...t, categories: t.categories.filter(c => c !== category) };
      }
      const has = t.categories.includes(category);
      return {
        ...t,
        categories: has
          ? t.categories.filter(c => c !== category)
          : [...t.categories, category],
      };
    }));
    setError(null);
  };

  const handleSave = () => {
    // Validate
    const names = tracks.map(t => t.name.trim());
    if (names.some(n => !n)) {
      setError('All tracks must have a name');
      return;
    }
    if (new Set(names).size !== names.length) {
      setError('Track names must be unique');
      return;
    }
    if (!tracks.some(t => t.isDefault)) {
      setError('One track must be marked as default');
      return;
    }

    onSave(tracks.map(t => ({ ...t, name: t.name.trim() })));
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white">Configure Tracks</h2>
        <p className="text-gray-400">
          Group your feature categories into parallel tracks (up to 5). Each track processes features independently.
          The default track catches any categories not explicitly assigned.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-950 text-red-200 rounded-lg border border-red-800 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {tracks.map((track, index) => (
          <div key={index} className="border border-gray-700 rounded-lg p-4 space-y-3 bg-gray-900/50">
            <div className="flex items-center gap-3">
              {/* Color dot */}
              <div
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: track.color || TRACK_COLORS[index % TRACK_COLORS.length] }}
              />

              {/* Name input */}
              <input
                type="text"
                value={track.name}
                onChange={(e) => updateTrack(index, { name: e.target.value })}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                placeholder="Track name"
              />

              {/* Default toggle */}
              <button
                onClick={() => toggleDefault(index)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  track.isDefault
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {track.isDefault ? 'Default' : 'Set Default'}
              </button>

              {/* Remove */}
              <button
                onClick={() => removeTrack(index)}
                disabled={tracks.length <= 1}
                className="p-1.5 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Remove track"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Category pills */}
            <div className="flex flex-wrap gap-2">
              {detectedCategories.map((cat) => {
                const isAssigned = track.categories.includes(cat);
                const isAssignedElsewhere = !isAssigned && assignedCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(index, cat)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      isAssigned
                        ? 'text-white'
                        : isAssignedElsewhere
                          ? 'bg-gray-800/50 text-gray-600 hover:bg-gray-700 hover:text-gray-300'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                    style={isAssigned ? { backgroundColor: track.color || TRACK_COLORS[index % TRACK_COLORS.length] } : undefined}
                  >
                    {cat}
                  </button>
                );
              })}
              {detectedCategories.length === 0 && (
                <span className="text-gray-500 text-xs italic">No categories detected in features</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add track button */}
      <button
        onClick={addTrack}
        disabled={tracks.length >= 5}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Plus className="w-4 h-4" />
        Add Track
      </button>

      {/* Unassigned categories hint */}
      {unassignedCategories.length > 0 && (
        <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700">
          <p className="text-gray-400 text-sm">
            <span className="font-medium text-gray-300">Unassigned categories:</span>{' '}
            {unassignedCategories.join(', ')}
            <span className="text-gray-500"> — these will be routed to the default track.</span>
          </p>
        </div>
      )}

      {/* Save button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          <Save className="w-4 h-4" />
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
