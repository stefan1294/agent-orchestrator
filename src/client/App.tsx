import { Routes, Route, useLocation } from 'react-router-dom';
import Nav from './components/Nav';
import { useSocket } from './hooks/useSocket';
import Agents from './pages/Agents';
import Dashboard from './pages/Dashboard';
import Features from './pages/Features';
import SessionDetail from './pages/SessionDetail';
import Settings from './pages/Settings';
import Tracks from './pages/Tracks';
import { useStore } from './store';

export default function App() {
  useSocket(); // Initialize socket connection
  const location = useLocation();
  const criticalAlerts = useStore((s) => s.criticalAlerts);
  const dismissCriticalAlert = useStore((s) => s.dismissCriticalAlert);

  // Agents page uses full width, others are constrained
  const isAgentsPage = location.pathname === '/agents';

  return (
    <div className="min-h-screen bg-gray-950">
      <Nav />

      {/* Critical failure alerts */}
      {criticalAlerts.length > 0 && (
        <div className="fixed top-[72px] left-0 right-0 z-40 px-4 py-2 space-y-2">
          {criticalAlerts.map((alert, i) => (
            <div
              key={i}
              className="mx-auto max-w-4xl p-4 bg-red-950 border border-red-700 rounded-lg shadow-lg flex items-start gap-3"
            >
              <div className="text-red-400 text-xl flex-shrink-0">!!</div>
              <div className="flex-1">
                <p className="text-red-200 font-semibold">
                  Critical: Track "{alert.track}" auto-paused
                </p>
                <p className="text-red-300 text-sm mt-1">
                  {alert.reason} ({alert.consecutiveFailures} consecutive failures).
                  Fix the environment issue and restart the orchestrator.
                </p>
              </div>
              <button
                onClick={() => dismissCriticalAlert(i)}
                className="text-red-400 hover:text-red-200 text-lg px-2"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      <main className={`pt-20 px-6 pb-8 ${isAgentsPage ? '' : 'max-w-7xl mx-auto'}`}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/features" element={<Features />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/sessions/:id" element={<SessionDetail />} />
          <Route path="/tracks" element={<Tracks />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
