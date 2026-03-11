const { contextBridge, ipcRenderer } = require('electron');

// Expose a controlled API to the renderer process
// Never expose ipcRenderer directly — only specific channels
contextBridge.exposeInMainWorld('guardian', {

  // ── PTY Operations ──────────────────────────────────
  pty: {
    create: (opts) => ipcRenderer.invoke('guardian:pty:create', opts),
    write: (opts) => ipcRenderer.send('guardian:pty:write', opts),
    resize: (opts) => ipcRenderer.send('guardian:pty:resize', opts),
    kill: (opts) => ipcRenderer.invoke('guardian:pty:kill', opts),

    onData: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:pty:data', handler);
      return () => ipcRenderer.removeListener('guardian:pty:data', handler);
    },

    onExit: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:pty:exit', handler);
      return () => ipcRenderer.removeListener('guardian:pty:exit', handler);
    },

    snapshot: (opts) => ipcRenderer.invoke('guardian:pty:snapshot', opts),
  },

  // ── Terminal History ──────────────────────────────────
  terminalHistory: {
    search: (query, limit) =>
      ipcRenderer.invoke('guardian:terminal:history:search', { query, limit }),
    recent: (opts) =>
      ipcRenderer.invoke('guardian:terminal:history:recent', opts),
  },

  // ── Claude Code ─────────────────────────────────────
  claude: {
    launch: (opts) => ipcRenderer.invoke('guardian:claude:launch', opts)
  },

  // ── File Operations ───────────────────────────────────
  file: {
    open: () => ipcRenderer.invoke('guardian:file:open'),
    save: (opts) => ipcRenderer.invoke('guardian:file:save', opts),
  },

  // ── Chat (stream-json Claude session) ───────────────
  chat: {
    send: (message, attachments) =>
      ipcRenderer.invoke('guardian:chat:send', { message, attachments }),
    stop: () => ipcRenderer.invoke('guardian:chat:stop'),
    newSession: () => ipcRenderer.invoke('guardian:chat:newSession'),

    onEvent: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:chat:event', handler);
      return () => ipcRenderer.removeListener('guardian:chat:event', handler);
    },

    onError: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:chat:error', handler);
      return () => ipcRenderer.removeListener('guardian:chat:error', handler);
    },

    onDone: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:chat:done', handler);
      return () => ipcRenderer.removeListener('guardian:chat:done', handler);
    },

    onSessionCreated: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:chat:sessionCreated', handler);
      return () => ipcRenderer.removeListener('guardian:chat:sessionCreated', handler);
    },

    onModelUsed: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:chat:modelUsed', handler);
      return () => ipcRenderer.removeListener('guardian:chat:modelUsed', handler);
    },
  },

  // ── Session Management ────────────────────────────────
  sessions: {
    list: (opts) => ipcRenderer.invoke('guardian:session:list', opts),
    get: (id) => ipcRenderer.invoke('guardian:session:get', { id }),
    resume: (id) => ipcRenderer.invoke('guardian:session:resume', { id }),
    delete: (id) => ipcRenderer.invoke('guardian:session:delete', { id }),
    update: (id, updates) => ipcRenderer.invoke('guardian:session:update', { id, updates }),
    summarize: (id) => ipcRenderer.invoke('guardian:session:summarize', { id }),
    onSummaryReady: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:session:summaryReady', handler);
      return () => ipcRenderer.removeListener('guardian:session:summaryReady', handler);
    },
  },

  // ── Notes (SQLite CRUD + versioning) ───────────────────
  notes: {
    load: () => ipcRenderer.invoke('guardian:notes:load'),
    save: (notes) => ipcRenderer.invoke('guardian:notes:save', { notes }),
    create: (note) => ipcRenderer.invoke('guardian:notes:create', note),
    update: (id, updates) => ipcRenderer.invoke('guardian:notes:update', { id, updates }),
    delete: (id) => ipcRenderer.invoke('guardian:notes:delete', { id }),
    history: (id) => ipcRenderer.invoke('guardian:notes:history', { id }),
    revert: (id, versionId) => ipcRenderer.invoke('guardian:notes:revert', { id, versionId }),
  },

  // ── Usage ─────────────────────────────────────────────
  usage: {
    load: () => ipcRenderer.invoke('guardian:usage:load'),
    append: (record) => ipcRenderer.invoke('guardian:usage:append', { record }),
  },

  // ── Integration Queue ────────────────────────
  queue: {
    list: (opts) => ipcRenderer.invoke('guardian:queue:list', opts),
    add: (item) => ipcRenderer.invoke('guardian:queue:add', item),
    update: (id, updates) => ipcRenderer.invoke('guardian:queue:update', { id, updates }),
    delete: (id) => ipcRenderer.invoke('guardian:queue:delete', { id }),
    stats: () => ipcRenderer.invoke('guardian:queue:stats'),
  },

  // ── Compression Memory (Hierarchical) ────────────────────
  compression: {
    list: (level) => ipcRenderer.invoke('guardian:compression:list', { level }),
    update: (id, updates) => ipcRenderer.invoke('guardian:compression:update', { id, updates }),
    stats: () => ipcRenderer.invoke('guardian:compression:stats'),
    run: (level) => ipcRenderer.invoke('guardian:compression:run', { level }),
    onComplete: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:compression:complete', handler);
      return () => ipcRenderer.removeListener('guardian:compression:complete', handler);
    },
  },

  // ── Telemetry ──────────────────────────────────────────
  telemetry: {
    session: () => ipcRenderer.invoke('guardian:telemetry:session'),
    onState: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:telemetry:state', handler);
      return () => ipcRenderer.removeListener('guardian:telemetry:state', handler);
    },
  },

  // ── Profile ────────────────────────
  profile: {
    get: () => ipcRenderer.invoke('guardian:profile:get'),
    set: (profile) => ipcRenderer.invoke('guardian:profile:set', { profile }),
  },

  // ── Search ────────────────────────────────────────────
  search: (query, scope) => ipcRenderer.invoke('guardian:search', { query, scope }),

  // ── Semantic Search (Vector Embeddings) ───────────────
  semanticSearch: (query, limit) => ipcRenderer.invoke('guardian:search:semantic', { query, limit }),

  // ── Embeddings Events ─────────────────────────────────
  embeddings: {
    onIndexed: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:embeddings:indexed', handler);
      return () => ipcRenderer.removeListener('guardian:embeddings:indexed', handler);
    },
  },

  // ── Config ────────────────────────────────────────────
  config: {
    get: (key) => ipcRenderer.invoke('guardian:config:get', { key }),
    set: (key, value) => ipcRenderer.invoke('guardian:config:set', { key, value }),
    layout: {
      get: () => ipcRenderer.invoke('guardian:config:layout:get'),
      set: (layout) => ipcRenderer.invoke('guardian:config:layout:set', { layout }),
    },
  },

  // ── Awareness-Trap Detection ────────────────
  awareness: {
    check: () => ipcRenderer.invoke('guardian:awareness:check'),
    dismiss: (topic) => ipcRenderer.invoke('guardian:awareness:dismiss', { topic }),
    onDetected: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:awareness:detected', handler);
      return () => ipcRenderer.removeListener('guardian:awareness:detected', handler);
    },
  },

  // ── Knowledge Graph ──────────────────────────
  graph: {
    entities: (opts) => ipcRenderer.invoke('guardian:graph:entities', opts),
    relationships: (opts) => ipcRenderer.invoke('guardian:graph:relationships', opts),
    extract: (sessionId) => ipcRenderer.invoke('guardian:graph:extract', { sessionId }),
    entitySessions: (entityId) => ipcRenderer.invoke('guardian:graph:entitySessions', { entityId }),
  },

  // ── ForgeFrame Model Routing ─────────────────────────
  model: {
    get: () => ipcRenderer.invoke('guardian:model:get'),
    set: (modelId) => ipcRenderer.invoke('guardian:model:set', { modelId }),
    list: () => ipcRenderer.invoke('guardian:model:list'),
    setAutoRoute: (enabled) => ipcRenderer.invoke('guardian:model:autoRoute', { enabled }),
  },

  // ── Welcome (First-Run) ─────────────────────────────
  welcome: {
    init: () => ipcRenderer.invoke('guardian:welcome:init'),
  },

  // ── Backup ────────────────────────────────────────────
  backup: {
    create: () => ipcRenderer.invoke('guardian:backup:create'),
    list: () => ipcRenderer.invoke('guardian:backup:list'),
    restore: (backupPath) => ipcRenderer.invoke('guardian:backup:restore', { backupPath }),
  },

  // ── Export ────────────────────────────────────────────
  export: {
    session: (sessionId, format) =>
      ipcRenderer.invoke('guardian:export:session', { sessionId, format }),
    note: (noteId, format) =>
      ipcRenderer.invoke('guardian:export:note', { noteId, format }),
    allNotes: (format) =>
      ipcRenderer.invoke('guardian:export:allNotes', { format }),
    fullData: () =>
      ipcRenderer.invoke('guardian:export:fullData'),
  },

  // ── Import ────────────────────────────────────────────
  import: {
    markdown: () => ipcRenderer.invoke('guardian:import:markdown'),
    obsidian: () => ipcRenderer.invoke('guardian:import:obsidian'),
    backup: () => ipcRenderer.invoke('guardian:import:backup'),
    conversations: {
      selectFile: () => ipcRenderer.invoke('guardian:import:conversations:selectFile'),
      validate: (filePath) => ipcRenderer.invoke('guardian:import:conversations:validate', { filePath }),
      start: (filePath) => ipcRenderer.invoke('guardian:import:conversations:start', { filePath }),
      cancel: (batchId) => ipcRenderer.invoke('guardian:import:conversations:cancel', { batchId }),
      status: (batchId) => ipcRenderer.invoke('guardian:import:conversations:status', { batchId }),
      batches: () => ipcRenderer.invoke('guardian:import:conversations:batches'),
      exportJournal: (filePath) => ipcRenderer.invoke('guardian:import:conversations:exportJournal', { filePath }),
      exportJournalAuto: (filePath, outputDir) => ipcRenderer.invoke('guardian:import:conversations:exportJournalAuto', { filePath, outputDir }),
      onProgress: (callback) => {
        const handler = (_event, payload) => callback(payload);
        ipcRenderer.on('guardian:import:conversations:progress', handler);
        return () => ipcRenderer.removeListener('guardian:import:conversations:progress', handler);
      },
    },
  },

  // ── Auto-Update ─────────────────────────────────────
  update: {
    check: () => ipcRenderer.invoke('guardian:update:check'),
    install: () => ipcRenderer.invoke('guardian:update:install'),
    onStatus: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:update:status', handler);
      return () => ipcRenderer.removeListener('guardian:update:status', handler);
    },
  },

  // ── Usage Metrics (analytics-free, local-only) ─────
  metrics: {
    get: () => ipcRenderer.invoke('guardian:metrics:get'),
    export: () => ipcRenderer.invoke('guardian:metrics:export'),
    track: (feature) => ipcRenderer.invoke('guardian:metrics:track', { feature }),
  },

  // ── Post-Chat Pipeline Status ───────────────────
  pipeline: {
    onStatus: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:pipeline:status', handler);
      return () => ipcRenderer.removeListener('guardian:pipeline:status', handler);
    },
    onDigest: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:pipeline:digest', handler);
      return () => ipcRenderer.removeListener('guardian:pipeline:digest', handler);
    },
  },

  // ── Librarian (Auto-Extraction) ─────────────────
  librarian: {
    onStatus: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:librarian:status', handler);
      return () => ipcRenderer.removeListener('guardian:librarian:status', handler);
    },
    onComplete: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('guardian:librarian:complete', handler);
      return () => ipcRenderer.removeListener('guardian:librarian:complete', handler);
    },
    rerun: (sessionId) => ipcRenderer.invoke('guardian:librarian:rerun', { sessionId }),
  },

  // ── Multi-Provider Management ──────────────────────────
  providers: {
    list: () => ipcRenderer.invoke('guardian:providers:list'),
    add: (provider) => ipcRenderer.invoke('guardian:providers:add', provider),
    remove: (id) => ipcRenderer.invoke('guardian:providers:remove', { id }),
    test: (id) => ipcRenderer.invoke('guardian:providers:test', { id }),
    models: (id) => ipcRenderer.invoke('guardian:providers:models', { id }),
  },

  // ── Secure API Key Management ──────────────────────────
  keys: {
    set: (provider, key) => ipcRenderer.invoke('guardian:keys:set', { provider, key }),
    delete: (provider) => ipcRenderer.invoke('guardian:keys:delete', { provider }),
    list: () => ipcRenderer.invoke('guardian:keys:list'),
    test: (provider) => ipcRenderer.invoke('guardian:keys:test', { provider }),
  },

  // ── Perlocutionary Audit (Reframe Detection) ────────
  reframe: {
    list: (filters) => ipcRenderer.invoke('guardian:reframe:list', filters),
    rate: (id, accurate) => ipcRenderer.invoke('guardian:reframe:rate', { id, accurate }),
    acknowledge: (id) => ipcRenderer.invoke('guardian:reframe:acknowledge', { id }),
    acknowledgeAll: () => ipcRenderer.invoke('guardian:reframe:acknowledgeAll'),
    stats: () => ipcRenderer.invoke('guardian:reframe:stats'),
    drift: (days) => ipcRenderer.invoke('guardian:reframe:drift', { days }),
  },

  // ── Identity Dimensions ────────────────────────────
  dimensions: {
    scores: (days) => ipcRenderer.invoke('guardian:dimensions:scores', { days }),
    timeline: (weeks) => ipcRenderer.invoke('guardian:dimensions:timeline', { weeks }),
  },

  // ── Reflections (Self-Exploration) ─────────────────────
  reflections: {
    ingest: (zipPath) => ipcRenderer.invoke('guardian:reflections:ingest', { zipPath }),
    search: (opts) => ipcRenderer.invoke('guardian:reflections:search', opts),
    conversation: (id) => ipcRenderer.invoke('guardian:reflections:conversation', { id }),
    conversations: (opts) => ipcRenderer.invoke('guardian:reflections:conversations', opts),
    stats: () => ipcRenderer.invoke('guardian:reflections:stats'),
    semantic: (opts) => ipcRenderer.invoke('guardian:reflections:semantic', opts),
    embed: () => ipcRenderer.invoke('guardian:reflections:embed'),
    analyze: (opts) => ipcRenderer.invoke('guardian:reflections:analyze', opts),
    onImportProgress: (cb) => {
      const handler = (_event, payload) => cb(payload);
      ipcRenderer.on('guardian:reflections:importProgress', handler);
      return () => ipcRenderer.removeListener('guardian:reflections:importProgress', handler);
    },
    onEmbedProgress: (cb) => {
      const handler = (_event, payload) => cb(payload);
      ipcRenderer.on('guardian:reflections:embedProgress', handler);
      return () => ipcRenderer.removeListener('guardian:reflections:embedProgress', handler);
    },
  },

  // ── Privacy Layer ──────────────────────────────────
  privacy: {
    setSensitivity: (table, id, sensitivity) => ipcRenderer.invoke('guardian:privacy:setSensitivity', { table, id, sensitivity }),
    getSensitivity: (table, id) => ipcRenderer.invoke('guardian:privacy:getSensitivity', { table, id }),
  },

  // ── Performance Profiling ────────────────────────────
  perf: {
    snapshot: () => ipcRenderer.invoke('guardian:perf:snapshot'),
    mark: (name) => ipcRenderer.invoke('guardian:perf:mark', { name }),
    logRenderer: (name, data) => ipcRenderer.invoke('guardian:perf:logRenderer', { name, data }),
  },

  // ── ForgeFrame MCP ─────────────────────────────────
  forgeframeMcp: {
    status: () => ipcRenderer.invoke('guardian:forgeframe:status'),
    memorySave: (content, metadata) => ipcRenderer.invoke('guardian:forgeframe:memorySave', { content, metadata }),
    memoryQuery: (query, options) => ipcRenderer.invoke('guardian:forgeframe:memoryQuery', { query, ...options }),
    memorySearch: (query) => ipcRenderer.invoke('guardian:forgeframe:memorySearch', { query }),
    memoryStatus: () => ipcRenderer.invoke('guardian:forgeframe:memoryStatus'),
    sessionStart: (name) => ipcRenderer.invoke('guardian:forgeframe:sessionStart', { name }),
    sessionEnd: () => ipcRenderer.invoke('guardian:forgeframe:sessionEnd'),
    sessionCurrent: () => ipcRenderer.invoke('guardian:forgeframe:sessionCurrent'),
  },

  // ── System ──────────────────────────────────────────
  system: {
    info: () => ipcRenderer.invoke('guardian:system:info')
  }
});
