import React, { useEffect, useMemo, useCallback, useRef, useState, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';

import ChatPanel from './panels/ChatPanel';
import SidebarContainer from './components/SidebarContainer';
import ErrorBoundary from './components/ErrorBoundary';
import ModelPicker from './components/ModelPicker';
import TerminalPanel from './panels/TerminalPanel';
import { TerminalHostContext } from './TerminalHostContext';
import useStore from './store';

// Lazy-load heavy overlay components — only mounted when visible
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const SettingsPanel = lazy(() => import('./components/SettingsPanel'));
const Onboarding = lazy(() => import('./components/Onboarding'));
const TerminalWindow = lazy(() => import('./components/TerminalWindow'));
const ProcessGuide = lazy(() => import('./components/ProcessGuide'));

/*
  Navigation Instruments:
  - Warm orb: token burn rate (metabolic load proxy) → opacity/scale
  - Cool orb: session duration (engagement depth) → hue shift blue→amber
  - Glow orb: system state → pulse on thinking, brighten on responding, dim on error
  - Status bar: live telemetry — burn rate, duration, exchange count, thinking ratio
  - Drift detection: subtle status message when interaction pattern shifts
*/

const PANEL_KEYS = { '2': 'chat' };

// Default proportional sizes (used for reset on double-click)
const DEFAULT_SIZES_UNDOCKED = [67, 33];         // chat 2/3, sidebar 1/3
const DEFAULT_SIZES_DOCKED = [35, 40, 25];       // terminal, chat, sidebar (%)

// Debounce helper
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function formatDuration(minutes) {
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m > 0 ? ` ${m}m` : ''}`;
}

export default function App() {
  const setSystemInfo = useStore((s) => s.setSystemInfo);
  const fetchSessions = useStore((s) => s.fetchSessions);
  const fetchNotes = useStore((s) => s.fetchNotes);
  const fetchQueue = useStore((s) => s.fetchQueue);
  const fetchProfile = useStore((s) => s.fetchProfile);
  const focusedPanel = useStore((s) => s.focusedPanel);
  const setFocusedPanel = useStore((s) => s.setFocusedPanel);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const profile = useStore((s) => s.profile);
  const telemetry = useStore((s) => s.telemetry);
  const setTelemetry = useStore((s) => s.setTelemetry);
  const queueUnresolved = useStore((s) => s.queueUnresolved);
  const maximizedPanel = useStore((s) => s.maximizedPanel);
  const toggleMaximizedPanel = useStore((s) => s.toggleMaximizedPanel);
  const loadLayout = useStore((s) => s.loadLayout);
  const saveLayout = useStore((s) => s.saveLayout);
  const layoutSizes = useStore((s) => s.layoutSizes);
  const toggleCommandPalette = useStore((s) => s.toggleCommandPalette);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const updateStatus = useStore((s) => s.updateStatus);
  const updateVersion = useStore((s) => s.updateVersion);
  const updatePercent = useStore((s) => s.updatePercent);
  const setUpdateStatus = useStore((s) => s.setUpdateStatus);
  const installUpdate = useStore((s) => s.installUpdate);
  const dismissUpdate = useStore((s) => s.dismissUpdate);
  const fetchModelSettings = useStore((s) => s.fetchModelSettings);
  const setLastAutoTier = useStore((s) => s.setLastAutoTier);
  const loadA11yPreferences = useStore((s) => s.loadA11yPreferences);
  const loadGuide = useStore((s) => s.loadGuide);
  const processGuideOpen = useStore((s) => s.processGuideOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const pipelineStatus = useStore((s) => s.pipelineStatus);
  const initPipeline = useStore((s) => s.initPipeline);
  const toggleTerminalWindow = useStore((s) => s.toggleTerminalWindow);
  const terminalDocked = useStore((s) => s.terminalDocked);
  const undockTerminal = useStore((s) => s.undockTerminal);
  const driftRef = useRef(null);
  const lastDriftRef = useRef(null);

  // Ref for Allotment instance to support double-click reset
  const horizontalRef = useRef(null);

  // Persistent DOM div for terminal — survives dock/undock without unmounting
  const [terminalHost] = useState(() => {
    const div = document.createElement('div');
    div.className = 'terminal-host';
    return div;
  });

  // Ref for docked terminal body container
  const dockedBodyRef = useRef(null);

  // Mount terminalHost into docked pane when docked
  useEffect(() => {
    if (!terminalDocked) return;
    const el = dockedBodyRef.current;
    if (el && terminalHost) {
      el.appendChild(terminalHost);
      const timer = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
      return () => {
        clearTimeout(timer);
        if (terminalHost.parentNode === el) el.removeChild(terminalHost);
      };
    }
  }, [terminalDocked, terminalHost]);

  // Bootstrap
  useEffect(() => {
    window.guardian?.system.info().then(setSystemInfo);
    fetchSessions();
    fetchNotes();
    fetchQueue();
    fetchProfile();
    fetchModelSettings();
    loadLayout();
    loadA11yPreferences();
    loadGuide();
    initPipeline();
  }, [setSystemInfo, fetchSessions, fetchNotes, fetchQueue, fetchProfile, fetchModelSettings, loadLayout, loadA11yPreferences, loadGuide, initPipeline]);

  // Subscribe to telemetry pushes from main process
  useEffect(() => {
    const unsub = window.guardian?.telemetry.onState((state) => {
      setTelemetry(state);
      // Track drift for status message
      if (state.drift && state.drift !== lastDriftRef.current) {
        lastDriftRef.current = state.drift;
        driftRef.current = state.drift;
        // Clear drift message after 15 seconds
        setTimeout(() => { driftRef.current = null; }, 15000);
      }
    });
    return () => unsub?.();
  }, [setTelemetry]);

  // Subscribe to ForgeFrame auto-route notifications
  useEffect(() => {
    const unsub = window.guardian?.chat.onModelUsed?.((data) => {
      if (data.auto && data.tier) {
        setLastAutoTier(data.tier);
      }
    });
    return () => unsub?.();
  }, [setLastAutoTier]);

  // Subscribe to auto-update status events
  useEffect(() => {
    const unsub = window.guardian?.update?.onStatus?.((data) => {
      setUpdateStatus(data);
    });
    return () => unsub?.();
  }, [setUpdateStatus]);

  // Debounced layout persistence
  const debouncedSaveLayout = useMemo(
    () => debounce((sizes) => saveLayout(sizes), 400),
    [saveLayout]
  );

  // Allotment change handlers
  const handleHorizontalChange = useCallback((sizes) => {
    if (maximizedPanel) return;
    const current = useStore.getState().layoutSizes || {};
    const docked = useStore.getState().terminalDocked;
    const key = docked ? 'horizontalDocked' : 'horizontalUndocked';
    debouncedSaveLayout({ ...current, [key]: sizes });
  }, [maximizedPanel, debouncedSaveLayout]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    // Ctrl+Shift+P — command palette
    if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      e.preventDefault();
      toggleCommandPalette();
      return;
    }
    // Ctrl+, — settings panel
    if (e.ctrlKey && !e.shiftKey && e.key === ',') {
      e.preventDefault();
      toggleSettings();
      return;
    }
    // Ctrl+1 — toggle terminal window
    if (e.ctrlKey && !e.shiftKey && e.key === '1') {
      e.preventDefault();
      toggleTerminalWindow();
      return;
    }
    // Ctrl+2 — focus chat panel
    if (e.ctrlKey && !e.shiftKey && PANEL_KEYS[e.key]) {
      e.preventDefault();
      setFocusedPanel(PANEL_KEYS[e.key]);
    }
    // Ctrl+3 — toggle sidebar
    if (e.ctrlKey && !e.shiftKey && e.key === '3') {
      e.preventDefault();
      toggleSidebar();
    }
    // Ctrl+Shift+M — maximize/restore focused panel
    if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
      e.preventDefault();
      toggleMaximizedPanel();
    }
    // Ctrl+Shift+B — create backup
    if (e.ctrlKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
      e.preventDefault();
      window.guardian?.backup?.create().then((result) => {
        if (result?.ok) console.log('[guardian] Backup created:', result.name);
      });
    }
    if (e.key === 'Escape') {
      document.activeElement?.blur();
    }
  }, [setFocusedPanel, toggleMaximizedPanel, toggleCommandPalette, toggleSettings, toggleSidebar, toggleTerminalWindow]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Derive orb CSS custom properties from telemetry
  const orbStyle = useMemo(() => ({
    '--orb-warm-opacity': 0.04 + telemetry.intensity * 0.12,
    '--orb-warm-scale': 1 + telemetry.intensity * 0.15,
    '--orb-cool-hue': telemetry.duration * 40,  // 0 = blue (0), 1 = amber (40deg)
    '--orb-cool-opacity': 0.04 + telemetry.duration * 0.06,
    '--orb-glow-opacity':
      telemetry.systemState === 'thinking' ? 0.10
      : telemetry.systemState === 'responding' ? 0.07
      : telemetry.systemState === 'error' ? 0.02
      : 0.04,
    '--orb-glow-pulse':
      telemetry.systemState === 'thinking' ? 'orb-pulse 1.5s ease-in-out infinite'
      : telemetry.systemState === 'responding' ? 'orb-pulse 2.5s ease-in-out infinite'
      : 'none',
  }), [telemetry]);

  // Drift message
  const driftMessage = useMemo(() => {
    if (!telemetry.drift) return null;
    const msgs = {
      consolidating: 'drift detected — messages are consolidating',
      expanding: 'drift detected — exploration is expanding',
      slowing: 'drift detected — pace is decelerating',
      accelerating: 'drift detected — pace is accelerating',
    };
    return msgs[telemetry.drift] || null;
  }, [telemetry.drift]);

  // Show onboarding if no profile
  if (profile === null) {
    // Still loading — show nothing
    return <div className="cockpit" style={{ background: 'var(--void)' }} />;
  }
  if (profile === false || !profile?.onboardingComplete) {
    // Profile not set — hasn't been fetched as null from backend yet
    // Actually profile starts as null in store. We need to differentiate
    // "not loaded yet" from "loaded but empty". fetchProfile sets profile
    // to the result or leaves null.
  }

  // Check if onboarding needed (profile is explicitly loaded but empty/missing)
  const needsOnboarding = !profile || !profile.onboardingComplete;

  if (needsOnboarding) {
    return (
      <div className="cockpit" style={orbStyle}>
        <div className="ambient">
          <div className="orb orb--warm" />
          <div className="orb orb--cool" />
          <div className="orb orb--glow" />
        </div>
        <div className="grid-underlay" />
        <Suspense fallback={null}>
          <Onboarding />
        </Suspense>
      </div>
    );
  }

  // Compute visibility for maximize mode
  const isMax = maximizedPanel !== null;
  const showTerminal = terminalDocked && (!isMax || maximizedPanel === 'terminal');
  const showChat = !isMax || maximizedPanel === 'chat';
  const showSidebar = !isMax || maximizedPanel === 'sidebar';

  // Compute preferred sizes from saved layout or defaults
  const defaultSizes = terminalDocked ? DEFAULT_SIZES_DOCKED : DEFAULT_SIZES_UNDOCKED;
  const layoutKey = terminalDocked ? 'horizontalDocked' : 'horizontalUndocked';
  const hSizes = layoutSizes?.[layoutKey] || undefined;

  return (
    <TerminalHostContext.Provider value={terminalHost}>
    <div className="cockpit cockpit--allotment" style={orbStyle} role="application" aria-label="Guardian workspace">
      {/* ── Skip Navigation ────────────────────────── */}
      <a href="#main-panels" className="skip-nav">Skip to main content</a>

      {/* ── Functional Ambient Orbs ────────────────── */}
      <div className="ambient" aria-hidden="true">
        <div className="orb orb--warm" />
        <div className="orb orb--cool" />
        <div className="orb orb--glow" />
      </div>

      <div className="grid-underlay" aria-hidden="true" />

      <svg className="synapse-layer" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <line x1="33%" y1="40%" x2="50%" y2="35%" />
        <line x1="50%" y1="60%" x2="67%" y2="30%" />
        <line x1="67%" y1="70%" x2="85%" y2="50%" />
      </svg>

      {/* ── Top Bar ────────────────────────────────── */}
      <header className="top-bar" role="banner">
        <div className="top-bar__brand">
          <span className="top-bar__glyph" aria-hidden="true">&#9672;</span>
          <span className="top-bar__name">guardian</span>
        </div>
        <div className="top-bar__sys" aria-label="System status">
          <ModelPicker />
          <span className="top-bar__sys-item" aria-live="polite">
            {activeSessionId ? 'session active' : 'idle'}
          </span>
          {queueUnresolved > 0 && (
            <span className="top-bar__sys-item top-bar__sys-item--queue" aria-live="polite">
              {queueUnresolved} open thread{queueUnresolved !== 1 ? 's' : ''}
            </span>
          )}
          <span className="top-bar__sys-item">
            {profile?.architecture?.toUpperCase() || ''}
          </span>
        </div>
      </header>

      {/* ── Allotment Panel Area ─────────────────────── */}
      <main id="main-panels" className="panel-area" role="main" aria-label="Guardian panels">
        <Allotment
          ref={horizontalRef}
          proportionalLayout
          defaultSizes={hSizes}
          onChange={handleHorizontalChange}
          onReset={() => {
            horizontalRef.current?.resize(defaultSizes);
          }}
        >
          {/* ── Docked Terminal Column (only when docked) ── */}
          {terminalDocked && (
            <Allotment.Pane
              minSize={isMax && !showTerminal ? 0 : 120}
              visible={showTerminal}
            >
              <div
                className={`zone zone--terminal${focusedPanel === 'terminal' ? ' zone--focused' : ''}`}
                onClick={() => setFocusedPanel('terminal')}
                role="region"
                aria-label="Terminal panel"
              >
                <div className="zone-head">
                  <div className="zone-head__left">
                    <span className="zone-head__label zone-head__label--active">Terminal</span>
                  </div>
                  <div className="zone-head__actions">
                    <button className="zone-head__btn" onClick={undockTerminal} title="Pop out to floating window">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 5V2h5M9 12V9h3M2 2l4 4M13 9l-4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="zone-body" ref={dockedBodyRef} />
              </div>
            </Allotment.Pane>
          )}

          {/* ── Chat Column ────────────────────────── */}
          <Allotment.Pane
            minSize={isMax && !showChat ? 0 : 120}
            visible={showChat}
          >
            <div
              className={`zone zone--chat${focusedPanel === 'chat' ? ' zone--focused' : ''}`}
              onClick={() => setFocusedPanel('chat')}
              role="region"
              aria-label="Chat panel"
            >
              <ErrorBoundary name="Chat">
                <ChatPanel />
              </ErrorBoundary>
            </div>
          </Allotment.Pane>

          {/* ── Sidebar Column (ActivityBar + content) ── */}
          <Allotment.Pane
            minSize={isMax && !showSidebar ? 0 : 44}
            visible={showSidebar}
          >
            <div
              className={`zone zone--sidebar${focusedPanel === 'sidebar' ? ' zone--focused' : ''}`}
              onClick={() => setFocusedPanel('sidebar')}
              role="region"
              aria-label="Sidebar panel"
            >
              <ErrorBoundary name="Sidebar">
                <SidebarContainer />
              </ErrorBoundary>
            </div>
          </Allotment.Pane>
        </Allotment>
      </main>

      {/* ── Floating Terminal Window (hidden when docked) ── */}
      {!terminalDocked && (
        <Suspense fallback={null}>
          <TerminalWindow />
        </Suspense>
      )}

      {/* ── Terminal Portal: renders once into persistent host div ── */}
      {createPortal(
        <ErrorBoundary name="Terminal"><TerminalPanel /></ErrorBoundary>,
        terminalHost
      )}

      {/* ── Bottom Bar — Telemetry Strip ────────── */}
      <footer className="bottom-bar" role="contentinfo" aria-label="Session telemetry">
        <div className="bottom-bar__left">
          <div className="bottom-bar__alive" aria-live="polite" aria-atomic="true">
            <span className={`bottom-bar__alive-dot${
              telemetry.systemState === 'thinking' ? ' bottom-bar__alive-dot--thinking' :
              telemetry.systemState === 'responding' ? ' bottom-bar__alive-dot--responding' :
              telemetry.systemState === 'error' ? ' bottom-bar__alive-dot--error' : ''
            }`} aria-hidden="true" />
            <span>{telemetry.systemState}</span>
          </div>
          {pipelineStatus && (
            <span className="bottom-bar__pipeline" aria-live="polite">
              {pipelineStatus.step || 'starting'}
            </span>
          )}
          {telemetry.elapsed > 0 && (
            <span className="bottom-bar__metric" aria-label={`Session duration: ${formatDuration(telemetry.elapsed)}`}>
              {formatDuration(telemetry.elapsed)}
            </span>
          )}
          {telemetry.burnRate > 0 && (
            <span className="bottom-bar__metric" aria-label={`Token burn rate: ${telemetry.burnRate} tokens per minute`}>
              {telemetry.burnRate} tok/min
            </span>
          )}
        </div>
        <div className="bottom-bar__center" aria-live="polite">
          {driftMessage && (
            <span className="bottom-bar__drift">{driftMessage}</span>
          )}
        </div>
        {/* ── Update notification ── */}
          {updateStatus === 'ready' && (
            <span className="bottom-bar__update bottom-bar__update--ready">
              v{updateVersion} ready —{' '}
              <button
                className="bottom-bar__update-btn"
                onClick={installUpdate}
              >
                restart to update
              </button>
              <button
                className="bottom-bar__update-dismiss"
                onClick={dismissUpdate}
              >
                later
              </button>
            </span>
          )}
          {updateStatus === 'available' && (
            <span className="bottom-bar__update">
              v{updateVersion} downloading...
            </span>
          )}
          {updateStatus === 'downloading' && (
            <span className="bottom-bar__update">
              updating {updatePercent}%
            </span>
          )}
        <div className="bottom-bar__right">
          {telemetry.exchangeCount > 0 && (
            <span className="bottom-bar__metric" aria-label={`${telemetry.exchangeCount} exchanges`}>
              {telemetry.exchangeCount} exchanges
            </span>
          )}
          {telemetry.thinkingRatio > 0 && (
            <span className="bottom-bar__metric" aria-label={`${telemetry.thinkingRatio} percent thinking`}>
              {telemetry.thinkingRatio}% thinking
            </span>
          )}
          <span className="bottom-bar__metric">
            {telemetry.tokensBurned > 0
              ? `${telemetry.tokensBurned.toLocaleString()} tokens`
              : 'guardian v0.1'
            }
          </span>
        </div>
      </footer>

      {/* ── Command Palette Overlay (lazy-loaded) ──── */}
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>

      {/* ── Settings Panel Overlay (lazy-loaded) ──── */}
      <Suspense fallback={null}>
        <SettingsPanel />
      </Suspense>

      {/* ── Process Guide Overlay (lazy-loaded) ──── */}
      {processGuideOpen && (
        <Suspense fallback={null}>
          <ProcessGuide />
        </Suspense>
      )}
    </div>
    </TerminalHostContext.Provider>
  );
}
