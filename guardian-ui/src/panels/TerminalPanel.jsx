import React, { useRef, useEffect, useState, useCallback, useMemo, createContext, useContext } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Allotment } from 'allotment';
import '@xterm/xterm/css/xterm.css';
import 'allotment/dist/style.css';
import PanelHeader from '../components/PanelHeader';
import useStore from '../store';

// Max 4 panes per spec
const MAX_PANES = 4;

// Registry context: allows panes to register their xterm instance for snapshot access
const TermRefRegistryContext = createContext(null);

// xterm theme matching Guardian void architecture
const XTERM_THEME = {
  background: '#080808',
  foreground: '#e8dcc8',
  cursor: '#e8dcc8',
  cursorAccent: '#050505',
  selectionBackground: 'rgba(232,220,200, 0.15)',
  selectionForeground: '#e8dcc8',
  black: '#111111',
  red: '#c75050',
  green: '#5bf29b',
  yellow: '#d4a843',
  blue: '#5b9bd5',
  magenta: '#b07ab8',
  cyan: '#5bbfc7',
  white: '#e8dcc8',
  brightBlack: '#505058',
  brightRed: '#e06060',
  brightGreen: '#7ed67d',
  brightYellow: '#e8c05a',
  brightBlue: '#7bb5e8',
  brightMagenta: '#c894d0',
  brightCyan: '#75d9e0',
  brightWhite: '#f2e6d0'
};

let _paneIdCounter = 0;
function generatePaneId() {
  return `term-${Date.now()}-${++_paneIdCounter}`;
}

// ── Single Terminal Pane Component ───────────────────────────
function TerminalPane({ paneId, isActive, onFocus }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const cleanupRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [mode, setMode] = useState('shell');
  const addTerminal = useStore((s) => s.addTerminal);
  const updateTerminal = useStore((s) => s.updateTerminal);
  const termRegistry = useContext(TermRefRegistryContext);

  const spawnSession = useCallback(async (sessionMode) => {
    if (!window.guardian) return;

    const { cols, rows } = fitAddonRef.current?.proposeDimensions() || { cols: 120, rows: 30 };

    let result;
    if (sessionMode === 'claude') {
      result = await window.guardian.claude.launch({ id: paneId, cols, rows });
    } else {
      result = await window.guardian.pty.create({ id: paneId, cols, rows });
    }

    if (result?.ok) {
      setStatus('active');
      setMode(sessionMode);
      addTerminal(paneId, result.pid);
      termRef.current?.focus();
    } else {
      termRef.current?.writeln(`\x1b[31mError: ${result?.error || 'Failed to spawn session'}\x1b[0m`);
    }
  }, [paneId, addTerminal]);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: XTERM_THEME,
      scrollback: 1000,
      convertEol: true,
      rightClickSelectsWord: true,
      fastScrollModifier: 'alt'
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch (e) { /* container not ready */ }
    });

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Register in parent registry for snapshot access
    if (termRegistry) termRegistry.current.set(paneId, term);

    // Handle Ctrl+V paste explicitly
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
        navigator.clipboard.readText().then((text) => {
          if (text) window.guardian?.pty.write({ id: paneId, data: text });
        }).catch(() => {});
        return false;
      }
      // Let split terminal shortcuts bubble up (Ctrl+Shift+D/W/S, Ctrl+Tab)
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) return false;
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && (e.key === 'W' || e.key === 'w')) return false;
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) return false;
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'Tab') return false;
      return true;
    });

    // Forward keystrokes to PTY
    term.onData((data) => {
      window.guardian?.pty.write({ id: paneId, data });
    });

    // Focus handler — notify parent this pane is active
    term.textarea?.addEventListener('focus', () => onFocus?.());

    // Listen for PTY output
    const unsubData = window.guardian?.pty.onData(({ id, data }) => {
      if (id === paneId) term.write(data);
    });

    // Listen for PTY exit
    const unsubExit = window.guardian?.pty.onExit(({ id, exitCode }) => {
      if (id === paneId) {
        setStatus('idle');
        updateTerminal(id, { status: 'exited', exitCode });
        term.writeln(`\r\n\x1b[90m── Process exited (code ${exitCode}) ──\x1b[0m`);
        term.writeln('\x1b[90mPress any key to restart...\x1b[0m');

        const disposable = term.onKey(() => {
          disposable.dispose();
          spawnSession(mode);
        });
      }
    });

    cleanupRef.current = () => {
      unsubData?.();
      unsubExit?.();
      term.dispose();
    };

    spawnSession('shell');

    return () => {
      // Kill PTY when pane unmounts
      window.guardian?.pty.kill({ id: paneId });
      cleanupRef.current?.();
      termRef.current = null;
      if (termRegistry) termRegistry.current.delete(paneId);
    };
  }, [paneId]);

  // Handle container resize
  useEffect(() => {
    if (!fitAddonRef.current) return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddonRef.current.fit();
          const dims = fitAddonRef.current.proposeDimensions();
          if (dims?.cols && dims?.rows) {
            window.guardian?.pty.resize({ id: paneId, cols: dims.cols, rows: dims.rows });
          }
        } catch (e) { /* ignore */ }
      });
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [paneId]);

  // Focus terminal when this pane becomes active
  useEffect(() => {
    if (isActive && termRef.current) {
      termRef.current.focus();
    }
  }, [isActive]);

  return (
    <div
      className={`terminal-pane${isActive ? ' terminal-pane--active' : ''}`}
      onClick={onFocus}
    >
      <div ref={containerRef} className="terminal-container" />
    </div>
  );
}

