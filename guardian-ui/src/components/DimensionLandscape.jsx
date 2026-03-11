import React, { useEffect, useMemo, useCallback } from 'react';
import useStore from '../store';

const DIMENSIONS = [
  'emotional', 'professional', 'reasoning', 'relational',
  'ambition', 'worth', 'somatic', 'creative',
];

const DIMENSION_LABELS = {
  emotional: 'Emotional',
  professional: 'Professional',
  reasoning: 'Reasoning',
  relational: 'Relational',
  ambition: 'Ambition',
  worth: 'Worth',
  somatic: 'Somatic',
  creative: 'Creative',
};

// Layout constants
const CX = 150;
const CY = 150;
const RADIUS = 110;
const INNER_RADIUS = 20;

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function DimensionLandscape() {
  const dimensionScores = useStore((s) => s.dimensionScores);
  const selectedDimension = useStore((s) => s.selectedDimension);
  const dimensionTimeWindow = useStore((s) => s.dimensionTimeWindow);
  const fetchDimensionScores = useStore((s) => s.fetchDimensionScores);
  const setSelectedDimension = useStore((s) => s.setSelectedDimension);
  const setDimensionTimeWindow = useStore((s) => s.setDimensionTimeWindow);

  useEffect(() => {
    fetchDimensionScores();
  }, [fetchDimensionScores]);

  const dimensions = dimensionScores?.dimensions || {};
  const dominantDimension = dimensionScores?.dominantDimension;
  const neglectedDimension = dimensionScores?.neglectedDimension;

  // Compute polygon points
  const polygonPoints = useMemo(() => {
    return DIMENSIONS.map((dim, i) => {
      const angle = (360 / DIMENSIONS.length) * i;
      const score = dimensions[dim]?.score || 0;
      const r = INNER_RADIUS + (RADIUS - INNER_RADIUS) * Math.min(1, score);
      return polarToCartesian(CX, CY, r, angle);
    });
  }, [dimensions]);

  const polygonPath = useMemo(() => {
    if (polygonPoints.length === 0) return '';
    return polygonPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';
  }, [polygonPoints]);

  const handleDimensionClick = useCallback((dim) => {
    setSelectedDimension(selectedDimension === dim ? null : dim);
  }, [selectedDimension, setSelectedDimension]);

  return (
    <div className="dimension-landscape">
      {/* Time window pills */}
      <div className="dimension-time-pills">
        {[30, 90, 0].map((days) => (
          <button
            key={days}
            className={`dimension-time-pill${dimensionTimeWindow === days ? ' dimension-time-pill--active' : ''}`}
            onClick={() => setDimensionTimeWindow(days)}
          >
            {days === 0 ? 'all' : `${days}d`}
          </button>
        ))}
      </div>

      {/* SVG Radial Plot */}
      <svg
        viewBox="0 0 300 300"
        className="dimension-landscape__svg"
        role="img"
        aria-label="Identity dimension landscape"
      >
        {/* Grid rings */}
        {[0.25, 0.5, 0.75, 1.0].map((level) => (
          <circle
            key={level}
            cx={CX}
            cy={CY}
            r={INNER_RADIUS + (RADIUS - INNER_RADIUS) * level}
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="0.5"
          />
        ))}

        {/* Spokes + Labels + Nodes */}
        {DIMENSIONS.map((dim, i) => {
          const angle = (360 / DIMENSIONS.length) * i;
          const outerPoint = polarToCartesian(CX, CY, RADIUS, angle);
          const innerPoint = polarToCartesian(CX, CY, INNER_RADIUS, angle);
          const labelPoint = polarToCartesian(CX, CY, RADIUS + 16, angle);
          const score = dimensions[dim]?.score || 0;
          const nodeR = INNER_RADIUS + (RADIUS - INNER_RADIUS) * Math.min(1, score);
          const nodePoint = polarToCartesian(CX, CY, nodeR, angle);
          const isDominant = dim === dominantDimension;
          const isNeglected = dim === neglectedDimension;
          const isSelected = dim === selectedDimension;
          const nodeRadius = 4 + (score * 4);

          let nodeColor = 'rgba(232,220,200,0.5)';
          if (isDominant) nodeColor = '#5BF29B';
          if (isNeglected) nodeColor = '#C75050';
          if (isSelected) nodeColor = '#E8DCC8';

          return (
            <g key={dim}>
              {/* Spoke line */}
              <line
                x1={innerPoint.x}
                y1={innerPoint.y}
                x2={outerPoint.x}
                y2={outerPoint.y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="0.5"
              />

              {/* Node */}
              <circle
                cx={nodePoint.x}
                cy={nodePoint.y}
                r={nodeRadius}
                fill={nodeColor}
                fillOpacity={isSelected ? 0.8 : 0.4}
                stroke={nodeColor}
                strokeWidth={isSelected ? 1.5 : 0.5}
                strokeOpacity={isSelected ? 1 : 0.6}
                style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}
                onClick={() => handleDimensionClick(dim)}
              />

              {/* Label */}
              <text
                x={labelPoint.x}
                y={labelPoint.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={isSelected ? '#E8DCC8' : 'rgba(255,255,255,0.3)'}
                fontSize="7"
                fontFamily="'JetBrains Mono', monospace"
                fontWeight={isDominant ? '600' : '400'}
                letterSpacing="0.04em"
                style={{ cursor: 'pointer' }}
                onClick={() => handleDimensionClick(dim)}
              >
                {DIMENSION_LABELS[dim]}
              </text>
            </g>
          );
        })}

        {/* Polygon fill */}
        {polygonPath && (
          <>
            <path
              d={polygonPath}
              fill="rgba(232,220,200,0.06)"
              stroke="rgba(232,220,200,0.4)"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </>
        )}
      </svg>

      {/* Legend */}
      {(dominantDimension || neglectedDimension) && (
        <div className="dimension-landscape__legend">
          {dominantDimension && (
            <span className="dimension-legend-item dimension-legend-item--dominant">
              {DIMENSION_LABELS[dominantDimension]} (dominant)
            </span>
          )}
          {neglectedDimension && (
            <span className="dimension-legend-item dimension-legend-item--neglected">
              {DIMENSION_LABELS[neglectedDimension]} (neglected)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(DimensionLandscape);
