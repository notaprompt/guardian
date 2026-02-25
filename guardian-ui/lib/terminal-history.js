/**
 * Guardian — Terminal History Database
 *
 * Separate SQLite database for terminal I/O capture.
 * Stored at ~/.guardian/data/terminal_history.db
 *
 * Design principles:
 * - Separate DB to avoid bloating the main guardian.db with high-volume PTY data
 * - Buffered writes with debounce to keep capture lightweight
 * - FTS5 for full-text search across command history
 * - Per-pane tracking (works with split terminals — each pane has its own ID)
 */

const Database = require('better-sqlite3');
const path = require('path');
const { DIRS } = require('./paths');
const log = require('./logger');
const { generateId } = require('./database');

let _db = null;

// ── Buffering ───────────────────────────────────────────────
// Buffer PTY output per terminal, flush on command boundaries or timer

const _outputBuffers = new Map();   // terminalId -> { chunks: string, lastWrite: number, timer: null }
const FLUSH_INTERVAL_MS = 3000;     // Flush buffered output every 3s
const MAX_OUTPUT_LENGTH = 50000;    // Truncate stored output per command at 50KB

// ── Initialization ──────────────────────────────────────────

function open() {
  if (_db) return _db;

  const dbPath = path.join(DIRS.data, 'terminal_history.db');
  log.info('Opening terminal history DB at', dbPath);
  _db = new Database(dbPath);

  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');

  _createSchema();
  return _db;
}

function close() {
  // Flush all pending buffers before closing
  for (const [terminalId] of _outputBuffers) {
    _flushBuffer(terminalId);
  }
  if (_db) {
    log.info('Closing terminal history DB');
    _db.close();
    _db = null;
  }
}

function db() {
  if (!_db) open();
  return _db;
}

// ── Schema ──────────────────────────────────────────────────

function _createSchema() {
  _db.exec(`
    -- Terminal commands: each row is a captured command + its output
    CREATE TABLE IF NOT EXISTS terminal_commands (
      id TEXT PRIMARY KEY,
      terminal_id TEXT NOT NULL,
      input TEXT DEFAULT '',
      output TEXT DEFAULT '',
      cwd TEXT DEFAULT '',
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tc_terminal ON terminal_commands(terminal_id);
    CREATE INDEX IF NOT EXISTS idx_tc_timestamp ON terminal_commands(timestamp DESC);

    -- Terminal snapshots: viewport captures via Ctrl+Shift+S
    CREATE TABLE IF NOT EXISTS terminal_snapshots (
      id TEXT PRIMARY KEY,
      terminal_id TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ts_timestamp ON terminal_snapshots(timestamp DESC);

    -- Full-text search across commands and output
    CREATE VIRTUAL TABLE IF NOT EXISTS terminal_fts USING fts5(
      input, output,
      content=terminal_commands,
      content_rowid=rowid
    );
  `);

  log.info('Terminal history schema ready');
}

// ── Output Buffering ────────────────────────────────────────

function _getBuffer(terminalId) {
  if (!_outputBuffers.has(terminalId)) {
    _outputBuffers.set(terminalId, {
      chunks: '',
      lastWrite: Date.now(),
      timer: null,
      currentInput: '',
    });
  }
  return _outputBuffers.get(terminalId);
}

