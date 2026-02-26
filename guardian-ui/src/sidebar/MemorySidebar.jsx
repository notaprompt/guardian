import React, { useState, useEffect, lazy, Suspense } from 'react';
import useStore from '../store';

const DimensionLandscape = lazy(() => import('../components/DimensionLandscape'));
const DimensionDetail = lazy(() => import('../components/DimensionDetail'));
const MemoryExplorer = lazy(() => import('../components/MemoryExplorer'));

function MemoryLayers() {
  const compressionL2 = useStore((s) => s.compressionL2);
  const compressionL3 = useStore((s) => s.compressionL3);
  const fetchCompression = useStore((s) => s.fetchCompression);
  const updateCompressionItem = useStore((s) => s.updateCompressionItem);
  const runCompression = useStore((s) => s.runCompression);
  const sessions = useStore((s) => s.sessions);
  const navigateTo = useStore((s) => s.navigateTo);
  const [expandedSourceId, setExpandedSourceId] = useState(null);

  useEffect(() => {
    fetchCompression();
  }, [fetchCompression]);

  return (
    <div className="memory-layers">
      <div className="memory-layers__depth">
        {compressionL3.length} principle{compressionL3.length !== 1 ? 's' : ''} | {compressionL2.length} pattern{compressionL2.length !== 1 ? 's' : ''}
      </div>

      <div className="memory-layers__section">
        <div className="memory-layers__section-header">
          <span className="memory-layers__section-title">
            <span className="memory-layers__level-badge memory-layers__level-badge--l3">L3</span>
            {' '}Principles
          </span>
          <button
            className="memory-layers__section-btn"
            onClick={() => runCompression(3)}
            title="Distill principles from patterns"
          >
            distill
          </button>
        </div>
        {compressionL3.length === 0 && (
          <div className="memory-layers__empty">
            No principles yet. Need 3+ patterns to distill.
          </div>
        )}
        {compressionL3.map((item) => (
          <div
            key={item.id}
            className="memory-layers__item"
            style={{ opacity: Math.max(0.3, item.strength || 1) }}
          >
            <div className="memory-layers__item-content">
              {item.content.split('\n')[0]}
            </div>
            <div className="memory-layers__item-meta">
              <span className="memory-layers__item-strength">
                {Math.round((item.strength || 1) * 100)}%
              </span>
              <span>{item.created_at?.slice(0, 10)}</span>
              {item.source_ids && (() => {
                const ids = JSON.parse(item.source_ids || '[]');
                const isExpanded = expandedSourceId === item.id;
                return (
                  <>
                    <span
                      className="memory-layers__source-link"
                      onClick={(e) => { e.stopPropagation(); setExpandedSourceId(isExpanded ? null : item.id); }}
                    >
                      {ids.length} sources {isExpanded ? '-' : '+'}
                    </span>
                    {isExpanded && (
                      <div className="memory-layers__sources-list">
                        {ids.map(sid => {
                          const sess = sessions.find(sess => sess.id === sid);
                          return (
                            <div key={sid} className="memory-layers__source-item"
                              onClick={() => navigateTo('sessions', { sessionId: sid })}>
                              {sess?.title || sid.slice(0, 8) + '...'}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
              {item.status === 'pinned' && <span className="memory-layers__pin-badge">pinned</span>}
            </div>
            <div className="memory-layers__item-actions">
              {item.status !== 'pinned' ? (
                <button
                  className="memory-layers__action-btn"
                  onClick={() => updateCompressionItem(item.id, { status: 'pinned' })}
                  title="Pin -- exempt from decay"
                >
                  pin
                </button>
              ) : (
                <button
                  className="memory-layers__action-btn"
                  onClick={() => updateCompressionItem(item.id, { status: 'active' })}
                  title="Unpin"
                >
                  unpin
                </button>
              )}
              <button
                className="memory-layers__action-btn memory-layers__action-btn--danger"
                onClick={() => updateCompressionItem(item.id, { status: 'archived' })}
                title="Dismiss -- archive"
              >
                dismiss
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="memory-layers__section">
        <div className="memory-layers__section-header">
          <span className="memory-layers__section-title">
            <span className="memory-layers__level-badge memory-layers__level-badge--l2">L2</span>
            {' '}Patterns
          </span>
          <button
            className="memory-layers__section-btn"
            onClick={() => runCompression(2)}
            title="Extract patterns from summaries"
          >
            extract
          </button>
        </div>
        {compressionL2.length === 0 && (
          <div className="memory-layers__empty">
            No patterns yet. Need 5+ session summaries.
          </div>
        )}
        {compressionL2.map((item) => (
          <div
            key={item.id}
            className="memory-layers__item"
            style={{ opacity: Math.max(0.3, item.strength || 1) }}
          >
            <div className="memory-layers__item-content">
              {item.content.split('\n')[0]}
            </div>
            <div className="memory-layers__item-meta">
              <span className="memory-layers__item-strength">
                {Math.round((item.strength || 1) * 100)}%
              </span>
              <span>{item.created_at?.slice(0, 10)}</span>
              {item.source_ids && (() => {
                const ids = JSON.parse(item.source_ids || '[]');
                const isExpanded = expandedSourceId === item.id;
                return (
                  <>
                    <span
                      className="memory-layers__source-link"
                      onClick={(e) => { e.stopPropagation(); setExpandedSourceId(isExpanded ? null : item.id); }}
                    >
                      {ids.length} sources {isExpanded ? '-' : '+'}
                    </span>
                    {isExpanded && (
                      <div className="memory-layers__sources-list">
                        {ids.map(sid => {
                          const sess = sessions.find(sess => sess.id === sid);
                          return (
                            <div key={sid} className="memory-layers__source-item"
                              onClick={() => navigateTo('sessions', { sessionId: sid })}>
                              {sess?.title || sid.slice(0, 8) + '...'}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
              {item.status === 'pinned' && <span className="memory-layers__pin-badge">pinned</span>}
            </div>
            <div className="memory-layers__item-actions">
              {item.status !== 'pinned' ? (
                <button
                  className="memory-layers__action-btn"
                  onClick={() => updateCompressionItem(item.id, { status: 'pinned' })}
                  title="Pin -- exempt from decay"
                >
                  pin
                </button>
              ) : (
                <button
                  className="memory-layers__action-btn"
                  onClick={() => updateCompressionItem(item.id, { status: 'active' })}
                  title="Unpin"
                >
                  unpin
                </button>
              )}
              <button
                className="memory-layers__action-btn memory-layers__action-btn--danger"
                onClick={() => updateCompressionItem(item.id, { status: 'archived' })}
                title="Dismiss -- archive"
              >
                dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MemorySidebar() {
  const [memoryTab, setMemoryTab] = useState('layers');
  const selectedDimension = useStore((s) => s.selectedDimension);

  return (
    <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="memory-view__toggle">
        <button
          className={`memory-view__toggle-btn${memoryTab === 'layers' ? ' memory-view__toggle-btn--active' : ''}`}
          onClick={() => setMemoryTab('layers')}
        >
          principles & patterns
        </button>
        <button
          className={`memory-view__toggle-btn${memoryTab === 'landscape' ? ' memory-view__toggle-btn--active' : ''}`}
          onClick={() => setMemoryTab('landscape')}
        >
          landscape
        </button>
        <button
          className={`memory-view__toggle-btn${memoryTab === 'conversations' ? ' memory-view__toggle-btn--active' : ''}`}
          onClick={() => setMemoryTab('conversations')}
        >
          imported
        </button>
      </div>

      {memoryTab === 'layers' && <MemoryLayers />}

      {memoryTab === 'landscape' && (
        <Suspense
          fallback={
            <div className="empty-state">
              <div className="empty-state__icon" style={{ animation: 'pulse 1.5s infinite' }}>&#9671;</div>
              <div className="empty-state__text">Loading landscape...</div>
            </div>
          }
        >
          <DimensionLandscape />
          {selectedDimension && <DimensionDetail />}
        </Suspense>
      )}

      {memoryTab === 'conversations' && (
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
      )}
    </div>
  );
}

export default React.memo(MemorySidebar);