// ── Split Layout Renderer ────────────────────────────────────
function SplitLayout({ paneIds, splitMode, activeTerminalId, onFocus }) {
  const panes = paneIds.map((id) => (
    <TerminalPane
      key={id}
      paneId={id}
      isActive={id === activeTerminalId}
      onFocus={() => onFocus(id)}
    />
  ));

  if (paneIds.length === 1 || splitMode === 'single') {
    return panes[0] || null;
  }

  if (splitMode === 'horizontal') {
    return (
      <Allotment vertical={false}>
        {panes.map((pane, i) => (
          <Allotment.Pane key={paneIds[i]}>{pane}</Allotment.Pane>
        ))}
      </Allotment>
    );
  }

  if (splitMode === 'vertical') {
    return (
      <Allotment vertical={true}>
        {panes.map((pane, i) => (
          <Allotment.Pane key={paneIds[i]}>{pane}</Allotment.Pane>
        ))}
      </Allotment>
    );
  }

  // Quad: 2x2 grid using nested allotments
  if (splitMode === 'quad') {
    const topPanes = panes.slice(0, 2);
    const bottomPanes = panes.slice(2, 4);
    return (
      <Allotment vertical={true}>
        <Allotment.Pane>
          <Allotment vertical={false}>
            {topPanes.map((pane, i) => (
              <Allotment.Pane key={paneIds[i]}>{pane}</Allotment.Pane>
            ))}
          </Allotment>
        </Allotment.Pane>
        {bottomPanes.length > 0 && (
          <Allotment.Pane>
            <Allotment vertical={false}>
              {bottomPanes.map((pane, i) => (
                <Allotment.Pane key={paneIds[i + 2]}>{pane}</Allotment.Pane>
              ))}
            </Allotment>
          </Allotment.Pane>
        )}
      </Allotment>
    );
  }

  return panes[0] || null;
}

// ── Helper: extract visible text from xterm buffer ───────────
function getTerminalBufferText(term) {
  if (!term || !term.buffer) return '';
  const buf = term.buffer.active;
  const lines = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  // Trim trailing empty lines
  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  return lines.join('\n');
}

