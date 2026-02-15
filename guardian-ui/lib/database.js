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

    -- Compression levels (hierarchical memory)
    CREATE TABLE IF NOT EXISTS compression_levels (
      id TEXT PRIMARY KEY,
      level INTEGER NOT NULL,
      content TEXT NOT NULL,
      source_ids TEXT DEFAULT '[]',
      entity_links TEXT DEFAULT '[]',
      strength REAL DEFAULT 1.0,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_compression_level ON compression_levels(level);
    CREATE INDEX IF NOT EXISTS idx_compression_status ON compression_levels(status);

    -- FTS for compression memory
    CREATE VIRTUAL TABLE IF NOT EXISTS compression_fts USING fts5(content);

    -- Reframe events (Perlocutionary Audit)
    CREATE TABLE IF NOT EXISTS reframe_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      message_id TEXT NOT NULL,
      user_context TEXT NOT NULL,
      reframe_text TEXT NOT NULL,
      reframe_type TEXT NOT NULL,
      confidence REAL DEFAULT 0.0,
      identity_dimension TEXT,
      acknowledged INTEGER DEFAULT 0,
      accurate INTEGER DEFAULT -1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reframe_session ON reframe_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_reframe_type ON reframe_events(reframe_type);
    CREATE INDEX IF NOT EXISTS idx_reframe_dimension ON reframe_events(identity_dimension);
    CREATE INDEX IF NOT EXISTS idx_reframe_acknowledged ON reframe_events(acknowledged);
  `);

  // Knowledge graph tables
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

  // Librarian + Providers tables (Phase 3)
  try {
    _db.exec(`
      -- Note sources: tracks where auto-extracted notes came from
      CREATE TABLE IF NOT EXISTS note_sources (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        extraction_type TEXT NOT NULL DEFAULT 'manual',
        confidence REAL DEFAULT 1.0,
        auto_generated INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_note_sources_note ON note_sources(note_id);
      CREATE INDEX IF NOT EXISTS idx_note_sources_session ON note_sources(session_id);

      -- Entity-note links: many-to-many between KG entities and notes
      CREATE TABLE IF NOT EXISTS entity_notes (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        relevance REAL DEFAULT 1.0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_entity_notes_entity ON entity_notes(entity_id);
      CREATE INDEX IF NOT EXISTS idx_entity_notes_note ON entity_notes(note_id);

      -- Entity-artifact links: many-to-many between KG entities and artifacts
      CREATE TABLE IF NOT EXISTS entity_artifacts (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_entity_artifacts_entity ON entity_artifacts(entity_id);
      CREATE INDEX IF NOT EXISTS idx_entity_artifacts_artifact ON entity_artifacts(artifact_id);

      -- Providers: external LLM provider configurations
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'openai-compatible',
        enabled INTEGER DEFAULT 1,
        base_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Provider models: available models per provider
      CREATE TABLE IF NOT EXISTS provider_models (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        label TEXT,
        description TEXT,
        tier TEXT DEFAULT 'standard',
        max_tokens INTEGER DEFAULT 4096,
        supports_streaming INTEGER DEFAULT 1,
        supports_thinking INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);
    `);
  } catch (e) {
    log.warn('Librarian/providers schema init failed:', e.message);
  }

  // Import batch tracking table
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        file_name TEXT,
        file_size INTEGER,
        status TEXT DEFAULT 'pending',
        total_conversations INTEGER DEFAULT 0,
        imported_conversations INTEGER DEFAULT 0,
        skipped_conversations INTEGER DEFAULT 0,
        error_message TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
    `);
  } catch (e) {
    log.warn('Import batches table init failed:', e.message);
  }

  // ALTER TABLE migrations (idempotent — catch duplicate column errors)
  try { _db.exec('ALTER TABLE notes ADD COLUMN auto_generated INTEGER DEFAULT 0'); } catch (_) {}
  try { _db.exec('ALTER TABLE notes ADD COLUMN source_session_id TEXT'); } catch (_) {}
  try { _db.exec('ALTER TABLE sessions ADD COLUMN provider TEXT DEFAULT \'claude-cli\''); } catch (_) {}
  try { _db.exec('ALTER TABLE sessions ADD COLUMN extraction_status TEXT DEFAULT \'pending\''); } catch (_) {}
  try { _db.exec('ALTER TABLE queue_items ADD COLUMN grounding_type TEXT'); } catch (_) {}
  try { _db.exec('ALTER TABLE queue_items ADD COLUMN grounding_description TEXT'); } catch (_) {}
  try { _db.exec('ALTER TABLE queue_items ADD COLUMN grounded_at TEXT'); } catch (_) {}

  // Conversation import columns on sessions
  try { _db.exec('ALTER TABLE sessions ADD COLUMN source TEXT DEFAULT \'guardian\''); } catch (_) {}
  try { _db.exec('ALTER TABLE sessions ADD COLUMN import_batch_id TEXT'); } catch (_) {}
  try { _db.exec('ALTER TABLE sessions ADD COLUMN original_id TEXT'); } catch (_) {}
  try { _db.exec('ALTER TABLE sessions ADD COLUMN message_count INTEGER DEFAULT 0'); } catch (_) {}

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
      const groundedAt = (updates.status === 'resolved' && updates.groundingType) ? new Date().toISOString() : null;
      db().prepare('UPDATE queue_items SET status = ?, resolved_at = ? WHERE id = ?')
        .run(updates.status, resolvedAt, id);
      if (updates.groundingType) {
        db().prepare('UPDATE queue_items SET grounding_type = ?, grounding_description = ?, grounded_at = ? WHERE id = ?')
          .run(updates.groundingType, updates.groundingDescription || '', groundedAt, id);
      }
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

  stats() {
    const total = db().prepare("SELECT COUNT(*) as c FROM queue_items WHERE status = 'resolved'").get().c;
    const grounded = db().prepare("SELECT COUNT(*) as c FROM queue_items WHERE status = 'resolved' AND grounding_type IS NOT NULL").get().c;
    const groundingRate = total > 0 ? Math.round((grounded / total) * 100) : 0;

    const avgRow = db().prepare(`
      SELECT AVG(julianday(grounded_at) - julianday(created_at)) as avg_days
      FROM queue_items
      WHERE status = 'resolved' AND grounded_at IS NOT NULL
    `).get();
    const avgLatencyDays = avgRow.avg_days ? Math.round(avgRow.avg_days * 10) / 10 : 0;

    return { groundingRate, avgLatencyDays };
  },
};

// ── Compression Memory ──────────────────────────────────────

const compression = {
  create(item) {
    const id = item.id || `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    db().prepare(`
      INSERT INTO compression_levels (id, level, content, source_ids, entity_links, strength, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      item.level,
      item.content,
      JSON.stringify(item.sourceIds || []),
      JSON.stringify(item.entityLinks || []),
      item.strength != null ? item.strength : 1.0,
      item.status || 'active',
      now, now
    );
    // Update FTS
    try {
      db().prepare('INSERT INTO compression_fts(rowid, content) VALUES ((SELECT rowid FROM compression_levels WHERE id = ?), ?)').run(id, item.content);
    } catch (_) {}
    return id;
  },

  update(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(updates)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      fields.push(`${col} = ?`);
      values.push(typeof val === 'object' ? JSON.stringify(val) : val);
    }
    if (fields.length === 0) return;
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    db().prepare(`UPDATE compression_levels SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  get(id) {
    return db().prepare('SELECT * FROM compression_levels WHERE id = ?').get(id);
  },

  listByLevel(level, opts = {}) {
    const status = opts.status || 'active';
    let sql = 'SELECT * FROM compression_levels WHERE level = ?';
    const params = [level];
    if (status !== 'all') {
      sql += ' AND (status = ? OR status = ?)';
      params.push(status, 'pinned');
    }
    sql += ' ORDER BY strength DESC, updated_at DESC';
    if (opts.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }
    return db().prepare(sql).all(...params);
  },

  countSinceLastCompression(level) {
    const lastHigher = db().prepare(
      'SELECT created_at FROM compression_levels WHERE level = ? ORDER BY created_at DESC LIMIT 1'
    ).get(level + 1);

    if (lastHigher) {
      return db().prepare(
        'SELECT COUNT(*) as c FROM compression_levels WHERE level = ? AND status = ? AND created_at > ?'
      ).get(level, 'active', lastHigher.created_at).c;
    }
    return db().prepare(
      'SELECT COUNT(*) as c FROM compression_levels WHERE level = ? AND status = ?'
    ).get(level, 'active').c;
  },

  applyDecay() {
    db().prepare(`
      UPDATE compression_levels SET strength = strength * 0.97, updated_at = ?
      WHERE status = 'active'
    `).run(new Date().toISOString());
    db().prepare(`
      UPDATE compression_levels SET status = 'archived', updated_at = ?
      WHERE status = 'active' AND strength < 0.3
    `).run(new Date().toISOString());
  },

  reinforceStrength(id) {
    db().prepare(`
      UPDATE compression_levels SET strength = MIN(1.0, strength + 0.15), updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id);
  },

  search(query) {
    if (!query || !query.trim()) return [];
    const ftsQuery = query.replace(/['"]/g, '').split(/\s+/).map(w => `"${w}"`).join(' ');
    try {
      return db().prepare(`
        SELECT cl.*
        FROM compression_fts fts
        JOIN compression_levels cl ON cl.rowid = fts.rowid
        WHERE compression_fts MATCH ?
        AND cl.status IN ('active', 'pinned')
        ORDER BY rank
        LIMIT 20
      `).all(ftsQuery);
    } catch (_) {
      return [];
    }
  },

  levelCounts() {
    const rows = db().prepare(`
      SELECT level, COUNT(*) as c FROM compression_levels
      WHERE status IN ('active', 'pinned')
      GROUP BY level
    `).all();
    const counts = { l0: 0, l1: 0, l2: 0, l3: 0 };
    for (const r of rows) {
      counts[`l${r.level}`] = r.c;
    }
    return counts;
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

// ── Note Sources ──────────────────────────────────────────────

const noteSources = {
  create(source) {
    const id = source.id || `ns_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db().prepare(`
      INSERT INTO note_sources (id, note_id, session_id, message_id, extraction_type, confidence, auto_generated, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      source.noteId,
      source.sessionId || null,
      source.messageId || null,
      source.extractionType || 'manual',
      source.confidence != null ? source.confidence : 1.0,
      source.autoGenerated ? 1 : 0,
      new Date().toISOString()
    );
    return id;
  },

  listByNote(noteId) {
    return db().prepare(
      'SELECT * FROM note_sources WHERE note_id = ? ORDER BY created_at DESC'
    ).all(noteId);
  },

  listBySession(sessionId) {
    return db().prepare(
      'SELECT * FROM note_sources WHERE session_id = ? ORDER BY created_at DESC'
    ).all(sessionId);
  },
};

// ── Entity Notes ──────────────────────────────────────────────

const entityNotes = {
  link(entityId, noteId, relevance) {
    const id = `en_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db().prepare(`
      INSERT INTO entity_notes (id, entity_id, note_id, relevance, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, entityId, noteId, relevance != null ? relevance : 1.0, new Date().toISOString());
    return id;
  },

  getNotesForEntity(entityId) {
    return db().prepare(`
      SELECT n.*, en.relevance, en.created_at as linked_at
      FROM entity_notes en
      JOIN notes n ON n.id = en.note_id
      WHERE en.entity_id = ?
      ORDER BY en.relevance DESC
    `).all(entityId);
  },

  getEntitiesForNote(noteId) {
    return db().prepare(
      'SELECT * FROM entity_notes WHERE note_id = ? ORDER BY relevance DESC'
    ).all(noteId);
  },
};

// ── Provider Store ────────────────────────────────────────────

const providerStore = {
  create(provider) {
    const id = provider.id || `prov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    db().prepare(`
      INSERT INTO providers (id, name, type, enabled, base_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      provider.name,
      provider.type || 'openai-compatible',
      provider.enabled != null ? (provider.enabled ? 1 : 0) : 1,
      provider.baseUrl || null,
      now, now
    );
    return id;
  },

  list() {
    return db().prepare('SELECT * FROM providers ORDER BY name ASC').all();
  },

  get(id) {
    return db().prepare('SELECT * FROM providers WHERE id = ?').get(id);
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
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    db().prepare(`UPDATE providers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  delete(id) {
    db().prepare('DELETE FROM provider_models WHERE provider_id = ?').run(id);
    db().prepare('DELETE FROM providers WHERE id = ?').run(id);
  },

  addModel(model) {
    const id = model.id || `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db().prepare(`
      INSERT INTO provider_models (id, provider_id, model_id, label, description, tier, max_tokens, supports_streaming, supports_thinking, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      model.providerId,
      model.modelId,
      model.label || model.modelId,
      model.description || null,
      model.tier || 'standard',
      model.maxTokens || 4096,
      model.supportsStreaming != null ? (model.supportsStreaming ? 1 : 0) : 1,
      model.supportsThinking != null ? (model.supportsThinking ? 1 : 0) : 0,
      model.enabled != null ? (model.enabled ? 1 : 0) : 1
    );
    return id;
  },

  getModels(providerId) {
    return db().prepare(
      'SELECT * FROM provider_models WHERE provider_id = ? ORDER BY tier ASC, label ASC'
    ).all(providerId);
  },
};

// ── Reframe Events (Perlocutionary Audit) ────────────────────

const reframe = {
  add(event) {
    db().prepare(`
      INSERT INTO reframe_events (id, session_id, message_id, user_context, reframe_text, reframe_type, confidence, identity_dimension, acknowledged, accurate, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.sessionId,
      event.messageId,
      event.userContext,
      event.reframeText,
      event.reframeType,
      event.confidence != null ? event.confidence : 0.0,
      event.identityDimension || null,
      event.acknowledged ? 1 : 0,
      event.accurate != null ? event.accurate : -1,
      event.createdAt || new Date().toISOString()
    );
    return event.id;
  },

  list({ sessionId, type, dimension, acknowledged, limit = 100, offset = 0 } = {}) {
    let sql = 'SELECT * FROM reframe_events';
    const where = [];
    const params = [];

    if (sessionId != null) {
      where.push('session_id = ?');
      params.push(sessionId);
    }
    if (type != null) {
      where.push('reframe_type = ?');
      params.push(type);
    }
    if (dimension != null) {
      where.push('identity_dimension = ?');
      params.push(dimension);
    }
    if (acknowledged != null) {
      where.push('acknowledged = ?');
      params.push(acknowledged ? 1 : 0);
    }

    if (where.length > 0) {
      sql += ' WHERE ' + where.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return db().prepare(sql).all(...params);
  },

  rate(id, accurate) {
    db().prepare('UPDATE reframe_events SET accurate = ? WHERE id = ?').run(accurate, id);
  },

  acknowledge(id) {
    db().prepare('UPDATE reframe_events SET acknowledged = 1 WHERE id = ?').run(id);
  },

  acknowledgeAll() {
    db().prepare('UPDATE reframe_events SET acknowledged = 1 WHERE acknowledged = 0').run();
  },

  stats() {
    const total = db().prepare('SELECT COUNT(*) as c FROM reframe_events').get().c;
    const unacknowledged = db().prepare('SELECT COUNT(*) as c FROM reframe_events WHERE acknowledged = 0').get().c;

    // By type
    const typeRows = db().prepare(
      'SELECT reframe_type, COUNT(*) as c FROM reframe_events GROUP BY reframe_type'
    ).all();
    const byType = { contrast: 0, relabel: 0, identity: 0, minimize: 0, inflate: 0, certainty: 0, redirect: 0 };
    for (const r of typeRows) {
      byType[r.reframe_type] = r.c;
    }

    // By dimension
    const dimRows = db().prepare(
      'SELECT identity_dimension, COUNT(*) as c FROM reframe_events WHERE identity_dimension IS NOT NULL GROUP BY identity_dimension'
    ).all();
    const byDimension = { emotional: 0, professional: 0, cognitive: 0, relational: 0, ambition: 0, worth: 0, somatic: 0, creative: 0 };
    for (const r of dimRows) {
      byDimension[r.identity_dimension] = r.c;
    }

    // Accuracy rate
    const ratedTotal = db().prepare('SELECT COUNT(*) as c FROM reframe_events WHERE accurate != -1').get().c;
    const ratedAccurate = db().prepare('SELECT COUNT(*) as c FROM reframe_events WHERE accurate = 1').get().c;
    const accuracyRate = ratedTotal > 0 ? ratedAccurate / ratedTotal : null;

    return { total, unacknowledged, byType, byDimension, accuracyRate };
  },

  getDriftScore(days = 30) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const ratedTotal = db().prepare(
      'SELECT COUNT(*) as c FROM reframe_events WHERE accurate != -1 AND created_at >= ?'
    ).get(cutoff).c;
    if (ratedTotal === 0) return null;
    const ratedAccurate = db().prepare(
      'SELECT COUNT(*) as c FROM reframe_events WHERE accurate = 1 AND created_at >= ?'
    ).get(cutoff).c;
    return ratedAccurate / ratedTotal;
  },
};

// ── Import Batches ───────────────────────────────────────────

const importBatches = {
  create(batch) {
    const id = batch.id || `ib_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db().prepare(`
      INSERT INTO import_batches (id, source, file_name, file_size, status, total_conversations, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      batch.source,
      batch.fileName || null,
      batch.fileSize || 0,
      batch.status || 'pending',
      batch.totalConversations || 0,
      batch.startedAt || new Date().toISOString()
    );
    return id;
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
    db().prepare(`UPDATE import_batches SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  get(id) {
    return db().prepare('SELECT * FROM import_batches WHERE id = ?').get(id);
  },

  list() {
    return db().prepare('SELECT * FROM import_batches ORDER BY started_at DESC').all();
  },
};

module.exports = { open, close, db, sessions, messages, notes, usage, queue, compression, search, migrateFromJSON, noteSources, entityNotes, providerStore, reframe, importBatches };
