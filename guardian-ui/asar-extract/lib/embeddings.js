/**
 * Guardian -- Semantic Embedding Pipeline
 *
 * Generates semantic summaries of conversation chunks via Claude CLI,
 * stores them in SQLite for FTS-powered semantic search.
 * Runs asynchronously after session ends -- never blocks the UI.
 * Gracefully degrades if summarization/embedding fails.
 *
 * Architecture:
 *   1. After a session ends, chunk the conversation into segments
 *   2. For each chunk, generate a semantic summary via Claude CLI
 *   3. Store chunk + summary in the embeddings table
 *   4. Semantic search queries the summaries via FTS5
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const log = require('./logger');

// ── Claude CLI resolution (mirrors main.js / summarizer.js) ─────

function getClaudePath() {
  const localBin = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (fs.existsSync(localBin)) return localBin;
  return 'claude';
}

const claudeBinDir = path.join(os.homedir(), '.local', 'bin');
const sep = process.platform === 'win32' ? ';' : ':';
const currentPath = process.env.Path || process.env.PATH || '';
const newPath = claudeBinDir + sep + currentPath;
const cliEnv = {
  ...process.env,
  Path: newPath,
  PATH: newPath,
};

// ── State ───────────────────────────────────────────────────────

let _db = null;
let _processing = false;
const _queue = []; // { sessionId, chunks[] }

// ── Initialization ──────────────────────────────────────────────

/**
 * Initialize the embeddings module with a database reference.
 * Creates the embeddings table and FTS index if they don't exist.
 */
function init(database) {
  _db = database;
  _createSchema();
}

function _createSchema() {
  if (!_db) return;
  try {
    const db = typeof _db.db === 'function' ? _db.db() : _db;
    db.exec(`
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

      -- FTS on semantic summaries for meaning-based search
      CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_fts USING fts5(
        chunk_text, semantic_summary
      );
    `);
    log.info('Embeddings schema ready');
  } catch (e) {
    log.error('Embeddings schema creation failed:', e.message);
  }
}

// ── Chunking ────────────────────────────────────────────────────

/**
 * Chunk a conversation into segments suitable for embedding.
 * Each chunk is ~500-1000 chars of conversation, preserving message boundaries.
 */
function chunkConversation(messages) {
  if (!messages || messages.length === 0) return [];

  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;
  const MAX_CHUNK = 800;

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const text = (msg.content || '').trim();
    if (!text) continue;

    const truncated = text.slice(0, 500);
    const line = `${role}: ${truncated}`;

    if (currentLength + line.length > MAX_CHUNK && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));
      currentChunk = [];
      currentLength = 0;
    }

    currentChunk.push(line);
    currentLength += line.length;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  return chunks;
}

// ── Semantic Summary Generation ─────────────────────────────────

/**
 * Generate a semantic summary for a text chunk using Claude CLI.
 * Returns a promise that resolves with the summary string.
 */
function generateSummary(chunkText) {
  return new Promise((resolve, reject) => {
    const prompt = [
      'You are generating a semantic index entry for a conversation search system.',
      'Given the following conversation excerpt, produce a dense 2-3 sentence semantic summary.',
      'Include key topics, concepts, questions, decisions, and any domain-specific terms.',
      'Include synonyms and related concepts that someone might search for.',
      'Output ONLY the summary text, no labels or prefixes.',
      '',
      '---',
      chunkText,
      '---',
    ].join('\n');

    const claudePath = getClaudePath();
    const args = ['-p', prompt, '--output-format', 'text'];

    let proc;
    try {
      proc = spawn(claudePath, args, {
        cwd: os.homedir(),
        env: cliEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      });
    } catch (e) {
      reject(e);
      return;
    }

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim().slice(0, 500));
      } else {
        reject(new Error(stderr.trim() || `Exit code ${code}`));
      }
    });

    proc.on('error', (e) => reject(e));
  });
}

// ── Storage ─────────────────────────────────────────────────────

/**
 * Store a chunk and its semantic summary in the database.
 */
