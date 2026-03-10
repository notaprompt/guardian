const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

// ── Crash Logging ─────────────────────────────────────────────────
// Write uncaught errors to a log file for debugging packaged builds
const crashLogPath = path.join(os.homedir(), '.guardian', 'crash.log');
process.on('uncaughtException', (err) => {
  const msg = `[${new Date().toISOString()}] UNCAUGHT: ${err.stack || err.message}\n`;
  try {
    fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
    fs.appendFileSync(crashLogPath, msg);
  } catch (_) { /* can't even write logs */ }
  if (app.isReady()) {
    dialog.showErrorBox('Guardian — Fatal Error', err.stack || err.message);
  }
  process.exit(1);
});

// ── Guardian Modules ─────────────────────────────────────────────
const { initDirectories, FILES, readJSON, writeJSON } = require('./lib/paths');
const database = require('./lib/database');
const terminalHistory = require('./lib/terminal-history');
const log = require('./lib/logger');
const forgeframe = require('./lib/forgeframe-bridge');
const awareness = require('./lib/awareness');
const { summarizeSession } = require('./lib/summarizer');
const embeddings = require('./lib/embeddings');
const knowledgeGraph = require('./lib/knowledge-graph');
const backup = require('./lib/backup');
const exporter = require('./lib/exporter');
const importer = require('./lib/importer');
const importParser = require('./lib/import-parser');
const importWorker = require('./lib/import-worker');
const journalExporter = require('./lib/journal-exporter');
const metrics = require('./lib/metrics');
const perf = require('./lib/performance');
const librarian = require('./lib/librarian');
const providers = require('./lib/providers');
const secureStore = require('./lib/secure-store');
const reflections = require('./lib/reflections');

// Start performance tracking immediately on module load
perf.markStartupBegin();

// ── Auto-Updater (GitHub Releases) ──────────────────────────────
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = log;
} catch (e) {
  log.warn('Auto-updater unavailable (dev mode):', e.message);
}

