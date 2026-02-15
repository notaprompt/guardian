import React, { useState, useEffect, useCallback } from 'react';
import useStore from '../store';
import '../styles/import.css';

function SourceBadge({ source }) {
  const label = source === 'chatgpt' ? 'ChatGPT' : source === 'claude_export' ? 'Claude' : source || 'guardian';
  return <span className={`import-source-badge import-source-badge--${source || 'guardian'}`}>{label}</span>;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function MemoryExplorer() {
  const sessions = useStore((s) => s.sessions);
  const resumeSession = useStore((s) => s.resumeSession);
  const importBatches = useStore((s) => s.importBatches);
  const fetchImportBatches = useStore((s) => s.fetchImportBatches);
  const openSettings = useStore((s) => s.openSettings);

  const [view, setView] = useState('conversations');
  const [sourceFilter, setSourceFilter] = useState('all');

  useEffect(() => {
    fetchImportBatches();
  }, [fetchImportBatches]);

  const importedSessions = sessions
    .filter((s) => s.source && s.source !== 'guardian')
    .filter((s) => sourceFilter === 'all' || s.source === sourceFilter)
    .sort((a, b) => {
      const da = a.started_at || a.created_at || '';
      const db = b.started_at || b.created_at || '';
      return db.localeCompare(da);
    });

  const handleResume = useCallback(async (id) => {
    await resumeSession(id);
  }, [resumeSession]);

  const hasImported = sessions.some((s) => s.source && s.source !== 'guardian');

  return (
    <div className="memory-explorer">
      <div className="memory-explorer__header">
        <div className="memory-explorer__view-toggle">
          <button
            className={`memory-explorer__view-btn${view === 'conversations' ? ' memory-explorer__view-btn--active' : ''}`}
            onClick={() => setView('conversations')}
          >
            Conversations
          </button>
          <button
            className={`memory-explorer__view-btn${view === 'batches' ? ' memory-explorer__view-btn--active' : ''}`}
            onClick={() => setView('batches')}
          >
            Batches
          </button>
        </div>
        {view === 'conversations' && (
          <div className="memory-explorer__filters">
            {['all', 'chatgpt', 'claude_export'].map((f) => (
              <button
                key={f}
                className={`memory-explorer__filter${sourceFilter === f ? ' memory-explorer__filter--active' : ''}`}
                onClick={() => setSourceFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'chatgpt' ? 'ChatGPT' : 'Claude'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Conversations view */}
      {view === 'conversations' && (
        <div className="memory-explorer__list">
          {!hasImported && (
            <div className="empty-state">
              <div className="empty-state__icon">{'\u21E9'}</div>
              <div className="empty-state__text">No imported conversations</div>
              <button className="settings-link" onClick={openSettings} style={{ marginTop: 8 }}>
                Open Settings to import
              </button>
            </div>
          )}
          {hasImported && importedSessions.length === 0 && (
            <div className="empty-state">
              <div className="empty-state__icon">?</div>
              <div className="empty-state__text">No conversations match filter</div>
            </div>
          )}
          <div className="search-results" role="list" aria-label="Imported conversations">
            {importedSessions.map((s) => (
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
                  <SourceBadge source={s.source} />{' '}
                  {s.title || 'Untitled conversation'}
                </div>
                <div className="memory-card__meta">
                  <span>{formatDate(s.started_at || s.created_at)}</span>
                  {s.message_count > 0 && <span>{s.message_count} messages</span>}
                  {s.model && <span>{s.model}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Batches view */}
      {view === 'batches' && (
        <div className="memory-explorer__list">
          {importBatches.length === 0 && (
            <div className="empty-state">
              <div className="empty-state__icon">{'\u21E9'}</div>
              <div className="empty-state__text">No import batches yet</div>
              <button className="settings-link" onClick={openSettings} style={{ marginTop: 8 }}>
                Open Settings to import
              </button>
            </div>
          )}
          {importBatches.map((b) => (
            <div key={b.id} className="settings-provider-card" style={{ marginBottom: 6 }}>
              <div className="settings-provider-card__info">
                <span className="settings-provider-card__name">
                  {b.file_name || 'Unknown file'}
                </span>
                <span className="settings-provider-card__type">
                  <SourceBadge source={b.source} />
                </span>
              </div>
              <div className="settings-provider-card__status">
                <span className={`settings-provider-card__status-dot${
                  b.status === 'complete' ? ' settings-provider-card__status-dot--available' :
                  b.status === 'failed' ? ' settings-provider-card__status-dot--unavailable' : ''
                }`} />
                {b.status}
              </div>
              <div style={{ fontSize: 10, color: 'var(--white-45)', fontFamily: 'var(--mono)' }}>
                {b.imported_conversations || 0} imported
              </div>
              <div style={{ fontSize: 10, color: 'var(--white-30)', fontFamily: 'var(--mono)' }}>
                {formatDate(b.started_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
