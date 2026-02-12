/**
 * Guardian — Database Manager
 *
 * SQLite via better-sqlite3 (synchronous, fast, Electron-compatible).
 * All persistent state: sessions, messages, notes, artifacts, queue, usage.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { FILES, DIRS } = require('./paths');
const log = require('./logger');

let _db = null;

// ── Initialization ───────────────────────────────────────────

function open() {
  if (_db) return _db;

  log.info('Opening database at', FILES.database);
  _db = new Database(FILES.database);

  // Performance pragmas
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('foreign_keys = ON');

  _createSchema();
  return _db;
}

function close() {
  if (_db) {
    log.info('Closing database');
    _db.close();
    _db = null;
  }
}

function db() {
  if (!_db) open();
  return _db;
}

// ── Schema ───────────────────────────────────────────────────

function _createSchema() {
  _db.exec(`
    -- Sessions
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      claude_session_id TEXT,
      title TEXT,
      summary TEXT,
      model TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0
    );

    -- Messages
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT,
      thinking TEXT,
      attachments TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

    -- Notes
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'scratch',
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      color TEXT DEFAULT 'default',
      project_id TEXT,
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Artifacts
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      message_id TEXT REFERENCES messages(id),
      type TEXT NOT NULL,
      title TEXT,
      language TEXT,
      file_path TEXT,
      version INTEGER DEFAULT 1,
      content TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);

    -- Integration Queue
    CREATE TABLE IF NOT EXISTS queue_items (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      source_session_id TEXT,
      source_message_id TEXT,
      status TEXT DEFAULT 'open',
      priority INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    -- Usage Records
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL
    );

    -- Note Versions (version history for every save)
    CREATE TABLE IF NOT EXISTS note_versions (
      id TEXT PRIMARY KEY,
      note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
      content TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_versions(note_id);

    -- Semantic embedding chunks
    CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      semantic_summary TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_embeddings_session ON embeddings(session_id);

    -- Performance indices for common queries
    CREATE INDEX IF NOT EXISTS idx_queue_items_status ON queue_items(status);
    CREATE INDEX IF NOT EXISTS idx_usage_session ON usage(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);

    -- FTS on semantic summaries for meaning-based search
    CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_fts USING fts5(
      chunk_text, semantic_summary
    );

    -- Full-text search
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content, thinking, content=messages, content_rowid=rowid
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title, content, content=notes, content_rowid=rowid
    );

    -- Session summaries full-text search
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      title, summary, content=sessions, content_rowid=rowid
    );
  `);

  // Knowledge graph tables (V.1.d)
  try {
    const knowledgeGraph = require('./knowledge-graph');
    knowledgeGraph.createSchema(_db);
  } catch (e) {
    log.warn('Knowledge graph schema init failed:', e.message);
  }

  // Feature usage metrics tables
  try {
    const metrics = require('./metrics');
    metrics.createSchema(_db);
  } catch (e) {
    log.warn('Metrics schema init failed:', e.message);
  }

  log.info('Database schema ready');
}

// ── Sessions ─────────────────────────────────────────────────

const sessions = {
  create(id, opts = {}) {
    db().prepare(`
      INSERT INTO sessions (id, project_id, claude_session_id, title, model, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      opts.projectId || null,
      opts.claudeSessionId || null,
      opts.title || 'New session',
      opts.model || null,
      new Date().toISOString()
    );
    return id;
  },

  update(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(updates)) {
      // Map camelCase to snake_case
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      fields.push(`${col} = ?`);
      values.push(val);
    }
    if (fields.length === 0) return;
    values.push(id);
    db().prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  get(id) {
    return db().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  },

  list(opts = {}) {
    let sql = 'SELECT * FROM sessions';
    const params = [];
    const where = [];

    if (opts.projectId) {
      where.push('project_id = ?');
      params.push(opts.projectId);
    }

    if (where.length > 0) {
      sql += ' WHERE ' + where.join(' AND ');
    }
    sql += ' ORDER BY started_at DESC';

    if (opts.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }

    return db().prepare(sql).all(...params);
  },

  delete(id) {
    db().prepare('DELETE FROM sessions WHERE id = ?').run(id);
  },

  updateTokens(id, tokensIn, tokensOut) {
    db().prepare(`
      UPDATE sessions
      SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?
      WHERE id = ?
    `).run(tokensIn, tokensOut, id);
  },

  updateSummary(id, summary) {
    db().prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(summary, id);
    // Update FTS index
    try {
      const session = db().prepare('SELECT rowid, title FROM sessions WHERE id = ?').get(id);
      if (session) {
        // Delete old FTS entry then insert new one
        try { db().prepare('DELETE FROM sessions_fts WHERE rowid = ?').run(session.rowid); } catch (_) {}
        db().prepare(
          'INSERT INTO sessions_fts(rowid, title, summary) VALUES (?, ?, ?)'
        ).run(session.rowid, session.title || '', summary || '');
      }
    } catch (_) { /* FTS update best-effort */ }
  },
};

