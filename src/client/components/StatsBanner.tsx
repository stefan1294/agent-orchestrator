import { Clock, CheckCircle2, XCircle, Circle } from 'lucide-react';
import React, { useMemo } from 'react';
import { useStore } from '../store';

const StatsBanner: React.FC = () => {
  const features = useStore((s) => s.features);
  const state = useStore((s) => s.status.state);
  const startedAt = useStore((s) => s.status.startedAt);

  const stats = useMemo(() => {
    const total = features.length;
    const passed = features.filter((f) => f.status === 'passed').length;
    const failed = features.filter((f) => f.status === 'failed').length;
    const open = features.filter((f) => f.status === 'open').length;

    return { total, passed, failed, open };
  }, [features]);

  const runningTime = useMemo(() => {
    if (!startedAt || state === 'stopped') return '00:00:00';

    const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [startedAt, state]);

  return (
    <div className="bg-gray-900 rounded-lg p-6 grid grid-cols-5 gap-4">
      {/* Total Features */}
      <div className="flex items-center gap-3">
        <Circle className="w-8 h-8 text-gray-400" />
        <div>
          <p className="text-gray-400 text-sm">Total Features</p>
          <p className="text-2xl font-bold text-white">{stats.total}</p>
        </div>
      </div>

      {/* Passed */}
      <div className="flex items-center gap-3">
        <CheckCircle2 className="w-8 h-8 text-green-500" />
        <div>
          <p className="text-gray-400 text-sm">Passed</p>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-green-500 text-white px-2 py-1 rounded">✓</span>
            <p className="text-2xl font-bold text-white">{stats.passed}</p>
          </div>
        </div>
      </div>

      {/* Failed */}
      <div className="flex items-center gap-3">
        <XCircle className="w-8 h-8 text-red-500" />
        <div>
          <p className="text-gray-400 text-sm">Failed</p>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-red-500 text-white px-2 py-1 rounded">✕</span>
            <p className="text-2xl font-bold text-white">{stats.failed}</p>
          </div>
        </div>
      </div>

      {/* Open */}
      <div className="flex items-center gap-3">
        <Circle className="w-8 h-8 text-blue-500" />
        <div>
          <p className="text-gray-400 text-sm">Open</p>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded">○</span>
            <p className="text-2xl font-bold text-white">{stats.open}</p>
          </div>
        </div>
      </div>

      {/* Running Time */}
      <div className="flex items-center gap-3">
        <Clock className="w-8 h-8 text-amber-500" />
        <div>
          <p className="text-gray-400 text-sm">Running Time</p>
          <p className="text-2xl font-bold text-white font-mono">{runningTime}</p>
        </div>
      </div>
    </div>
  );
};

export default StatsBanner;
