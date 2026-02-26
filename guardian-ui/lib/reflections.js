/**
 * Guardian — Reflections
 *
 * Ingestion, search, and analysis of exported Claude conversation history.
 * Supports both raw .json and .zip exports containing conversations.json.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const log = require('./logger');
const { buildFtsQuery } = require('./database');
const ollama = require('./ollama');

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── ZIP Helpers ──────────────────────────────────────────────

/**
 * Extract a single file by name from a zip buffer.
 * Returns the file contents as a UTF-8 string, or null if not found.
 */
function extractFileFromZip(buf, targetName) {
  let offset = 0;
  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compressionMethod = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);

    const nameStart = offset + 30;
    const relPath = buf.toString('utf-8', nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    const compressedData = buf.subarray(dataStart, dataStart + compressedSize);

    offset = dataStart + compressedSize;

    if (relPath !== targetName && !relPath.endsWith('/' + targetName)) continue;

    if (compressionMethod === 0) {
      return compressedData.toString('utf-8');
    } else if (compressionMethod === 8) {
      const inflated = zlib.inflateRawSync(compressedData);
      return inflated.toString('utf-8');
    }
  }
  return null;
}

// ── Ingestion ────────────────────────────────────────────────

/**
 * Ingest a Claude conversation export (zip or json).
 * Idempotent — safe to run on the same file twice (INSERT OR IGNORE).
 * Returns { conversations, messages, skipped, dateRange }.
 */
function ingestExport(db, filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = filePath.toLowerCase();
  let rawJson;

  if (ext.endsWith('.zip')) {
    const buf = fs.readFileSync(filePath);
    rawJson = extractFileFromZip(buf, 'conversations.json');
    if (!rawJson) {
      throw new Error('No conversations.json found in zip');
    }
  } else if (ext.endsWith('.json')) {
    rawJson = fs.readFileSync(filePath, 'utf-8');
  } else {
    throw new Error('Unsupported file type. Expected .json or .zip');
  }

  const conversations = JSON.parse(rawJson);
  if (!Array.isArray(conversations)) {
    throw new Error('Expected a JSON array of conversations');
  }

  const sourceFile = path.basename(filePath);
  const now = new Date().toISOString();

  const insertConvo = db.prepare(`
    INSERT OR IGNORE INTO reflection_conversations
      (id, title, source_file, created_at, message_count, human_count, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMsg = db.prepare(`
    INSERT OR IGNORE INTO reflection_messages
      (id, conversation_id, sender, text, created_at, seq)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let totalConversations = 0;
  let totalMessages = 0;
  let skipped = 0;
  let earliest = null;
  let latest = null;

  const tx = db.transaction(() => {
    for (const convo of conversations) {
      const convoId = convo.uuid || convo.id;
      if (!convoId) { skipped++; continue; }

      const msgs = convo.chat_messages || convo.messages || [];
      const title = convo.name || convo.title || 'Untitled';
      const createdAt = convo.created_at || convo.create_time || now;
      const humanCount = msgs.filter(m =>
        (m.sender === 'human') || (m.role === 'human') || (m.role === 'user')
      ).length;

      const result = insertConvo.run(
        convoId, title, sourceFile, createdAt,
        msgs.length, humanCount, now
      );

      if (result.changes === 0) { skipped++; continue; }
      totalConversations++;

      // Track date range
      if (!earliest || createdAt < earliest) earliest = createdAt;
      if (!latest || createdAt > latest) latest = createdAt;

      for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        const msgId = msg.uuid || msg.id || `${convoId}_${i}`;
        const sender = normalizeSender(msg.sender || msg.role);
        const text = extractText(msg);
        const msgCreatedAt = msg.created_at || msg.timestamp || createdAt;

        if (!text) continue;

        insertMsg.run(msgId, convoId, sender, text, msgCreatedAt, i);
        totalMessages++;
      }
    }
  });

  tx();

  log.info(`Reflections: ingested ${totalConversations} conversations, ${totalMessages} messages from ${sourceFile}`);

  return {
    conversations: totalConversations,
    messages: totalMessages,
    skipped,
    dateRange: { earliest, latest },
  };
}

