import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import PanelHeader from '../components/PanelHeader';
import useStore from '../store';

const DimensionLandscape = React.lazy(() => import('../components/DimensionLandscape'));
const DimensionDetail = React.lazy(() => import('../components/DimensionDetail'));

// ── Note type definitions ─────────────────────────────────────
const NOTE_TYPES = [
  { id: 'all',        label: 'All' },
  { id: 'scratch',    label: 'Scratch' },
  { id: 'structured', label: 'Structured' },
  { id: 'journal',    label: 'Journal' },
  { id: 'auto',       label: 'Auto' },
  { id: 'memory',     label: 'Memory' },
];

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dateStr = d.toISOString().slice(0, 10);
  if (dateStr === today) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return dateStr;
}

// ── Debounce helper ───────────────────────────────────────────
function useDebouncedCallback(fn, delay) {
  const timerRef = useRef(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback((...args) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]);
}

// ── Version History Panel ─────────────────────────────────────
function VersionHistory({ noteId }) {
  const noteVersions = useStore((s) => s.noteVersions);
  const fetchNoteVersions = useStore((s) => s.fetchNoteVersions);
  const revertNoteVersion = useStore((s) => s.revertNoteVersion);

  useEffect(() => {
    if (noteId) fetchNoteVersions(noteId);
  }, [noteId, fetchNoteVersions]);

  if (!noteVersions || noteVersions.length === 0) {
    return (
      <div className="notes-versions-empty">
        No version history yet
      </div>
    );
  }

  return (
    <div className="notes-versions">
      {noteVersions.map((v) => (
        <div key={v.id} className="notes-version-item">
          <span className="notes-version-item__time">
            {formatTimestamp(v.created_at)}
          </span>
          <span className="notes-version-item__preview">
            {(v.content || '').slice(0, 60)}
          </span>
          <button
            className="notes-version-item__btn"
            onClick={() => revertNoteVersion(noteId, v.id)}
            title="Revert to this version"
          >
            revert
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Memory Layers (Hierarchical Compression) ────────────────
function MemoryLayers() {
  const compressionL2 = useStore((s) => s.compressionL2);
  const compressionL3 = useStore((s) => s.compressionL3);
  const fetchCompression = useStore((s) => s.fetchCompression);
  const updateCompressionItem = useStore((s) => s.updateCompressionItem);
  const runCompression = useStore((s) => s.runCompression);

  useEffect(() => {
    fetchCompression();
  }, [fetchCompression]);

  return (
    <div className="memory-layers">
      {/* Depth indicator */}
      <div className="memory-layers__depth">
        {compressionL3.length} principle{compressionL3.length !== 1 ? 's' : ''} | {compressionL2.length} pattern{compressionL2.length !== 1 ? 's' : ''}
      </div>

      {/* L3 Principles */}
      <div className="memory-layers__section">
        <div className="memory-layers__section-header">
          <span className="memory-layers__section-title">
            <span className="memory-layers__level-badge memory-layers__level-badge--l3">L3</span>
            {' '}Principles
          </span>
          <button
            className="memory-layers__section-btn"
            onClick={() => runCompression(3)}
            title="Distill principles from patterns"
          >
            distill
          </button>
        </div>
        {compressionL3.length === 0 && (
          <div className="memory-layers__empty">
            No principles yet. Need 3+ patterns to distill.
          </div>
        )}
        {compressionL3.map((item) => (
          <div
            key={item.id}
            className="memory-layers__item"
            style={{ opacity: Math.max(0.3, item.strength || 1) }}
          >
            <div className="memory-layers__item-content">
              {item.content.split('\n')[0]}
            </div>
            <div className="memory-layers__item-meta">
              <span className="memory-layers__item-strength">
                {Math.round((item.strength || 1) * 100)}%
              </span>
              <span>{item.created_at?.slice(0, 10)}</span>
              {item.source_ids && (
                <span>{JSON.parse(item.source_ids || '[]').length} sources</span>
              )}
              {item.status === 'pinned' && <span className="memory-layers__pin-badge">pinned</span>}
            </div>
            <div className="memory-layers__item-actions">
              {item.status !== 'pinned' ? (
                <button
                  className="memory-layers__action-btn"
                  onClick={() => updateCompressionItem(item.id, { status: 'pinned' })}
                  title="Pin — exempt from decay"
                >
                  pin
                </button>
              ) : (
                <button
                  className="memory-layers__action-btn"
                  onClick={() => updateCompressionItem(item.id, { status: 'active' })}
                  title="Unpin"
                >
                  unpin
                </button>
              )}
              <button
                className="memory-layers__action-btn memory-layers__action-btn--danger"
                onClick={() => updateCompressionItem(item.id, { status: 'archived' })}
                title="Dismiss — archive"
              >
                dismiss
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* L2 Patterns */}
      <div className="memory-layers__section">
        <div className="memory-layers__section-header">
          <span className="memory-layers__section-title">
            <span className="memory-layers__level-badge memory-layers__level-badge--l2">L2</span>
            {' '}Patterns
          </span>
          <button
            className="memory-layers__section-btn"
            onClick={() => runCompression(2)}
            title="Extract patterns from summaries"
          >
            extract
          </button>
        </div>
        {compressionL2.length === 0 && (
          <div className="memory-layers__empty">
            No patterns yet. Need 5+ session summaries.
          </div>
        )}
        {compressionL2.map((item) => (
          <div
            key={item.id}
            className="memory-layers__item"
            style={{ opacity: Math.max(0.3, item.strength || 1) }}
          >
            <div className="memory-layers__item-content">
              {item.content.split('\n')[0]}
            </div>
            <div className="memory-layers__item-meta">
              <span className="memory-layers__item-strength">
                {Math.round((item.strength || 1) * 100)}%
              </span>
              <span>{item.created_at?.slice(0, 10)}</span>
              {item.source_ids && (
                <span>{JSON.parse(item.source_ids || '[]').length} sources</span>
              )}
              {item.status === 'pinned' && <span className="memory-layers__pin-badge">pinned</span>}
            </div>
            <div className="memory-layers__item-actions">
              {item.status !== 'pinned' ? (
                <button
                  className="memory-layers__action-btn"
                  onClick={() => updateCompressionItem(item.id, { status: 'pinned' })}
                  title="Pin — exempt from decay"
                >
                  pin
                </button>
              ) : (
                <button
                  className="memory-layers__action-btn"
                  onClick={() => updateCompressionItem(item.id, { status: 'active' })}
                  title="Unpin"
                >
                  unpin
                </button>
              )}
              <button
                className="memory-layers__action-btn memory-layers__action-btn--danger"
                onClick={() => updateCompressionItem(item.id, { status: 'archived' })}
                title="Dismiss — archive"
              >
                dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Memory View (with Landscape tab) ─────────────────────────
function MemoryView() {
  const [memoryTab, setMemoryTab] = useState('layers'); // 'layers' | 'landscape'
  const selectedDimension = useStore((s) => s.selectedDimension);

  return (
    <div className="zone-body" style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Memory sub-tab toggle */}
      <div className="memory-view__toggle">
        <button
          className={`memory-view__toggle-btn${memoryTab === 'layers' ? ' memory-view__toggle-btn--active' : ''}`}
          onClick={() => setMemoryTab('layers')}
        >
          principles & patterns
        </button>
        <button
          className={`memory-view__toggle-btn${memoryTab === 'landscape' ? ' memory-view__toggle-btn--active' : ''}`}
          onClick={() => setMemoryTab('landscape')}
        >
          landscape
        </button>
      </div>

      {memoryTab === 'layers' && <MemoryLayers />}

      {memoryTab === 'landscape' && (
        <React.Suspense
          fallback={
            <div className="empty-state">
              <div className="empty-state__icon" style={{ animation: 'pulse 1.5s infinite' }}>&#9671;</div>
              <div className="empty-state__text">Loading landscape...</div>
            </div>
          }
        >
          <DimensionLandscape />
          {selectedDimension && <DimensionDetail />}
        </React.Suspense>
      )}
    </div>
  );
}

// ── Main Notes Panel ──────────────────────────────────────────
function NotesPanelInner() {
  const notes = useStore((s) => s.notes);
  const activeNoteId = useStore((s) => s.activeNoteId);
  const noteTypeFilter = useStore((s) => s.noteTypeFilter);
  const addNote = useStore((s) => s.addNote);
  const updateNote = useStore((s) => s.updateNote);
  const deleteNote = useStore((s) => s.deleteNote);
  const setActiveNoteId = useStore((s) => s.setActiveNoteId);
  const setNoteTypeFilter = useStore((s) => s.setNoteTypeFilter);
  const resumeSession = useStore((s) => s.resumeSession);

  const [showVersions, setShowVersions] = useState(false);
  const editorRef = useRef(null);

  // Filter notes by type
  const filteredNotes = useMemo(() => {
    if (noteTypeFilter === 'all') return notes;
    if (noteTypeFilter === 'auto') return notes.filter((n) => n.auto_generated);
    return notes.filter((n) => n.type === noteTypeFilter);
  }, [notes, noteTypeFilter]);

  // Get the active note object
  const activeNote = useMemo(() => {
    if (!activeNoteId) return null;
    return notes.find((n) => n.id === activeNoteId) || null;
  }, [notes, activeNoteId]);

  // Debounced backend persist (500ms) — avoids hammering DB on every keystroke
  const debouncedPersist = useDebouncedCallback((id, updates) => {
    window.guardian?.notes.update(id, updates).catch(() => {});
  }, 500);

  // Handle content change — update local state immediately, debounce persistence
  const handleContentChange = useCallback((e) => {
    if (!activeNote) return;
    const content = e.target.value;
    // Immediate local update for responsive UI
    useStore.setState((state) => ({
      notes: state.notes.map((n) =>
        n.id === activeNote.id ? { ...n, content, updatedAt: new Date().toISOString() } : n
      )
    }));
    // Debounced backend save (creates version snapshot)
    debouncedPersist(activeNote.id, { content });
  }, [activeNote, debouncedPersist]);

  // Handle title change — same pattern
  const handleTitleChange = useCallback((e) => {
    if (!activeNote) return;
    const title = e.target.value;
    useStore.setState((state) => ({
      notes: state.notes.map((n) =>
        n.id === activeNote.id ? { ...n, title, updatedAt: new Date().toISOString() } : n
      )
    }));
    debouncedPersist(activeNote.id, { title });
  }, [activeNote, debouncedPersist]);

  // Create new note of the current filter type (or scratch if 'all')
  const handleAddNote = useCallback(() => {
    const type = noteTypeFilter === 'all' ? 'scratch' : noteTypeFilter;
    addNote(type);
    setShowVersions(false);
  }, [addNote, noteTypeFilter]);

  // Delete active note
  const handleDelete = useCallback(() => {
    if (!activeNoteId) return;
    deleteNote(activeNoteId);
    setShowVersions(false);
  }, [activeNoteId, deleteNote]);

  // Type label for display
  const typeLabel = useCallback((type) => {
    if (type === 'scratch') return 'SCR';
    if (type === 'structured') return 'STR';
    if (type === 'journal') return 'JRN';
    return '';
  }, []);

  return (
    <>
      <PanelHeader label="Notes">
        <button
          className="zone-head__btn"
          onClick={handleAddNote}
          title="New note"
          aria-label="Create new note"
        >
          +
        </button>
      </PanelHeader>

      {/* ── Type Tab Bar ─────────────────────────────────── */}
      <div className="notes-type-tabs" role="tablist" aria-label="Note type filter">
        {NOTE_TYPES.map((t) => (
          <button
            key={t.id}
            role="tab"
            className={`notes-type-tab${noteTypeFilter === t.id ? ' notes-type-tab--active' : ''}`}
            onClick={() => setNoteTypeFilter(t.id)}
            aria-selected={noteTypeFilter === t.id}
            aria-label={`Show ${t.label.toLowerCase()} notes`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {noteTypeFilter === 'memory' ? (
        <MemoryView />
      ) : (
        <div className="zone-body notes-layout">
          {/* ── Note List (left sidebar) ────────────────────── */}
          <div className="notes-list" role="listbox" aria-label="Notes list">
            {filteredNotes.length === 0 && (
              <div className="notes-list-empty">
                <span>No {noteTypeFilter === 'all' ? '' : noteTypeFilter + ' '}notes</span>
                <button className="notes-list-empty__btn" onClick={handleAddNote}>
                  Create one
                </button>
              </div>
            )}
            {filteredNotes.map((note) => (
              <div
                key={note.id}
                role="option"
                className={`notes-list-item${activeNoteId === note.id ? ' notes-list-item--active' : ''}`}
                onClick={() => { setActiveNoteId(note.id); setShowVersions(false); }}
                aria-selected={activeNoteId === note.id}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveNoteId(note.id); setShowVersions(false); } }}
              >
                <div className="notes-list-item__top">
                  <span className="notes-list-item__type">{typeLabel(note.type)}</span>
                  {note.auto_generated && (
                    <span className="notes-list-item__auto-badge">auto</span>
                  )}
                  <span className="notes-list-item__title">
                    {note.title || (note.type === 'scratch' ? 'Untitled scratch' : 'Untitled')}
                  </span>
                </div>
                <div className="notes-list-item__meta">
                  <span>{formatTimestamp(note.updatedAt)}</span>
                  {note.content && (
                    <span className="notes-list-item__snippet">
                      {note.content.slice(0, 40)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Note Editor (main area) ─────────────────────── */}
          <div className="notes-editor">
            {!activeNote ? (
              <div className="empty-state">
                <div className="empty-state__icon">&#9782;</div>
                <div className="empty-state__text">Select or create a note</div>
                <button className="notes-add-first" onClick={handleAddNote}>
                  New note
                </button>
              </div>
            ) : (
              <>
                {/* Editor toolbar */}
                <div className="notes-editor__toolbar">
                  <span className="notes-editor__type-badge">
                    {activeNote.type}
                  </span>
                  {activeNote.type !== 'scratch' && (
                    <input
                      className="notes-editor__title"
                      type="text"
                      value={activeNote.title}
                      onChange={handleTitleChange}
                      placeholder={activeNote.type === 'journal' ? 'YYYY-MM-DD' : 'Note title...'}
                      spellCheck={false}
                      aria-label="Note title"
                    />
                  )}
                  {activeNote.type === 'scratch' && (
                    <span className="notes-editor__timestamp">
                      {formatTimestamp(activeNote.createdAt)}
                    </span>
                  )}
                  <div className="notes-editor__actions">
                    {activeNote.source_session_id && (
                      <button
                        className="notes-editor__btn notes-editor__source-btn"
                        onClick={() => resumeSession(activeNote.source_session_id)}
                        title="Open source session"
                      >
                        source session
                      </button>
                    )}
                    <button
                      className={`notes-editor__btn${showVersions ? ' notes-editor__btn--active' : ''}`}
                      onClick={() => setShowVersions(!showVersions)}
                      title="Version history"
                    >
                      history
                    </button>
                    <button
                      className="notes-editor__btn notes-editor__btn--danger"
                      onClick={handleDelete}
                      title="Delete note"
                    >
                      delete
                    </button>
                  </div>
                </div>

                {/* Version history panel */}
                {showVersions && (
                  <VersionHistory noteId={activeNote.id} />
                )}

                {/* Content editor */}
                <textarea
                  ref={editorRef}
                  className="notes-editor__content"
                  value={activeNote.content}
                  onChange={handleContentChange}
                  placeholder={
                    activeNote.type === 'scratch'
                      ? 'Quick capture... no formatting needed'
                      : activeNote.type === 'journal'
                      ? 'What are you observing today?'
                      : 'Write in Markdown...'
                  }
                  spellCheck={false}
                  aria-label="Note content"
                />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default React.memo(NotesPanelInner);
