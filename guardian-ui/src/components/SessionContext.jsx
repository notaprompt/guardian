import React from 'react';
import useStore from '../store';

export default function SessionContext() {
  const ctx = useStore((s) => s.sessionContext);
  const dismiss = useStore((s) => s.dismissSessionContext);
  const navigateTo = useStore((s) => s.navigateTo);
  const messages = useStore((s) => s.chatMessages);
  const quietMode = useStore((s) => s.quietMode);

  if (!ctx || messages.length > 0 || quietMode) return null;

  const { queueItems, patterns, awareness, weekSessions } = ctx;

  return (
    <div className="session-context" role="status">
      <div className="session-context__header">
        <span className="session-context__label">since last session</span>
        <button className="session-context__dismiss" onClick={dismiss}>x</button>
      </div>
      <div className="session-context__items">
        {queueItems.length > 0 && (
          <span className="session-context__item"
            onClick={() => navigateTo('queue')}>
            {queueItems.length} open thread{queueItems.length !== 1 ? 's' : ''}
          </span>
        )}
        {patterns.length > 0 && (
          <span className="session-context__item"
            onClick={() => navigateTo('memory')}>
            {patterns.length} recent pattern{patterns.length !== 1 ? 's' : ''}
          </span>
        )}
        {awareness && (
          <span className="session-context__item session-context__item--awareness">
            awareness: {awareness.topic}
          </span>
        )}
        {weekSessions > 0 && (
          <span className="session-context__item session-context__item--dim"
            onClick={() => navigateTo('sessions')}>
            {weekSessions} session{weekSessions !== 1 ? 's' : ''} this week
          </span>
        )}
      </div>
    </div>
  );
}
