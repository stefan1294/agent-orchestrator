import { FolderOpen, ArrowRight, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { setProject } from '../hooks/useApi';

export default function ProjectSetup({ onConfigured }: { onConfigured: () => void }) {
  const [projectPath, setProjectPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsInit, setNeedsInit] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectPath.trim()) return;

    setError(null);
    setNeedsInit(false);
    setLoading(true);

    try {
      await setProject(projectPath.trim());
      onConfigured();
    } catch (err: any) {
      const msg = err.message || 'Failed to configure project';
      setError(msg);
      if (msg.includes('orchestrator.config.json') || msg.includes('init')) {
        setNeedsInit(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-950 border border-blue-800 mb-4">
            <FolderOpen className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Orchestrator</h1>
          <p className="text-gray-400">
            Configure a project to get started. Point to a directory containing an{' '}
            <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded text-sm">orchestrator.config.json</code>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="projectPath" className="block text-sm font-medium text-gray-300 mb-1.5">
              Project Path
            </label>
            <input
              id="projectPath"
              type="text"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="/path/to/your/project"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono text-sm"
              autoFocus
            />
          </div>

          {error && (
            <div className="p-3 bg-red-950/50 border border-red-800 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-300">
                <p>{error}</p>
                {needsInit && (
                  <p className="mt-2 text-red-400">
                    Run <code className="bg-red-900/50 px-1.5 py-0.5 rounded">npx agent-orchestrator init</code> in your project directory to create the config file.
                  </p>
                )}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !projectPath.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? (
              'Connecting...'
            ) : (
              <>
                Configure Project
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 p-4 bg-gray-900 border border-gray-800 rounded-lg">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Or use CLI</h3>
          <p className="text-xs text-gray-500 mb-2">
            Start the orchestrator with a project path:
          </p>
          <code className="block text-xs text-gray-400 bg-gray-950 p-2 rounded font-mono">
            npx agent-orchestrator start --project /path/to/project
          </code>
        </div>
      </div>
    </div>
  );
}