function normalizeSender(sender) {
  if (!sender) return 'assistant';
  const s = sender.toLowerCase();
  if (s === 'human' || s === 'user') return 'human';
  return 'assistant';
}

function extractText(msg) {
  // Handle various export formats
  if (typeof msg.text === 'string') return msg.text;
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
  }
  return '';
}

// ── Full Text Search ─────────────────────────────────────────

/**
 * Search reflection messages using FTS5.
 * Returns messages with conversation metadata and FTS highlights.
 */
function search(db, { query, sender, from, to, limit = 50 }) {
  if (!query || !query.trim()) return [];

  const ftsQuery = buildFtsQuery(query);
  const where = [];
  const params = [ftsQuery];

  if (sender && sender !== 'both') {
    where.push('m.sender = ?');
    params.push(sender);
  }
  if (from) {
    where.push('m.created_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('m.created_at <= ?');
    params.push(to);
  }

  const whereClause = where.length > 0 ? 'AND ' + where.join(' AND ') : '';

  try {
    const rows = db.prepare(`
      SELECT
        m.id, m.conversation_id, m.sender, m.created_at, m.seq,
        highlight(reflection_messages_fts, 0, '<mark>', '</mark>') AS highlighted_text,
        m.text,
        c.title AS conversation_title,
        c.created_at AS conversation_date,
        c.message_count
      FROM reflection_messages_fts fts
      JOIN reflection_messages m ON m.rowid = fts.rowid
      JOIN reflection_conversations c ON c.id = m.conversation_id
      WHERE reflection_messages_fts MATCH ?
      ${whereClause}
      ORDER BY rank
      LIMIT ?
    `).all(...params, limit);

    // Add surrounding context (prev + next message)
    const getContext = db.prepare(`
      SELECT id, sender, text, seq FROM reflection_messages
      WHERE conversation_id = ? AND seq = ?
    `);

    return rows.map(row => {
      const prev = getContext.get(row.conversation_id, row.seq - 1);
      const next = getContext.get(row.conversation_id, row.seq + 1);
      return {
        ...row,
        context: { prev: prev || null, next: next || null },
      };
    });
  } catch (e) {
    log.warn('Reflections search failed:', e.message);
    return [];
  }
}

// ── Conversation Reader ──────────────────────────────────────

/**
 * Get all messages for a conversation, ordered by seq.
 */
function getConversation(db, conversationId) {
  const convo = db.prepare(
    'SELECT * FROM reflection_conversations WHERE id = ?'
  ).get(conversationId);
  if (!convo) return null;

  const messages = db.prepare(
    'SELECT * FROM reflection_messages WHERE conversation_id = ? ORDER BY seq ASC'
  ).all(conversationId);

  return { ...convo, messages };
}

/**
 * Paginated conversation list with optional title search.
 */
function listConversations(db, { limit = 50, offset = 0, search: titleSearch } = {}) {
  let sql = 'SELECT * FROM reflection_conversations';
  const params = [];

  if (titleSearch && titleSearch.trim()) {
    sql += ' WHERE title LIKE ?';
    params.push(`%${titleSearch.trim()}%`);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);

  const countSql = titleSearch && titleSearch.trim()
    ? 'SELECT COUNT(*) as c FROM reflection_conversations WHERE title LIKE ?'
    : 'SELECT COUNT(*) as c FROM reflection_conversations';
  const countParams = titleSearch && titleSearch.trim() ? [`%${titleSearch.trim()}%`] : [];
  const total = db.prepare(countSql).get(...countParams).c;

  return { conversations: rows, total };
}

// ── Stats ────────────────────────────────────────────────────

function getStats(db) {
  const convos = db.prepare('SELECT COUNT(*) as c FROM reflection_conversations').get().c;
  if (convos === 0) return null;

  const msgs = db.prepare('SELECT COUNT(*) as c FROM reflection_messages').get().c;
  const humanMsgs = db.prepare("SELECT COUNT(*) as c FROM reflection_messages WHERE sender = 'human'").get().c;

  const earliest = db.prepare(
    'SELECT MIN(created_at) as d FROM reflection_conversations'
  ).get().d;
  const latest = db.prepare(
    'SELECT MAX(created_at) as d FROM reflection_conversations'
  ).get().d;

  // Most active conversations by message count
  const topConversations = db.prepare(`
    SELECT id, title, message_count, created_at
    FROM reflection_conversations
    ORDER BY message_count DESC
    LIMIT 10
  `).all();

  return {
    conversations: convos,
    messages: msgs,
    humanMessages: humanMsgs,
    dateRange: { earliest, latest },
    topConversations,
  };
}

// ── Semantic Search ──────────────────────────────────────────

async function semanticSearch(db, { query, limit = 20 }) {
  const embeddingCount = db.prepare(
    'SELECT COUNT(*) as c FROM reflection_embeddings'
  ).get().c;

  if (embeddingCount === 0) {
    throw new Error('No embeddings available. Run "Embed All" first.');
  }

  const queryVec = await ollama.embed(query);

  const rows = db.prepare(`
    SELECT e.message_id, e.vector,
           m.text, m.sender, m.created_at,
           m.conversation_id,
           c.title AS conversation_title
    FROM reflection_embeddings e
    JOIN reflection_messages m ON m.id = e.message_id
    JOIN reflection_conversations c ON c.id = m.conversation_id
  `).all();

  const scored = rows.map((row) => {
    const vec = new Float32Array(new Uint8Array(row.vector).buffer);
    const similarity = cosineSimilarity(queryVec, vec);
    return {
      id: row.message_id,
      conversation_id: row.conversation_id,
      conversation_title: row.conversation_title,
      sender: row.sender,
      text: row.text,
      created_at: row.created_at,
      similarity,
    };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

async function embedAll(db, { onProgress }) {
  const rows = db.prepare(`
    SELECT m.id, m.text
    FROM reflection_messages m
    LEFT JOIN reflection_embeddings e ON e.message_id = m.id
    WHERE e.message_id IS NULL
  `).all();

  const total = rows.length;
  if (total === 0) {
    if (onProgress) onProgress({ done: 0, total: 0, status: 'done', errors: [] });
    return;
  }

  const insert = db.prepare(
    'INSERT OR REPLACE INTO reflection_embeddings (message_id, vector) VALUES (?, ?)'
  );

  let done = 0;
  const errors = [];

  for (const row of rows) {
    if (!row.text || !row.text.trim()) {
      done++;
      continue;
    }
    try {
      const vec = await ollama.embed(row.text);
      const buf = Buffer.from(new Float32Array(vec).buffer);
      insert.run(row.id, buf);
    } catch (e) {
      errors.push(`${row.id}: ${e.message}`);
      log.warn(`Reflections embed failed for ${row.id}:`, e.message);
    }
    done++;
    if (onProgress) onProgress({ done, total, status: 'embedding', errors });
  }

  if (onProgress) onProgress({ done, total, status: 'done', errors });
}

// ── LLM Analysis (RAG) ──────────────────────────────────────

async function analyze(db, { query, limit = 10 }) {
  let sources;
  try {
    sources = await semanticSearch(db, { query, limit: 5 });
  } catch {
    // Fall back to FTS if no embeddings
    sources = search(db, { query, limit: 5 }).map((r) => ({
      id: r.id,
      conversation_id: r.conversation_id,
      conversation_title: r.conversation_title,
      sender: r.sender,
      text: r.text,
      created_at: r.created_at,
      similarity: null,
    }));
  }

  if (sources.length === 0) {
    return { answer: 'No relevant context found for this query.', sources: [] };
  }

  const excerpts = sources
    .map((s, i) => `${i + 1}. [${s.sender} in "${s.conversation_title}"]: ${s.text.slice(0, 500)}`)
    .join('\n');

  const prompt = `You are analyzing conversation history. Based on the following excerpts, answer the user's question with specific references.

[Excerpts]
${excerpts}

Question: ${query}

Provide a thoughtful analysis with references to specific conversations.`;

  const answer = await ollama.generate(prompt);
  return { answer, sources };
}

module.exports = {
  ingestExport,
  search,
  getConversation,
  listConversations,
  getStats,
  semanticSearch,
  embedAll,
  analyze,
};
