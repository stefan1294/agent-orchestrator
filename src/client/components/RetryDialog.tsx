import { X } from 'lucide-react';
import React, { useState } from 'react';
import type { Feature } from '../types';

interface Props {
  feature: Feature;
  onClose: () => void;
  onRetry: (featureId: number, extraContext: string) => void;
}

const RetryDialog: React.FC<Props> = ({ feature, onClose, onRetry }) => {
  const [extraContext, setExtraContext] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRetry = async () => {
    setIsSubmitting(true);
    try {
      await onRetry(feature.id, extraContext);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const errorMessage = feature.latestSession?.error_message;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4 border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-white">Retry Feature</h2>
            <p className="text-gray-400 text-sm mt-1">Feature ID: {feature.id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Feature Name */}
          <div>
            <p className="text-sm text-gray-400 mb-1">Feature Name</p>
            <p className="text-white font-semibold">{feature.name}</p>
          </div>

          {/* Last Error */}
          {errorMessage && (
            <div>
              <p className="text-sm text-gray-400 mb-2">Last Error Message</p>
              <div className="bg-red-950/20 border border-red-900/50 rounded p-3">
                <p className="text-red-300 text-sm font-mono break-words whitespace-pre-wrap">
                  {errorMessage}
                </p>
              </div>
            </div>
          )}

          {/* Additional Instructions */}
          <div>
            <label htmlFor="extra-context" className="block text-sm text-gray-400 mb-2">
              Additional Instructions for Retry
            </label>
            <textarea
              id="extra-context"
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              placeholder="Describe what went wrong or provide extra context..."
              className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
              rows={4}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end p-6 border-t border-gray-700">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleRetry}
            disabled={isSubmitting}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {isSubmitting ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RetryDialog;
