import React, { useState, useCallback, useEffect } from 'react';
import useStore from '../store';
import ReflectionConversation from './ReflectionConversation';

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function sanitizeHighlight(html) {
  if (!html) return '';
  // Escape all HTML, then restore only <mark> and </mark> from FTS5 highlight()
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/&lt;mark&gt;/g, '<mark>')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}

function formatDateRange(stats) {
  if (!stats || !stats.dateRange) return '';
  const { earliest, latest } = stats.dateRange;
  if (!earliest || !latest) return '';
  const start = new Date(earliest);
  const end = new Date(latest);
  const months = Math.max(1, Math.round((end - start) / (30.44 * 86400000)));
  return `${stats.conversations} conversations over ${months} month${months !== 1 ? 's' : ''} -- ${stats.messages.toLocaleString()} exchanges`;
}

export default function ReflectionsExplorer() {
  const query = useStore((s) => s.reflectionQuery);
  const setQuery = useStore((s) => s.setReflectionQuery);
  const results = useStore((s) => s.reflectionResults);
  const loading = useStore((s) => s.reflectionLoading);
  const stats = useStore((s) => s.reflectionStats);
  const mode = useStore((s) => s.reflectionMode);
  const setMode = useStore((s) => s.setReflectionMode);
  const searchReflections = useStore((s) => s.searchReflections);
  const conversation = useStore((s) => s.reflectionConversation);
  const loadConversation = useStore((s) => s.loadReflectionConversation);
  const clearConversation = useStore((s) => s.clearReflectionConversation);
  const loadStats = useStore((s) => s.loadReflectionStats);
  const importReflections = useStore((s) => s.importReflections);

  const [highlightMessageId, setHighlightMessageId] = useState(null);
  const [importStatus, setImportStatus] = useState(null);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleSearch = useCallback(() => {
    if (!query.trim()) return;
    if (mode === 'words') {
      searchReflections();
    }
  }, [query, mode, searchReflections]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  }, [handleSearch]);

  const handleResultClick = useCallback((result) => {
    setHighlightMessageId(result.id);
    loadConversation(result.conversation_id);
  }, [loadConversation]);

  const handleBack = useCallback(() => {
    clearConversation();
    setHighlightMessageId(null);
  }, [clearConversation]);

  const handleImport = useCallback(async () => {
    try {
      const result = await window.guardian?.import?.conversations?.selectFile();
      if (!result?.ok || !result.filePath) return;

      setImportStatus('importing');
      const importResult = await importReflections(result.filePath);
      if (importResult?.ok) {
        setImportStatus(`Imported ${importResult.conversations} conversations, ${importResult.messages} messages`);
      } else {
        setImportStatus(`Import failed: ${importResult?.error || 'unknown error'}`);
      }
      setTimeout(() => setImportStatus(null), 5000);
    } catch (e) {
      setImportStatus(`Import failed: ${e.message}`);
      setTimeout(() => setImportStatus(null), 5000);
    }
  }, [importReflections]);

  // Conversation reader view
  if (conversation) {
    return (
      <ReflectionConversation
        conversation={conversation}
        highlightMessageId={highlightMessageId}
        onBack={handleBack}
      />
    );
  }

  // Search view
  const hasData = stats && stats.conversations > 0;
  const stubMessage = 'Available on local hardware';

  return (
    <div className="reflections-explorer">
      {/* Header with import button */}
      <div className="reflections-explorer__toolbar">
        <button
          className="reflections-explorer__import-btn"
          onClick={handleImport}
          title="Import conversations"
        >
          Import conversations
        </button>
      </div>

      {importStatus && (
        <div className="reflections-explorer__status">
          {importStatus === 'importing' ? 'Importing...' : importStatus}
        </div>
      )}

      {/* Search input */}
      <div className="reflections-explorer__search">
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What are you looking for?"
          aria-label="Search reflections"
        />
      </div>

      {/* Mode pills */}
      <div className="reflections-explorer__modes" role="radiogroup" aria-label="Search mode">
        <button
          className={`reflections-mode-btn${mode === 'words' ? ' reflections-mode-btn--active' : ''}`}
          onClick={() => setMode('words')}
          role="radio"
          aria-checked={mode === 'words'}
        >
          Words
        </button>
        <button
          className={`reflections-mode-btn${mode === 'meaning' ? ' reflections-mode-btn--active' : ''}`}
          onClick={() => setMode('meaning')}
          role="radio"
          aria-checked={mode === 'meaning'}
          title={stubMessage}
        >
          Meaning
        </button>
        <button
          className={`reflections-mode-btn${mode === 'inquiry' ? ' reflections-mode-btn--active' : ''}`}
          onClick={() => setMode('inquiry')}
          role="radio"
          aria-checked={mode === 'inquiry'}
          title={stubMessage}
        >
          Inquiry
        </button>
      </div>

      {/* Stats line */}
      {hasData && (
        <div className="reflections-explorer__stats">
          {formatDateRange(stats)}
        </div>
      )}

      {/* Meaning / Inquiry stub notice */}
      {(mode === 'meaning' || mode === 'inquiry') && (
        <div className="reflections-explorer__stub-notice">
          {mode === 'meaning'
            ? 'Semantic search requires local hardware with Ollama and nomic-embed-text.'
            : 'Inquiry mode requires local hardware with Ollama and qwen2.5:7b-instruct.'}
        </div>
      )}

      {/* Results */}
      <div className="reflections-explorer__results">
        {/* Empty state: no data */}
        {!hasData && !loading && results.length === 0 && (
          <div className="empty-state">
            <div className="empty-state__icon">{'\u27F3'}</div>
            <div className="empty-state__text">
              No conversations here yet. Import an export to bring your words home.
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="empty-state" role="status" aria-live="polite">
            <div className="empty-state__icon" style={{ animation: 'pulse 1.5s infinite' }} aria-hidden="true">o</div>
            <div className="empty-state__text">Searching...</div>
          </div>
        )}

        {/* No results for query */}
        {hasData && !loading && results.length === 0 && query.trim() && mode === 'words' && (
          <div className="empty-state">
            <div className="empty-state__icon">?</div>
            <div className="empty-state__text">
              Nothing matched. Try different words, or switch to Meaning to search what you meant.
            </div>
          </div>
        )}

        {/* Search results */}
        {results.length > 0 && (
          <div className="reflections-results" role="list" aria-label="Reflection search results">
            {results.map((result, i) => (
              <div
                key={result.id || i}
                className="reflections-result"
                role="listitem"
                tabIndex={0}
                onClick={() => handleResultClick(result)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleResultClick(result); } }}
              >
                <div className="reflections-result__convo-title">
                  {result.conversation_title || 'Untitled'}
                </div>
                <div className="reflections-result__meta">
                  {formatDate(result.created_at)}
                  {' \u00b7 '}
                  {result.sender === 'human' ? 'You' : 'Claude'}
                </div>
                <div
                  className="reflections-result__text"
                  dangerouslySetInnerHTML={{ __html: sanitizeHighlight(result.highlighted_text || result.text) }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
