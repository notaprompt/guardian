import React from 'react';

export default function PanelHeader({ label, active, status, children }) {
  const dotClass = status === 'active' ? 'zone-head__dot--alive'
    : status === 'error' ? 'zone-head__dot--error'
    : '';

  const statusLabel = status === 'active' ? 'active' : status === 'error' ? 'error' : 'idle';

  return (
    <div className="zone-head" role="toolbar" aria-label={`${label} controls`}>
      <div className="zone-head__left">
        {status && (
          <span
            className={`zone-head__dot ${dotClass}`}
            role="status"
            aria-label={`${label} status: ${statusLabel}`}
          />
        )}
        <span className={`zone-head__label ${active ? 'zone-head__label--active' : ''}`}>
          {label}
        </span>
      </div>
      <div className="zone-head__actions">
        {children}
      </div>
    </div>
  );
}
