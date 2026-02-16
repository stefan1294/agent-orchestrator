import { ChevronDown, ChevronRight } from 'lucide-react';
import React, { useEffect, useRef } from 'react';
import { useStore } from '../store';

interface Props {
  sessionId: string;
}

const LiveOutput: React.FC<Props> = ({ sessionId }) => {
  const liveOutput = useStore((s) => s.liveOutput);
  const endRef = useRef<HTMLDivElement>(null);
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(new Set());

  const messages = liveOutput.get(sessionId) || [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleExpanded = (id: string) => {
    const newSet = new Set(expandedItems);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedItems(newSet);
  };

  const renderMessage = (msg: any, index: number) => {
    const id = `msg-${index}`;
    const isExpanded = expandedItems.has(id);
    const agentLabel = msg.agent ? (
      <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-2">
        {msg.agent}
      </span>
    ) : null;

    if (msg.type === 'assistant' && msg.content) {
      return (
        <div key={id} className="border-l-4 border-emerald-600 pl-4 py-2">
          {agentLabel}
          <p className="text-white text-sm whitespace-pre-wrap">{msg.content}</p>
        </div>
      );
    }

    if (msg.type === 'tool_use') {
      return (
        <div key={id} className="border-l-4 border-blue-500 pl-4 py-2">
          <button
            onClick={() => toggleExpanded(id)}
            className="flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <span className="font-mono text-sm">
              {agentLabel}
              <span className="text-blue-400">Tool:</span> {msg.tool_name}
            </span>
          </button>
          {isExpanded && msg.tool_input && (
            <div className="mt-2 ml-6 bg-gray-900 rounded p-3 overflow-x-auto">
              <pre className="text-gray-300 text-xs">
                {typeof msg.tool_input === 'string' ? msg.tool_input : JSON.stringify(msg.tool_input, null, 2)}
              </pre>
            </div>
          )}
        </div>
      );
    }

    if (msg.type === 'tool_result') {
      const resultContent = msg.tool_result || msg.content;
      return (
        <div key={id} className="border-l-4 border-gray-500 pl-4 py-2">
          <button
            onClick={() => toggleExpanded(id)}
            className="flex items-center gap-2 text-gray-400 hover:text-gray-300 transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <span className="font-mono text-sm">
              {agentLabel}
              Result
            </span>
          </button>
          {isExpanded && resultContent && (
            <div className="mt-2 ml-6 bg-gray-900 rounded p-3 overflow-x-auto">
              <pre className="text-gray-400 text-xs">
                {typeof resultContent === 'string'
                  ? resultContent
                  : JSON.stringify(resultContent, null, 2)}
              </pre>
            </div>
          )}
        </div>
      );
    }

    if (msg.type === 'system') {
      return (
        <div key={id} className="border-l-4 border-yellow-500 pl-4 py-2">
          {agentLabel}
          <p className="text-yellow-400 text-sm">{msg.content}</p>
        </div>
      );
    }

    if (msg.type === 'result') {
      return (
        <div key={id} className="border-l-4 border-purple-500 pl-4 py-2">
          {agentLabel}
          <p className="text-purple-300 text-sm">{msg.content}</p>
        </div>
      );
    }

    // Fallback: show type label, not raw JSON
    return (
      <div key={id} className="border-l-4 border-gray-600 pl-4 py-2">
        {agentLabel}
        <p className="text-gray-400 text-sm">[{msg.type}] {msg.content || ''}</p>
      </div>
    );
  };

  return (
    <div className="bg-gray-950 rounded-lg border border-gray-800 p-4 font-mono text-sm max-h-96 overflow-y-auto">
      {messages.length === 0 ? (
        <p className="text-gray-500">Waiting for output...</p>
      ) : (
        <div className="space-y-2">
          {messages.map((msg, index) => renderMessage(msg, index))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
};

export default LiveOutput;
