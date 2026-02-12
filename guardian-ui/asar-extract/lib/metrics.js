/**
 * Guardian — Analytics-Free Usage Metrics
 *
 * Local-only feature usage counters. No PII, no content, no network calls.
 * Tracks: panel focus, command executions, note creation by type,
 * search frequency (keyword vs semantic), model usage distribution,
 * session count/duration, backup frequency.
 *
 * All data stored in SQLite feature_usage table. Opt-in export as anonymized JSON.
 */

const log = require('./logger');

let _db = null;

// ── Schema ────────────────────────────────────────────────────

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feature_usage (
      feature TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      last_used TEXT,
      PRIMARY KEY (feature)
    );

    CREATE TABLE IF NOT EXISTS session_metrics (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER DEFAULT 0
    );
  `);
}

// ── Init ──────────────────────────────────────────────────────

function init(database) {
  _db = database.db();
  try {
    createSchema(_db);
    log.info('Metrics schema ready');
  } catch (e) {
    log.warn('Metrics schema init failed:', e.message);
  }
}

// ── Core: increment a feature counter ─────────────────────────

function increment(feature) {
  if (!_db) return;
  try {
    const now = new Date().toISOString();
    _db.prepare(`
      INSERT INTO feature_usage (feature, count, last_used)
      VALUES (?, 1, ?)
      ON CONFLICT(feature) DO UPDATE SET
        count = count + 1,
        last_used = ?
    `).run(feature, now, now);
  } catch (e) {
    log.warn('Metrics increment failed for', feature, ':', e.message);
  }
}

// ── Batch increment (for efficiency) ──────────────────────────

function incrementMany(features) {
  if (!_db || !features || features.length === 0) return;
  try {
    const now = new Date().toISOString();
    const stmt = _db.prepare(`
      INSERT INTO feature_usage (feature, count, last_used)
      VALUES (?, 1, ?)
      ON CONFLICT(feature) DO UPDATE SET
        count = count + 1,
        last_used = ?
    `);
    const tx = _db.transaction((items) => {
      for (const f of items) {
        stmt.run(f, now, now);
      }
    });
    tx(features);
  } catch (e) {
    log.warn('Metrics incrementMany failed:', e.message);
  }
}

// ── Get all metrics ───────────────────────────────────────────

function getAll() {
  if (!_db) return [];
  try {
    return _db.prepare(
      'SELECT feature, count, last_used FROM feature_usage ORDER BY count DESC'
    ).all();
  } catch (e) {
    log.warn('Metrics getAll failed:', e.message);
    return [];
  }
}

// ── Get a single feature count ────────────────────────────────

function getCount(feature) {
  if (!_db) return 0;
  try {
    const row = _db.prepare(
      'SELECT count FROM feature_usage WHERE feature = ?'
    ).get(feature);
    return row ? row.count : 0;
  } catch (e) {
    return 0;
  }
}

// ── Session tracking ──────────────────────────────────────────

function startSession(sessionId) {
  if (!_db) return;
  try {
    const now = new Date().toISOString();
    _db.prepare(`
      INSERT OR REPLACE INTO session_metrics (id, started_at, ended_at, duration_seconds)
      VALUES (?, ?, NULL, 0)
    `).run(sessionId, now);
    increment('session.started');
  } catch (e) {
    log.warn('Metrics startSession failed:', e.message);
  }
}

function endSession(sessionId) {
  if (!_db) return;
  try {
    const row = _db.prepare(
      'SELECT started_at FROM session_metrics WHERE id = ?'
    ).get(sessionId);
    if (row) {
      const now = new Date().toISOString();
      const start = new Date(row.started_at).getTime();
      const durationSeconds = Math.round((Date.now() - start) / 1000);
      _db.prepare(`
        UPDATE session_metrics SET ended_at = ?, duration_seconds = ?
        WHERE id = ?
      `).run(now, durationSeconds, sessionId);
    }
  } catch (e) {
    log.warn('Metrics endSession failed:', e.message);
  }
}

function getSessionStats() {
  if (!_db) return { totalSessions: 0, totalDurationMinutes: 0, avgDurationMinutes: 0 };
  try {
    const row = _db.prepare(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(duration_seconds), 0) as total_duration,
        COALESCE(AVG(duration_seconds), 0) as avg_duration
      FROM session_metrics
      WHERE duration_seconds > 0
    `).get();
    return {
      totalSessions: row.total,
      totalDurationMinutes: Math.round(row.total_duration / 60),
      avgDurationMinutes: Math.round(row.avg_duration / 60),
    };
  } catch (e) {
    return { totalSessions: 0, totalDurationMinutes: 0, avgDurationMinutes: 0 };
  }
}

// ── Export as anonymized JSON ──────────────────────────────────
// Opt-in only. Contains no PII or content — just feature names and counts.

function exportAnonymized() {
  const metrics = getAll();
  const sessionStats = getSessionStats();

  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    version: '1.0.0',
    note: 'Analytics-free usage metrics. Local-only. No PII. No content. Opt-in export.',
    featureUsage: metrics.reduce((acc, m) => {
      acc[m.feature] = m.count;
      return acc;
    }, {}),
    sessions: sessionStats,
  }, null, 2);
}

// ── Convenience: track specific features ──────────────────────

const track = {
  panelFocus(panel) {
    increment(`panel.focus.${panel}`);
  },

  commandExecution(command) {
    increment('command.executed');
    increment(`command.${command}`);
  },

  noteCreated(type) {
    increment('note.created');
    increment(`note.created.${type}`);
  },

  searchPerformed(mode) {
    increment('search.performed');
    increment(`search.${mode}`);
  },

  modelUsed(modelId) {
    increment('model.used');
    // Normalize model ID to a short label
    if (modelId.includes('opus')) increment('model.opus');
    else if (modelId.includes('sonnet')) increment('model.sonnet');
    else if (modelId.includes('haiku')) increment('model.haiku');
    else increment(`model.${modelId}`);
  },

  chatMessageSent() {
    increment('chat.message.sent');
  },

  backupCreated() {
    increment('backup.created');
  },

  exportPerformed(type) {
    increment('export.performed');
    increment(`export.${type}`);
  },

  importPerformed(type) {
    increment('import.performed');
    increment(`import.${type}`);
  },

  queueItemAdded() {
    increment('queue.item.added');
  },

  queueItemResolved() {
    increment('queue.item.resolved');
  },
};

module.exports = {
  init,
  createSchema,
  increment,
  incrementMany,
  getAll,
  getCount,
  startSession,
  endSession,
  getSessionStats,
  exportAnonymized,
  track,
};
