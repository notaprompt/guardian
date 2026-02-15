import React from 'react';

const TYPE_COLORS = {
  contrast: '#D4A843',
  relabel: '#7BA4D4',
  identity: '#C4B8A0',
  minimize: '#8B7355',
  inflate: '#C9956B',
  certainty: '#C75050',
  redirect: '#5B8A72',
};

function DriftPatternView({ stats }) {
  if (!stats) {
    return (
      <div className="drift-pattern">
        <div className="drift-pattern__empty">No pattern data yet</div>
      </div>
    );
  }

  const { total, byType, byDimension, accuracyRate } = stats;

  // Sort types by count
  const sortedTypes = Object.entries(byType || {})
    .sort(([, a], [, b]) => b - a);

  const sortedDimensions = Object.entries(byDimension || {})
    .sort(([, a], [, b]) => b - a);

  const maxTypeCount = sortedTypes.length > 0 ? sortedTypes[0][1] : 1;

  return (
    <div className="drift-pattern">
      {/* Summary row */}
      <div className="drift-pattern__summary">
        <div className="drift-pattern__stat">
          <span className="drift-pattern__stat-value">{total || 0}</span>
          <span className="drift-pattern__stat-label">reframes detected</span>
        </div>
        <div className="drift-pattern__stat">
          <span className="drift-pattern__stat-value">
            {accuracyRate !== null && accuracyRate !== undefined
              ? `${Math.round(accuracyRate * 100)}%`
              : '--'}
          </span>
          <span className="drift-pattern__stat-label">accuracy rate</span>
        </div>
      </div>

      {/* Type distribution */}
      {sortedTypes.length > 0 && (
        <div className="drift-pattern__section">
          <div className="drift-pattern__section-title">reframe types</div>
          {sortedTypes.map(([type, count]) => (
            <div key={type} className="drift-pattern__bar-row">
              <span className="drift-pattern__bar-label" style={{ color: TYPE_COLORS[type] || 'var(--white-45)' }}>
                {type}
              </span>
              <div className="drift-pattern__bar-track">
                <div
                  className="drift-pattern__bar-fill"
                  style={{
                    width: `${(count / maxTypeCount) * 100}%`,
                    background: TYPE_COLORS[type] || 'var(--white-30)',
                  }}
                />
              </div>
              <span className="drift-pattern__bar-count">{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Dimension distribution */}
      {sortedDimensions.length > 0 && (
        <div className="drift-pattern__section">
          <div className="drift-pattern__section-title">identity dimensions</div>
          {sortedDimensions.map(([dim, count]) => (
            <div key={dim} className="drift-pattern__dim-row">
              <span className="drift-pattern__dim-label">{dim}</span>
              <span className="drift-pattern__dim-count">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default React.memo(DriftPatternView);
