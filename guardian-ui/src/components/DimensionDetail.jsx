import React, { useEffect } from 'react';
import useStore from '../store';

const TREND_ARROWS = {
  rising: '\u25B4',   // ▴
  stable: '\u25B8',   // ▸
  falling: '\u25BE',  // ▾
};

function DimensionDetail() {
  const dimensionScores = useStore((s) => s.dimensionScores);
  const selectedDimension = useStore((s) => s.selectedDimension);
  const dimensionTimeline = useStore((s) => s.dimensionTimeline);
  const fetchDimensionTimeline = useStore((s) => s.fetchDimensionTimeline);
  const setSelectedDimension = useStore((s) => s.setSelectedDimension);

  useEffect(() => {
    if (selectedDimension && !dimensionTimeline) {
      fetchDimensionTimeline();
    }
  }, [selectedDimension, dimensionTimeline, fetchDimensionTimeline]);

  if (!selectedDimension || !dimensionScores) return null;

  const dim = dimensionScores.dimensions?.[selectedDimension];
  if (!dim) return null;

  const trendArrow = TREND_ARROWS[dim.trend] || TREND_ARROWS.stable;
  const scorePct = Math.round((dim.score || 0) * 100);

  // Extract weekly sparkline data for this dimension
  const sparkData = (dimensionTimeline || []).map((w) => ({
    week: w.week,
    value: w.dimensions?.[selectedDimension] || 0,
  }));
  const sparkMax = Math.max(...sparkData.map((d) => d.value), 0.01);

  return (
    <div className="dimension-detail">
      <div className="dimension-detail__header">
        <span className="dimension-detail__name">{selectedDimension}</span>
        <span className="dimension-detail__trend" title={dim.trend || 'stable'}>
          {trendArrow}
        </span>
        <button
          className="dimension-detail__close"
          onClick={() => setSelectedDimension(null)}
          title="Close detail"
        >
          x
        </button>
      </div>

      <div className="dimension-detail__score">
        <span className="dimension-detail__score-value">{scorePct}%</span>
        <span className="dimension-detail__score-label">engagement</span>
      </div>

      <div className="dimension-detail__stats">
        {dim.reframeCount > 0 && (
          <div className="dimension-detail__stat-row">
            <span className="dimension-detail__stat-label">reframes</span>
            <span className="dimension-detail__stat-value">{dim.reframeCount}</span>
          </div>
        )}
        {dim.entityCount > 0 && (
          <div className="dimension-detail__stat-row">
            <span className="dimension-detail__stat-label">entities</span>
            <span className="dimension-detail__stat-value">{dim.entityCount}</span>
          </div>
        )}
      </div>

      {/* Weekly sparkline */}
      {sparkData.length > 0 && (
        <div className="dimension-detail__sparkline">
          <div className="dimension-detail__sparkline-label">12-week trend</div>
          <svg viewBox={`0 0 ${sparkData.length * 10} 24`} className="dimension-detail__sparkline-svg">
            {sparkData.map((d, i) => {
              const h = (d.value / sparkMax) * 20;
              return (
                <rect
                  key={d.week}
                  x={i * 10 + 1}
                  y={22 - h}
                  width="8"
                  height={Math.max(1, h)}
                  rx="1"
                  fill={d.value > 0 ? 'rgba(232,220,200,0.3)' : 'rgba(255,255,255,0.04)'}
                />
              );
            })}
          </svg>
        </div>
      )}

      {dim.score > 0 && dim.reframeCount > 0 && dim.accuracyRate !== undefined && dim.accuracyRate < 0.6 && (
        <div className="dimension-detail__caution">
          Reframe accuracy is low in this dimension. Guardian is adjusting context.
        </div>
      )}
    </div>
  );
}

export default React.memo(DimensionDetail);