function storeChunk(sessionId, chunkIndex, chunkText, semanticSummary) {
  if (!_db) return;
  try {
    const db = typeof _db.db === 'function' ? _db.db() : _db;
    const id = `emb_${sessionId}_${chunkIndex}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO embeddings (id, session_id, chunk_index, chunk_text, semantic_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, chunkIndex, chunkText, semanticSummary, now);

    // Update FTS index
    try {
      const row = db.prepare('SELECT rowid FROM embeddings WHERE id = ?').get(id);
      if (row) {
        db.prepare('INSERT OR REPLACE INTO embeddings_fts(rowid, chunk_text, semantic_summary) VALUES (?, ?, ?)')
          .run(row.rowid, chunkText, semanticSummary || '');
      }
    } catch (_) { /* FTS best-effort */ }

    log.info(`Embeddings: stored chunk ${chunkIndex} for session ${sessionId}`);
  } catch (e) {
    log.error('Embeddings: store failed:', e.message);
  }
}

// ── Semantic Search ─────────────────────────────────────────────

/**
 * Search the embeddings index semantically.
 * Queries FTS on both chunk text and semantic summaries.
 *
 * @param {string} query - User search query
 * @param {Object} opts - { limit }
 * @returns {Array} Search results with session info
 */
function search(query, opts = {}) {
  if (!_db) return [];
  try {
    const db = typeof _db.db === 'function' ? _db.db() : _db;
    const limit = opts.limit || 20;

    // Build FTS query: quote each word for prefix matching
    const ftsQuery = query
      .replace(/['"]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .map((w) => `"${w}"`)
      .join(' ');

    if (!ftsQuery) return [];

    const rows = db.prepare(`
      SELECT e.id, e.session_id, e.chunk_index, e.chunk_text, e.semantic_summary,
             s.title as session_title, s.started_at as session_date
      FROM embeddings_fts fts
      JOIN embeddings e ON e.rowid = fts.rowid
      LEFT JOIN sessions s ON e.session_id = s.id
      WHERE embeddings_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit);

    return rows.map((r) => ({
      type: 'semantic',
      id: r.id,
      sessionId: r.session_id,
      chunkIndex: r.chunk_index,
      content: r.chunk_text,
      summary: r.semantic_summary,
      sessionTitle: r.session_title || 'Untitled',
      sessionDate: r.session_date,
    }));
  } catch (e) {
    log.warn('Embeddings: search failed:', e.message);
    return [];
  }
}

// ── Async Processing Pipeline ───────────────────────────────────

/**
 * Queue a session for embedding generation.
 * Called after a session ends — never blocks the UI.
 *
 * @param {string} sessionId
 * @param {Array} messages - Array of { role, content } objects
 * @param {Function} [onProgress] - Called with (sessionId, processed, total)
 * @param {Function} [onComplete] - Called with (sessionId, chunkCount)
 * @param {Function} [onError] - Called with (sessionId, error)
 */
function indexSession({ sessionId, messages, onProgress, onComplete, onError }) {
  const chunks = chunkConversation(messages);
  if (chunks.length === 0) {
    log.info('Embeddings: no chunks to index for session', sessionId);
    if (onComplete) onComplete(sessionId, 0);
    return;
  }

  // Check if already indexed
  if (_db) {
    try {
      const db = typeof _db.db === 'function' ? _db.db() : _db;
      const existing = db.prepare(
        'SELECT COUNT(*) as c FROM embeddings WHERE session_id = ?'
      ).get(sessionId);
      if (existing && existing.c >= chunks.length) {
        log.info('Embeddings: session already indexed:', sessionId);
        if (onComplete) onComplete(sessionId, existing.c);
        return;
      }
    } catch (_) { /* proceed with indexing */ }
  }

  _queue.push({ sessionId, chunks, onProgress, onComplete, onError });
  _processQueue();
}

/**
 * Process the embedding queue sequentially.
 * Each chunk gets a Claude CLI call — we serialize to avoid overloading.
 */
async function _processQueue() {
  if (_processing || _queue.length === 0) return;
  _processing = true;

  while (_queue.length > 0) {
    const job = _queue.shift();
    const { sessionId, chunks, onProgress, onComplete, onError } = job;

    log.info(`Embeddings: processing ${chunks.length} chunks for session ${sessionId}`);
    let processed = 0;

    for (let i = 0; i < chunks.length; i++) {
      try {
        const summary = await generateSummary(chunks[i]);
        storeChunk(sessionId, i, chunks[i], summary);
        processed++;
        if (onProgress) onProgress(sessionId, processed, chunks.length);
      } catch (e) {
        log.warn(`Embeddings: chunk ${i} failed for ${sessionId}:`, e.message);
        // Store the chunk without a summary — still searchable by raw text
        storeChunk(sessionId, i, chunks[i], null);
        processed++;
      }
    }

    log.info(`Embeddings: completed ${processed}/${chunks.length} chunks for ${sessionId}`);
    if (onComplete) onComplete(sessionId, processed);
  }

  _processing = false;
}

/**
 * Check if the embedding pipeline is currently processing.
 */
function isProcessing() {
  return _processing;
}

/**
 * Get embedding stats for a session.
 */
function getSessionStats(sessionId) {
  if (!_db) return { total: 0, withSummary: 0 };
  try {
    const db = typeof _db.db === 'function' ? _db.db() : _db;
    const total = db.prepare(
      'SELECT COUNT(*) as c FROM embeddings WHERE session_id = ?'
    ).get(sessionId);
    const withSummary = db.prepare(
      'SELECT COUNT(*) as c FROM embeddings WHERE session_id = ? AND semantic_summary IS NOT NULL'
    ).get(sessionId);
    return {
      total: total ? total.c : 0,
      withSummary: withSummary ? withSummary.c : 0,
    };
  } catch (_) {
    return { total: 0, withSummary: 0 };
  }
}

module.exports = {
  init,
  chunkConversation,
  indexSession,
  search,
  isProcessing,
  getSessionStats,
};
