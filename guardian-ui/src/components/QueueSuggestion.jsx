import React from 'react';
import useStore from '../store';

/**
 * QueueSuggestion -- Dismissable card shown when pipeline-extracted
 * entities match open integration queue items.
 */
export default function QueueSuggestion() {
  const suggestion = useStore((s) => s.queueSuggestion);
  const dismiss = useStore((s) => s.dismissQueueSuggestion);
  const navigateTo = useStore((s) => s.navigateTo);
  const quietMode = useStore((s) => s.quietMode);

  if (!suggestion || quietMode) return null;

  const { entityNames, queueItems } = suggestion;

  return (
    <div className="queue-suggestion" role="status" aria-live="polite">
      <div className="queue-suggestion__header">
        <span className="queue-suggestion__label">related to open threads</span>
        <button className="queue-suggestion__dismiss" onClick={dismiss}>x</button>
      </div>
      <div className="queue-suggestion__body">
        <span className="queue-suggestion__text">
          Entities from this conversation ({entityNames.join(', ')}) relate to:
        </span>
        {queueItems.map((item) => (
          <div key={item.id} className="queue-suggestion__item"
            onClick={() => navigateTo('queue')}>
            {item.text.length > 70 ? item.text.slice(0, 70) + '...' : item.text}
          </div>
        ))}
      </div>
    </div>
  );
}
