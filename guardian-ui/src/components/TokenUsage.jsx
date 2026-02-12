import React, { useState, useMemo } from 'react';
import useStore from '../store';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All Time' },
];

function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfWeek() {
  const d = new Date();
  const day = d.getDay();
  // Monday = 1, so shift back to Monday (Sunday=0 becomes -6)
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function TokenUsage() {
  const [period, setPeriod] = useState('all');
  const usageRecords = useStore((s) => s.usageRecords);

  const { totalInput, totalOutput, total, requestCount } = useMemo(() => {
    let cutoff = null;
    if (period === 'today') cutoff = getStartOfToday();
    else if (period === 'week') cutoff = getStartOfWeek();
    else if (period === 'month') cutoff = getStartOfMonth();

    const filtered = cutoff
      ? usageRecords.filter((r) => new Date(r.timestamp) >= cutoff)
      : usageRecords;

    let inp = 0;
    let out = 0;
    for (const r of filtered) {
      inp += r.inputTokens || 0;
      out += r.outputTokens || 0;
    }

    return {
      totalInput: inp,
      totalOutput: out,
      total: inp + out,
      requestCount: filtered.length,
    };
  }, [usageRecords, period]);

  return (
    <div className="token-usage">
      <div className="token-usage__tabs">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            className={`token-usage__tab${period === p.key ? ' token-usage__tab--active' : ''}`}
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="token-usage__stats">
        <div className="token-usage__stat">
          <div className="token-usage__stat-value">
            {totalInput.toLocaleString()}
          </div>
          <div className="token-usage__stat-label">Input</div>
        </div>
        <div className="token-usage__stat">
          <div className="token-usage__stat-value">
            {totalOutput.toLocaleString()}
          </div>
          <div className="token-usage__stat-label">Output</div>
        </div>
        <div className="token-usage__stat">
          <div className="token-usage__stat-value">
            {total.toLocaleString()}
          </div>
          <div className="token-usage__stat-label">Total</div>
        </div>
      </div>

      <div className="token-usage__footer">
        {requestCount.toLocaleString()} request{requestCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
