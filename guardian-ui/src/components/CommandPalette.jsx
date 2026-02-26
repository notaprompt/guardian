import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import useStore from '../store';
import '../styles/command-palette.css';

// ── MRU persistence key ──────────────────────────────────────
const MRU_KEY = 'guardian:commandPalette:mru';
const MRU_MAX = 20;

function loadMru() {
  try {
    const raw = localStorage.getItem(MRU_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMru(mru) {
  try {
    localStorage.setItem(MRU_KEY, JSON.stringify(mru.slice(0, MRU_MAX)));
  } catch { /* ignore quota errors */ }
}

// ── Fuzzy match ──────────────────────────────────────────────
// Returns { match: true, score, indices } or { match: false }.
// Lower score = better match. Consecutive char runs and prefix
// matches score better.
function fuzzyMatch(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return { match: true, score: 0, indices: [] };

  let qi = 0;
  let ti = 0;
  const indices = [];
  let score = 0;
  let lastMatchIdx = -2;

  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      indices.push(ti);
      // Consecutive bonus: sequential matches get lower score
      score += (ti === lastMatchIdx + 1) ? 0 : (ti - (lastMatchIdx + 1)) + 1;
      lastMatchIdx = ti;
      qi++;
    }
    ti++;
  }

  if (qi < q.length) return { match: false };

  // Prefix bonus
  if (indices[0] === 0) score -= 2;

  return { match: true, score, indices };
}

// ── Highlighted name ─────────────────────────────────────────
function HighlightedName({ text, indices }) {
  if (!indices || indices.length === 0) {
    return <span>{text}</span>;
  }
  const indexSet = new Set(indices);
  const parts = [];
  let i = 0;
  while (i < text.length) {
    if (indexSet.has(i)) {
      let j = i;
      while (j < text.length && indexSet.has(j)) j++;
      parts.push(
        <span key={i} className="command-palette__match">{text.slice(i, j)}</span>
      );
      i = j;
    } else {
      let j = i;
      while (j < text.length && !indexSet.has(j)) j++;
      parts.push(<span key={i}>{text.slice(i, j)}</span>);
      i = j;
    }
  }
  return <>{parts}</>;
}

// ── Command definitions ──────────────────────────────────────
const COMMANDS = [
  // Navigation
  { id: 'focus-terminal',  name: 'Focus Terminal',           icon: '>_', category: 'navigation', shortcut: 'Ctrl+1',
    action: (store) => { store.toggleTerminalWindow(); store.setFocusedPanel('terminal'); } },
  { id: 'focus-chat',      name: 'Focus Chat',               icon: '\u25C7', category: 'navigation', shortcut: 'Ctrl+2',
    action: (store) => store.setFocusedPanel('chat') },
  { id: 'sidebar-notes',   name: 'Sidebar: Notes',           icon: '\u2630', category: 'navigation',
    action: (store) => { store.setActiveSidebarPanel('notes'); store.setFocusedPanel('sidebar'); } },
  { id: 'sidebar-queue',   name: 'Sidebar: Queue',           icon: '!', category: 'navigation',
    action: (store) => { store.setActiveSidebarPanel('queue'); store.setFocusedPanel('sidebar'); } },
  { id: 'sidebar-search',  name: 'Sidebar: Search',          icon: '\u2315', category: 'navigation',
    action: (store) => { store.setActiveSidebarPanel('search'); store.setFocusedPanel('sidebar'); } },
  { id: 'sidebar-sessions', name: 'Sidebar: Sessions',       icon: '#', category: 'navigation',
    action: (store) => { store.setActiveSidebarPanel('sessions'); store.setFocusedPanel('sidebar'); } },
  { id: 'sidebar-reflections', name: 'Sidebar: Reflections', icon: '\u27F3', category: 'navigation',
    action: (store) => { store.setActiveSidebarPanel('reflections'); store.setFocusedPanel('sidebar'); } },
  { id: 'sidebar-graph',   name: 'Sidebar: Graph',           icon: '\u25C8', category: 'navigation',
    action: (store) => { store.setActiveSidebarPanel('graph'); store.setFocusedPanel('sidebar'); } },
  { id: 'sidebar-drift',   name: 'Sidebar: Drift',           icon: '\u25C7', category: 'navigation',
    action: (store) => { store.setActiveSidebarPanel('drift'); store.setFocusedPanel('sidebar'); } },
  { id: 'sidebar-memory',  name: 'Sidebar: Memory',          icon: '\u2B50', category: 'navigation',
    action: (store) => { store.setActiveSidebarPanel('memory'); store.setFocusedPanel('sidebar'); } },

  // Sessions
  { id: 'new-session',     name: 'New Chat Session',         icon: '+',  category: 'session',    desc: 'Start new session',
    action: (store) => store.clearChat() },

  // Notes
  { id: 'new-scratch',     name: 'New Scratch Note',         icon: '\u270E', category: 'notes',     shortcut: 'Ctrl+N', desc: 'Quick unstructured capture',
    action: (store) => { store.addNote(); store.setActiveSidebarPanel('notes'); store.setFocusedPanel('sidebar'); } },
  { id: 'new-structured',  name: 'New Structured Note',      icon: '\u2637', category: 'notes',     shortcut: 'Ctrl+Shift+N', desc: 'Titled, organized note',
    action: (store) => { store.addNote(); store.setActiveSidebarPanel('notes'); store.setFocusedPanel('sidebar'); } },
  { id: 'new-journal',     name: 'New Journal Entry',        icon: '\u2609', category: 'notes',     desc: 'Date-stamped reflection',
    action: (store) => { store.addNote(); store.setActiveSidebarPanel('notes'); store.setFocusedPanel('sidebar'); } },

  // Memory
  { id: 'search-memory',   name: 'Search Memory',            icon: '\u2315', category: 'memory',    shortcut: 'Ctrl+K', desc: 'Search conversations, notes, artifacts',
    action: (store) => { store.setActiveSidebarPanel('search'); store.setFocusedPanel('sidebar'); } },

  // Layout
  { id: 'maximize-panel',  name: 'Maximize Focused Panel',   icon: '\u2922', category: 'layout',    shortcut: 'Ctrl+Shift+M', desc: 'Expand current panel, collapse others',
    action: () => { useStore.getState().toggleMaximizedPanel(); } },

  // Settings
  { id: 'open-settings',   name: 'Open Settings',            icon: '\u2699', category: 'settings',  shortcut: 'Ctrl+,', desc: 'Configure Guardian preferences',
    action: (store) => store.openSettings() },

  // Backup & Data
  { id: 'create-backup',    name: 'Create Backup',           icon: '\u2913', category: 'backup',    shortcut: 'Ctrl+Shift+B', desc: 'Back up all Guardian data',
    action: async () => {
      const result = await window.guardian?.backup?.create();
      if (result?.ok) console.log('[guardian] Backup created:', result.name);
    }},
  { id: 'restore-backup',   name: 'Restore from Backup',     icon: '\u21BB', category: 'backup',    desc: 'Restore Guardian data from a backup file',
    action: async () => {
      const result = await window.guardian?.import?.backup();
      if (result?.ok) console.log('[guardian] Backup restored:', result.fileCount, 'files');
    }},
  { id: 'export-session',   name: 'Export Current Session',   icon: '\u21E5', category: 'backup',    desc: 'Export active conversation as Markdown',
    action: async (store) => {
      const sessionId = store.activeSessionId;
      if (!sessionId) return;
      await window.guardian?.export?.session(sessionId, 'markdown');
    }},
  { id: 'export-session-json', name: 'Export Session as JSON', icon: '\u21E5', category: 'backup',  desc: 'Export active conversation with full data fidelity',
    action: async (store) => {
      const sessionId = store.activeSessionId;
      if (!sessionId) return;
      await window.guardian?.export?.session(sessionId, 'json');
    }},
  { id: 'export-all-notes', name: 'Export All Notes',         icon: '\u21E5', category: 'backup',    desc: 'Export all notes as Markdown files',
    action: async () => {
      await window.guardian?.export?.allNotes('markdown');
    }},
  { id: 'export-full-data', name: 'Export Full Data (JSON)',   icon: '\u21E5', category: 'backup',    desc: 'Export all sessions, notes, and usage data',
    action: async () => {
      await window.guardian?.export?.fullData();
    }},
  { id: 'import-notes',     name: 'Import Notes',             icon: '\u21E4', category: 'backup',    desc: 'Import Markdown files as notes',
    action: async (store) => {
      const result = await window.guardian?.import?.markdown();
      if (result?.ok && result.importedCount > 0) store.fetchNotes();
    }},
  { id: 'import-obsidian',  name: 'Import Obsidian Vault',    icon: '\u21E4', category: 'backup',    desc: 'Import notes from an Obsidian vault folder',
    action: async (store) => {
      const result = await window.guardian?.import?.obsidian();
      if (result?.ok && result.importedCount > 0) store.fetchNotes();
    }},
];

const CATEGORY_LABELS = {
  recent: 'Recent',
  navigation: 'Navigation',
  session: 'Session',
  notes: 'Notes',
  memory: 'Memory',
  layout: 'Layout',
  settings: 'Settings',
  backup: 'Backup & Data',
};

const CATEGORY_ORDER = ['recent', 'navigation', 'session', 'notes', 'memory', 'layout', 'settings', 'backup'];

// ── Component ────────────────────────────────────────────────
function CommandPaletteInner() {
  const isOpen = useStore((s) => s.commandPaletteOpen);
  const closeCommandPalette = useStore((s) => s.closeCommandPalette);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [mru, setMru] = useState(loadMru);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Get store actions we need for command execution
  const storeActions = useStore();

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      setMru(loadMru());
      // Focus input on next tick (after render)
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Build filtered + sorted results
  const results = useMemo(() => {
    const q = query.trim();

    if (q.length === 0) {
      // Show MRU commands first, then all others grouped by category
      const mruSet = new Set(mru);
      const mruCommands = mru
        .map((id) => COMMANDS.find((c) => c.id === id))
        .filter(Boolean)
        .map((c) => ({ ...c, _category: 'recent', _score: 0, _indices: [] }));

      const rest = COMMANDS
        .filter((c) => !mruSet.has(c.id))
        .map((c) => ({ ...c, _category: c.category, _score: 0, _indices: [] }));

      return [...mruCommands, ...rest];
    }

    // Fuzzy filter
    const matches = [];
    for (const cmd of COMMANDS) {
      const result = fuzzyMatch(q, cmd.name);
      if (result.match) {
        matches.push({ ...cmd, _category: cmd.category, _score: result.score, _indices: result.indices });
      }
    }

    // Sort by score (lower = better)
    matches.sort((a, b) => a._score - b._score);

    return matches;
  }, [query, mru]);

  // Keep activeIndex in bounds
  useEffect(() => {
    if (activeIndex >= results.length) {
      setActiveIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, activeIndex]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector('.command-palette__item--active');
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  // Execute a command
  const execute = useCallback((cmd) => {
    // Update MRU
    const newMru = [cmd.id, ...mru.filter((id) => id !== cmd.id)].slice(0, MRU_MAX);
    setMru(newMru);
    saveMru(newMru);

    // Close palette
    closeCommandPalette();

    // Run action
    cmd.action(storeActions);
  }, [mru, closeCommandPalette, storeActions]);

  // Focus trap — keep Tab within the palette dialog
  const paletteRef = useRef(null);
  const handleFocusTrap = useCallback((e) => {
    if (e.key !== 'Tab' || !paletteRef.current) return;
    const focusable = paletteRef.current.querySelectorAll(
      'input, button, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    handleFocusTrap(e);

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeCommandPalette();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (results[activeIndex]) {
        execute(results[activeIndex]);
      }
      return;
    }
  }, [results, activeIndex, execute, closeCommandPalette, handleFocusTrap]);

  // Click on overlay background closes palette
  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      closeCommandPalette();
    }
  }, [closeCommandPalette]);

  if (!isOpen) return null;

  // Group results by category for rendering separators
  let lastCategory = null;
  const itemElements = [];
  let flatIndex = 0;

  for (const cmd of results) {
    const cat = cmd._category;
    if (cat !== lastCategory) {
      const label = CATEGORY_LABELS[cat] || cat;
      itemElements.push(
        <div key={`cat-${cat}`} className="command-palette__category">{label}</div>
      );
      lastCategory = cat;
    }

    const idx = flatIndex;
    itemElements.push(
      <div
        key={cmd.id}
        id={`cp-item-${cmd.id}`}
        role="option"
        aria-selected={idx === activeIndex}
        className={`command-palette__item${idx === activeIndex ? ' command-palette__item--active' : ''}`}
        onMouseEnter={() => setActiveIndex(idx)}
        onClick={() => execute(cmd)}
      >
        <span className="command-palette__item-icon">{cmd.icon}</span>
        <div className="command-palette__item-body">
          <div className="command-palette__item-name">
            <HighlightedName text={cmd.name} indices={cmd._indices} />
          </div>
          {cmd.desc && <div className="command-palette__item-desc">{cmd.desc}</div>}
        </div>
        {cmd.shortcut && (
          <span className="command-palette__item-shortcut">{cmd.shortcut}</span>
        )}
      </div>
    );
    flatIndex++;
  }

  return (
    <div className="command-palette-overlay" onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="command-palette" onKeyDown={handleKeyDown} ref={paletteRef}>
        <div className="command-palette__input-wrap">
          <span className="command-palette__icon" aria-hidden="true">&gt;</span>
          <input
            ref={inputRef}
            className="command-palette__input"
            type="text"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-listbox"
            aria-activedescendant={results[activeIndex] ? `cp-item-${results[activeIndex].id}` : undefined}
            aria-label="Search commands"
          />
        </div>

        <div className="command-palette__results" ref={listRef} id="command-palette-listbox" role="listbox" aria-label="Commands">
          {results.length === 0 ? (
            <div className="command-palette__empty">no matching commands</div>
          ) : (
            itemElements
          )}
        </div>

        <div className="command-palette__footer">
          <span className="command-palette__hint">
            <kbd>&#8593;&#8595;</kbd> navigate
          </span>
          <span className="command-palette__hint">
            <kbd>Enter</kbd> execute
          </span>
          <span className="command-palette__hint">
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

export default React.memo(CommandPaletteInner);
