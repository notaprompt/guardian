import React from 'react';
import useStore from '../store';

function ProcessGuide() {
  const hideProcessGuide = useStore((s) => s.hideProcessGuide);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) hideProcessGuide();
  };

  return (
    <div className="process-guide-overlay" onClick={handleOverlayClick}>
      <div className="process-guide" style={{ position: 'relative' }}>
        <button className="process-guide__close" onClick={hideProcessGuide} aria-label="Close">x</button>
        <div className="process-guide__title">How Guardian Works</div>

        <div className="process-guide__section">
          <div className="process-guide__section-title">What happens after you send a message</div>
          <p>Guardian runs a five-stage pipeline on every conversation exchange:</p>
          <ol style={{ margin: '4px 0 8px 16px', padding: 0, lineHeight: 1.8 }}>
            <li><strong>Awareness detection</strong> -- scans for recurring patterns and cognitive traps</li>
            <li><strong>Auto-summarize + compression</strong> -- distills sessions into layered memory</li>
            <li><strong>Semantic embedding</strong> -- indexes conversation chunks for meaning-based search</li>
            <li><strong>Knowledge graph extraction</strong> -- identifies entities and relationships</li>
            <li><strong>Librarian auto-extraction</strong> -- creates notes and files artifacts automatically</li>
          </ol>
          <p>Results appear as a digest card below the chat.</p>
        </div>

        <div className="process-guide__section">
          <div className="process-guide__section-title">Feature reference</div>

          <div className="process-guide__feature">
            <span className="process-guide__feature-name">Notes</span> -- scratch, structured, and journal entries.
            Auto-generated from the pipeline or created manually. Your persistent workspace.
          </div>
          <div className="process-guide__feature">
            <span className="process-guide__feature-name">Queue</span> -- open threads that need attention.
            Grounding workflow with sensitivity tiers for prioritization.
          </div>
          <div className="process-guide__feature">
            <span className="process-guide__feature-name">Knowledge Graph</span> -- entities and relationships
            extracted from your conversations. Grows automatically as you talk.
          </div>
          <div className="process-guide__feature">
            <span className="process-guide__feature-name">Memory Compression</span> -- L0 raw conversations
            compress into L1 session summaries, L2 patterns, and L3 principles over time.
          </div>
          <div className="process-guide__feature">
            <span className="process-guide__feature-name">Drift Detection</span> -- tracks reframe events
            when the LLM shifts your perspective. Monitors cognitive trajectory.
          </div>
          <div className="process-guide__feature">
            <span className="process-guide__feature-name">Reflections</span> -- imported conversation history.
            Search by Words (full-text), Meaning (semantic), or Inquiry (RAG).
          </div>
          <div className="process-guide__feature">
            <span className="process-guide__feature-name">Search</span> -- full-text search across all
            conversations, notes, and artifacts.
          </div>
          <div className="process-guide__feature">
            <span className="process-guide__feature-name">Sovereign Layer</span> -- surface, deep, and sovereign
            sensitivity tiers. Context gating controls what the LLM can access. Export protection for sensitive data.
          </div>
        </div>

        <div className="process-guide__section">
          <div className="process-guide__section-title">The hero flow</div>
          <div className="process-guide__hero">
            Chat about a topic across multiple sessions. Guardian detects a recurring pattern (awareness trap).
            Ground it in your Queue. Compression extracts a principle. The principle appears in your Knowledge Graph.
            Search Reflections for related past thinking. Guardian connects the dots.
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProcessGuide;
