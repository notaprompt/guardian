import React, { useState, useMemo } from 'react';

// Summarize thinking: first sentence of each paragraph, max 3 lines
function summarize(text) {
  if (!text) return '';
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  const sentences = paragraphs.slice(0, 3).map((p) => {
    const match = p.match(/^(.+?[.!?])\s/);
    return match ? match[1] : p.split('\n')[0].slice(0, 120);
  });
  return sentences.join('\n');
}

export default function ThinkingIndicator({ thinking, isStreaming }) {
  const [expanded, setExpanded] = useState(false);

  const summary = useMemo(() => summarize(thinking), [thinking]);

  if (!thinking) return null;

  return (
    <div
      className={`thinking-indicator${expanded ? ' thinking-indicator--expanded' : ''}`}
      onDoubleClick={() => setExpanded((v) => !v)}
    >
      <div className="thinking-indicator__header">
        <span className={`thinking-indicator__icon${isStreaming ? ' thinking-indicator__icon--streaming' : ''}`}>
          {isStreaming ? '\u25C9' : '\u25C7'}
        </span>
        <span className="thinking-indicator__label">
          {isStreaming ? 'Thinking...' : 'Thought process'}
        </span>
        <button
          className="thinking-indicator__toggle"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '\u25B4' : '\u25BE'}
        </button>
      </div>
      <div className="thinking-indicator__summary">{summary}</div>
      {expanded && (
        <div className="thinking-indicator__detail">{thinking}</div>
      )}
    </div>
  );
}
