import React from 'react';
import useStore from '../store';

const NAV_ITEMS = [
  { id: 'terminal', tooltip: 'Terminal', special: true, icon: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="14" height="12" rx="1.5" />
      <polyline points="5,8 7.5,10.5 5,13" />
      <line x1="9.5" y1="13" x2="13" y2="13" />
    </svg>
  )},
  { id: 'notes', tooltip: 'Notes', icon: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2" width="12" height="14" rx="1.5" />
      <line x1="6" y1="6" x2="12" y2="6" />
      <line x1="6" y1="9" x2="12" y2="9" />
      <line x1="6" y1="12" x2="9" y2="12" />
    </svg>
  )},
  { id: 'queue', tooltip: 'Queue', badge: 'queueUnresolved', icon: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="6.5" />
      <circle cx="9" cy="9" r="2" fill="currentColor" stroke="none" />
    </svg>
  )},
  { id: 'search', tooltip: 'Search', icon: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="7.5" r="4.5" />
      <line x1="11" y1="11" x2="15" y2="15" />
    </svg>
  )},
  { id: 'sessions', tooltip: 'Sessions', icon: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="6.5" />
      <polyline points="9,5 9,9 12,11" />
    </svg>
  )},
  { id: 'reflections', tooltip: 'Reflections', icon: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9a5 5 0 0 1 8.5-3.5" />
      <polyline points="13,3 13,6 10,6" />
      <path d="M14 9a5 5 0 0 1-8.5 3.5" />
      <polyline points="5,15 5,12 8,12" />
    </svg>
  )},
  { id: 'graph', tooltip: 'Graph', icon: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="5" r="2" />
      <circle cx="13" cy="5" r="2" />
      <circle cx="9" cy="14" r="2" />
      <line x1="6.5" y1="6.5" x2="8" y2="12.5" />
      <line x1="11.5" y1="6.5" x2="10" y2="12.5" />
      <line x1="7" y1="5" x2="11" y2="5" />
    </svg>
  )},
  { id: 'drift', tooltip: 'Drift', badge: 'reframeUnacknowledged', icon: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 4v5l3 2" />
      <path d="M12.5 3.5l1 2" />
      <path d="M5.5 3.5l-1 2" />
    </svg>
  )},
  { id: 'memory', tooltip: 'Memory', icon: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2C6.5 2 4 4.5 4 7c0 1.5.5 2.5 1.5 3.5C4.5 11.5 4 13 4 14" />
      <path d="M9 2c2.5 0 5 2.5 5 5 0 1.5-.5 2.5-1.5 3.5 1 1 1.5 2.5 1.5 4" />
      <path d="M9 2v14" />
      <path d="M6 8c1-1 2-1 3-1s2 0 3 1" />
      <path d="M5.5 11c1.5.5 2.5.5 3.5.5s2 0 3.5-.5" />
    </svg>
  )},
];

const ADVANCED_TABS = new Set(['graph', 'drift', 'memory', 'reflections']);

function ActivityBar() {
  const activeSidebarPanel = useStore((s) => s.activeSidebarPanel);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setActiveSidebarPanel = useStore((s) => s.setActiveSidebarPanel);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const queueUnresolved = useStore((s) => s.queueUnresolved);
  const reframeUnacknowledged = useStore((s) => s.reframeUnacknowledged);
  const toggleTerminalWindow = useStore((s) => s.toggleTerminalWindow);
  const terminalWindowOpen = useStore((s) => s.terminalWindowOpen);
  const terminalWindowMinimized = useStore((s) => s.terminalWindowMinimized);
  const tabsUnlocked = useStore((s) => s.guide.tabsUnlocked);
  const newlyUnlockedTab = useStore((s) => s.newlyUnlockedTab);
  const showProcessGuide = useStore((s) => s.showProcessGuide);

  const badges = { queueUnresolved, reframeUnacknowledged };

  return (
    <nav className="activity-bar" role="tablist" aria-label="Sidebar navigation">
      <div className="activity-bar__top">
        {NAV_ITEMS.map((item) => {
          const isActive = item.special
            ? terminalWindowOpen && !terminalWindowMinimized
            : activeSidebarPanel === item.id && !sidebarCollapsed;
          const badgeCount = item.badge ? badges[item.badge] : 0;
          const isLocked = ADVANCED_TABS.has(item.id) && !tabsUnlocked.includes(item.id);
          const isNewlyUnlocked = newlyUnlockedTab === item.id;
          let cls = 'activity-bar__btn';
          if (isActive) cls += ' activity-bar__btn--active';
          if (isLocked) cls += ' activity-bar__btn--locked';
          if (isNewlyUnlocked) cls += ' activity-bar__btn--newly-unlocked';
          return (
            <button
              key={item.id}
              className={cls}
              onClick={() => item.special ? toggleTerminalWindow() : setActiveSidebarPanel(item.id)}
              data-tooltip={item.tooltip}
              role="tab"
              aria-selected={isActive}
              aria-label={item.tooltip}
              ref={isNewlyUnlocked ? (el) => {
                if (el) setTimeout(() => useStore.setState({ newlyUnlockedTab: null }), 2000);
              } : undefined}
            >
              {item.icon}
              {badgeCount > 0 && (
                <span className="activity-bar__badge">{badgeCount}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="activity-bar__bottom">
        <button
          className="activity-bar__btn"
          onClick={showProcessGuide}
          data-tooltip="How It Works"
          aria-label="How Guardian works"
        >
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="9" r="6.5" />
            <path d="M7 7a2 2 0 1 1 2.5 1.94c-.3.1-.5.36-.5.68V11" />
            <circle cx="9" cy="13.5" r="0.5" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button
          className="activity-bar__btn"
          onClick={toggleSettings}
          data-tooltip="Settings"
          aria-label="Settings"
        >
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="9" r="2.5" />
            <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.1 3.1l1.4 1.4M13.5 13.5l1.4 1.4M3.1 14.9l1.4-1.4M13.5 4.5l1.4-1.4" />
          </svg>
        </button>
      </div>
    </nav>
  );
}

export default React.memo(ActivityBar);
