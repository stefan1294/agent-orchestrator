import { ChevronDown, ChevronRight } from 'lucide-react';
import React from 'react';
import type { AgentMessage } from '../types';

interface Props {
  messages: AgentMessage[];
}

const MessageViewer: React.FC<Props> = ({ messages }) => {
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    const newSet = new Set(expandedItems);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedItems(newSet);
  };

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'assistant':
        return 'bg-blue-500 text-white';
      case 'tool_use':
        return 'bg-purple-500 text-white';
      case 'tool_result':
        return 'bg-green-500 text-white';
      default:
        return 'bg-gray-600 text-white';
    }
  };

  const formatTimestamp = (timestamp: string | undefined) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  return (
    <div className="space-y-2">
      {messages.map((msg, index) => {
        const id = `msg-${index}`;
        const isExpanded = expandedItems.has(id);

        return (
          <div key={id} className="bg-gray-800 rounded-lg p-4">
            {/* Header */}
            <div className="flex items-center gap-3 mb-3">
              <span className={`text-xs font-bold px-2 py-1 rounded ${getTypeBadgeColor(msg.type)}`}>
                {msg.type}
              </span>
              {msg.agent && (
                <span className="text-xs font-bold px-2 py-1 rounded bg-gray-700 text-gray-100">
                  {msg.agent}
                </span>
              )}
              {msg.timestamp && (
                <span className="text-xs text-gray-400">{formatTimestamp(msg.timestamp)}</span>
              )}
            </div>

            {/* Content */}
            <div className="mb-2">
              {msg.type === 'assistant' && (
                <div className="text-gray-200 text-sm whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              )}

              {msg.type === 'tool_use' && (
                <div>
                  <p className="text-gray-300 font-semibold text-sm mb-2">
                    Tool: {msg.tool_name}
                  </p>
                  <button
                    onClick={() => toggleExpanded(id)}
                    className="flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors text-sm"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    Input
                  </button>
                  {isExpanded && msg.tool_input && (
                    <div className="mt-2 bg-gray-900 rounded p-3 overflow-x-auto">
                      <pre className="text-gray-300 text-xs">
                        {JSON.stringify(msg.tool_input, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {msg.type === 'tool_result' && (
                <div>
                  <button
                    onClick={() => toggleExpanded(id)}
                    className="flex items-center gap-2 text-green-400 hover:text-green-300 transition-colors text-sm"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    Result
                  </button>
                  {isExpanded && (msg.tool_result || msg.content) && (
                    <div className="mt-2 bg-gray-900 rounded p-3 overflow-x-auto">
                      <pre className="text-gray-300 text-xs">
                        {typeof (msg.tool_result ?? msg.content) === 'string'
                          ? (msg.tool_result ?? msg.content)
                          : JSON.stringify(msg.tool_result ?? msg.content, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Raw JSON View */}
            <button
              onClick={() => toggleExpanded(`${id}-raw`)}
              className="flex items-center gap-2 text-gray-500 hover:text-gray-400 transition-colors text-xs mt-3"
            >
              {expandedItems.has(`${id}-raw`) ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              Raw JSON
            </button>
            {expandedItems.has(`${id}-raw`) && (
              <div className="mt-2 bg-gray-900 rounded p-3 overflow-x-auto">
                <pre className="text-gray-400 text-xs">
                  {JSON.stringify(msg, null, 2)}
                </pre>
              </div>
            )}
          </div>
        );
      })}

      {messages.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-400">No messages to display</p>
        </div>
      )}
    </div>
  );
};

export default MessageViewer;
