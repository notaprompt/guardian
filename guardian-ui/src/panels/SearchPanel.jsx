import React, { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import PanelHeader from '../components/PanelHeader';
import useStore from '../store';

const KnowledgeGraph = lazy(() => import('../components/KnowledgeGraph'));
const DriftTab = lazy(() => import('../components/DriftTab'));
const MemoryExplorer = lazy(() => import('../components/MemoryExplorer'));

function SearchPanelInner() {
  const query = useStore((s) => s.searchQuery);
  const setQuery = useStore((s) => s.setSearchQuery);
  const results = useStore((s) => s.searchResults);
  const semanticResults = useStore((s) => s.semanticSearchResults);
  const searchMode = useStore((s) => s.searchMode);
  const setSearchMode = useStore((s) => s.setSearchMode);
  const performSearch = useStore((s) => s.performSearch);
  const sessions = useStore((s) => s.sessions);
  const resumeSession = useStore((s) => s.resumeSession);
  const updateSession = useStore((s) => s.updateSession);
  const summarizeSession = useStore((s) => s.summarizeSession);
  const queueItems = useStore((s) => s.queueItems);
  const addQueueItem = useStore((s) => s.addQueueItem);
  const updateQueueItem = useStore((s) => s.updateQueueItem);
  const deleteQueueItem = useStore((s) => s.deleteQueueItem);
  const groundingPrompt = useStore((s) => s.groundingPrompt);
  const groundingStats = useStore((s) => s.groundingStats);
  const showGroundingFor = useStore((s) => s.showGroundingFor);
  const resolveWithGrounding = useStore((s) => s.resolveWithGrounding);
  const skipGrounding = useStore((s) => s.skipGrounding);
  const fetchGroundingStats = useStore((s) => s.fetchGroundingStats);
  const hideGrounding = useStore((s) => s.hideGrounding);
  const reframeUnacknowledged = useStore((s) => s.reframeUnacknowledged);
  const fetchReframeStats = useStore((s) => s.fetchReframeStats);
  const tab = useStore((s) => s.searchPanelTab);
  const setTab = useStore((s) => s.setSearchPanelTab);
  const [isSearching, setIsSearching] = useState(false);
  const [newThread, setNewThread] = useState('');
  const [summarizingIds, setSummarizingIds] = useState(new Set());
  const [groundingType, setGroundingType] = useState(null);
  const [groundingDesc, setGroundingDesc] = useState('');

  // Listen for summary-ready events from main process
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

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    await performSearch(query);
    setIsSearching(false);
  }, [query, performSearch]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  }, [handleSearch]);

  const handleResume = useCallback(async (id) => {
    await resumeSession(id);
  }, [resumeSession]);

  const handleAddThread = useCallback(async () => {
    if (!newThread.trim()) return;
    await addQueueItem(newThread.trim());
    setNewThread('');
  }, [newThread, addQueueItem]);

  const handleThreadKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddThread();
    }
  }, [handleAddThread]);

  useEffect(() => {
    fetchGroundingStats();
  }, [fetchGroundingStats]);

  useEffect(() => {
    fetchReframeStats();
  }, [fetchReframeStats]);

  const handleGroundingConfirm = useCallback((itemId) => {
    if (!groundingType) return;
    resolveWithGrounding(itemId, groundingType, groundingDesc);
    setGroundingType(null);
    setGroundingDesc('');
  }, [groundingType, groundingDesc, resolveWithGrounding]);

  return (
    <>
      <PanelHeader label="Artifacts">
        <button
          className={`zone-head__btn${tab === 'queue' ? ' zone-head__btn--active' : ''}`}
          onClick={() => setTab('queue')}
          title="Integration queue (TRIM)"
          role="tab"
          aria-selected={tab === 'queue'}
          aria-label="Integration queue"
        >
          !
        </button>
        <button
          className={`zone-head__btn${tab === 'search' ? ' zone-head__btn--active' : ''}`}
          onClick={() => setTab('search')}
          title="Search"
          role="tab"
          aria-selected={tab === 'search'}
          aria-label="Search"
        >
          ?
        </button>
        <button
          className={`zone-head__btn${tab === 'sessions' ? ' zone-head__btn--active' : ''}`}
          onClick={() => setTab('sessions')}
          title="Session history"
          role="tab"
          aria-selected={tab === 'sessions'}
          aria-label="Session history"
        >
          #
        </button>
        <button
          className={`zone-head__btn${tab === 'graph' ? ' zone-head__btn--active' : ''}`}
          onClick={() => setTab('graph')}
          title="Knowledge graph"
          role="tab"
          aria-selected={tab === 'graph'}
          aria-label="Knowledge graph"
        >
          &#9672;
        </button>
        <button
          className={`zone-head__btn${tab === 'drift' ? ' zone-head__btn--active' : ''}`}
          onClick={() => setTab('drift')}
          title="Perlocutionary audit"
          role="tab"
          aria-selected={tab === 'drift'}
          aria-label="Perlocutionary audit"
          style={{ position: 'relative' }}
        >
          &#9671;
          {reframeUnacknowledged > 0 && (
            <span className="drift-badge">{reframeUnacknowledged}</span>
          )}
        </button>
        <button
          className={`zone-head__btn${tab === 'memory' ? ' zone-head__btn--active' : ''}`}
          onClick={() => setTab('memory')}
          title="Memory explorer"
          role="tab"
          aria-selected={tab === 'memory'}
          aria-label="Memory explorer"
        >
          {'\u21E9'}
        </button>
      </PanelHeader>

      {/* ── Integration Queue (TRIM 7.2) ──────────── */}
      {tab === 'queue' && (
        <div className="zone-body" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div className="queue-input-row">
            <input
              className="search-input"
              type="text"
              value={newThread}
              onChange={(e) => setNewThread(e.target.value)}
              onKeyDown={handleThreadKeyDown}
              placeholder="Add open thread..."
              aria-label="Add open thread"
            />
          </div>
          {groundingStats.groundingRate > 0 && (
            <div className="grounding-stats">
              <span>{groundingStats.groundingRate}% grounded</span>
              <span>|</span>
              <span>avg {groundingStats.avgLatencyDays} days</span>
            </div>
          )}
          {queueItems.length === 0 && (
            <div className="empty-state">
              <div className="empty-state__icon">~</div>
              <div className="empty-state__text">No open threads</div>
            </div>
          )}
          <div className="queue-list" role="list" aria-label="Open threads">
            {queueItems.map((item) => (
              <React.Fragment key={item.id}>
                <div className={`queue-item queue-item--${item.status}`} role="listitem">
                  <div className="queue-item__text">{item.text}</div>
                  <div className="queue-item__actions">
                    {item.status === 'open' && (
                      <>
                        <button
                          className="queue-item__btn"
                          onClick={() => { showGroundingFor(item.id); setGroundingType(null); setGroundingDesc(''); }}
                          title="Resolve with grounding"
                          aria-label={`Resolve: ${item.text}`}
                        >
                          ok
                        </button>
                        <button
                          className="queue-item__btn"
                          onClick={() => updateQueueItem(item.id, { status: 'deferred' })}
                          title="Defer"
                          aria-label={`Defer: ${item.text}`}
                        >
                          --
                        </button>
                      </>
                    )}
                    {item.status === 'deferred' && (
                      <button
                        className="queue-item__btn"
                        onClick={() => updateQueueItem(item.id, { status: 'open' })}
                        title="Reopen"
                        aria-label={`Reopen: ${item.text}`}
                      >
                        ^
                      </button>
                    )}
                    <button
                      className="queue-item__btn queue-item__btn--danger"
                      onClick={() => deleteQueueItem(item.id)}
                      title="Delete"
                      aria-label={`Delete: ${item.text}`}
                    >
                      x
                    </button>
                  </div>
                </div>
                {groundingPrompt === item.id && (
                  <div className="grounding-prompt">
                    <div className="grounding-prompt__header">What changed in the world?</div>
                    <div className="grounding-prompt__types">
                      {['sent email', 'committed code', 'conversation', 'decision', 'other'].map((type) => (
                        <button
                          key={type}
                          className={`grounding-prompt__type-btn${groundingType === type ? ' grounding-prompt__type-btn--active' : ''}`}
                          onClick={() => setGroundingType(type)}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                    <input
                      className="grounding-prompt__input"
                      type="text"
                      value={groundingDesc}
                      onChange={(e) => setGroundingDesc(e.target.value)}
                      placeholder="Optional: describe what happened..."
                      onKeyDown={(e) => { if (e.key === 'Enter') handleGroundingConfirm(item.id); }}
                    />
                    <div className="grounding-prompt__actions">
                      <button
                        className="queue-item__btn"
                        onClick={() => handleGroundingConfirm(item.id)}
                        disabled={!groundingType}
                        title="Confirm grounding"
                      >
                        ground
                      </button>
                      <button
                        className="grounding-prompt__skip"
                        onClick={() => skipGrounding(item.id)}
                        title="Skip grounding"
                      >
                        skip
                      </button>
                      <button
                        className="grounding-prompt__skip"
                        onClick={hideGrounding}
                        title="Cancel"
                      >
                        cancel
                      </button>
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* ── Search ─────────────────────────────────── */}
      {tab === 'search' && (
        <>
          <div className="search-bar">
            <div className="search-mode-toggle" role="radiogroup" aria-label="Search mode">
              <button
                className={`search-mode-btn${searchMode === 'keyword' ? ' search-mode-btn--active' : ''}`}
                onClick={() => setSearchMode('keyword')}
                title="Keyword search (FTS)"
                role="radio"
                aria-checked={searchMode === 'keyword'}
              >
                keyword
              </button>
              <button
                className={`search-mode-btn${searchMode === 'semantic' ? ' search-mode-btn--active' : ''}`}
                onClick={() => setSearchMode('semantic')}
                title="Semantic search (meaning-based)"
                role="radio"
                aria-checked={searchMode === 'semantic'}
              >
                semantic
              </button>
            </div>
            <input
              className="search-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchMode === 'semantic' ? 'Search by meaning...' : 'Search conversations, notes...'}
              aria-label={searchMode === 'semantic' ? 'Semantic search' : 'Keyword search'}
            />
          </div>
          <div className="zone-body" style={{ overflowY: 'auto' }}>
            {results.length === 0 && semanticResults.length === 0 && !isSearching && (
              <div className="empty-state">
                <div className="empty-state__icon">?</div>
                <div className="empty-state__text">
                  {query ? 'No results' : (searchMode === 'semantic' ? 'Semantic search' : 'Full-text search')}
                </div>
              </div>
            )}
            {isSearching && (
              <div className="empty-state" role="status" aria-live="polite">
                <div className="empty-state__icon" style={{ animation: 'pulse 1.5s infinite' }} aria-hidden="true">o</div>
                <div className="empty-state__text">Searching...</div>
              </div>
            )}
            {/* Keyword results */}
            {searchMode === 'keyword' && (
              <div className="search-results" role="list" aria-label="Keyword search results">
                {results.map((result, i) => (
                  <div key={result.id || i} className="search-result" role="listitem">
                    <div className="search-result__title">
                      [{result.type}] {result.title || result.session_title || 'Untitled'}
                    </div>
                    <div className="search-result__snippet">
                      {(result.content || '').slice(0, 200)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Semantic results */}
            {searchMode === 'semantic' && (
              <div className="search-results" role="list" aria-label="Semantic search results">
                {semanticResults.map((result, i) => (
                  <div key={result.id || i} className="search-result" role="listitem">
                    <div className="search-result__title">
                      {result.sessionTitle || 'Untitled'}
                    </div>
                    {result.summary && (
                      <div className="search-result__summary">
                        {result.summary}
                      </div>
                    )}
                    <div className="search-result__snippet">
                      {(result.content || '').slice(0, 200)}
                    </div>
                    {result.sessionDate && (
                      <div className="search-result__meta">
                        {result.sessionDate.slice(0, 16).replace('T', ' ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Sessions ───────────────────────────────── */}
      {tab === 'sessions' && (
        <div className="zone-body" style={{ overflowY: 'auto', padding: '8px 12px' }}>
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
      )}

      {/* ── Knowledge Graph (V.1.d) ───────────────── */}
      {tab === 'graph' && (
        <div className="zone-body" style={{ overflow: 'hidden', flex: 1 }}>
          <Suspense
            fallback={
              <div className="empty-state">
                <div className="empty-state__icon" style={{ animation: 'pulse 1.5s infinite' }}>&#9672;</div>
                <div className="empty-state__text">Loading graph...</div>
              </div>
            }
          >
            <KnowledgeGraph />
          </Suspense>
        </div>
      )}

      {/* ── Perlocutionary Audit (Drift Tab) ─────── */}
      {tab === 'drift' && (
        <div className="zone-body" style={{ overflowY: 'auto', flex: 1 }}>
          <Suspense
            fallback={
              <div className="empty-state">
                <div className="empty-state__icon" style={{ animation: 'pulse 1.5s infinite' }}>&#9671;</div>
                <div className="empty-state__text">Loading drift data...</div>
              </div>
            }
          >
            <DriftTab />
          </Suspense>
        </div>
      )}

      {/* ── Memory Explorer ──────────────────────── */}
      {tab === 'memory' && (
        <div className="zone-body" style={{ overflowY: 'auto', flex: 1 }}>
          <Suspense
            fallback={
              <div className="empty-state">
                <div className="empty-state__icon" style={{ animation: 'pulse 1.5s infinite' }}>{'\u21E9'}</div>
                <div className="empty-state__text">Loading memory explorer...</div>
              </div>
            }
          >
            <MemoryExplorer />
          </Suspense>
        </div>
      )}
    </>
  );
}

export default React.memo(SearchPanelInner);
