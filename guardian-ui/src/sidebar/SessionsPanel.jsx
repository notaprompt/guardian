import React, { useState, useCallback, useEffect } from 'react';
import useStore from '../store';

function SessionsPanel() {
  const sessions = useStore((s) => s.sessions);
  const resumeSession = useStore((s) => s.resumeSession);
  const updateSession = useStore((s) => s.updateSession);
  const summarizeSession = useStore((s) => s.summarizeSession);

  const [summarizingIds, setSummarizingIds] = useState(new Set());

  useEffect(() => {
    const cleanup = window.guardian?.sessions?.onSummaryReady?.((payload) => {
      if (payload.sessionId && payload.summary) {
        updateSession(payload.sessionId, { summary: payload.summary });
        setSummarizingIds((prev) => {
          const next = new Set(prev);
          next.delete(payload.sessionId);
          return next;
        });
      }
    });
    return () => { if (cleanup) cleanup(); };
  }, [updateSession]);

  const handleResume = useCallback(async (id) => {
    await resumeSession(id);
  }, [resumeSession]);

  return (
    <div className="zone-body" style={{ overflowY: 'auto', padding: '8px 12px', flex: 1 }}>
      {sessions.length === 0 && (
        <div className="empty-state">
          <div className="empty-state__icon">#</div>
          <div className="empty-state__text">No sessions yet</div>
        </div>
      )}
      <div className="search-results" role="list" aria-label="Past sessions">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="search-result"
            style={{ cursor: 'pointer' }}
            onClick={() => handleResume(s.id)}
            role="listitem"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleResume(s.id); } }}
          >
            <div className="search-result__title">
              {s.title || 'Untitled session'}
            </div>
            {s.summary && (
              <div className="search-result__summary">
                {s.summary}
              </div>
            )}
            <div className="search-result__snippet">
              {s.started_at?.slice(0, 16).replace('T', ' ')}
              {s.tokens_in || s.tokens_out
                ? ` | ${((s.tokens_in || 0) + (s.tokens_out || 0)).toLocaleString()} tokens`
                : ''}
            </div>
            <div className="search-result__actions">
              <button
                className="session-summarize-btn"
                disabled={summarizingIds.has(s.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSummarizingIds((prev) => new Set(prev).add(s.id));
                  summarizeSession(s.id).then((result) => {
                    if (!result?.ok) {
                      setSummarizingIds((prev) => {
                        const next = new Set(prev);
                        next.delete(s.id);
                        return next;
                      });
                    }
                  });
                }}
                title={s.summary ? 'Regenerate summary' : 'Generate summary'}
              >
                {summarizingIds.has(s.id) ? '...' : (s.summary ? 're-summarize' : 'summarize')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default React.memo(SessionsPanel);
