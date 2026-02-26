import { create } from 'zustand';

// ── Global App State ────────────────────────────────────────
// Each panel manages its own local state; this store handles
// cross-cutting concerns and shared data.

let _msgIdCounter = 0;

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const useStore = create((set, get) => ({

  // ── Terminal Sessions ───────────────────────────────────
  terminals: {},   // { [id]: { pid, status: 'active'|'exited', exitCode } }
  activeTerminalId: null,
  splitMode: 'single',       // single | horizontal | vertical | quad
  terminalPaneOrder: [],     // ordered list of terminal pane IDs for layout

  addTerminal: (id, pid) => set((state) => ({
    terminals: {
      ...state.terminals,
      [id]: { pid, status: 'active', exitCode: null }
    }
  })),

  updateTerminal: (id, updates) => set((state) => ({
    terminals: {
      ...state.terminals,
      [id]: { ...state.terminals[id], ...updates }
    }
  })),

  removeTerminal: (id) => set((state) => {
    const { [id]: _, ...rest } = state.terminals;
    const newOrder = state.terminalPaneOrder.filter((tid) => tid !== id);
    const newActive = state.activeTerminalId === id
      ? (newOrder[0] || null)
      : state.activeTerminalId;
    return {
      terminals: rest,
      terminalPaneOrder: newOrder,
      activeTerminalId: newActive,
    };
  }),

  setActiveTerminalId: (id) => set({ activeTerminalId: id }),

  setSplitMode: (mode) => set({ splitMode: mode }),

  setTerminalPaneOrder: (order) => set({ terminalPaneOrder: order }),

  // ── Session Management ─────────────────────────────────────
  activeSessionId: null,
  sessions: [],            // [{ id, title, started_at, ended_at, tokens_in, tokens_out }]

  setActiveSessionId: (id) => set({ activeSessionId: id }),

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) => set((state) => ({
    sessions: [session, ...state.sessions]
  })),

  updateSession: (id, updates) => set((state) => ({
    sessions: state.sessions.map((s) =>
      s.id === id ? { ...s, ...updates } : s
    )
  })),

  removeSession: (id) => set((state) => ({
    sessions: state.sessions.filter((s) => s.id !== id),
    activeSessionId: state.activeSessionId === id ? null : state.activeSessionId
  })),

  // Load session list from backend
  fetchSessions: async () => {
    try {
      const result = await window.guardian.sessions.list();
      if (result.ok) set({ sessions: result.sessions });
    } catch (e) {
      console.error('[store] fetchSessions failed:', e);
    }
  },

  // Trigger re-summarization for a session
  summarizeSession: async (id) => {
    try {
      const result = await window.guardian.sessions.summarize(id);
      return result;
    } catch (e) {
      console.error('[store] summarizeSession failed:', e);
      return { ok: false, error: e.message };
    }
  },

  // Resume a session — loads messages into chat
  resumeSession: async (id) => {
    try {
      const result = await window.guardian.sessions.resume(id);
      if (result.ok) {
        set({ activeSessionId: id });
        // Hydrate chat messages from DB
        const msgs = (result.messages || []).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }));
        set({ chatMessages: msgs });
        // Hydrate thinking blocks
        const thinking = {};
        for (const m of result.messages || []) {
          if (m.thinking) {
            thinking[m.id] = { text: m.thinking, isComplete: true };
          }
        }
        set({ thinkingBlocks: thinking });
        return result;
      }
    } catch (e) {
      console.error('[store] resumeSession failed:', e);
    }
    return null;
  },

  // ── Chat Session ──────────────────────────────────────────
  chatMessages: [],
  chatSessionActive: false,
  chatIsResponding: false,
  thinkingBlocks: {},   // { [msgId]: { text, isComplete } }

  setChatSessionActive: (active) => set({ chatSessionActive: active }),
  setChatIsResponding: (responding) => set({ chatIsResponding: responding }),

  addChatMessage: (role, content) => {
    const id = Date.now() * 100 + (++_msgIdCounter % 100);
    set((state) => ({
      chatMessages: [
        ...state.chatMessages,
        { id, role, content, timestamp: new Date().toISOString() }
      ]
    }));
    return id;
  },

  updateLastAssistantMessage: (content) => set((state) => {
    const msgs = [...state.chatMessages];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i] = { ...msgs[i], content };
        break;
      }
    }
    return { chatMessages: msgs };
  }),

  setThinkingForMessage: (msgId, text, isComplete) => set((state) => ({
    thinkingBlocks: {
      ...state.thinkingBlocks,
      [msgId]: { text, isComplete }
    }
  })),

  clearChat: () => set({
    chatMessages: [],
    thinkingBlocks: {},
    activeSessionId: null,
    awareness: null,
  }),

  // ── Usage Tracking ─────────────────────────────────────────
  usageRecords: [],
  setUsageRecords: (records) => set({ usageRecords: records }),
  addUsageRecord: (record) => set((state) => ({
    usageRecords: [...state.usageRecords, record]
  })),

  // ── Notes (three types: scratch/structured/journal, persisted to SQLite) ──
  // Each note: { id, type, title, content, color, tags, createdAt, updatedAt }
  notes: [],
  activeNoteId: null,
  noteTypeFilter: 'all',  // 'all' | 'scratch' | 'structured' | 'journal'
  noteVersions: [],        // versions for the currently viewed note

  setNotes: (notes) => set({ notes }),
  setActiveNoteId: (id) => set({ activeNoteId: id, noteVersions: [] }),
  setNoteTypeFilter: (filter) => set({ noteTypeFilter: filter }),

  addNote: (type = 'scratch') => {
    const now = new Date().toISOString();
    const isJournal = type === 'journal';
    const title = isJournal
      ? new Date().toISOString().slice(0, 10) // YYYY-MM-DD
      : '';
    const note = {
      id: generateId('note'),
      type,
      title,
      content: '',
      color: 'default',
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({
      notes: [note, ...state.notes],
      activeNoteId: note.id,
    }));
    // Persist to backend
    window.guardian?.notes.create(note).catch(e => console.error('[store]', e.message || e));
    return note.id;
  },

  updateNote: (id, updates) => {
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
      )
    }));
    // Persist to backend
    window.guardian?.notes.update(id, updates).catch(e => console.error('[store]', e.message || e));
  },

  deleteNote: (id) => {
    set((state) => ({
      notes: state.notes.filter((n) => n.id !== id),
      activeNoteId: state.activeNoteId === id ? null : state.activeNoteId,
    }));
    // Persist to backend
    window.guardian?.notes.delete(id).catch(e => console.error('[store]', e.message || e));
  },

  // Fetch version history for a note
  fetchNoteVersions: async (id) => {
    try {
      const result = await window.guardian?.notes.history(id);
      if (result?.ok) {
        set({ noteVersions: result.versions });
      }
    } catch (e) {
      console.error('[store] fetchNoteVersions failed:', e);
    }
  },

  // Revert to a specific version
  revertNoteVersion: async (noteId, versionId) => {
    try {
      const result = await window.guardian?.notes.revert(noteId, versionId);
      if (result?.ok) {
        const note = result.note;
        set((state) => ({
          notes: state.notes.map((n) =>
            n.id === noteId ? { ...n, content: note.content, updatedAt: note.updated_at } : n
          )
        }));
        // Refresh version list
        get().fetchNoteVersions(noteId);
      }
    } catch (e) {
      console.error('[store] revertNoteVersion failed:', e);
    }
  },

  // Load notes from backend
  fetchNotes: async () => {
    try {
      const result = await window.guardian.notes.load();
      if (result.ok) {
        // Map snake_case DB fields to camelCase
        const mapped = result.notes.map((n) => ({
          id: n.id,
          type: n.type || 'scratch',
          title: n.title,
          content: n.content,
          color: n.color,
          tags: typeof n.tags === 'string' ? JSON.parse(n.tags) : (n.tags || []),
          createdAt: n.created_at,
          updatedAt: n.updated_at,
        }));
        set({ notes: mapped });
      }
    } catch (e) {
      console.error('[store] fetchNotes failed:', e);
    }
  },

  // ── Compression Memory (Hierarchical Layers) ─────────────────
  compressionL2: [],     // L2 pattern items
  compressionL3: [],     // L3 principle items
  compressionStats: { l2Count: 0, l3Count: 0 },

  fetchCompression: async () => {
    try {
      const [l2, l3, stats] = await Promise.all([
        window.guardian.compression.list(2),
        window.guardian.compression.list(3),
        window.guardian.compression.stats(),
      ]);
      set({
        compressionL2: l2?.ok ? l2.items : [],
        compressionL3: l3?.ok ? l3.items : [],
        compressionStats: stats?.ok ? { l2Count: stats.l2 || 0, l3Count: stats.l3 || 0 } : { l2Count: 0, l3Count: 0 },
      });
    } catch (e) {
      console.error('[store] fetchCompression failed:', e);
    }
  },

  updateCompressionItem: async (id, updates) => {
    try {
      await window.guardian.compression.update(id, updates);
      get().fetchCompression();
    } catch (e) {
      console.error('[store] updateCompressionItem failed:', e);
    }
  },

  runCompression: async (level) => {
    try {
      await window.guardian.compression.run(level);
    } catch (e) {
      console.error('[store] runCompression failed:', e);
    }
  },

  initCompression: () => {
    const cleanup = window.guardian?.compression?.onComplete?.((payload) => {
      get().fetchCompression();
    });
    return cleanup;
  },

  // ── Search / Artifacts ──────────────────────────────────
  searchQuery: '',
  searchResults: [],
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchResults: (results) => set({ searchResults: results }),

  // Search mode: 'keyword' (FTS) or 'semantic' (embedding summaries)
  searchMode: 'keyword',
  setSearchMode: (mode) => set({ searchMode: mode }),
  semanticSearchResults: [],

  // Full-text search via backend
  performSearch: async (query, scope) => {
    set({ searchQuery: query });
    if (!query.trim()) {
      set({ searchResults: [], semanticSearchResults: [] });
      return;
    }
    const { searchMode } = get();
    try {
      if (searchMode === 'semantic') {
        const result = await window.guardian.semanticSearch(query);
        if (result.ok) set({ semanticSearchResults: result.results, searchResults: [] });
      } else {
        const result = await window.guardian.search(query, scope);
        if (result.ok) set({ searchResults: result.results, semanticSearchResults: [] });
      }
    } catch (e) {
      console.error('[store] search failed:', e);
    }
  },

  // ── Navigation Instruments ─────────────────────────

  // Telemetry (pushed from main process every 5s)
  telemetry: {
    elapsed: 0,
    tokensBurned: 0,
    burnRate: 0,
    exchangeCount: 0,
    thinkingRatio: 0,
    intensity: 0,       // 0-1, drives warm orb
    duration: 0,        // 0-1, drives cool orb
    systemState: 'idle', // idle | thinking | responding | error
    drift: null,        // null | 'consolidating' | 'expanding' | 'slowing' | 'accelerating'
  },
  setTelemetry: (t) => set({ telemetry: { ...get().telemetry, ...t } }),

  // Ambient state (derived from telemetry for orb rendering)
  ambientState: {
    warmIntensity: 0,    // 0-1 → warm orb opacity/scale
    coolShift: 0,        // 0-1 → cool orb hue shift blue→amber
    glowState: 'nominal', // nominal | thinking | responding | error
  },
  setAmbientState: (s) => set({ ambientState: { ...get().ambientState, ...s } }),

  // Integration Queue
  queueItems: [],
  queueUnresolved: 0,

  // Grounding layer
  groundingPrompt: null,   // queue item ID showing grounding prompt, null = none
  groundingStats: { groundingRate: 0, avgLatencyDays: 0 },

  showGroundingFor: (id) => set({ groundingPrompt: id }),
  hideGrounding: () => set({ groundingPrompt: null }),

  resolveWithGrounding: async (id, type, description) => {
    try {
      await window.guardian.queue.update(id, {
        status: 'resolved',
        groundingType: type,
        groundingDescription: description || '',
      });
      set({ groundingPrompt: null });
      get().fetchQueue();
      get().fetchGroundingStats();
    } catch (e) {
      console.error('[store] resolveWithGrounding failed:', e);
    }
  },

  skipGrounding: async (id) => {
    try {
      await window.guardian.queue.update(id, { status: 'resolved' });
      set({ groundingPrompt: null });
      get().fetchQueue();
      get().fetchGroundingStats();
    } catch (e) {
      console.error('[store] skipGrounding failed:', e);
    }
  },

  fetchGroundingStats: async () => {
    try {
      const result = await window.guardian.queue.stats();
      if (result?.ok) {
        set({ groundingStats: { groundingRate: result.groundingRate, avgLatencyDays: result.avgLatencyDays } });
      }
    } catch (e) {
      console.error('[store] fetchGroundingStats failed:', e);
    }
  },

  setQueueItems: (items) => set({
    queueItems: items,
    queueUnresolved: items.filter((i) => i.status === 'open').length,
  }),

  fetchQueue: async () => {
    try {
      const result = await window.guardian.queue.list();
      if (result.ok) {
        const items = result.items;
        set({
          queueItems: items,
          queueUnresolved: items.filter((i) => i.status === 'open').length,
        });
      }
    } catch (e) {
      console.error('[store] fetchQueue failed:', e);
    }
  },

  addQueueItem: async (text) => {
    try {
      const result = await window.guardian.queue.add({ text });
      if (result.ok) {
        get().fetchQueue();
      }
      return result;
    } catch (e) {
      console.error('[store] addQueueItem failed:', e);
    }
  },

  updateQueueItem: async (id, updates) => {
    try {
      await window.guardian.queue.update(id, updates);
      get().fetchQueue();
    } catch (e) {
      console.error('[store] updateQueueItem failed:', e);
    }
  },

  deleteQueueItem: async (id) => {
    try {
      await window.guardian.queue.delete(id);
      get().fetchQueue();
    } catch (e) {
      console.error('[store] deleteQueueItem failed:', e);
    }
  },

  // User Profile
  // null = not loaded yet, {} = loaded but empty (needs onboarding)
  profile: null,

  setProfile: (profile) => set({ profile }),

  fetchProfile: async () => {
    try {
      const result = await window.guardian.profile.get();
      if (result.ok) {
        // Profile exists on disk → use it; null from disk → empty object (needs onboarding)
        set({ profile: result.profile || {} });
      } else {
        set({ profile: {} }); // No profile file → needs onboarding
      }
    } catch (e) {
      console.error('[store] fetchProfile failed:', e);
      set({ profile: {} }); // Error → treat as needs onboarding
    }
  },

  saveProfile: async (profile) => {
    set({ profile });
    try {
      await window.guardian.profile.set(profile);
    } catch (e) {
      console.error('[store] saveProfile failed:', e);
    }
  },

  // ── Command Palette ────────────────────────────────────
  commandPaletteOpen: false,
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),

  // ── Settings Panel ──────────────────────────────────────
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),

  // ── Focused Panel ──────────────────────────────────────
  focusedPanel: 'chat',   // 'terminal' | 'chat' | 'sidebar'
  setFocusedPanel: (panel) => set({ focusedPanel: panel }),

  // ── Layout (Allotment panel sizes) ───────────────────
  maximizedPanel: null,   // null | 'terminal' | 'chat' | 'sidebar'
  setMaximizedPanel: (panel) => set({ maximizedPanel: panel }),

  toggleMaximizedPanel: () => {
    const { focusedPanel, maximizedPanel } = get();
    set({ maximizedPanel: maximizedPanel ? null : focusedPanel });
  },

  // Persisted allotment sizes: { horizontal: [leftPx, rightPx], left: [topPx, bottomPx], right: [topPx, bottomPx] }
  layoutSizes: null,
  setLayoutSizes: (sizes) => set({ layoutSizes: sizes }),

  loadLayout: async () => {
    try {
      const result = await window.guardian?.config.layout.get();
      if (result?.ok && result.layout?.allotment) {
        set({ layoutSizes: result.layout.allotment });
      }
    } catch (e) {
      console.error('[store] loadLayout failed:', e);
    }
  },

  saveLayout: (sizes) => {
    set({ layoutSizes: sizes });
    try {
      window.guardian?.config.layout.get().then((result) => {
        const existing = result?.ok ? result.layout : {};
        window.guardian?.config.layout.set({ ...existing, allotment: sizes });
      });
    } catch (e) {
      console.error('[store] saveLayout failed:', e);
    }
  },

  // ── ForgeFrame Model Routing ────────────────────────────
  models: [
    { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet', description: 'Balanced — code, writing, analysis', tier: 'balanced' },
    { id: 'claude-opus-4-6', label: 'Opus', description: 'Deep analysis — complex reasoning', tier: 'deep' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku', description: 'Quick questions — fast responses', tier: 'quick' },
  ],
  selectedModel: 'claude-sonnet-4-5-20250929',
  autoRoute: true,
  lastAutoTier: null,  // last auto-routed tier for display

  setSelectedModel: (modelId) => {
    set({ selectedModel: modelId });
    window.guardian?.model?.set(modelId).catch(e => console.error('[store]', e.message || e));
  },

  setAutoRoute: (enabled) => {
    set({ autoRoute: enabled });
    window.guardian?.model?.setAutoRoute(enabled).catch(e => console.error('[store]', e.message || e));
  },

  setLastAutoTier: (tier) => set({ lastAutoTier: tier }),

  fetchModelSettings: async () => {
    try {
      const result = await window.guardian?.model?.get();
      if (result?.ok) {
        set({
          selectedModel: result.modelId || 'claude-sonnet-4-5-20250929',
          autoRoute: result.autoRoute !== false,
          ...(result.models?.length > 0 ? { models: result.models } : {}),
        });
      }
    } catch (e) {
      console.error('[store] fetchModelSettings failed:', e);
    }
  },

  // ── Providers (multi-model backend routing) ────────────────
  providers: [],           // [{ id, name, type, enabled, base_url }]
  providerModels: {},      // { [providerId]: [{ id, model_id, label, tier }] }

  fetchProviders: async () => {
    const list = await window.guardian?.providers?.list();
    set({ providers: list || [] });
  },
  addProvider: async (provider) => {
    await window.guardian?.providers?.add(provider);
    get().fetchProviders();
  },
  removeProvider: async (id) => {
    await window.guardian?.providers?.remove(id);
    get().fetchProviders();
  },
  testProvider: async (id) => {
    return await window.guardian?.providers?.test(id);
  },
  fetchProviderModels: async (id) => {
    const models = await window.guardian?.providers?.models(id);
    set((s) => ({ providerModels: { ...s.providerModels, [id]: models || [] } }));
  },

  // ── API Keys ──────────────────────────────────────────────
  apiKeyStatus: {},        // { [providerType]: 'set'|'unset'|'testing'|'valid'|'invalid' }

  setApiKey: async (provider, key) => {
    await window.guardian?.keys?.set(provider, key);
    get().fetchApiKeyStatus();
  },
  deleteApiKey: async (provider) => {
    await window.guardian?.keys?.delete(provider);
    get().fetchApiKeyStatus();
  },
  fetchApiKeyStatus: async () => {
    const list = await window.guardian?.keys?.list();
    const status = {};
    (list || []).forEach(p => { status[p] = 'set'; });
    set({ apiKeyStatus: status });
  },
  testApiKey: async (provider) => {
    set((s) => ({ apiKeyStatus: { ...s.apiKeyStatus, [provider]: 'testing' } }));
    const result = await window.guardian?.keys?.test(provider);
    set((s) => ({ apiKeyStatus: { ...s.apiKeyStatus, [provider]: result ? 'valid' : 'invalid' } }));
    return result;
  },

  // ── Librarian (session artifact extraction) ───────────────
  librarianStatus: null,  // null | { sessionId, status: 'extracting'|'complete'|'failed', notesCreated, artifactsFiled }

  setLibrarianStatus: (status) => set({ librarianStatus: status }),

  initLibrarian: () => {
    window.guardian?.librarian?.onStatus((status) => set({ librarianStatus: status }));
    window.guardian?.librarian?.onComplete((result) => set({ librarianStatus: { ...result, status: 'complete' } }));
  },

  // ── Post-Chat Pipeline Status ─────────────────
  pipelineStatus: null,  // null | { active, step, sessionId }
  pipelineDigest: null,  // null | { sessionId, awareness, summarized, embeddingChunks, entities, relationships, notesCreated, artifactsFiled }

  initPipeline: () => {
    window.guardian?.pipeline?.onStatus((status) => set({ pipelineStatus: status.active ? status : null }));
    window.guardian?.pipeline?.onDigest((digest) => set({ pipelineDigest: digest }));
  },

  clearPipelineDigest: () => set({ pipelineDigest: null }),

  // ── Awareness-Trap Detection ─────────────────
  // Detection result from main process, or null if no pattern detected
  awareness: null,   // { topic, sessionCount, spanText, confidence, ... }

  setAwareness: (detection) => set({ awareness: detection }),

  clearAwareness: () => set({ awareness: null }),

  // Dismiss: tell backend to suppress this topic for 7 days, clear UI
  dismissAwareness: async () => {
    const { awareness: current } = get();
    if (!current) return;
    try {
      await window.guardian?.awareness?.dismiss(current.topic);
    } catch (e) {
      console.error('[store] dismissAwareness failed:', e);
    }
    set({ awareness: null });
  },

  // Promote: add topic to integration queue, then clear the alert
  promoteAwareness: async () => {
    const { awareness: current } = get();
    if (!current) return;
    try {
      const text = `[awareness pattern] ${current.topic} — appeared in ${current.sessionCount} sessions over ${current.spanText} without resolution`;
      await window.guardian?.queue?.add({ text });
      await window.guardian?.awareness?.dismiss(current.topic);
      get().fetchQueue();
    } catch (e) {
      console.error('[store] promoteAwareness failed:', e);
    }
    set({ awareness: null });
  },

  // ── Knowledge Graph ──────────────────────────────
  graphEntities: [],
  graphRelationships: [],
  graphLoading: false,

  setGraphEntities: (entities) => set({ graphEntities: entities }),
  setGraphRelationships: (relationships) => set({ graphRelationships: relationships }),

  fetchGraph: async () => {
    set({ graphLoading: true });
    try {
      const [entResult, relResult] = await Promise.all([
        window.guardian?.graph?.entities(),
        window.guardian?.graph?.relationships(),
      ]);
      set({
        graphEntities: entResult?.ok ? entResult.entities : [],
        graphRelationships: relResult?.ok ? relResult.relationships : [],
        graphLoading: false,
      });
    } catch (e) {
      console.error('[store] fetchGraph failed:', e);
      set({ graphLoading: false });
    }
  },

  extractGraph: async (sessionId) => {
    try {
      await window.guardian?.graph?.extract(sessionId);
    } catch (e) {
      console.error('[store] extractGraph failed:', e);
    }
  },

  // ── Welcome / First-Run ─────────────────────────────────
  firstRunComplete: false,

  initWelcome: async () => {
    try {
      await window.guardian?.welcome.init();
      // Refresh notes and queue so the starter content appears
      get().fetchNotes();
      get().fetchQueue();
      set({ firstRunComplete: true });
    } catch (e) {
      console.error('[store] initWelcome failed:', e);
      set({ firstRunComplete: true }); // Don't block the user on failure
    }
  },

  // ── Accessibility Preferences ────────────────────────────
  highContrast: false,
  reducedMotion: false,

  setHighContrast: (enabled) => {
    set({ highContrast: enabled });
    document.body.classList.toggle('high-contrast', enabled);
    window.guardian?.config?.set('highContrast', enabled).catch(e => console.error('[store]', e.message || e));
  },

  setReducedMotion: (enabled) => {
    set({ reducedMotion: enabled });
    document.body.classList.toggle('reduced-motion', enabled);
    window.guardian?.config?.set('reducedMotion', enabled).catch(e => console.error('[store]', e.message || e));
  },

  loadA11yPreferences: async () => {
    try {
      const result = await window.guardian?.config?.get();
      if (result?.ok && result.value) {
        const hc = result.value.highContrast === true;
        const rm = result.value.reducedMotion === true;
        set({ highContrast: hc, reducedMotion: rm });
        document.body.classList.toggle('high-contrast', hc);
        document.body.classList.toggle('reduced-motion', rm);
      }
    } catch (e) {
      console.error('[store] loadA11yPreferences failed:', e);
    }
  },

  // ── Auto-Update ──────────────────────────────────────────
  // status: null, checking, available, downloading, ready, up-to-date, error
  updateStatus: null,
  updateVersion: null,
  updatePercent: 0,
  updateError: null,

  setUpdateStatus: (data) => set({
    updateStatus: data.status,
    updateVersion: data.version || get().updateVersion,
    updatePercent: data.percent || 0,
    updateError: data.error || null,
  }),

  checkForUpdate: async () => {
    try {
      await window.guardian?.update?.check();
    } catch (e) {
      console.error('[store] checkForUpdate failed:', e);
    }
  },

  installUpdate: async () => {
    try {
      await window.guardian?.update?.install();
    } catch (e) {
      console.error('[store] installUpdate failed:', e);
    }
  },

  dismissUpdate: () => set({ updateStatus: null }),

  // ── Usage Metrics (analytics-free, local-only) ──────────
  metricsData: null, // { featureUsage: [], sessionStats: {} }
  metricsExport: null, // exported JSON string

  fetchMetrics: async () => {
    try {
      const result = await window.guardian?.metrics?.get();
      if (result?.ok) {
        set({ metricsData: { featureUsage: result.featureUsage, sessionStats: result.sessionStats } });
      }
    } catch (e) {
      console.error('[store] fetchMetrics failed:', e);
    }
  },

  exportMetrics: async () => {
    try {
      const result = await window.guardian?.metrics?.export();
      if (result?.ok) {
        set({ metricsExport: result.data });
        return result.data;
      }
    } catch (e) {
      console.error('[store] exportMetrics failed:', e);
    }
    return null;
  },

  trackFeature: (feature) => {
    window.guardian?.metrics?.track(feature).catch(e => console.error('[store]', e.message || e));
  },

  // ── Conversation Import ──────────────────────────────────
  importBatches: [],
  fetchImportBatches: async () => {
    try {
      const result = await window.guardian?.import?.conversations?.batches();
      if (result?.ok) set({ importBatches: result.batches || [] });
    } catch (e) {
      console.error('[store] fetchImportBatches failed:', e);
    }
  },

  // ── Terminal Window (floating) ─────────────────────────────
  terminalWindowOpen: false,
  terminalWindowMinimized: false,
  terminalWindowMaximized: false,
  terminalWindowPosition: { x: 60, y: 60 },
  terminalWindowSize: { width: 720, height: 440 },
  terminalDocked: false,

  toggleTerminalWindow: () => {
    const { terminalWindowOpen, terminalWindowMinimized, terminalDocked } = get();
    if (terminalDocked) {
      // Ctrl+1 when docked -> undock back to floating
      set({ terminalDocked: false, terminalWindowOpen: true });
      return;
    }
    if (!terminalWindowOpen) {
      set({ terminalWindowOpen: true, terminalWindowMinimized: false });
    } else if (terminalWindowMinimized) {
      set({ terminalWindowMinimized: false });
    } else {
      set({ terminalWindowOpen: false });
    }
  },
  closeTerminalWindow: () => set({ terminalWindowOpen: false }),
  minimizeTerminalWindow: () => set((s) => ({
    terminalWindowMinimized: !s.terminalWindowMinimized,
    terminalWindowMaximized: false,
  })),
  maximizeTerminalWindow: () => set((s) => ({
    terminalWindowMaximized: !s.terminalWindowMaximized,
    terminalWindowMinimized: false,
  })),
  setTerminalWindowPosition: (pos) => set({ terminalWindowPosition: pos }),
  setTerminalWindowSize: (size) => set({ terminalWindowSize: size }),

  dockTerminal: () => set({
    terminalDocked: true,
    terminalWindowOpen: true,
    terminalWindowMinimized: false,
    terminalWindowMaximized: false,
  }),

  undockTerminal: () => set({
    terminalDocked: false,
    terminalWindowOpen: true,
  }),

  // ── Sidebar Navigation ──────────────────────────────────────
  activeSidebarPanel: 'notes',  // 'notes'|'queue'|'search'|'sessions'|'reflections'|'graph'|'drift'|'memory'
  sidebarCollapsed: false,
  setActiveSidebarPanel: (panel) => {
    const { activeSidebarPanel, sidebarCollapsed } = get();
    if (panel === activeSidebarPanel && !sidebarCollapsed) {
      set({ sidebarCollapsed: true });
    } else {
      set({ activeSidebarPanel: panel, sidebarCollapsed: false });
    }
  },
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  // ── Perlocutionary Audit (Reframe Detection) ──────────────
  reframeEvents: [],
  reframeStats: null,
  driftScore: null,
  reframeUnacknowledged: 0,
  reframeFilter: { type: null, dimension: null, rated: null },

  fetchReframeEvents: async () => {
    try {
      const { reframeFilter } = get();
      const filters = {};
      if (reframeFilter.type) filters.type = reframeFilter.type;
      if (reframeFilter.dimension) filters.dimension = reframeFilter.dimension;
      if (reframeFilter.rated === 'rated') filters.acknowledged = 1;
      if (reframeFilter.rated === 'unrated') filters.acknowledged = 0;
      filters.limit = 100;
      const events = await window.guardian?.reframe?.list(filters);
      if (Array.isArray(events)) {
        set({ reframeEvents: events });
      }
    } catch (e) {
      console.error('[store] fetchReframeEvents failed:', e);
    }
  },

  fetchReframeStats: async () => {
    try {
      const stats = await window.guardian?.reframe?.stats();
      if (stats) {
        set({ reframeStats: stats, reframeUnacknowledged: stats.unacknowledged || 0 });
      }
    } catch (e) {
      console.error('[store] fetchReframeStats failed:', e);
    }
  },

  fetchDriftScore: async () => {
    try {
      const result = await window.guardian?.reframe?.drift(30);
      if (result) {
        set({ driftScore: result.score });
      }
    } catch (e) {
      console.error('[store] fetchDriftScore failed:', e);
    }
  },

  rateReframe: async (id, accurate) => {
    try {
      await window.guardian?.reframe?.rate(id, accurate);
      // Update local state immediately
      set((state) => ({
        reframeEvents: state.reframeEvents.map((e) =>
          e.id === id ? { ...e, accurate, acknowledged: 1 } : e
        ),
      }));
      // Refresh stats and drift score
      get().fetchReframeStats();
      get().fetchDriftScore();
    } catch (e) {
      console.error('[store] rateReframe failed:', e);
    }
  },

  acknowledgeReframe: async (id) => {
    try {
      await window.guardian?.reframe?.acknowledge(id);
      set((state) => ({
        reframeEvents: state.reframeEvents.map((e) =>
          e.id === id ? { ...e, acknowledged: 1 } : e
        ),
        reframeUnacknowledged: Math.max(0, state.reframeUnacknowledged - 1),
      }));
    } catch (e) {
      console.error('[store] acknowledgeReframe failed:', e);
    }
  },

  setReframeFilter: (filter) => {
    set((state) => ({
      reframeFilter: { ...state.reframeFilter, ...filter },
    }));
    // Re-fetch with new filter
    setTimeout(() => get().fetchReframeEvents(), 0);
  },

  // ── Identity Dimensions ──────────────────────────────────
  dimensionScores: null,
  dimensionTimeline: null,
  dimensionLastComputed: null,
  selectedDimension: null,
  dimensionTimeWindow: 30,

  fetchDimensionScores: async () => {
    const { dimensionTimeWindow, dimensionLastComputed } = get();
    // TTL: 10 minutes
    if (dimensionLastComputed && Date.now() - dimensionLastComputed < 600000) return;
    try {
      const result = await window.guardian?.dimensions?.scores(dimensionTimeWindow);
      if (result?.ok) {
        set({
          dimensionScores: result,
          dimensionLastComputed: Date.now(),
        });
      }
    } catch (e) {
      console.error('[store] fetchDimensionScores failed:', e);
    }
  },

  fetchDimensionTimeline: async () => {
    try {
      const result = await window.guardian?.dimensions?.timeline(12);
      if (result?.ok) {
        set({ dimensionTimeline: result.timeline });
      }
    } catch (e) {
      console.error('[store] fetchDimensionTimeline failed:', e);
    }
  },

  setSelectedDimension: (dim) => set({ selectedDimension: dim }),

  setDimensionTimeWindow: (days) => {
    set({ dimensionTimeWindow: days, dimensionLastComputed: null });
    get().fetchDimensionScores();
  },

  // ── Reflections (Self-Exploration) ───────────────────────
  reflectionQuery: '',
  reflectionResults: [],
  reflectionConversation: null,
  reflectionStats: null,
  reflectionLoading: false,
  reflectionMode: 'words',   // 'words' | 'meaning' | 'inquiry'

  setReflectionQuery: (q) => set({ reflectionQuery: q }),
  setReflectionMode: (m) => set({ reflectionMode: m }),

  searchReflections: async () => {
    const q = get().reflectionQuery;
    if (!q.trim()) {
      set({ reflectionResults: [] });
      return;
    }
    const { reflectionMode } = get();
    if (reflectionMode === 'meaning') {
      set({ reflectionResults: [], reflectionLoading: false });
      console.warn('[store] searchReflections: meaning mode requires embeddings (not yet available)');
      return;
    }
    if (reflectionMode === 'inquiry') {
      set({ reflectionResults: [], reflectionLoading: false });
      console.warn('[store] searchReflections: inquiry mode requires LLM analysis (not yet available)');
      return;
    }
    set({ reflectionLoading: true });
    try {
      const result = await window.guardian.reflections.search({
        query: q,
        sender: 'both',
        limit: 50,
      });
      set({
        reflectionResults: result.ok ? result.results : [],
        reflectionLoading: false,
      });
    } catch (e) {
      console.error('[store] searchReflections failed:', e);
      set({ reflectionResults: [], reflectionLoading: false });
    }
  },

  loadReflectionConversation: async (id) => {
    try {
      const result = await window.guardian.reflections.conversation(id);
      if (result.ok) {
        set({ reflectionConversation: result.conversation });
      }
    } catch (e) {
      console.error('[store] loadReflectionConversation failed:', e);
    }
  },

  clearReflectionConversation: () => set({ reflectionConversation: null }),

  loadReflectionStats: async () => {
    try {
      const result = await window.guardian.reflections.stats();
      if (result.ok) {
        set({ reflectionStats: result.stats });
      }
    } catch (e) {
      console.error('[store] loadReflectionStats failed:', e);
    }
  },

  importReflections: async (zipPath) => {
    try {
      const result = await window.guardian.reflections.ingest(zipPath);
      if (result.ok) {
        // Refresh stats after import
        const stats = await window.guardian.reflections.stats();
        if (stats.ok) set({ reflectionStats: stats.stats });
      }
      return result;
    } catch (e) {
      console.error('[store] importReflections failed:', e);
      return { ok: false, error: e.message };
    }
  },

  // ── App Meta ────────────────────────────────────────────
  systemInfo: null,
  setSystemInfo: (info) => set({ systemInfo: info })
}));

export default useStore;
