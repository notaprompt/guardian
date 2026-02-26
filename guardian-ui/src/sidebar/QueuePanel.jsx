import React, { useState, useCallback, useEffect } from 'react';
import useStore from '../store';

function QueuePanel() {
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
  const setSensitivity = useStore((s) => s.setSensitivity);

  const [newThread, setNewThread] = useState('');
  const [groundingType, setGroundingType] = useState(null);
  const [groundingDesc, setGroundingDesc] = useState('');

  useEffect(() => {
    fetchGroundingStats();
  }, [fetchGroundingStats]);

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

  const cycleSensitivity = useCallback((itemId, current) => {
    const next = current === 'surface' ? 'deep' : current === 'deep' ? 'sovereign' : 'surface';
    setSensitivity('queue_items', itemId, next);
  }, [setSensitivity]);

  const handleGroundingConfirm = useCallback((itemId) => {
    if (!groundingType) return;
    resolveWithGrounding(itemId, groundingType, groundingDesc);
    setGroundingType(null);
    setGroundingDesc('');
  }, [groundingType, groundingDesc, resolveWithGrounding]);

  return (
    <div className="zone-body" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', flex: 1 }}>
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
            <div className={`queue-item queue-item--${item.status}${item.sensitivity && item.sensitivity !== 'surface' ? ` queue-item--${item.sensitivity}` : ''}`} role="listitem">
              <div className="queue-item__text">{item.text}</div>
              <div className="queue-item__actions">
                {item.sensitivity && item.sensitivity !== 'surface' && (
                  <button
                    className={`sovereign-btn sovereign-btn--${item.sensitivity}`}
                    onClick={() => cycleSensitivity(item.id, item.sensitivity)}
                    title={`Sensitivity: ${item.sensitivity} (click to cycle)`}
                  >
                    {item.sensitivity === 'deep' ? 'D' : 'S'}
                  </button>
                )}
                {(!item.sensitivity || item.sensitivity === 'surface') && (
                  <button
                    className="sovereign-btn"
                    onClick={() => cycleSensitivity(item.id, 'surface')}
                    title="Sensitivity: surface (click to cycle)"
                  >
                    -
                  </button>
                )}
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
  );
}

export default React.memo(QueuePanel);