// ── Messages ─────────────────────────────────────────────────

const messages = {
  create(msg) {
    db().prepare(`
      INSERT INTO messages (id, session_id, role, content, thinking, attachments, tokens_in, tokens_out, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id,
      msg.sessionId,
      msg.role,
      msg.content || '',
      msg.thinking || null,
      msg.attachments ? JSON.stringify(msg.attachments) : null,
      msg.tokensIn || 0,
      msg.tokensOut || 0,
      msg.timestamp || new Date().toISOString()
    );

    // Update FTS
    try {
      db().prepare(`
        INSERT INTO messages_fts(rowid, content, thinking)
        VALUES ((SELECT rowid FROM messages WHERE id = ?), ?, ?)
      `).run(msg.id, msg.content || '', msg.thinking || '');
    } catch (_) { /* FTS insert best-effort */ }

    return msg.id;
  },

  update(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(updates)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      fields.push(`${col} = ?`);
      values.push(val);
    }
    if (fields.length === 0) return;
    values.push(id);
    db().prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  listBySession(sessionId) {
    return db().prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(sessionId);
  },

  get(id) {
    return db().prepare('SELECT * FROM messages WHERE id = ?').get(id);
  },
};

// ── Notes ────────────────────────────────────────────────────

const notes = {
  create(note) {
    const now = new Date().toISOString();
    const id = note.id || Date.now().toString();
    db().prepare(`
      INSERT INTO notes (id, type, title, content, color, project_id, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      note.type || 'scratch',
      note.title || '',
      note.content || '',
      note.color || 'default',
      note.projectId || null,
      JSON.stringify(note.tags || []),
      now, now
    );

    try {
      db().prepare(`
        INSERT INTO notes_fts(rowid, title, content)
        VALUES ((SELECT rowid FROM notes WHERE id = ?), ?, ?)
      `).run(id, note.title || '', note.content || '');
    } catch (_) {}

    return id;
  },

  update(id, updates) {
    const now = new Date().toISOString();
    const note = notes.get(id);
    if (!note) return;

    // Save a version snapshot if content is changing
    if (updates.content !== undefined && note.content && note.content !== updates.content) {
      notes.saveVersion(id, note.content);
    }

    const newTitle = updates.title !== undefined ? updates.title : note.title;
    const newContent = updates.content !== undefined ? updates.content : note.content;
    const newColor = updates.color !== undefined ? updates.color : note.color;
    const newTags = updates.tags !== undefined ? JSON.stringify(updates.tags) : note.tags;

    db().prepare(`
      UPDATE notes SET title = ?, content = ?, color = ?, tags = ?, updated_at = ?
      WHERE id = ?
    `).run(newTitle, newContent, newColor, newTags, now, id);
  },

  get(id) {
    return db().prepare('SELECT * FROM notes WHERE id = ?').get(id);
  },

  list(opts = {}) {
    let sql = 'SELECT * FROM notes';
    const params = [];
    const where = [];

    if (opts.type) {
      where.push('type = ?');
      params.push(opts.type);
    }
    if (opts.projectId) {
      where.push('project_id = ?');
      params.push(opts.projectId);
    }

    if (where.length > 0) {
      sql += ' WHERE ' + where.join(' AND ');
    }
    sql += ' ORDER BY updated_at DESC';
    return db().prepare(sql).all(...params);
  },

  delete(id) {
    db().prepare('DELETE FROM note_versions WHERE note_id = ?').run(id);
    db().prepare('DELETE FROM notes WHERE id = ?').run(id);
  },

  // Save a version snapshot of the current note content
  saveVersion(noteId, content) {
    const versionId = `nv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db().prepare(`
      INSERT INTO note_versions (id, note_id, content, created_at)
      VALUES (?, ?, ?, ?)
    `).run(versionId, noteId, content, new Date().toISOString());
    return versionId;
  },

  // Get version history for a note (newest first)
  listVersions(noteId) {
    return db().prepare(
      'SELECT * FROM note_versions WHERE note_id = ? ORDER BY created_at DESC'
    ).all(noteId);
  },

  // Revert a note to a specific version
  revert(noteId, versionId) {
    const version = db().prepare(
      'SELECT * FROM note_versions WHERE id = ? AND note_id = ?'
    ).get(versionId, noteId);
    if (!version) return null;
    const now = new Date().toISOString();
    // Save current content as a new version before reverting
    const currentNote = notes.get(noteId);
    if (currentNote && currentNote.content !== version.content) {
      notes.saveVersion(noteId, currentNote.content);
    }
    db().prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?')
      .run(version.content, now, noteId);
    return version;
  },
};

// ── Usage ────────────────────────────────────────────────────

const usage = {
  append(record) {
    db().prepare(`
      INSERT INTO usage (session_id, input_tokens, output_tokens, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(
      record.sessionId || null,
      record.inputTokens || 0,
      record.outputTokens || 0,
      record.timestamp || new Date().toISOString()
    );
  },

  list(opts = {}) {
    let sql = 'SELECT * FROM usage';
    const params = [];
    if (opts.sessionId) {
      sql += ' WHERE session_id = ?';
      params.push(opts.sessionId);
    }
    sql += ' ORDER BY timestamp DESC';
    if (opts.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }
    return db().prepare(sql).all(...params);
  },

  totals() {
    const row = db().prepare(
      'SELECT COALESCE(SUM(input_tokens),0) as input, COALESCE(SUM(output_tokens),0) as output FROM usage'
    ).get();
    return { inputTokens: row.input, outputTokens: row.output };
  },
};

// ── Queue ────────────────────────────────────────────────────

const queue = {
  add(item) {
    const id = item.id || Date.now().toString();
    db().prepare(`
      INSERT INTO queue_items (id, text, source_session_id, source_message_id, status, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, item.text,
      item.sourceSessionId || null,
      item.sourceMessageId || null,
      item.status || 'open',
      item.priority || 0,
      new Date().toISOString()
    );
    return id;
  },

  update(id, updates) {
    if (updates.status) {
      const resolvedAt = updates.status === 'resolved' ? new Date().toISOString() : null;
      db().prepare('UPDATE queue_items SET status = ?, resolved_at = ? WHERE id = ?')
        .run(updates.status, resolvedAt, id);
    }
    if (updates.priority !== undefined) {
      db().prepare('UPDATE queue_items SET priority = ? WHERE id = ?')
        .run(updates.priority, id);
    }
    if (updates.text) {
      db().prepare('UPDATE queue_items SET text = ? WHERE id = ?')
        .run(updates.text, id);
    }
  },

  list(opts = {}) {
    const status = opts.status || 'open';
    return db().prepare(
      'SELECT * FROM queue_items WHERE status = ? ORDER BY priority DESC, created_at ASC'
    ).all(status);
  },

  delete(id) {
    db().prepare('DELETE FROM queue_items WHERE id = ?').run(id);
  },
};

// ── Search ───────────────────────────────────────────────────

function search(query, opts = {}) {
  const results = [];
  const ftsQuery = query.replace(/['"]/g, '').split(/\s+/).map(w => `"${w}"`).join(' ');

  if (!opts.scope || opts.scope === 'all' || opts.scope === 'conversations') {
    try {
      const rows = db().prepare(`
        SELECT m.id, m.session_id, m.role, m.content, m.timestamp,
               s.title as session_title
        FROM messages_fts fts
        JOIN messages m ON m.rowid = fts.rowid
        LEFT JOIN sessions s ON m.session_id = s.id
        WHERE messages_fts MATCH ?
        ORDER BY rank
        LIMIT 20
      `).all(ftsQuery);
      for (const r of rows) {
        results.push({ type: 'message', ...r });
      }
    } catch (_) { /* FTS match can fail on bad queries */ }
  }

  if (!opts.scope || opts.scope === 'all' || opts.scope === 'sessions') {
    try {
      const rows = db().prepare(`
        SELECT s.id, s.title, s.summary, s.started_at, s.tokens_in, s.tokens_out
        FROM sessions_fts fts
        JOIN sessions s ON s.rowid = fts.rowid
        WHERE sessions_fts MATCH ?
        ORDER BY rank
        LIMIT 20
      `).all(ftsQuery);
      for (const r of rows) {
        results.push({ type: 'session', ...r });
      }
    } catch (_) { /* FTS match can fail on bad queries */ }
  }

  if (!opts.scope || opts.scope === 'all' || opts.scope === 'notes') {
    try {
      const rows = db().prepare(`
        SELECT n.id, n.type, n.title, n.content, n.updated_at
        FROM notes_fts fts
        JOIN notes n ON n.rowid = fts.rowid
        WHERE notes_fts MATCH ?
        ORDER BY rank
        LIMIT 20
      `).all(ftsQuery);
      for (const r of rows) {
        results.push({ type: 'note', ...r });
      }
    } catch (_) {}
  }

  return results;
}

// ── Migration from JSON ──────────────────────────────────────

function migrateFromJSON(projectDir) {
  // Migrate notes from guardian-notes.json
  const notesFile = path.join(projectDir, 'guardian-notes.json');
  if (fs.existsSync(notesFile)) {
    try {
      const oldNotes = JSON.parse(fs.readFileSync(notesFile, 'utf-8'));
      const existingCount = db().prepare('SELECT COUNT(*) as c FROM notes').get().c;
      if (existingCount === 0 && oldNotes.length > 0) {
        log.info(`Migrating ${oldNotes.length} notes from JSON`);
        const insert = db().prepare(`
          INSERT OR IGNORE INTO notes (id, type, title, content, color, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const tx = db().transaction((items) => {
          for (const n of items) {
            insert.run(
              n.id, 'scratch', n.title || '', n.content || '',
              n.color || 'default', n.createdAt || new Date().toISOString(),
              n.updatedAt || new Date().toISOString()
            );
          }
        });
        tx(oldNotes);
        log.info('Notes migration complete');
      }
    } catch (e) {
      log.error('Notes migration failed:', e.message);
    }
  }

  // Migrate usage from guardian-usage.json
  const usageFile = path.join(projectDir, 'guardian-usage.json');
  if (fs.existsSync(usageFile)) {
    try {
      const oldUsage = JSON.parse(fs.readFileSync(usageFile, 'utf-8'));
      const existingCount = db().prepare('SELECT COUNT(*) as c FROM usage').get().c;
      if (existingCount === 0 && oldUsage.length > 0) {
        log.info(`Migrating ${oldUsage.length} usage records from JSON`);
        const insert = db().prepare(`
          INSERT INTO usage (input_tokens, output_tokens, timestamp)
          VALUES (?, ?, ?)
        `);
        const tx = db().transaction((items) => {
          for (const r of items) {
            insert.run(r.inputTokens || 0, r.outputTokens || 0, r.timestamp);
          }
        });
        tx(oldUsage);
        log.info('Usage migration complete');
      }
    } catch (e) {
      log.error('Usage migration failed:', e.message);
    }
  }
}

module.exports = { open, close, db, sessions, messages, notes, usage, queue, search, migrateFromJSON };
