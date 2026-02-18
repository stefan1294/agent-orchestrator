import { Play, Square, Activity } from 'lucide-react';
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { startOrchestrator, stopOrchestrator } from '../hooks/useApi';
import { useStore } from '../store';

const Nav: React.FC = () => {
  const state = useStore((s) => s.status.state);
  const location = useLocation();

  const statusColor: Record<string, string> = {
    running: 'bg-green-500',
    stopping: 'bg-yellow-500',
    stopped: 'bg-gray-600',
    setup: 'bg-blue-500',
  };

  const statusLabel: Record<string, string> = {
    running: 'Running',
    stopping: 'Stopping',
    stopped: 'Stopped',
    setup: 'Setup',
  };

  const isRunning = state === 'running';
  const isSetup = state === 'setup';

  const handleToggle = async () => {
    if (isRunning) {
      await stopOrchestrator();
    } else {
      await startOrchestrator();
    }
  };

  return (
    <nav className="fixed top-0 left-0 right-0 bg-gray-900 border-b border-gray-800 z-50">
      <div className="px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-blue-500" />
          <span className="text-xl font-bold text-white">Agent Orchestrator</span>
        </div>

        {/* Center Nav Links */}
        <div className="flex items-center gap-8">
          <Link
            to="/"
            className={`hover:text-white transition-colors font-medium ${location.pathname === '/' ? 'text-white' : 'text-gray-300'}`}
          >
            Dashboard
          </Link>
          <Link
            to="/agents"
            className={`hover:text-white transition-colors font-medium ${location.pathname === '/agents' ? 'text-white' : 'text-gray-300'}`}
          >
            Agents
          </Link>
          <Link
            to="/features"
            className={`hover:text-white transition-colors font-medium ${location.pathname === '/features' ? 'text-white' : 'text-gray-300'}`}
          >
            Features
          </Link>
          <Link
            to="/tracks"
            className={`hover:text-white transition-colors font-medium ${location.pathname === '/tracks' ? 'text-white' : 'text-gray-300'}`}
          >
            Tracks
          </Link>
          <Link
            to="/settings"
            className={`hover:text-white transition-colors font-medium ${location.pathname === '/settings' ? 'text-white' : 'text-gray-300'}`}
          >
            Settings
          </Link>
        </div>

        {/* Right Side: Status Badge + Button */}
        <div className="flex items-center gap-4">
          {/* Status Badge */}
          <div className="flex items-center gap-2 px-3 py-1 bg-gray-800 rounded-full">
            <div className={`w-2 h-2 rounded-full ${statusColor[state] || 'bg-gray-600'}`}></div>
            <span className="text-sm text-gray-300">{statusLabel[state] || state}</span>
          </div>

          {/* Start/Stop Button */}
          <button
            onClick={handleToggle}
            disabled={isSetup}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              isSetup
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : isRunning
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            {isRunning ? (
              <>
                <Square className="w-4 h-4" />
                Stop
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Start
              </>
            )}
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Nav;