function setupAutoUpdater() {
  if (!autoUpdater) return;
  autoUpdater.on('checking-for-update', () => {
    log.info('Auto-updater: checking for update...');
    send('guardian:update:status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Auto-updater: update available:', info.version);
    send('guardian:update:status', {
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    log.info('Auto-updater: up to date');
    send('guardian:update:status', { status: 'up-to-date' });
  });

  autoUpdater.on('download-progress', (progress) => {
    send('guardian:update:status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Auto-updater: update downloaded:', info.version);
    send('guardian:update:status', {
      status: 'ready',
      version: info.version,
    });
  });

  autoUpdater.on('error', (err) => {
    log.warn('Auto-updater error:', err.message);
    send('guardian:update:status', { status: 'error', error: err.message });
  });
}

// ── PTY Management ──────────────────────────────────────────────
let pty;
try {
  pty = require('node-pty');
} catch (e) {
  log.error('node-pty failed to load:', e.message);
}

const ptySessions = new Map();

const defaultShell = os.platform() === 'win32'
  ? 'powershell.exe'
  : process.env.SHELL || '/bin/bash';

const { getClaudePath, newPath: claudeNewPath } = require('./lib/claude-cli');
const { CLAUDECODE: _drop, ...cleanEnv } = process.env;
const ptyEnv = {
  ...cleanEnv,
  Path: claudeNewPath,
  PATH: claudeNewPath,
  ...(process.platform !== 'win32' ? { TERM: 'xterm-256color', COLORTERM: 'truecolor' } : {})
};

// ── Claude CLI ──────────────────────────────────────────────────
function isClaudeAvailable() {
  const p = getClaudePath();
  if (p === 'claude') {
    // Check if claude is on PATH
    try {
      require('child_process').execSync('claude --version', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch (_) {
      return false;
    }
  }
  return fs.existsSync(p);
}

// ── Window ──────────────────────────────────────────────────────
let mainWindow;

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function createWindow() {
  const layout = readJSON(FILES.layout, { width: 1600, height: 1000 });

  mainWindow = new BrowserWindow({
    width: layout.width || 1600,
    height: layout.height || 1000,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0b',
    icon: fs.existsSync(path.join(__dirname, 'build', 'icon.ico'))
      ? path.join(__dirname, 'build', 'icon.ico')
      : fs.existsSync(path.join(__dirname, 'build', 'icon.png'))
        ? path.join(__dirname, 'build', 'icon.png')
        : fs.existsSync(path.join(__dirname, 'build', 'icon.svg'))
          ? path.join(__dirname, 'build', 'icon.svg')
          : undefined,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const isDev = !app.isPackaged;
  const DEV_URL = 'http://localhost:5173';

  if (isDev) {
    let retries = 0;
    const tryLoad = () => {
      mainWindow.loadURL(DEV_URL).catch(() => {
        if (++retries < 20 && mainWindow && !mainWindow.isDestroyed()) {
          log.info(`Vite not ready (attempt ${retries}/20), retrying...`);
          setTimeout(tryLoad, 500);
        } else {
          log.error('Failed to connect to Vite dev server at', DEV_URL);
        }
      });
    };
    tryLoad();
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  // Mark startup complete when renderer content has loaded
  mainWindow.webContents.on('did-finish-load', () => {
    perf.mark('window:loaded');
    const startupMs = perf.markStartupComplete();
    log.info('Startup complete in', startupMs, 'ms');
    perf.logMemory('post-startup');
  });

  // Persist window size on resize (debounced to avoid disk thrash)
  let resizeTimer = null;
  mainWindow.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
        const [w, h] = mainWindow.getSize();
        writeJSON(FILES.layout, { ...readJSON(FILES.layout, {}), width: w, height: h });
      }
    }, 500);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    for (const [id, session] of ptySessions) {
      try { session.kill(); } catch (_) {}
      ptySessions.delete(id);
    }
  });

  log.info('Window created, dev:', isDev);
}

// ══════════════════════════════════════════════════════════════════
// IPC HANDLERS
// ══════════════════════════════════════════════════════════════════

// ── PTY Lifecycle ───────────────────────────────────────────────

ipcMain.handle('guardian:pty:create', (event, { id, cols, rows, cwd }) => {
  if (!pty) return { error: 'node-pty not available' };

  if (ptySessions.has(id)) {
    try { ptySessions.get(id).kill(); } catch (_) {}
    ptySessions.delete(id);
  }

  const ptyProcess = pty.spawn(defaultShell, [], {
    name: 'xterm-256color',
    cols: cols || 120,
    rows: rows || 30,
    cwd: cwd || os.homedir(),
    env: ptyEnv
  });

  ptySessions.set(id, ptyProcess);

  ptyProcess.onData((data) => {
    send('guardian:pty:data', { id, data });
    terminalHistory.captureOutput(id, data);
  });
  ptyProcess.onExit(({ exitCode }) => {
    ptySessions.delete(id);
    terminalHistory.removeTerminal(id);
    send('guardian:pty:exit', { id, exitCode });
  });

  return { ok: true, pid: ptyProcess.pid };
});

ipcMain.on('guardian:pty:write', (event, { id, data }) => {
  const session = ptySessions.get(id);
  if (session) session.write(data);
  terminalHistory.captureInput(id, data);
});

ipcMain.on('guardian:pty:resize', (event, { id, cols, rows }) => {
  const session = ptySessions.get(id);
  if (session) {
    try { session.resize(cols, rows); } catch (_) {}
  }
});

ipcMain.handle('guardian:pty:kill', (event, { id }) => {
  const session = ptySessions.get(id);
  if (session) {
    try { session.kill(); } catch (_) {}
    ptySessions.delete(id);
    return { ok: true };
  }
  return { error: 'Session not found' };
});

// ── Terminal History: Snapshot & Search ──────────────────────────

ipcMain.handle('guardian:pty:snapshot', (event, { id, content }) => {
  try {
    return terminalHistory.saveSnapshot(id, content);
  } catch (e) {
    log.error('Snapshot failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:terminal:history:search', (event, { query, limit }) => {
  try {
    const results = terminalHistory.search(query, { limit });
    return { ok: true, results };
  } catch (e) {
    log.error('Terminal history search failed:', e.message);
    return { ok: false, error: e.message, results: [] };
  }
});

ipcMain.handle('guardian:terminal:history:recent', (event, opts = {}) => {
  try {
    const results = terminalHistory.recentCommands(opts);
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: e.message, results: [] };
  }
});

// ── Launch Claude Code in a PTY ─────────────────────────────────

ipcMain.handle('guardian:claude:launch', (event, { id, cols, rows, cwd }) => {
  if (!pty) return { error: 'node-pty not available' };

  if (ptySessions.has(id)) {
    try { ptySessions.get(id).kill(); } catch (_) {}
    ptySessions.delete(id);
  }

  const claudePath = getClaudePath();
  const ptyProcess = pty.spawn(claudePath, [], {
    name: 'xterm-256color',
    cols: cols || 120,
    rows: rows || 30,
    cwd: cwd || os.homedir(),
    env: ptyEnv
  });

  ptySessions.set(id, ptyProcess);
  ptyProcess.onData((data) => {
    send('guardian:pty:data', { id, data });
    terminalHistory.captureOutput(id, data);
  });
  ptyProcess.onExit(({ exitCode }) => {
    ptySessions.delete(id);
    terminalHistory.removeTerminal(id);
    send('guardian:pty:exit', { id, exitCode });
  });

  return { ok: true, pid: ptyProcess.pid };
});

// ── Session Telemetry Engine ─────────────────────────────────────
// Tracks real-time cognitive load proxies for navigation instruments

const telemetry = {
  sessionStart: null,
  tokensBurned: 0,
  thinkingTokens: 0,
  outputTokens: 0,
  exchangeCount: 0,
  tokenHistory: [],         // [{ ts, tokens }] for burn rate calc
  lastMessageTimes: [],     // timestamps for drift detection
  lastMessageLengths: [],   // lengths for drift detection
  systemState: 'idle',      // idle | thinking | responding | error | latency
  _interval: null,

  reset() {
    this.sessionStart = Date.now();
    this.tokensBurned = 0;
    this.thinkingTokens = 0;
    this.outputTokens = 0;
    this.exchangeCount = 0;
    this.tokenHistory = [];
    this.lastMessageTimes = [];
    this.lastMessageLengths = [];
    this.systemState = 'idle';
  },

  addTokens(input, output, thinking) {
    const total = (input || 0) + (output || 0);
    this.tokensBurned += total;
    this.outputTokens += (output || 0);
    this.thinkingTokens += (thinking || 0);
    this.tokenHistory.push({ ts: Date.now(), tokens: total });
    // Keep last 5 minutes of history
    const cutoff = Date.now() - 300000;
    this.tokenHistory = this.tokenHistory.filter((h) => h.ts > cutoff);
  },

  addExchange(userMsgLength) {
    this.exchangeCount++;
    this.lastMessageTimes.push(Date.now());
    this.lastMessageLengths.push(userMsgLength || 0);
    // Keep last 20 exchanges for drift detection
    if (this.lastMessageTimes.length > 20) this.lastMessageTimes.shift();
    if (this.lastMessageLengths.length > 20) this.lastMessageLengths.shift();
  },

  getState() {
    const elapsed = this.sessionStart ? (Date.now() - this.sessionStart) / 60000 : 0;
    // Token burn rate: tokens per minute over last 2 min window
    const twoMinAgo = Date.now() - 120000;
    const recentTokens = this.tokenHistory
      .filter((h) => h.ts > twoMinAgo)
      .reduce((sum, h) => sum + h.tokens, 0);
    const burnRate = elapsed > 0 ? recentTokens / Math.min(2, elapsed) : 0;
    // Thinking ratio: thinking tokens / total output
    const thinkingRatio = this.outputTokens > 0
      ? this.thinkingTokens / this.outputTokens : 0;
    // Intensity: 0-1 normalized burn rate (1000 tokens/min = 1.0)
    const intensity = Math.min(1, burnRate / 1000);
    // Duration: 0-1 normalized (120 min = 1.0)
    const duration = Math.min(1, elapsed / 120);

    return {
      sessionStart: this.sessionStart,
      elapsed: Math.round(elapsed),
      tokensBurned: this.tokensBurned,
      burnRate: Math.round(burnRate),
      exchangeCount: this.exchangeCount,
      thinkingRatio: Math.round(thinkingRatio * 100),
      intensity,
      duration,
      systemState: this.systemState,
    };
  },

  // Drift detection: analyze interaction patterns
  detectDrift() {
    if (this.lastMessageLengths.length < 4) return null;
    const recent = this.lastMessageLengths.slice(-4);
    const older = this.lastMessageLengths.slice(-8, -4);
    if (older.length < 2) return null;
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    // Significant change in message length pattern
    if (olderAvg > 0 && Math.abs(recentAvg - olderAvg) / olderAvg > 0.6) {
      if (recentAvg < olderAvg) return 'consolidating';
      return 'expanding';
    }
    // Check timing drift — response cadence change
    if (this.lastMessageTimes.length >= 6) {
      const recentGaps = [];
      const olderGaps = [];
      for (let i = this.lastMessageTimes.length - 1; i > this.lastMessageTimes.length - 4 && i > 0; i--) {
        recentGaps.push(this.lastMessageTimes[i] - this.lastMessageTimes[i - 1]);
      }
      for (let i = this.lastMessageTimes.length - 4; i > this.lastMessageTimes.length - 7 && i > 0; i--) {
        olderGaps.push(this.lastMessageTimes[i] - this.lastMessageTimes[i - 1]);
      }
      if (recentGaps.length >= 2 && olderGaps.length >= 2) {
        const recentPace = recentGaps.reduce((a, b) => a + b, 0) / recentGaps.length;
        const olderPace = olderGaps.reduce((a, b) => a + b, 0) / olderGaps.length;
        if (olderPace > 0 && recentPace / olderPace > 2.5) return 'slowing';
        if (olderPace > 0 && recentPace / olderPace < 0.4) return 'accelerating';
      }
    }
    return null;
  },

  startPushing() {
    if (this._interval) return;
    this._interval = setInterval(() => {
      const state = this.getState();
      const drift = this.detectDrift();
      send('guardian:telemetry:state', { ...state, drift });
    }, 5000);
  },

  stopPushing() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  },
};

// ── Post-Chat Pipeline (sequential queue) ───────────────────────
// Runs awareness, summarize, embeddings, KG extraction, and librarian
// sequentially instead of spawning all 5 at once.

function runPostChatPipeline(sessionId) {
  const steps = [
    // Step 1: Awareness-trap detection (synchronous, fast)
    function awarenessStep() {
      try {
        const profile = readJSON(FILES.profile, null);
        const detection = awareness.detect(database, sessionId, profile);
        if (detection) {
          log.info('Awareness pattern detected:', detection.topic, 'confidence:', detection.confidence);
          send('guardian:awareness:detected', detection);
        }
      } catch (e) {
        log.warn('Awareness detection failed:', e.message);
      }
    },

    // Step 2: Auto-summarize + compression cascade
    function summarizeStep() {
      return new Promise((resolve) => {
        try {
          const msgs = database.messages.listBySession(sessionId);
          if (msgs.length < 2) { resolve(); return; }
          summarizeSession({
            sessionId,
            messages: msgs,
            onComplete: (sid, summary) => {
              try {
                database.sessions.updateSummary(sid, summary);
                send('guardian:session:summaryReady', { sessionId: sid, summary });
              } catch (e) {
                log.warn('Failed to save summary:', e.message);
              }
              // Register L1 compression entry and trigger L2/L3 cascade
              try {
                const compressionPipeline = require('./lib/compression');
                const result = compressionPipeline.registerL1(database, sid, summary);
                if (result.shouldTriggerL2) {
                  compressionPipeline.extractPatterns(database, {
                    onComplete: (l2Items) => {
                      log.info('L2 pattern extraction complete:', l2Items.length, 'patterns');
                      send('guardian:compression:complete', { level: 2, count: l2Items.length });
                      const l2Count = database.compression.countSinceLastCompression(2);
                      if (l2Count >= 3) {
                        compressionPipeline.distillPrinciples(database, {
                          onComplete: (l3Items) => {
                            log.info('L3 principle distillation complete:', l3Items.length, 'principles');
                            send('guardian:compression:complete', { level: 3, count: l3Items.length });
                          },
                          onError: (err) => log.warn('L3 distillation failed:', err.message),
                        });
                      }
                    },
                    onError: (err) => log.warn('L2 extraction failed:', err.message),
                  });
                }
              } catch (e) {
                log.warn('Compression L1 registration failed:', e.message);
              }
              resolve();
            },
            onError: (sid, err) => {
              log.warn('Auto-summarize failed for', sid, ':', err.message);
              resolve();
            },
          });
        } catch (e) {
          log.warn('Auto-summarize setup failed:', e.message);
          resolve();
        }
      });
    },

    // Step 3: Semantic embedding indexing
    function embeddingsStep() {
      return new Promise((resolve) => {
        try {
          const msgs = database.messages.listBySession(sessionId);
          if (msgs.length < 2) { resolve(); return; }
          embeddings.indexSession({
            sessionId,
            messages: msgs,
            onComplete: (sid, count) => {
              log.info('Embeddings indexed for session', sid, ':', count, 'chunks');
              send('guardian:embeddings:indexed', { sessionId: sid, chunks: count });
              resolve();
            },
            onError: (sid, err) => {
              log.warn('Embedding indexing failed for', sid, ':', err.message);
              resolve();
            },
          });
        } catch (e) {
          log.warn('Embedding indexing setup failed:', e.message);
          resolve();
        }
      });
    },

    // Step 4: Knowledge graph entity extraction
    function knowledgeGraphStep() {
      return new Promise((resolve) => {
        try {
          const msgs = database.messages.listBySession(sessionId);
          if (msgs.length < 2) { resolve(); return; }
          knowledgeGraph.extractEntities(msgs, {
            onComplete: (entities, relationships) => {
              try {
                const result = knowledgeGraph.mergeExtractionResults(
                  database.db(), entities, relationships, sessionId
                );
                log.info('Knowledge graph extracted:', result.entityCount, 'entities,', result.relationshipCount, 'relationships');
                send('guardian:graph:extracted', { sessionId, ...result });
              } catch (e) {
                log.warn('Knowledge graph merge failed:', e.message);
              }
              resolve();
            },
            onError: (err) => {
              log.warn('Knowledge graph extraction failed:', err.message);
              resolve();
            },
          });
        } catch (e) {
          log.warn('Knowledge graph extraction setup failed:', e.message);
          resolve();
        }
      });
    },

    // Step 5: Librarian auto-extraction pipeline
    function librarianStep() {
      return new Promise((resolve) => {
        try {
          const msgs = database.messages.listBySession(sessionId);
          if (msgs.length < 2) { resolve(); return; }
          send('guardian:librarian:status', { sessionId, status: 'running' });
          librarian.runPipeline({
            sessionId,
            messages: msgs,
            db: database,
            onComplete: (result) => {
              log.info('Librarian pipeline complete for session', sessionId, JSON.stringify(result));
              send('guardian:librarian:complete', { sessionId, ...result });
              resolve();
            },
            onError: (err) => {
              log.warn('Librarian pipeline failed for', sessionId, ':', err.message);
              send('guardian:librarian:status', { sessionId, status: 'error', error: err.message });
              resolve();
            },
          });
        } catch (e) {
          log.warn('Librarian pipeline setup failed:', e.message);
          resolve();
        }
      });
    },
  ];

  // Step names for pipeline status reporting
  const stepNames = ['awareness', 'summarize', 'embeddings', 'knowledge-graph', 'librarian'];

  // Digest collector — each step can append results
  const digest = { sessionId, awareness: null, summarized: false, embeddingChunks: 0, entities: 0, relationships: 0, notesCreated: 0, artifactsFiled: 0 };

  // Patch steps to collect digest data via existing send() events
  const origSend = send;
  const digestSend = (channel, data) => {
    if (channel === 'guardian:awareness:detected') digest.awareness = data?.topic || true;
    if (channel === 'guardian:session:summaryReady') digest.summarized = true;
    if (channel === 'guardian:embeddings:indexed') digest.embeddingChunks = data?.chunks || 0;
    if (channel === 'guardian:graph:extracted') { digest.entities = data?.entityCount || 0; digest.relationships = data?.relationshipCount || 0; }
    if (channel === 'guardian:librarian:complete') { digest.notesCreated = data?.notesCreated || 0; digest.artifactsFiled = data?.artifactsFiled || 0; }
    origSend(channel, data);
  };
  send = digestSend;

  // Run steps sequentially — each waits for the previous to finish
  (async () => {
    send('guardian:pipeline:status', { active: true, step: null, sessionId });
    for (let i = 0; i < steps.length; i++) {
      try {
        send('guardian:pipeline:status', { active: true, step: stepNames[i], sessionId });
        await steps[i]();
      } catch (e) {
        log.warn('Post-chat pipeline step failed:', e.message);
      }
    }
    send = origSend;
    send('guardian:pipeline:status', { active: false, step: null, sessionId });
    send('guardian:pipeline:digest', digest);
  })();
}

// ── Chat (stream-json Claude session) ───────────────────────────

let chatProcess = null;
let currentSessionId = null;    // Guardian session ID (our DB)
let claudeSessionId = null;     // Claude CLI --resume ID
const tempAttachmentFiles = [];

ipcMain.handle('guardian:chat:send', (event, { message, attachments, sessionId }) => {
  // Kill any in-flight process
  if (chatProcess) {
    try { chatProcess.kill(); } catch (_) {}
    chatProcess = null;
  }

  // Ensure we have a Guardian session
  if (sessionId) {
    currentSessionId = sessionId;
  }
  if (!currentSessionId) {
    currentSessionId = database.generateId('s');
    database.sessions.create(currentSessionId, { title: message.slice(0, 80) });
    send('guardian:chat:sessionCreated', { sessionId: currentSessionId });
    metrics.startSession(currentSessionId);
  }

  // Persist user message
  const userMsgId = database.generateId('m') + '_u';
  database.messages.create({
    id: userMsgId,
    sessionId: currentSessionId,
    role: 'user',
    content: message,
    attachments: attachments || null,
    timestamp: new Date().toISOString(),
  });

  // Telemetry: track exchange
  if (!telemetry.sessionStart) telemetry.reset();
  telemetry.addExchange(message.length);
  telemetry.systemState = 'thinking';
  telemetry.startPushing();

  // Metrics: track chat message sent
  metrics.track.chatMessageSent();

  // Build prompt with context injection
  // Budget: ~2000 tokens of auto-injected context
  let prompt = message;
  let contextTokenEstimate = 0;

  // 1. Inject notes context (sovereign/deep notes excluded from LLM context)
  try {
    const allNotes = database.notes.list()
      .filter((n) => !n.sensitivity || n.sensitivity === 'surface');
    if (allNotes.length > 0) {
      const notesContext = allNotes
        .slice(0, 10)
        .filter((n) => n.content && n.content.trim())
        .map((n) => `[${n.title || 'Untitled'}] ${n.content.slice(0, 300)}`)
        .join('\n');
      if (notesContext) {
        prompt = `[guardian-notes]\n${notesContext}\n[/guardian-notes]\n\n${prompt}`;
        contextTokenEstimate += Math.ceil(notesContext.length / 4);
      }
    }
  } catch (e) {
    log.warn('Notes injection failed:', e.message);
  }

  // 2. Inject integration queue (sovereign/deep items excluded from LLM context)
  try {
    if (contextTokenEstimate < 1600) {
      const openItems = database.queue.list({ status: 'open' })
        .filter((q) => !q.sensitivity || q.sensitivity === 'surface');
      if (openItems.length > 0) {
        const queueContext = openItems
          .slice(0, 8)
          .map((q) => `- ${q.text}`)
          .join('\n');
        prompt = `[guardian-open-threads]\n${queueContext}\n[/guardian-open-threads]\n\n${prompt}`;
        contextTokenEstimate += Math.ceil(queueContext.length / 4);
      }
    }
  } catch (e) {
    log.warn('Queue injection failed:', e.message);
  }

  // 3. Inject relevant past conversation context via FTS
  try {
    if (contextTokenEstimate < 1800) {
      const keywords = message.split(/\s+/).filter((w) => w.length > 4).slice(0, 5);
      if (keywords.length > 0) {
        const searchResults = database.search(keywords.join(' '), { scope: 'conversations' });
        const relevant = searchResults
          .filter((r) => r.session_id !== currentSessionId) // Exclude current session
          .slice(0, 3);
        if (relevant.length > 0) {
          const histContext = relevant
            .map((r) => `[session: ${r.session_title || 'untitled'}] ${(r.content || '').slice(0, 200)}`)
            .join('\n');
          prompt = `[guardian-context]\n${histContext}\n[/guardian-context]\n\n${prompt}`;
        }
      }
    }
  } catch (e) {
    log.warn('Context injection failed:', e.message);
  }

  // 4. Inject librarian-sourced relevant notes
  try {
    if (contextTokenEstimate < 1900) {
      const librarianContext = librarian.getRelevantContext(database, message);
      if (librarianContext) {
        prompt = `[guardian-librarian-notes]\n${librarianContext}\n[/guardian-librarian-notes]\n\n${prompt}`;
        contextTokenEstimate += Math.ceil(librarianContext.length / 4);
      }
    }
  } catch (e) {
    log.warn('Librarian context injection failed:', e.message);
  }

  // Inject text attachments as context blocks
  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      if (!att.isImage && att.type === 'text/plain') {
        prompt = `[file: ${att.name}]\n${att.data}\n[/file]\n\n${prompt}`;
      }
    }
  }

  // Check Claude CLI availability
  const claudePath = getClaudePath();
  if (!isClaudeAvailable()) {
    const errMsg = `Claude CLI not found. Expected at: ${claudePath}\nInstall from: https://docs.anthropic.com/en/docs/claude-code`;
    send('guardian:chat:error', { error: errMsg });
    send('guardian:chat:done', { exitCode: 1 });
    return { ok: false, error: 'Claude CLI not found' };
  }

  // ForgeFrame: resolve model for this message
  const modelResult = forgeframe.resolveModel(message, forgeframe.getSelectedModel());
  log.info('ForgeFrame routed to:', modelResult.modelId, modelResult.auto ? '(auto)' : '(manual)');
  send('guardian:chat:modelUsed', { modelId: modelResult.modelId, tier: modelResult.tier, auto: modelResult.auto });

  // Metrics: track model usage
  metrics.track.modelUsed(modelResult.modelId);

  // ── Provider dispatch: non-CLI providers use the providers registry ──
  if (modelResult.provider !== 'claude-cli') {
    log.info('Dispatching to provider:', modelResult.provider, 'model:', modelResult.modelId);

    // Look up provider config from DB for base_url
    const provRow = database.providerStore.get(modelResult.provider);
    const baseUrl = provRow?.base_url || null;

    // Build or find the right provider instance
    let providerInstance = providers.registry.getProvider(modelResult.provider);
    if (!providerInstance && baseUrl) {
      // Create an ad-hoc OpenAI-compatible provider for DB-registered providers
      const apiKey = secureStore.getKey(modelResult.provider);
      const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(baseUrl);
      const adhoc = new providers.OpenAIProvider({
        apiKey,
        baseUrl,
        name: provRow?.name || modelResult.provider,
        keyName: modelResult.provider,
        noAuth: isLocal && !apiKey,
      });
      providerInstance = adhoc;
    }
    if (!providerInstance) {
      send('guardian:chat:error', { error: `Provider "${modelResult.provider}" not available` });
      send('guardian:chat:done', { exitCode: 1 });
      return { ok: false, error: 'Provider not found' };
    }

    const msgs = [
      { role: 'system', content: 'You are Guardian, a focused AI assistant inside a desktop productivity app. Respond directly to the user\'s message. Be concise and helpful. Never roleplay as the user, never continue the user\'s thoughts, and never generate fake user messages. Context blocks wrapped in [guardian-*] tags are background reference — use them to inform your answer but do not repeat or narrate them.' },
      { role: 'user', content: prompt },
    ];
    const maxTok = modelResult.tier === 'quick' ? 512 : 4096;
    const emitter = providerInstance.sendMessage(msgs, {
      model: modelResult.modelId,
      stream: true,
      maxTokens: maxTok,
    });

    let assistantContent = '';
    const asstMsgId = database.generateId('m') + '_a';

    emitter.on('text_delta', (ev) => {
      assistantContent += ev.text;
      telemetry.systemState = 'responding';
      send('guardian:chat:event', { type: 'content_block_delta', delta: { type: 'text_delta', text: ev.text } });
    });

    emitter.on('result', (ev) => {
      if (ev.usage) {
        telemetry.addTokens(ev.usage.input_tokens, ev.usage.output_tokens, 0);
        database.usage.append({
          sessionId: currentSessionId,
          inputTokens: ev.usage.input_tokens || 0,
          outputTokens: ev.usage.output_tokens || 0,
        });
        database.sessions.updateTokens(currentSessionId, ev.usage.input_tokens || 0, ev.usage.output_tokens || 0);
      }
      send('guardian:chat:event', { type: 'result', usage: ev.usage });
    });

    emitter.on('error', (ev) => {
      send('guardian:chat:error', { error: ev.error, type: 'unknown' });
    });

    emitter.on('done', () => {
      if (assistantContent) {
        database.messages.create({
          id: asstMsgId, sessionId: currentSessionId, role: 'assistant',
          content: assistantContent, thinking: null, timestamp: new Date().toISOString(),
        });
      }
      telemetry.systemState = 'idle';
      send('guardian:chat:done', { exitCode: 0, sessionId: currentSessionId });
      log.info('Provider chat done:', modelResult.provider);
    });

    // Store abort handle
    chatProcess = { kill: () => emitter.abort && emitter.abort() };
    return { ok: true, provider: modelResult.provider };
  }

  // ── Claude CLI path ──────────────────────────────────────────
  const args = ['--verbose', '--output-format', 'stream-json', '--model', modelResult.modelId];

  // All attachments (images + text docs) → temp files → --file flags
  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      if (att.isImage || (att.type && att.type.startsWith('image/'))) {
        const tmpPath = path.join(os.tmpdir(), `guardian-attach-${Date.now()}-${att.name}`);
        fs.writeFileSync(tmpPath, Buffer.from(att.data, 'base64'));
        tempAttachmentFiles.push(tmpPath);
        args.push('--file', tmpPath);
      }
    }
  }

  if (claudeSessionId) {
    args.push('--resume', claudeSessionId);
  }

  log.info('Spawning Claude CLI:', args.slice(0, 5).join(' '), '...');

  let proc;
  try {
    proc = spawn(claudePath, args, {
      cwd: process.cwd(),
      env: ptyEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    // Feed prompt via stdin to avoid arg length limits
    proc.stdin.write(prompt);
    proc.stdin.end();
  } catch (e) {
    log.error('Failed to spawn Claude CLI:', e.message);
    send('guardian:chat:error', { error: `Failed to start Claude: ${e.message}` });
    send('guardian:chat:done', { exitCode: 1 });
    return { ok: false, error: e.message };
  }

  chatProcess = proc;
  let stdoutBuf = '';
  let assistantContent = '';
  let assistantThinking = '';

  // Create placeholder assistant message
  const asstMsgId = database.generateId('m') + '_a';

  proc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.session_id) {
          claudeSessionId = parsed.session_id;
          database.sessions.update(currentSessionId, { claudeSessionId: parsed.session_id });
        }
        // Track content for DB persistence
        if (parsed.type === 'assistant' && parsed.message?.content) {
          for (const block of parsed.message.content) {
            if (block.type === 'text') assistantContent = block.text;
            if (block.type === 'thinking') assistantThinking = block.thinking || '';
          }
        }
        if (parsed.type === 'content_block_delta') {
          if (parsed.delta?.type === 'text_delta') {
            assistantContent += parsed.delta.text;
            telemetry.systemState = 'responding';
          }
          if (parsed.delta?.type === 'thinking_delta') {
            assistantThinking += parsed.delta.thinking;
            telemetry.systemState = 'thinking';
          }
        }
        // Track usage
        if (parsed.type === 'result') {
          const u = parsed.usage || parsed.message?.usage;
          if (u) {
            const thinkingToks = Math.ceil(assistantThinking.length / 4); // estimate
            telemetry.addTokens(u.input_tokens, u.output_tokens, thinkingToks);
            database.usage.append({
              sessionId: currentSessionId,
              inputTokens: u.input_tokens || 0,
              outputTokens: u.output_tokens || 0,
            });
            database.sessions.updateTokens(
              currentSessionId,
              u.input_tokens || 0,
              u.output_tokens || 0
            );
          }
        }
        send('guardian:chat:event', parsed);
      } catch (_) { /* non-JSON line */ }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const err = chunk.toString();
    // Classify error for better UX
    if (err.includes('401') || err.includes('authentication') || err.includes('API key')) {
      send('guardian:chat:error', { error: 'Authentication failed. Check your Claude API key.', type: 'auth' });
    } else if (err.includes('429') || err.includes('rate limit')) {
      send('guardian:chat:error', { error: 'Rate limited. Please wait a moment.', type: 'rate_limit' });
    } else if (err.includes('ENOTFOUND') || err.includes('ECONNREFUSED') || err.includes('network')) {
      send('guardian:chat:error', { error: 'Network error. Check your internet connection.', type: 'network' });
    } else if (err.trim()) {
      send('guardian:chat:error', { error: err.trim(), type: 'unknown' });
    }
  });

  proc.on('close', (code) => {
    // Flush remaining buffer
    if (stdoutBuf.trim()) {
      try {
        const parsed = JSON.parse(stdoutBuf.trim());
        if (parsed.session_id) claudeSessionId = parsed.session_id;
        send('guardian:chat:event', parsed);
      } catch (_) {}
    }

    // Persist assistant message to DB
    if (assistantContent || assistantThinking) {
      database.messages.create({
        id: asstMsgId,
        sessionId: currentSessionId,
        role: 'assistant',
        content: assistantContent,
        thinking: assistantThinking || null,
        timestamp: new Date().toISOString(),
      });
    }

    if (chatProcess === proc) chatProcess = null;
    telemetry.systemState = 'idle';

    // Cleanup temp files
    while (tempAttachmentFiles.length > 0) {
      const tmp = tempAttachmentFiles.pop();
      try { fs.unlinkSync(tmp); } catch (_) {}
    }

    send('guardian:chat:done', { exitCode: code, sessionId: currentSessionId });
    log.info('Chat process exited:', code);

    // ── Post-chat pipeline (sequential queue) ────────────────────
    // Runs each pipeline step one at a time instead of spawning all at once
    if (currentSessionId && code === 0) {
      runPostChatPipeline(currentSessionId);
    }
  });

  return { ok: true, pid: proc.pid, sessionId: currentSessionId, messageId: asstMsgId };
});

