import React, { useState, useCallback } from 'react';
import useStore from '../store';
import './AwarenessAlert.css';

/**
 * AwarenessAlert — Awareness-trap notification
 *
 * Subtle amber banner at top of chat. Observational, never prescriptive.
 * "Guardian does NOT diagnose. It surfaces the pattern."
 */
export default function AwarenessAlert() {
  const awareness = useStore((s) => s.awareness);
  const dismissAwareness = useStore((s) => s.dismissAwareness);
  const promoteAwareness = useStore((s) => s.promoteAwareness);
  const [dismissing, setDismissing] = useState(false);

  if (!awareness || awareness.dismissed) return null;

  const handleDismiss = useCallback(async () => {
    setDismissing(true);
    await dismissAwareness();
  }, [dismissAwareness]);

  const handlePromote = useCallback(async () => {
    await promoteAwareness();
  }, [promoteAwareness]);

  const { sessionCount, spanText, topic } = awareness;

  return (
    <div className="awareness-alert" role="status" aria-live="polite">
      <div className="awareness-alert__icon" aria-hidden="true">&#9672;</div>
      <div className="awareness-alert__body">
        <p className="awareness-alert__message">
          This topic ({topic}) has appeared in {sessionCount} sessions
          over {spanText} without resolution. You can promote it to your
          integration queue or explore what's blocking action.
        </p>
        <div className="awareness-alert__actions">
          <button
            className="awareness-alert__btn awareness-alert__btn--promote"
            onClick={handlePromote}
            title="Add to integration queue"
          >
            add to integration queue
          </button>
          <button
            className="awareness-alert__btn awareness-alert__btn--dismiss"
            onClick={handleDismiss}
            disabled={dismissing}
            title="Dismiss — won't re-fire for 7 days"
          >
            dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
