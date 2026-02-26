import React from 'react';
import useStore from '../store';

function FirstSessionGuide() {
  const onboardingComplete = useStore((s) => s.profile?.onboardingComplete);
  const firstSessionDone = useStore((s) => s.guide.firstSessionDone);
  const pipelineDigest = useStore((s) => s.pipelineDigest);
  const markFirstSessionDone = useStore((s) => s.markFirstSessionDone);

  if (!onboardingComplete || firstSessionDone || !pipelineDigest) return null;

  return (
    <div className="first-session-guide" role="status">
      <div className="first-session-guide__title">What just happened?</div>
      Guardian analyzed your conversation. After every message:
      <ul style={{ margin: '4px 0 4px 16px', padding: 0 }}>
        <li>Entities are extracted to your Knowledge Graph</li>
        <li>Patterns are detected and compressed into long-term memory</li>
        <li>Awareness monitors your recurring topics</li>
      </ul>
      Click any item above to explore. This message won't appear again.
      <div>
        <button className="first-session-guide__dismiss" onClick={markFirstSessionDone}>
          Got it
        </button>
      </div>
    </div>
  );
}

export default React.memo(FirstSessionGuide);