// ── History Search Results Dropdown ──────────────────────────
function HistorySearchResults({ results, onClose }) {
  if (!results || results.length === 0) return null;

  return (
    <div className="terminal-history-results">
      {results.map((r) => (
        <div key={r.id} className="terminal-history-result">
          <span className="terminal-history-result__input">{r.input || '(no input)'}</span>
          <span className="terminal-history-result__time">
            {new Date(r.timestamp).toLocaleString()}
          </span>
          {r.output && (
            <pre className="terminal-history-result__output">
              {r.output.slice(0, 200)}
              {r.output.length > 200 ? '...' : ''}
            </pre>
          )}
        </div>
      ))}
      <button className="terminal-history-results__close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

// ── Main Terminal Panel ──────────────────────────────────────
function TerminalPanelInner() {
  const activeTerminalId = useStore((s) => s.activeTerminalId);
  const splitMode = useStore((s) => s.splitMode);
  const terminalPaneOrder = useStore((s) => s.terminalPaneOrder);
  const setActiveTerminalId = useStore((s) => s.setActiveTerminalId);
  const setSplitMode = useStore((s) => s.setSplitMode);
  const setTerminalPaneOrder = useStore((s) => s.setTerminalPaneOrder);
  const removeTerminal = useStore((s) => s.removeTerminal);

  // Registry of xterm instances for snapshot access
  const termRegistryRef = useRef(new Map());

  // History search state
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyResults, setHistoryResults] = useState(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const searchTimerRef = useRef(null);

  // Snapshot notification
  const [snapshotMsg, setSnapshotMsg] = useState(null);

  // Initialize first pane on mount
  useEffect(() => {
    if (terminalPaneOrder.length === 0) {
      const firstId = generatePaneId();
      setTerminalPaneOrder([firstId]);
      setActiveTerminalId(firstId);
    }
  }, []);

  const paneCount = terminalPaneOrder.length;

  // Determine next split mode when adding a pane
  const getNextSplitMode = useCallback((currentCount) => {
    if (currentCount <= 1) return 'single';
    if (currentCount === 2) return splitMode === 'vertical' ? 'vertical' : 'horizontal';
    if (currentCount === 3) return splitMode === 'vertical' ? 'vertical' : 'horizontal';
    return 'quad';
  }, [splitMode]);

  // Split: add a new pane
  const handleSplit = useCallback(() => {
    if (paneCount >= MAX_PANES) return;

    const newId = generatePaneId();
    const newOrder = [...terminalPaneOrder, newId];
    setTerminalPaneOrder(newOrder);
    setActiveTerminalId(newId);

    const nextCount = newOrder.length;
    if (nextCount === 2 && splitMode === 'single') {
      setSplitMode('horizontal');
    } else if (nextCount === 4) {
      setSplitMode('quad');
    }
  }, [paneCount, terminalPaneOrder, splitMode, setTerminalPaneOrder, setActiveTerminalId, setSplitMode]);

  // Close: remove the active pane
  const handleClose = useCallback(() => {
    if (paneCount <= 1) return;

    const idToRemove = activeTerminalId;
    if (!idToRemove) return;

    removeTerminal(idToRemove);

    // removeTerminal updates paneOrder and activeTerminalId via store
    // But we also need to adjust splitMode
    const remainingCount = paneCount - 1;
    if (remainingCount <= 1) {
      setSplitMode('single');
    } else if (remainingCount <= 3 && splitMode === 'quad') {
      setSplitMode('horizontal');
    }
  }, [paneCount, activeTerminalId, removeTerminal, splitMode, setSplitMode]);

  // Cycle between panes (Ctrl+Tab)
  const handleCycle = useCallback(() => {
    if (paneCount <= 1) return;
    const currentIdx = terminalPaneOrder.indexOf(activeTerminalId);
    const nextIdx = (currentIdx + 1) % terminalPaneOrder.length;
    setActiveTerminalId(terminalPaneOrder[nextIdx]);
  }, [paneCount, terminalPaneOrder, activeTerminalId, setActiveTerminalId]);

  // Toggle split direction for 2-3 panes
  const handleToggleSplitDirection = useCallback(() => {
    if (paneCount === 1 || splitMode === 'quad') return;
    setSplitMode(splitMode === 'horizontal' ? 'vertical' : 'horizontal');
  }, [paneCount, splitMode, setSplitMode]);

  // Snapshot: capture active terminal viewport
  const handleSnapshot = useCallback(async () => {
    if (!activeTerminalId) return;
    const term = termRegistryRef.current.get(activeTerminalId);
    if (!term) return;

    const content = getTerminalBufferText(term);
    if (!content.trim()) {
      setSnapshotMsg('Nothing to capture');
      setTimeout(() => setSnapshotMsg(null), 2000);
      return;
    }

    const result = await window.guardian?.pty.snapshot({
      id: activeTerminalId,
      content,
    });

    if (result?.ok) {
      setSnapshotMsg('Snapshot saved');
    } else {
      setSnapshotMsg('Snapshot failed');
    }
    setTimeout(() => setSnapshotMsg(null), 2000);
  }, [activeTerminalId]);

  // History search with debounce
  const handleHistorySearch = useCallback((query) => {
    setHistoryQuery(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!query.trim()) {
      setHistoryResults(null);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      const result = await window.guardian?.terminalHistory.search(query, 20);
      if (result?.ok) {
        setHistoryResults(result.results);
      }
    }, 300);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      // Ctrl+Shift+D — split
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        handleSplit();
        return;
      }
      // Ctrl+Shift+W — close pane
      if (e.ctrlKey && e.shiftKey && (e.key === 'W' || e.key === 'w')) {
        e.preventDefault();
        handleClose();
        return;
      }
      // Ctrl+Shift+S — snapshot active terminal
      if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        handleSnapshot();
        return;
      }
      // Ctrl+Tab — cycle panes
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        handleCycle();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSplit, handleClose, handleCycle, handleSnapshot]);

  const handlePaneFocus = useCallback((id) => {
    setActiveTerminalId(id);
  }, [setActiveTerminalId]);

  // Determine overall status for header
  const anyActive = paneCount > 0;
  const headerStatus = anyActive ? 'active' : 'idle';

  return (
    <TermRefRegistryContext.Provider value={termRegistryRef}>
      <PanelHeader
        label="Terminal"
        active={anyActive}
        status={headerStatus}
      >
        {/* History search bar */}
        <div className="terminal-history-search">
          <input
            type="text"
            className="terminal-history-search__input"
            placeholder="Search history..."
            value={historyQuery}
            onChange={(e) => handleHistorySearch(e.target.value)}
            onFocus={() => setSearchVisible(true)}
            onBlur={() => setTimeout(() => setSearchVisible(false), 200)}
            aria-label="Search terminal history"
          />
        </div>

        {/* Tab bar showing pane sessions */}
        <div className="terminal-tabs" role="tablist" aria-label="Terminal panes">
          {terminalPaneOrder.map((id, idx) => (
            <button
              key={id}
              role="tab"
              className={`terminal-tab${id === activeTerminalId ? ' terminal-tab--active' : ''}`}
              onClick={() => setActiveTerminalId(id)}
              title={`Terminal ${idx + 1}`}
              aria-label={`Terminal ${idx + 1}`}
              aria-selected={id === activeTerminalId}
            >
              {idx + 1}
            </button>
          ))}
        </div>

        {/* Snapshot button */}
        <button
          className="zone-head__btn"
          onClick={handleSnapshot}
          title="Snapshot terminal (Ctrl+Shift+S)"
          aria-label="Snapshot terminal"
        >
          S
        </button>

        {/* Split button */}
        <button
          className="zone-head__btn"
          onClick={handleSplit}
          disabled={paneCount >= MAX_PANES}
          title={`Split terminal (Ctrl+Shift+D)${paneCount >= MAX_PANES ? ' — max reached' : ''}`}
          aria-label="Split terminal"
        >
          +
        </button>

        {/* Toggle split direction */}
        {paneCount >= 2 && paneCount < 4 && (
          <button
            className="zone-head__btn"
            onClick={handleToggleSplitDirection}
            title={`Toggle ${splitMode === 'horizontal' ? 'vertical' : 'horizontal'} split`}
          >
            {splitMode === 'horizontal' ? '⬓' : '⬒'}
          </button>
        )}

        {/* Close pane button */}
        {paneCount > 1 && (
          <button
            className="zone-head__btn"
            onClick={handleClose}
            title="Close active pane (Ctrl+Shift+W)"
          >
            ✕
          </button>
        )}

        {/* Snapshot notification */}
        {snapshotMsg && (
          <span className="terminal-snapshot-msg" role="status" aria-live="polite">{snapshotMsg}</span>
        )}
      </PanelHeader>

      {/* History search results dropdown */}
      {searchVisible && historyResults && historyResults.length > 0 && (
        <HistorySearchResults
          results={historyResults}
          onClose={() => { setSearchVisible(false); setHistoryResults(null); setHistoryQuery(''); }}
        />
      )}

      {/* Terminal panes */}
      <div className="zone-body terminal-zone-body">
        {terminalPaneOrder.length > 0 && (
          <SplitLayout
            paneIds={terminalPaneOrder}
            splitMode={splitMode}
            activeTerminalId={activeTerminalId}
            onFocus={handlePaneFocus}
          />
        )}
      </div>
    </TermRefRegistryContext.Provider>
  );
}

export default React.memo(TerminalPanelInner);
