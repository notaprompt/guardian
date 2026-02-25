import React, { useState, useCallback } from 'react';
import useStore from '../store';

function SearchSidebar() {
  const query = useStore((s) => s.searchQuery);
  const setQuery = useStore((s) => s.setSearchQuery);
  const results = useStore((s) => s.searchResults);
  const semanticResults = useStore((s) => s.semanticSearchResults);
  const searchMode = useStore((s) => s.searchMode);
  const setSearchMode = useStore((s) => s.setSearchMode);
  const performSearch = useStore((s) => s.performSearch);

  const [isSearching, setIsSearching] = useState(false);

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

  return (
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
      <div className="zone-body" style={{ overflowY: 'auto', flex: 1 }}>
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
  );
}

export default React.memo(SearchSidebar);