function _flushBuffer(terminalId) {
  const buf = _outputBuffers.get(terminalId);
  if (!buf || !buf.chunks) return;

  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }

  // Store the buffered output as a command record
  try {
    const output = buf.chunks.length > MAX_OUTPUT_LENGTH
      ? buf.chunks.slice(-MAX_OUTPUT_LENGTH)
      : buf.chunks;

    const id = generateId('tc');
    db().prepare(`
      INSERT INTO terminal_commands (id, terminal_id, input, output, cwd, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      terminalId,
      buf.currentInput || '',
      output,
      '',
      new Date().toISOString()
    );

    // Update FTS
    try {
      db().prepare(`
        INSERT INTO terminal_fts(rowid, input, output)
        VALUES ((SELECT rowid FROM terminal_commands WHERE id = ?), ?, ?)
      `).run(id, buf.currentInput || '', output);
    } catch (_) { /* FTS best-effort */ }
  } catch (e) {
    log.error('Terminal history flush failed:', e.message);
  }

  buf.chunks = '';
  buf.currentInput = '';
  buf.lastWrite = Date.now();
}

/**
 * Called on every PTY data event. Buffers output and flushes
 * on command boundaries (newlines after prompts) or on timer.
 */
function captureOutput(terminalId, data) {
  if (!_db) return;

  const buf = _getBuffer(terminalId);
  buf.chunks += data;

  // Reset debounce timer
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => _flushBuffer(terminalId), FLUSH_INTERVAL_MS);
}

/**
 * Called when input is written to PTY. Detects command boundaries
 * (Enter key = \r) and flushes the previous command's output.
 */
function captureInput(terminalId, data) {
  if (!_db) return;

  const buf = _getBuffer(terminalId);

  // Detect Enter key — signals end of a command input
  if (data.includes('\r') || data.includes('\n')) {
    // Flush previous command output before starting new command capture
    if (buf.chunks.length > 0) {
      _flushBuffer(terminalId);
    }
    // Store the input line (strip control chars for readability)
    const cleaned = data.replace(/[\r\n]/g, '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    if (cleaned.trim()) {
      buf.currentInput = cleaned.trim();
    }
  } else {
    // Accumulate partial input (typing characters before Enter)
    const cleaned = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x1f]/g, '');
    buf.currentInput = (buf.currentInput || '') + cleaned;
  }
}

/**
 * Clean up buffers when a terminal pane is destroyed.
 */
function removeTerminal(terminalId) {
  _flushBuffer(terminalId);
  _outputBuffers.delete(terminalId);
}

// ── Snapshot ────────────────────────────────────────────────

/**
 * Save a snapshot of the terminal viewport content.
 * Called via Ctrl+Shift+S from the renderer.
 */
function saveSnapshot(terminalId, content) {
  const id = generateId('snap');
  try {
    db().prepare(`
      INSERT INTO terminal_snapshots (id, terminal_id, content, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(id, terminalId, content, new Date().toISOString());
    return { ok: true, id };
  } catch (e) {
    log.error('Snapshot save failed:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── Search ──────────────────────────────────────────────────

/**
 * Full-text search across terminal commands and output.
 */
function search(query, opts = {}) {
  const ftsQuery = query
    .replace(/['"]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w}"`)
    .join(' ');

  if (!ftsQuery) return [];

  try {
    let sql = `
      SELECT tc.id, tc.terminal_id, tc.input, tc.output, tc.cwd, tc.timestamp
      FROM terminal_fts fts
      JOIN terminal_commands tc ON tc.rowid = fts.rowid
      WHERE terminal_fts MATCH ?
      ORDER BY tc.timestamp DESC
      LIMIT ?
    `;
    const limit = opts.limit || 50;
    return db().prepare(sql).all(ftsQuery, limit);
  } catch (e) {
    log.error('Terminal history search failed:', e.message);
    return [];
  }
}

/**
 * Get recent commands for a specific terminal or all terminals.
 */
function recentCommands(opts = {}) {
  let sql = 'SELECT * FROM terminal_commands';
  const params = [];
  const where = [];

  if (opts.terminalId) {
    where.push('terminal_id = ?');
    params.push(opts.terminalId);
  }
  if (opts.inputOnly) {
    where.push("input != ''");
  }

  if (where.length > 0) {
    sql += ' WHERE ' + where.join(' AND ');
  }
  sql += ' ORDER BY timestamp DESC';

  const limit = opts.limit || 100;
  sql += ' LIMIT ?';
  params.push(limit);

  try {
    return db().prepare(sql).all(...params);
  } catch (e) {
    log.error('Terminal recent commands failed:', e.message);
    return [];
  }
}

/**
 * Get recent snapshots.
 */
function recentSnapshots(opts = {}) {
  const limit = opts.limit || 20;
  try {
    return db().prepare(
      'SELECT * FROM terminal_snapshots ORDER BY timestamp DESC LIMIT ?'
    ).all(limit);
  } catch (e) {
    return [];
  }
}

module.exports = {
  open,
  close,
  db,
  captureOutput,
  captureInput,
  removeTerminal,
  saveSnapshot,
  search,
  recentCommands,
  recentSnapshots,
};