ipcMain.handle('guardian:chat:stop', () => {
  if (chatProcess) {
    try { chatProcess.kill(); } catch (_) {}
    chatProcess = null;
  }
  return { ok: true };
});

ipcMain.handle('guardian:chat:newSession', () => {
  // End current session
  if (currentSessionId) {
    database.sessions.update(currentSessionId, { endedAt: new Date().toISOString() });
    metrics.endSession(currentSessionId);
  }
  currentSessionId = null;
  claudeSessionId = null;
  if (chatProcess) {
    try { chatProcess.kill(); } catch (_) {}
    chatProcess = null;
  }
  telemetry.reset();
  telemetry.stopPushing();
  send('guardian:telemetry:state', telemetry.getState());
  return { ok: true };
});

// ── Session Management ──────────────────────────────────────────

ipcMain.handle('guardian:session:list', (event, opts = {}) => {
  try {
    return { ok: true, sessions: database.sessions.list(opts) };
  } catch (e) {
    log.error('Session list failed:', e.message);
    return { ok: false, error: e.message, sessions: [] };
  }
});

ipcMain.handle('guardian:session:get', (event, { id }) => {
  try {
    const session = database.sessions.get(id);
    const messages = database.messages.listBySession(id);
    return { ok: true, session, messages };
  } catch (e) {
    log.error('Session get failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:session:resume', (event, { id }) => {
  try {
    const session = database.sessions.get(id);
    if (!session) return { ok: false, error: 'Session not found' };

    currentSessionId = id;
    claudeSessionId = session.claude_session_id || null;

    const messages = database.messages.listBySession(id);
    return { ok: true, session, messages };
  } catch (e) {
    log.error('Session resume failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:session:delete', (event, { id }) => {
  try {
    database.sessions.delete(id);
    if (currentSessionId === id) {
      currentSessionId = null;
      claudeSessionId = null;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:session:update', (event, { id, updates }) => {
  try {
    database.sessions.update(id, updates);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Session Summarization ────────────────────────────────────────

ipcMain.handle('guardian:session:summarize', (event, { id }) => {
  try {
    const msgs = database.messages.listBySession(id);
    if (!msgs || msgs.length === 0) {
      return { ok: false, error: 'No messages to summarize' };
    }
    summarizeSession({
      sessionId: id,
      messages: msgs,
      onComplete: (sid, summary) => {
        try {
          database.sessions.updateSummary(sid, summary);
          send('guardian:session:summaryReady', { sessionId: sid, summary });
        } catch (e) {
          log.warn('Failed to save summary:', e.message);
        }
      },
      onError: (sid, err) => {
        log.warn('Summarize failed for', sid, ':', err.message);
      },
    });
    return { ok: true };
  } catch (e) {
    log.error('Session summarize failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// ── Notes (SQLite) ──────────────────────────────────────────────

ipcMain.handle('guardian:notes:load', () => {
  try {
    const notes = database.notes.list();
    return { ok: true, notes };
  } catch (e) {
    log.error('Notes load failed:', e.message);
    return { ok: false, error: e.message, notes: [] };
  }
});

ipcMain.handle('guardian:notes:save', (event, { notes }) => {
  // Bulk save — sync all notes from renderer
  try {
    for (const n of notes) {
      const existing = database.notes.get(n.id);
      if (existing) {
        database.notes.update(n.id, {
          title: n.title,
          content: n.content,
          color: n.color,
        });
      } else {
        database.notes.create({
          id: n.id,
          type: n.type || 'scratch',
          title: n.title,
          content: n.content,
          color: n.color,
        });
      }
    }
    return { ok: true };
  } catch (e) {
    log.error('Notes save failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:notes:create', (event, note) => {
  try {
    const id = database.notes.create(note);
    metrics.track.noteCreated(note.type || 'scratch');
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:notes:update', (event, { id, updates }) => {
  try {
    database.notes.update(id, updates);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:notes:delete', (event, { id }) => {
  try {
    database.notes.delete(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:notes:history', (event, { id }) => {
  try {
    const versions = database.notes.listVersions(id);
    return { ok: true, versions };
  } catch (e) {
    return { ok: false, error: e.message, versions: [] };
  }
});

ipcMain.handle('guardian:notes:revert', (event, { id, versionId }) => {
  try {
    const version = database.notes.revert(id, versionId);
    if (!version) return { ok: false, error: 'Version not found' };
    const note = database.notes.get(id);
    return { ok: true, note };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Usage (SQLite) ──────────────────────────────────────────────

ipcMain.handle('guardian:usage:load', () => {
  try {
    const records = database.usage.list({ limit: 500 });
    // Map to renderer format
    const mapped = records.map((r) => ({
      timestamp: r.timestamp,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
    }));
    return { ok: true, records: mapped };
  } catch (e) {
    log.error('Usage load failed:', e.message);
    return { ok: false, error: e.message, records: [] };
  }
});

ipcMain.handle('guardian:usage:append', (event, { record }) => {
  try {
    database.usage.append({
      sessionId: currentSessionId,
      inputTokens: record.inputTokens || 0,
      outputTokens: record.outputTokens || 0,
    });
    return { ok: true };
  } catch (e) {
    log.error('Usage append failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// ── Integration Queue ────────────────────────────────

ipcMain.handle('guardian:queue:list', (event, opts = {}) => {
  try {
    const items = database.queue.list(opts);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: e.message, items: [] };
  }
});

ipcMain.handle('guardian:queue:add', (event, item) => {
  try {
    const id = database.queue.add({
      text: item.text,
      sourceSessionId: currentSessionId || null,
      sourceMessageId: item.sourceMessageId || null,
      priority: item.priority || 0,
    });
    metrics.track.queueItemAdded();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:queue:update', (event, { id, updates }) => {
  try {
    database.queue.update(id, updates);
    if (updates.status === 'resolved') metrics.track.queueItemResolved();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:queue:delete', (event, { id }) => {
  try {
    database.queue.delete(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── ForgeFrame Model Routing ─────────────────────────────────────

ipcMain.handle('guardian:model:get', () => {
  try {
    return {
      ok: true,
      modelId: forgeframe.getSelectedModel(),
      autoRoute: forgeframe.getAutoRoute(),
      models: forgeframe.getModels(),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:model:set', (event, { modelId }) => {
  try {
    forgeframe.setSelectedModel(modelId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:model:list', () => {
  return { ok: true, models: forgeframe.MODELS };
});

ipcMain.handle('guardian:model:autoRoute', (event, { enabled }) => {
  try {
    forgeframe.setAutoRoute(enabled);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Telemetry ───────────────────────────────────────────────────

ipcMain.handle('guardian:telemetry:session', () => {
  return { ok: true, ...telemetry.getState() };
});

// ── Awareness-Trap Detection ─────────────────────────

ipcMain.handle('guardian:awareness:check', () => {
  try {
    const profile = readJSON(FILES.profile, null);
    const detection = awareness.detect(database, currentSessionId, profile);
    return { ok: true, detection };
  } catch (e) {
    log.error('Awareness check failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:awareness:dismiss', (event, { topic }) => {
  try {
    awareness.dismiss(database, topic);
    return { ok: true };
  } catch (e) {
    log.error('Awareness dismiss failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// ── Profile ─────────────────

ipcMain.handle('guardian:profile:get', () => {
  try {
    return { ok: true, profile: readJSON(FILES.profile, null) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:profile:set', (event, { profile }) => {
  try {
    writeJSON(FILES.profile, profile);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Search ──────────────────────────────────────────────────────

ipcMain.handle('guardian:search', (event, { query, scope }) => {
  try {
    metrics.track.searchPerformed('keyword');
    const results = database.search(query, { scope });
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: e.message, results: [] };
  }
});

ipcMain.handle('guardian:search:semantic', (event, { query, limit }) => {
  try {
    metrics.track.searchPerformed('semantic');
    const results = embeddings.search(query, { limit });
    return { ok: true, results };
  } catch (e) {
    log.error('Semantic search failed:', e.message);
    return { ok: false, error: e.message, results: [] };
  }
});

// ── Knowledge Graph ──────────────────────────────────────

ipcMain.handle('guardian:graph:entities', (event, opts = {}) => {
  try {
    const entities = knowledgeGraph.getEntities(database.db(), opts);
    return { ok: true, entities };
  } catch (e) {
    log.error('Graph entities failed:', e.message);
    return { ok: false, error: e.message, entities: [] };
  }
});

ipcMain.handle('guardian:graph:relationships', (event, opts = {}) => {
  try {
    const relationships = knowledgeGraph.getRelationships(database.db(), opts);
    return { ok: true, relationships };
  } catch (e) {
    log.error('Graph relationships failed:', e.message);
    return { ok: false, error: e.message, relationships: [] };
  }
});

ipcMain.handle('guardian:graph:extract', (event, { sessionId }) => {
  try {
    const sid = sessionId || currentSessionId;
    if (!sid) return { ok: false, error: 'No session ID' };

    const msgs = database.messages.listBySession(sid);
    if (!msgs || msgs.length < 2) return { ok: false, error: 'Not enough messages' };

    knowledgeGraph.extractEntities(msgs, {
      onComplete: (entities, relationships) => {
        try {
          const result = knowledgeGraph.mergeExtractionResults(database.db(), entities, relationships, sid);
          log.info('Knowledge graph extraction complete:', result.entityCount, 'entities,', result.relationshipCount, 'relationships');
          send('guardian:graph:extracted', { sessionId: sid, ...result });
        } catch (e) {
          log.error('Knowledge graph merge failed:', e.message);
        }
      },
      onError: (err) => {
        log.warn('Knowledge graph extraction failed:', err.message);
      },
    });
    return { ok: true };
  } catch (e) {
    log.error('Graph extract failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:graph:entitySessions', (event, { entityId }) => {
  try {
    const sessions = knowledgeGraph.getEntitySessions(database.db(), entityId);
    return { ok: true, sessions };
  } catch (e) {
    log.error('Graph entity sessions failed:', e.message);
    return { ok: false, error: e.message, sessions: [] };
  }
});

// ── File Dialogs ────────────────────────────────────────────────

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];

function extractDocxText(filePath) {
  const tmpDir = path.join(os.tmpdir(), 'guardian-docx-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const zipCopy = path.join(tmpDir, 'doc.zip');
    fs.copyFileSync(filePath, zipCopy);
    require('child_process').execSync(
      `powershell -Command "Expand-Archive -Path '${zipCopy}' -DestinationPath '${tmpDir}' -Force"`,
      { stdio: 'pipe' }
    );
    const docXmlPath = path.join(tmpDir, 'word', 'document.xml');
    if (!fs.existsSync(docXmlPath)) return '[Could not extract text from .docx]';
    const xml = fs.readFileSync(docXmlPath, 'utf-8');
    return xml
      .replace(/<w:p[ >]/g, '\n<w:p ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch (e) {
    return `[Error reading .docx: ${e.message}]`;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function extractPdfText(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const raw = buf.toString('latin1');
    const textBlocks = [];
    const regex = /BT[\s\S]*?ET/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      const strRegex = /\(([^)]*)\)/g;
      let strMatch;
      while ((strMatch = strRegex.exec(match[0])) !== null) {
        if (strMatch[1].trim()) textBlocks.push(strMatch[1]);
      }
    }
    if (textBlocks.length > 0) {
      return textBlocks.join(' ')
        .replace(/\\n/g, '\n').replace(/\\r/g, '')
        .replace(/\s{3,}/g, '\n\n').trim();
    }
    return '[PDF uses compressed streams. Attach the .docx version instead.]';
  } catch (e) {
    return `[Error reading .pdf: ${e.message}]`;
  }
}

ipcMain.handle('guardian:file:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Documents', extensions: ['txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'py', 'css', 'html', 'yml', 'yaml', 'toml', 'docx', 'pdf'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

  const files = [];
  for (const filePath of result.filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath);
    if (IMAGE_EXTENSIONS.includes(ext)) {
      const raw = fs.readFileSync(filePath);
      const base64 = raw.toString('base64');
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      files.push({ name, type: mimeMap[ext] || 'image/png', data: base64, isImage: true, preview: `data:${mimeMap[ext] || 'image/png'};base64,${base64}` });
    } else if (ext === '.docx') {
      files.push({ name, type: 'text/plain', data: extractDocxText(filePath), isImage: false });
    } else if (ext === '.pdf') {
      files.push({ name, type: 'text/plain', data: extractPdfText(filePath), isImage: false });
    } else {
      files.push({ name, type: 'text/plain', data: fs.readFileSync(filePath, 'utf-8'), isImage: false });
    }
  }
  return { ok: true, files };
});

ipcMain.handle('guardian:file:save', async (event, { defaultName, content }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'untitled.txt',
    filters: [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return { ok: true, filePath: result.filePath };
});

// ── Config ──────────────────────────────────────────────────────

ipcMain.handle('guardian:config:get', (event, { key }) => {
  try {
    const settings = readJSON(FILES.settings, {});
    return { ok: true, value: key ? settings[key] : settings };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:config:set', (event, { key, value }) => {
  try {
    const settings = readJSON(FILES.settings, {});
    settings[key] = value;
    writeJSON(FILES.settings, settings);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:config:layout:get', () => {
  return { ok: true, layout: readJSON(FILES.layout, {}) };
});

ipcMain.handle('guardian:config:layout:set', (event, { layout }) => {
  try {
    writeJSON(FILES.layout, layout);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Welcome Session (First-Run Experience, Spec VI Step 4) ──────

ipcMain.handle('guardian:welcome:init', () => {
  try {
    // Create starter scratch note: brief tip about the three note types
    const noteId = database.generateId('welcome');
    database.notes.create({
      id: noteId,
      type: 'scratch',
      title: 'Note types in Guardian',
      content: 'Guardian has three note types:\n\n- **Scratch** — quick capture, no formatting needed, stream of consciousness welcome\n- **Structured** — titled, organized, persistent (design docs, reference material, decision logs)\n- **Journal** — date-stamped reflections, one entry per day\n\nScratch notes can be promoted to structured notes or journal entries as they evolve.',
    });

    // Create one integration queue item
    database.queue.add({
      text: "Explore Guardian's keyboard shortcuts (Ctrl+Shift+P for command palette)",
      priority: 0,
    });

    log.info('Welcome session initialized: starter note + queue item created');
    return { ok: true };
  } catch (e) {
    log.error('Welcome init failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// ── Backup System ───────────────────────────────────────────────

ipcMain.handle('guardian:backup:create', async () => {
  try {
    const result = await backup.createBackup();
    if (result.ok) metrics.track.backupCreated();
    return result;
  } catch (e) {
    log.error('Backup create failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:backup:list', () => {
  try {
    const backups = backup.listBackups();
    return { ok: true, backups };
  } catch (e) {
    log.error('Backup list failed:', e.message);
    return { ok: false, error: e.message, backups: [] };
  }
});

ipcMain.handle('guardian:backup:restore', async (event, { backupPath }) => {
  try {
    // If no path provided, open file dialog
    let filePath = backupPath;
    if (!filePath) {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
          { name: 'Guardian Backups', extensions: ['zip', 'gz'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }
      filePath = result.filePaths[0];
    }
    const restoreResult = await backup.restoreBackup(filePath);
    return restoreResult;
  } catch (e) {
    log.error('Backup restore failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// ── Export System ────────────────────────────────────────────────

ipcMain.handle('guardian:export:session', async (event, { sessionId, format }) => {
  try {
    const session = database.sessions.get(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };
    const messages = database.messages.listBySession(sessionId);

    let content, defaultName;
    if (format === 'json') {
      content = exporter.exportSessionAsJSON(session, messages);
      defaultName = `${(session.title || 'session').replace(/[<>:"/\\|?*]/g, '_')}.json`;
    } else {
      content = exporter.exportSessionAsMarkdown(session, messages);
      defaultName = `${(session.title || 'session').replace(/[<>:"/\\|?*]/g, '_')}.md`;
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: format === 'json'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: 'Markdown', extensions: ['md'] }],
    });

    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, content, 'utf-8');
    log.info('Exported session to:', result.filePath);
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    log.error('Export session failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:export:note', async (event, { noteId, format }) => {
  try {
    const note = database.notes.get(noteId);
    if (!note) return { ok: false, error: 'Note not found' };
    if (note.sensitivity === 'sovereign') return { ok: false, error: 'Sovereign notes cannot be exported' };

    let content, defaultName;
    if (format === 'json') {
      content = exporter.exportNoteAsJSON(note);
      defaultName = `${(note.title || 'note').replace(/[<>:"/\\|?*]/g, '_')}.json`;
    } else {
      content = exporter.exportNoteAsMarkdown(note);
      defaultName = `${(note.title || 'note').replace(/[<>:"/\\|?*]/g, '_')}.md`;
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: format === 'json'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: 'Markdown', extensions: ['md'] }],
    });

    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, content, 'utf-8');
    log.info('Exported note to:', result.filePath);
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    log.error('Export note failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:export:allNotes', async (event, { format }) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose export directory',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const outputDir = result.filePaths[0];
    const notes = database.notes.list()
      .filter((n) => n.sensitivity !== 'sovereign');

    if (format === 'json') {
      const content = exporter.exportFullDataAsJSON(database, { excludeSovereign: true });
      const filePath = path.join(outputDir, 'guardian-export.json');
      fs.writeFileSync(filePath, content, 'utf-8');
      log.info('Full JSON export to:', filePath);
      return { ok: true, filePath };
    } else {
      const exportResult = exporter.exportAllNotesAsMarkdown(notes, outputDir);
      return exportResult;
    }
  } catch (e) {
    log.error('Export all notes failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:export:fullData', async () => {
  try {
    const content = exporter.exportFullDataAsJSON(database, { excludeSovereign: true });
    const defaultName = `guardian-full-export-${new Date().toISOString().slice(0, 10)}.json`;

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, content, 'utf-8');
    log.info('Full data export to:', result.filePath);
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    log.error('Full data export failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// ── Import System ───────────────────────────────────────────────

ipcMain.handle('guardian:import:markdown', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const importResult = importer.importMarkdownFiles(result.filePaths);

    // Persist imported notes to database
    for (const note of importResult.imported) {
      database.notes.create({
        id: note.id,
        type: note.type,
        title: note.title,
        content: note.content,
        tags: note.tags,
      });
    }

    log.info('Imported', importResult.imported.length, 'markdown files');
    return {
      ok: true,
      importedCount: importResult.imported.length,
      errorCount: importResult.errors.length,
      errors: importResult.errors,
    };
  } catch (e) {
    log.error('Markdown import failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:import:obsidian', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Obsidian vault folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const importResult = importer.importObsidianVault(result.filePaths[0]);

    // Persist imported notes to database
    for (const note of importResult.imported) {
      database.notes.create({
        id: note.id,
        type: note.type,
        title: note.title,
        content: note.content,
        tags: note.tags,
      });
    }

    log.info('Imported Obsidian vault:', importResult.imported.length, 'notes');
    return {
      ok: true,
      importedCount: importResult.imported.length,
      errorCount: importResult.errors.length,
      errors: importResult.errors,
    };
  } catch (e) {
    log.error('Obsidian import failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// ── Conversation Import (ChatGPT / Claude exports) ──────────────

ipcMain.handle('guardian:import:conversations:selectFile', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Conversation Exports', extensions: ['json', 'zip'] },
      ],
      title: 'Select ChatGPT or Claude export file',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    return { ok: true, filePath: result.filePaths[0] };
  } catch (e) {
    log.error('Conversation import selectFile failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:import:conversations:validate', (event, { filePath }) => {
  try {
    const result = importParser.validateFile(filePath);
    return { ok: result.ok, ...result };
  } catch (e) {
    log.error('Conversation import validate failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:import:conversations:start', (event, { filePath }) => {
  try {
    // Parse the file
    const parsed = importParser.parseFile(filePath);
    if (parsed.conversations.length === 0) {
      return { ok: false, error: 'No conversations found in file', parseErrors: parsed.errors };
    }

    // Create import batch
    const stat = fs.statSync(filePath);
    const batchId = database.importBatches.create({
      source: parsed.conversations[0].source,
      fileName: path.basename(filePath),
      fileSize: stat.size,
      totalConversations: parsed.conversations.length,
      status: 'pending',
    });

    // Start async import
    importWorker.startImport({
      conversations: parsed.conversations,
      batchId,
      database,
      embeddings,
      onProgress: (progress) => {
        send('guardian:import:conversations:progress', progress);
      },
      onComplete: ({ batchId: bid, stats }) => {
        log.info('Conversation import complete:', bid, stats);
        send('guardian:import:conversations:progress', {
          phase: 'complete', current: stats.imported + stats.skipped, total: parsed.conversations.length, batchId: bid, percent: 100,
        });
      },
      onError: ({ batchId: bid, error }) => {
        log.error('Conversation import failed:', bid, error);
      },
    });

    return { ok: true, batchId, totalConversations: parsed.conversations.length, parseErrors: parsed.errors };
  } catch (e) {
    log.error('Conversation import start failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:import:conversations:cancel', (event, { batchId }) => {
  try {
    const cancelled = importWorker.cancelImport(batchId);
    return { ok: true, cancelled };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:import:conversations:status', (event, { batchId }) => {
  try {
    // Check in-memory state first (active import)
    const liveStatus = importWorker.getImportStatus(batchId);
    if (liveStatus) {
      return { ok: true, ...liveStatus };
    }
    // Fall back to DB record
    const batch = database.importBatches.get(batchId);
    if (!batch) return { ok: false, error: 'Batch not found' };
    return {
      ok: true,
      status: batch.status,
      progress: {
        phase: batch.status === 'complete' ? 'complete' : batch.status,
        current: batch.imported_conversations || 0,
        total: batch.total_conversations || 0,
        percent: batch.status === 'complete' ? 100 : 0,
      },
      stats: {
        imported: batch.imported_conversations || 0,
        skipped: batch.skipped_conversations || 0,
        errors: 0,
      },
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:import:conversations:batches', () => {
  try {
    const batches = database.importBatches.list();
    return { ok: true, batches };
  } catch (e) {
    log.error('Conversation import batches list failed:', e.message);
    return { ok: false, error: e.message, batches: [] };
  }
});

// ── Journal Export (ChatGPT / Claude → Markdown + Training JSONL) ──

ipcMain.handle('guardian:import:conversations:exportJournal', async (event, { filePath }) => {
  try {
    // Parse the file (same parser used by import)
    const parsed = importParser.parseFile(filePath);
    if (parsed.conversations.length === 0) {
      return { ok: false, error: 'No conversations found in file', parseErrors: parsed.errors };
    }

    // Let user pick output directory
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose journal output folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const outputDir = path.join(result.filePaths[0], 'journal');
    const writeResult = journalExporter.writeJournal(parsed.conversations, outputDir);

    return {
      ok: writeResult.ok,
      files: writeResult.files,
      stats: writeResult.stats,
      parseErrors: parsed.errors,
      error: writeResult.error || null,
    };
  } catch (e) {
    log.error('Journal export failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:import:conversations:exportJournalAuto', (event, { filePath, outputDir }) => {
  try {
    const parsed = importParser.parseFile(filePath);
    if (parsed.conversations.length === 0) {
      return { ok: false, error: 'No conversations found in file' };
    }

    const writeResult = journalExporter.writeJournal(parsed.conversations, outputDir);
    return {
      ok: writeResult.ok,
      files: writeResult.files,
      stats: writeResult.stats,
      error: writeResult.error || null,
    };
  } catch (e) {
    log.error('Journal auto-export failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:import:backup', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Guardian Backups', extensions: ['zip', 'gz'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const restoreResult = await importer.importBackup(result.filePaths[0]);
    log.info('Backup import result:', restoreResult);
    return restoreResult;
  } catch (e) {
    log.error('Backup import failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// ── Auto-Update IPC ──────────────────────────────────────────────

ipcMain.handle('guardian:update:check', () => {
  if (!app.isPackaged) {
    return { ok: false, error: 'Updates only available in packaged builds' };
  }
  autoUpdater.checkForUpdates();
  return { ok: true };
});

ipcMain.handle('guardian:update:install', () => {
  if (autoUpdater) autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

// ── Usage Metrics (analytics-free, local-only) ──────────────────

ipcMain.handle('guardian:metrics:get', () => {
  try {
    const featureUsage = metrics.getAll();
    const sessionStats = metrics.getSessionStats();
    return { ok: true, featureUsage, sessionStats };
  } catch (e) {
    log.error('Metrics get failed:', e.message);
    return { ok: false, error: e.message, featureUsage: [], sessionStats: {} };
  }
});

ipcMain.handle('guardian:metrics:export', () => {
  try {
    const data = metrics.exportAnonymized();
    return { ok: true, data };
  } catch (e) {
    log.error('Metrics export failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:metrics:track', (event, { feature }) => {
  try {
    metrics.increment(feature);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── System Info ─────────────────────────────────────────────────

ipcMain.handle('guardian:system:info', () => ({
  platform: os.platform(),
  homedir: os.homedir(),
  shell: defaultShell,
  nodeVersion: process.versions.node,
  electronVersion: process.versions.electron,
  claudeAvailable: isClaudeAvailable(),
  guardianHome: require('./lib/paths').GUARDIAN_HOME,
  appVersion: app.getVersion(),
  performance: perf.getMemorySnapshot(),
}));

// ── Performance Profiling ─────────────────────────────────────────

ipcMain.handle('guardian:perf:snapshot', () => {
  return { ok: true, memory: perf.getMemorySnapshot() };
});

ipcMain.handle('guardian:perf:mark', (event, { name }) => {
  perf.mark(name);
  return { ok: true };
});

ipcMain.handle('guardian:perf:logRenderer', (event, { name, data }) => {
  perf.logRendererMetric(name, data);
  return { ok: true };
});

// ── Librarian (Auto-Extraction) ──────────────────────────────────

ipcMain.handle('guardian:librarian:rerun', (event, { sessionId }) => {
  try {
    const sid = sessionId || currentSessionId;
    if (!sid) return { ok: false, error: 'No session ID' };

    const msgs = database.messages.listBySession(sid);
    if (!msgs || msgs.length < 2) return { ok: false, error: 'Not enough messages' };

    send('guardian:librarian:status', { sessionId: sid, status: 'running' });
    librarian.runPipeline({
      sessionId: sid,
      messages: msgs,
      db: database,
      onComplete: (result) => {
        log.info('Librarian rerun complete for', sid);
        send('guardian:librarian:complete', { sessionId: sid, ...result });
      },
      onError: (err) => {
        log.warn('Librarian rerun failed for', sid, ':', err.message);
        send('guardian:librarian:status', { sessionId: sid, status: 'error', error: err.message });
      },
    });
    return { ok: true };
  } catch (e) {
    log.error('Librarian rerun failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// ── Queue Stats (Grounding Layer) ────────────────────────────────

ipcMain.handle('guardian:queue:stats', () => {
  try {
    const stats = database.queue.stats();
    return { ok: true, ...stats };
  } catch (e) {
    log.error('Queue stats failed:', e.message);
    return { ok: false, error: e.message, groundingRate: 0, avgLatencyDays: 0 };
  }
});

// ── Compression Memory (Hierarchical) ────────────────────────────

ipcMain.handle('guardian:compression:list', (event, { level }) => {
  try {
    const items = database.compression.listByLevel(level);
    return { ok: true, items };
  } catch (e) {
    log.error('Compression list failed:', e.message);
    return { ok: false, error: e.message, items: [] };
  }
});

ipcMain.handle('guardian:compression:update', (event, { id, updates }) => {
  try {
    database.compression.update(id, updates);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:compression:stats', () => {
  try {
    const counts = database.compression.levelCounts();
    return { ok: true, ...counts };
  } catch (e) {
    log.error('Compression stats failed:', e.message);
    return { ok: false, error: e.message, l0: 0, l1: 0, l2: 0, l3: 0 };
  }
});

ipcMain.handle('guardian:compression:run', (event, { level }) => {
  try {
    const compression = require('./lib/compression');
    if (level === 2) {
      compression.extractPatterns(database, {
        onComplete: (items) => {
          log.info('Manual L2 extraction complete:', items.length);
          send('guardian:compression:complete', { level: 2, count: items.length });
        },
        onError: (err) => {
          log.warn('Manual L2 extraction failed:', err.message);
          send('guardian:compression:complete', { level: 2, count: 0, error: err.message });
        },
      });
    } else if (level === 3) {
      compression.distillPrinciples(database, {
        onComplete: (items) => {
          log.info('Manual L3 distillation complete:', items.length);
          send('guardian:compression:complete', { level: 3, count: items.length });
        },
        onError: (err) => {
          log.warn('Manual L3 distillation failed:', err.message);
          send('guardian:compression:complete', { level: 3, count: 0, error: err.message });
        },
      });
    }
    return { ok: true };
  } catch (e) {
    log.error('Compression run failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// ── Perlocutionary Audit (Reframe Detection) ────────────────────

ipcMain.handle('guardian:reframe:list', (event, filters) => {
  try {
    const events = database.reframe.list(filters || {});
    return { ok: true, events };
  } catch (e) {
    log.error('Reframe list failed:', e.message);
    return { ok: false, error: e.message, events: [] };
  }
});

ipcMain.handle('guardian:reframe:rate', (event, { id, accurate }) => {
  try {
    database.reframe.rate(id, accurate);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:reframe:acknowledge', (event, { id }) => {
  try {
    database.reframe.acknowledge(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:reframe:acknowledgeAll', () => {
  try {
    database.reframe.acknowledgeAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:reframe:stats', () => {
  try {
    const stats = database.reframe.stats();
    return { ok: true, ...stats };
  } catch (e) {
    log.error('Reframe stats failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:reframe:drift', (event, { days }) => {
  try {
    const score = database.reframe.getDriftScore(days || 30);
    return { ok: true, score };
  } catch (e) {
    log.error('Reframe drift failed:', e.message);
    return { ok: false, error: e.message, score: null };
  }
});

// ── Reflections (Self-Exploration) ──────────────────────────────

ipcMain.handle('guardian:reflections:ingest', async (event, { zipPath }) => {
  try {
    const db = database.db();
    const result = reflections.ingestExport(db, zipPath);
    return { ok: true, ...result };
  } catch (e) {
    log.error('Reflections ingest failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:reflections:search', (event, opts) => {
  try {
    const db = database.db();
    const results = reflections.search(db, opts);
    return { ok: true, results };
  } catch (e) {
    log.error('Reflections search failed:', e.message);
    return { ok: false, error: e.message, results: [] };
  }
});

ipcMain.handle('guardian:reflections:conversation', (event, { id }) => {
  try {
    const db = database.db();
    const conversation = reflections.getConversation(db, id);
    if (!conversation) return { ok: false, error: 'Conversation not found' };
    return { ok: true, conversation };
  } catch (e) {
    log.error('Reflections conversation failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:reflections:conversations', (event, opts) => {
  try {
    const db = database.db();
    const result = reflections.listConversations(db, opts);
    return { ok: true, ...result };
  } catch (e) {
    log.error('Reflections conversations list failed:', e.message);
    return { ok: false, error: e.message, conversations: [], total: 0 };
  }
});

ipcMain.handle('guardian:reflections:stats', () => {
  try {
    const db = database.db();
    const stats = reflections.getStats(db);
    return { ok: true, stats };
  } catch (e) {
    log.error('Reflections stats failed:', e.message);
    return { ok: false, error: e.message, stats: null };
  }
});

ipcMain.handle('guardian:reflections:semantic', async (event, opts) => {
  try {
    const db = database.db();
    const results = await reflections.semanticSearch(db, opts);
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: e.message, results: [] };
  }
});

ipcMain.handle('guardian:reflections:embed', async () => {
  try {
    const db = database.db();
    await reflections.embedAll(db, {
      onProgress: (progress) => send('guardian:reflections:embedProgress', progress),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:reflections:analyze', async (event, opts) => {
  try {
    const db = database.db();
    const result = await reflections.analyze(db, opts);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Identity Dimensions ─────────────────────────────────────────

ipcMain.handle('guardian:dimensions:scores', (event, { days }) => {
  try {
    const identityDimensions = require('./lib/identity-dimensions');
    const result = identityDimensions.computeDimensionScores(database, days || 30);
    return { ok: true, ...result };
  } catch (e) {
    log.error('Dimension scores failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:dimensions:timeline', (event, { weeks }) => {
  try {
    const identityDimensions = require('./lib/identity-dimensions');
    const result = identityDimensions.computeDimensionTimeline(database, weeks || 12);
    return { ok: true, timeline: result };
  } catch (e) {
    log.error('Dimension timeline failed:', e.message);
    return { ok: false, error: e.message, timeline: [] };
  }
});

// ── Sovereign Layer ──────────────────────────────────────────────

const SOVEREIGN_TABLES = ['notes', 'queue_items', 'compression_levels', 'reframe_events'];
const SOVEREIGN_LEVELS = ['surface', 'deep', 'sovereign'];

ipcMain.handle('guardian:sovereign:setSensitivity', (event, { table, id, sensitivity }) => {
  try {
    if (!SOVEREIGN_TABLES.includes(table)) {
      return { ok: false, error: `Invalid table: ${table}` };
    }
    if (!SOVEREIGN_LEVELS.includes(sensitivity)) {
      return { ok: false, error: `Invalid sensitivity: ${sensitivity}` };
    }
    database.db().prepare(`UPDATE ${table} SET sensitivity = ? WHERE id = ?`).run(sensitivity, id);
    return { ok: true };
  } catch (e) {
    log.error('Set sensitivity failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:sovereign:getSensitivity', (event, { table, id }) => {
  try {
    if (!SOVEREIGN_TABLES.includes(table)) {
      return { ok: false, error: `Invalid table: ${table}` };
    }
    const row = database.db().prepare(`SELECT sensitivity FROM ${table} WHERE id = ?`).get(id);
    return { ok: true, sensitivity: row ? (row.sensitivity || 'surface') : 'surface' };
  } catch (e) {
    log.error('Get sensitivity failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// ── Multi-Provider Management ────────────────────────────────────

ipcMain.handle('guardian:providers:list', () => {
  try {
    const available = providers.registry.listAvailable();
    return { ok: true, providers: available };
  } catch (e) {
    log.error('Providers list failed:', e.message);
    return { ok: false, error: e.message, providers: [] };
  }
});

ipcMain.handle('guardian:providers:add', (event, { type, config }) => {
  try {
    let provider;
    switch (type) {
      case 'anthropic':
        provider = new providers.AnthropicAPIProvider(config || {});
        break;
      case 'openai':
        provider = new providers.OpenAIProvider(config || {});
        break;
      case 'moonshot':
        provider = new providers.MoonshotProvider(config || {});
        break;
      default:
        return { ok: false, error: `Unknown provider type: ${type}` };
    }
    providers.registry.register(type, provider);
    return { ok: true };
  } catch (e) {
    log.error('Provider add failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:providers:remove', (event, { id }) => {
  try {
    const reg = providers.registry;
    const existing = reg.getProvider(id);
    if (!existing) return { ok: false, error: `Provider not found: ${id}` };
    // Remove by re-registering without it (registry doesn't have delete, so we flag it)
    reg._providers.delete(id);
    log.info('Provider removed:', id);
    return { ok: true };
  } catch (e) {
    log.error('Provider remove failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:providers:test', (event, { id }) => {
  try {
    const provider = providers.registry.getProvider(id);
    if (!provider) return { ok: false, error: `Provider not found: ${id}` };
    const available = provider.isAvailable();
    return { ok: true, available, name: provider.name, type: provider.type };
  } catch (e) {
    log.error('Provider test failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:providers:models', (event, { id }) => {
  try {
    // Return known models per provider type
    const modelsByType = {
      'claude-cli': [
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
        { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
      ],
      'anthropic': [
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
        { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
      ],
      'openai': [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'o1', name: 'o1' },
        { id: 'o1-mini', name: 'o1 Mini' },
      ],
      'moonshot': [
        { id: 'kimi-k2', name: 'Kimi K2' },
      ],
    };
    const models = modelsByType[id] || [];
    return { ok: true, models };
  } catch (e) {
    log.error('Provider models failed:', e.message);
    return { ok: false, error: e.message, models: [] };
  }
});

// ── Secure API Key Management ────────────────────────────────────

ipcMain.handle('guardian:keys:set', (event, { provider, key }) => {
  try {
    secureStore.setKey(provider, key);
    return { ok: true };
  } catch (e) {
    log.error('Key set failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:keys:delete', (event, { provider }) => {
  try {
    const removed = secureStore.deleteKey(provider);
    return { ok: true, removed };
  } catch (e) {
    log.error('Key delete failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('guardian:keys:list', () => {
  try {
    const providerNames = secureStore.listProviders();
    return { ok: true, providers: providerNames };
  } catch (e) {
    log.error('Key list failed:', e.message);
    return { ok: false, error: e.message, providers: [] };
  }
});

ipcMain.handle('guardian:keys:test', (event, { provider: providerType }) => {
  try {
    const key = secureStore.getKey(providerType);
    if (!key) return { ok: false, error: `No key stored for ${providerType}` };
    // Check if the provider exists and reports available
    const providerInstance = providers.registry.getProvider(providerType);
    if (providerInstance) {
      return { ok: true, available: providerInstance.isAvailable(), provider: providerType };
    }
    // No provider registered, but key exists
    return { ok: true, available: true, provider: providerType, note: 'Key exists but provider not registered' };
  } catch (e) {
    log.error('Key test failed:', e.message);
    return { ok: false, error: e.message };
  }
});

// ══════════════════════════════════════════════════════════════════
// APP LIFECYCLE
// ══════════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  perf.mark('app:ready');
  log.info('Guardian starting');

  // Initialize directory structure
  initDirectories();
  perf.mark('dirs:initialized');
  log.info('Directories initialized');

  // Open databases & run migrations
  database.open();
  database.migrateFromJSON(__dirname);
  terminalHistory.open();
  embeddings.init(database);
  metrics.init(database);
  secureStore.init();
  forgeframe.loadProviderModels(database.db());
  perf.mark('databases:ready');
  log.info('Databases ready');

  // Hourly decay for compression memory strength
  setInterval(() => {
    try {
      database.compression.applyDecay();
      log.info('Compression memory decay applied');
    } catch (e) {
      log.warn('Compression decay failed:', e.message);
    }
  }, 3600000);

  // Auto-backup check (async, never blocks startup)
  backup.checkAutoBackup().then((didBackup) => {
    if (didBackup) log.info('Auto-backup completed on startup');
  }).catch((e) => {
    log.warn('Auto-backup check failed:', e.message);
  });

  createWindow();
  perf.mark('window:created');

  // Log initial memory snapshot and start periodic sampling (60s)
  perf.logMemory('startup');
  perf.startMemorySampling(60000);

  // Auto-update: setup listeners and check (only in packaged builds)
  setupAutoUpdater();
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater && autoUpdater.checkForUpdates().catch((err) => {
        log.warn('Auto-update check failed:', err.message);
      });
    }, 5000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  telemetry.stopPushing();
  // End current session
  if (currentSessionId) {
    try {
      metrics.endSession(currentSessionId);
      database.sessions.update(currentSessionId, { endedAt: new Date().toISOString() });
    } catch (_) {}
  }
  terminalHistory.close();
  perf.logMemory('shutdown');
  perf.close();
  database.close();
  log.close();
});
