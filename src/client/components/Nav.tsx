import { Play, Square, Activity, Settings } from 'lucide-react';
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { startOrchestrator, stopOrchestrator } from '../hooks/useApi';
import { useStore } from '../store';

const Nav: React.FC = () => {
  const state = useStore((s) => s.status.state);
  const location = useLocation();

  const statusColor = {
    running: 'bg-green-500',
    stopping: 'bg-yellow-500',
    stopped: 'bg-gray-600',
  }[state];

  const statusLabel = {
    running: 'Running',
    stopping: 'Stopping',
    stopped: 'Stopped',
  }[state];

  const isRunning = state === 'running';

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
            to="/settings"
            className={`hover:text-white transition-colors font-medium flex items-center gap-1.5 ${location.pathname === '/settings' ? 'text-white' : 'text-gray-300'}`}
          >
            <Settings className="w-4 h-4" />
            Settings
          </Link>
        </div>

        {/* Right Side: Status Badge + Button */}
        <div className="flex items-center gap-4">
          {/* Status Badge */}
          <div className="flex items-center gap-2 px-3 py-1 bg-gray-800 rounded-full">
            <div className={`w-2 h-2 rounded-full ${statusColor}`}></div>
            <span className="text-sm text-gray-300">{statusLabel}</span>
          </div>

          {/* Start/Stop Button */}
          <button
            onClick={handleToggle}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              isRunning
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
