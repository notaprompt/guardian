import React, { useCallback } from 'react';
import useStore from '../store';

const TYPE_COLORS = {
  contrast: '#D4A843',
  relabel: '#7BA4D4',
  identity: '#C4B8A0',
  minimize: '#8B7355',
  inflate: '#C9956B',
  certainty: '#C75050',
  redirect: '#5B8A72',
};

function ReframeEventCard({ event }) {
  const rateReframe = useStore((s) => s.rateReframe);
  const navigateTo = useStore((s) => s.navigateTo);

  const handleRate = useCallback((accurate) => {
    rateReframe(event.id, accurate);
  }, [event.id, rateReframe]);

  const isRated = event.accurate !== -1 && event.accurate !== null && event.accurate !== undefined;
  const typeColor = TYPE_COLORS[event.reframe_type] || 'var(--white-30)';

  return (
    <div className={`reframe-card${isRated ? ' reframe-card--rated' : ''}`}>
      <div className="reframe-card__header">
        <span
          className="reframe-card__type-pill"
          style={{ borderColor: typeColor, color: typeColor }}
        >
          {event.reframe_type}
        </span>
        {event.identity_dimension && (
          <span className="reframe-card__dimension">{event.identity_dimension}</span>
        )}
        <span className="reframe-card__date">
          {event.created_at?.slice(0, 10)}
        </span>
      </div>

      <div className="reframe-card__context">
        <span className="reframe-card__context-label">you said</span>
        <div className="reframe-card__context-text">{event.user_context}</div>
      </div>

      <div className="reframe-card__reframe">
        <span className="reframe-card__reframe-label">reframed as</span>
        <div className="reframe-card__reframe-text">{event.reframe_text}</div>
      </div>

      <div className="reframe-card__actions">
        <button
          className={`reframe-card__btn reframe-card__btn--accurate${event.accurate === 1 ? ' reframe-card__btn--selected' : ''}`}
          onClick={() => handleRate(1)}
          disabled={isRated}
          title="This reframe feels accurate"
        >
          accurate
        </button>
        <button
          className={`reframe-card__btn reframe-card__btn--not-me${event.accurate === 0 ? ' reframe-card__btn--selected' : ''}`}
          onClick={() => handleRate(0)}
          disabled={isRated}
          title="This doesn't match my experience"
        >
          not me
        </button>
        {event.session_id && (
          <button
            className="reframe-card__btn reframe-card__session-link"
            onClick={() => navigateTo('sessions', { sessionId: event.session_id })}
            title="View source session"
          >
            session
          </button>
        )}
      </div>

      {event.confidence && (
        <div className="reframe-card__confidence">
          {Math.round(event.confidence * 100)}% confidence
        </div>
      )}
    </div>
  );
}

export default React.memo(ReframeEventCard);
