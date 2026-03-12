import React from 'react';
import useStore from '../store';

export default function SessionContext() {
  const ctx = useStore((s) => s.sessionContext);
  const dismiss = useStore((s) => s.dismissSessionContext);
  const navigateTo = useStore((s) => s.navigateTo);
  const resumeSession = useStore((s) => s.resumeSession);
  const messages = useStore((s) => s.chatMessages);
  const quietMode = useStore((s) => s.quietMode);
  const weeklyStats = useStore((s) => s.weeklyStats);

  const hasWeekly = weeklyStats && !quietMode && messages.length === 0;
  if (!ctx && !hasWeekly) return null;
  if ((ctx && messages.length > 0) || quietMode) {
    if (!hasWeekly) return null;
  }

  const { queueItems, patterns, awareness, weekSessions, lastSession } = ctx || {};

  return (
    <div className="session-context" role="status">
      {/* Weekly synthesis card */}
      {hasWeekly && (
        <div className="session-context__weekly">
          <span className="session-context__label">last 7 days</span>
          <div className="session-context__weekly-stats">
            {weeklyStats.sessions > 0 && <span>{weeklyStats.sessions} session{weeklyStats.sessions !== 1 ? 's' : ''}</span>}
            {weeklyStats.notes > 0 && <span>{weeklyStats.notes} note{weeklyStats.notes !== 1 ? 's' : ''}</span>}
            {weeklyStats.entities > 0 && <span>{weeklyStats.entities} entit{weeklyStats.entities !== 1 ? 'ies' : 'y'}</span>}
            {weeklyStats.resolved > 0 && <span>{weeklyStats.resolved} resolved</span>}
          </div>
        </div>
      )}

      {ctx && (
      <div className="session-context__header">
        <span className="session-context__label">since last session</span>
        <button className="session-context__dismiss" onClick={dismiss}>x</button>
      </div>
      )}

      {/* Continue from last session link */}
      {lastSession && (
        <div className="session-context__continue"
          onClick={() => resumeSession(lastSession.id)}>
          continue: {lastSession.title || 'last session'}
        </div>
      )}

      {/* Open queue items with text preview */}
      {queueItems && queueItems.length > 0 && (
        <div className="session-context__queue">
          <span className="session-context__queue-label"
            onClick={() => navigateTo('queue')}>
            open threads
          </span>
          {queueItems.map((item) => (
            <div key={item.id} className="session-context__queue-item"
              onClick={() => navigateTo('queue')}>
              {item.text.length > 60 ? item.text.slice(0, 60) + '...' : item.text}
            </div>
          ))}
        </div>
      )}

      {ctx && (
      <div className="session-context__items">
        {patterns && patterns.length > 0 && (
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
      )}
    </div>
  );
}
