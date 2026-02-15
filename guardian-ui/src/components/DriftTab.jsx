import React, { useState, useEffect, useCallback } from 'react';
import useStore from '../store';
import DriftScoreBar from './DriftScoreBar';
import ReframeEventCard from './ReframeEventCard';
import DriftPatternView from './DriftPatternView';

const REFRAME_TYPES = ['contrast', 'relabel', 'identity', 'minimize', 'inflate', 'certainty', 'redirect'];

function DriftTab() {
  const reframeEvents = useStore((s) => s.reframeEvents);
  const reframeStats = useStore((s) => s.reframeStats);
  const driftScore = useStore((s) => s.driftScore);
  const reframeFilter = useStore((s) => s.reframeFilter);
  const fetchReframeEvents = useStore((s) => s.fetchReframeEvents);
  const fetchReframeStats = useStore((s) => s.fetchReframeStats);
  const fetchDriftScore = useStore((s) => s.fetchDriftScore);
  const setReframeFilter = useStore((s) => s.setReframeFilter);

  const [view, setView] = useState('timeline'); // 'timeline' | 'patterns'

  // Fetch data on mount
  useEffect(() => {
    fetchReframeEvents();
    fetchReframeStats();
    fetchDriftScore();
  }, [fetchReframeEvents, fetchReframeStats, fetchDriftScore]);

  const handleTypeFilter = useCallback((type) => {
    setReframeFilter({ type: reframeFilter.type === type ? null : type });
  }, [reframeFilter.type, setReframeFilter]);

  return (
    <div className="drift-tab">
      {/* Drift Score */}
      <DriftScoreBar score={driftScore} />

      {/* View toggle */}
      <div className="drift-tab__toggle">
        <button
          className={`drift-tab__toggle-btn${view === 'timeline' ? ' drift-tab__toggle-btn--active' : ''}`}
          onClick={() => setView('timeline')}
        >
          timeline
        </button>
        <button
          className={`drift-tab__toggle-btn${view === 'patterns' ? ' drift-tab__toggle-btn--active' : ''}`}
          onClick={() => setView('patterns')}
        >
          patterns
        </button>
      </div>

      {view === 'timeline' && (
        <>
          {/* Type filter pills */}
          <div className="drift-tab__filters">
            {REFRAME_TYPES.map((type) => (
              <button
                key={type}
                className={`drift-tab__filter-pill${reframeFilter.type === type ? ' drift-tab__filter-pill--active' : ''}`}
                onClick={() => handleTypeFilter(type)}
              >
                {type}
              </button>
            ))}
          </div>

          {/* Event cards */}
          <div className="drift-tab__events">
            {reframeEvents.length === 0 && (
              <div className="drift-tab__empty">
                <div className="empty-state__icon" style={{ fontSize: '18px' }}>&#9671;</div>
                <div className="empty-state__text">No reframe events detected yet</div>
                <div className="drift-tab__empty-hint">
                  Guardian monitors how Claude reframes your thinking across sessions
                </div>
              </div>
            )}
            {reframeEvents.map((event) => (
              <ReframeEventCard key={event.id} event={event} />
            ))}
          </div>
        </>
      )}

      {view === 'patterns' && (
        <DriftPatternView stats={reframeStats} />
      )}
    </div>
  );
}

export default React.memo(DriftTab);
