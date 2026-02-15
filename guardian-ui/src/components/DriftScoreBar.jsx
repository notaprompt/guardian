import React from 'react';

function DriftScoreBar({ score }) {
  if (score === null || score === undefined) {
    return (
      <div className="drift-score-bar drift-score-bar--empty">
        <span className="drift-score-bar__label">Drift score</span>
        <span className="drift-score-bar__value">No rated events yet</span>
      </div>
    );
  }

  const pct = Math.round(score * 100);
  const level = score >= 0.7 ? 'alive' : score >= 0.4 ? 'caution' : 'danger';

  return (
    <div className={`drift-score-bar drift-score-bar--${level}`}>
      <div className="drift-score-bar__header">
        <span className="drift-score-bar__label">Drift score</span>
        <span className="drift-score-bar__value">{pct}% accurate</span>
      </div>
      <div className="drift-score-bar__track">
        <div
          className="drift-score-bar__fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      {score < 0.6 && (
        <div className="drift-score-bar__note">
          Guardian is adjusting context to match your framing
        </div>
      )}
    </div>
  );
}

export default React.memo(DriftScoreBar);
