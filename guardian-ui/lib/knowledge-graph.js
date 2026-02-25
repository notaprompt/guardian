/**
 * Guardian — Knowledge Graph
 *
 * Entity extraction from conversation sessions via Claude CLI,
 * plus DB operations for entities and relationships.
 * Persistent entity and relationship storage.
 */

const { spawn } = require('child_process');
const os = require('os');
const log = require('./logger');
const { getClaudePath, cliEnv } = require('./claude-cli');
const { generateId } = require('./database');

// ── Entity Extraction ──────────────────────────────────────────

/**
 * Extract entities and relationships from a set of messages
 * by spawning Claude CLI with a structured-output prompt.
 *
 * @param {Array} messages - Array of { role, content } message objects
 * @param {Function} onComplete - (entities, relationships) => void
 * @param {Function} onError - (err) => void
 */
function extractEntities(messages, { onComplete, onError }) {
  const conversationText = messages
    .filter((m) => m.content && m.content.trim())
    .map((m) => `[${m.role}]: ${m.content.slice(0, 2000)}`)
    .join('\n\n');

  if (!conversationText.trim()) {
    onError(new Error('No conversation content to extract from'));
    return;
  }

  // Cap input to avoid overloading
  const truncated = conversationText.slice(0, 12000);

  const prompt = `Analyze this conversation and extract entities and relationships. Return ONLY valid JSON, no markdown fences, no explanation.

Conversation:
---
${truncated}
---

Return JSON in exactly this format:
{"entities":[{"name":"string","type":"person|concept|project|decision|question"}],"relationships":[{"source":"entity name","target":"entity name","type":"related_to|contradicts|builds_on|depends_on"}]}

Rules:
- Entity names should be concise (1-4 words), lowercase
- Types: person (named people/roles), concept (ideas/theories/technologies), project (specific projects/products/repos), decision (choices made), question (open questions raised)
- Only extract entities that are substantively discussed, not just mentioned in passing
- Relationships connect entity names exactly as they appear in the entities array
- If no meaningful entities exist, return {"entities":[],"relationships":[]}`;

  const claudePath = getClaudePath();
  const args = ['-p', prompt, '--output-format', 'text', '--model', 'claude-haiku-4-5-20251001'];

  let proc;
  try {
    proc = spawn(claudePath, args, {
      cwd: os.homedir(),
      env: cliEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    onError(new Error(`Failed to spawn Claude CLI for extraction: ${e.message}`));
    return;
  }

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  proc.on('close', (code) => {
    if (code !== 0) {
      onError(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
      return;
    }

    try {
      // Try to extract JSON from the response (handle markdown fences)
      let jsonStr = stdout.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);
      const entities = Array.isArray(parsed.entities) ? parsed.entities : [];
      const relationships = Array.isArray(parsed.relationships) ? parsed.relationships : [];

      // Validate entity structure
      const validEntities = entities.filter(
        (e) => e.name && typeof e.name === 'string' && e.type && typeof e.type === 'string'
      );
      const validRelationships = relationships.filter(
        (r) => r.source && r.target && r.type
      );

      onComplete(validEntities, validRelationships);
    } catch (e) {
      onError(new Error(`Failed to parse extraction result: ${e.message}\nRaw: ${stdout.slice(0, 500)}`));
    }
  });
}

// ── Database Operations ─────────────────────────────────────────

/**
 * Initialize knowledge graph tables in the given database.
 * Called from database.js during schema creation.
 */
function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      mention_count INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      session_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_entity_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_entity_id);
  `);
}

/**
 * Upsert an entity: insert if new, increment mention_count if exists.
 */
function upsertEntity(db, entity) {
  const now = new Date().toISOString();
  const id = `e_${entity.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

  const existing = db.prepare('SELECT * FROM entities WHERE name = ?').get(entity.name.toLowerCase());

  if (existing) {
    db.prepare(`
      UPDATE entities SET mention_count = mention_count + 1, last_seen = ? WHERE name = ?
    `).run(now, entity.name.toLowerCase());
    return existing.id;
  } else {
    db.prepare(`
      INSERT INTO entities (id, name, type, first_seen, last_seen, mention_count)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, entity.name.toLowerCase(), entity.type, now, now);
    return id;
  }
}

/**
 * Insert a relationship between two entities.
 */
function addRelationship(db, sourceId, targetId, type, sessionId) {
  const id = generateId('r');
  const now = new Date().toISOString();

  // Avoid duplicate relationships in the same session
  const existing = db.prepare(`
    SELECT id FROM relationships
    WHERE source_entity_id = ? AND target_entity_id = ? AND type = ? AND session_id = ?
  `).get(sourceId, targetId, type, sessionId);

  if (!existing) {
    db.prepare(`
      INSERT INTO relationships (id, source_entity_id, target_entity_id, type, session_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sourceId, targetId, type, sessionId, now);
  }
}

/**
 * Process extraction results: upsert entities, add relationships.
 */
function mergeExtractionResults(db, entities, relationships, sessionId) {
  const nameToId = {};

  const upsertTx = db.transaction(() => {
    for (const entity of entities) {
      const id = upsertEntity(db, entity);
      nameToId[entity.name.toLowerCase()] = id;
    }
  });
  upsertTx();

  const relTx = db.transaction(() => {
    for (const rel of relationships) {
      const sourceId = nameToId[rel.source.toLowerCase()];
      const targetId = nameToId[rel.target.toLowerCase()];
      if (sourceId && targetId) {
        addRelationship(db, sourceId, targetId, rel.type, sessionId);
      }
    }
  });
  relTx();

  return { entityCount: entities.length, relationshipCount: relationships.length };
}

/**
 * Get all entities, optionally filtered.
 */
function getEntities(db, opts = {}) {
  let sql = 'SELECT * FROM entities';
  const params = [];
  const where = [];

  if (opts.type) {
    where.push('type = ?');
    params.push(opts.type);
  }
  if (opts.minMentions) {
    where.push('mention_count >= ?');
    params.push(opts.minMentions);
  }

  if (where.length > 0) {
    sql += ' WHERE ' + where.join(' AND ');
  }
  sql += ' ORDER BY mention_count DESC';

  if (opts.limit) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }

  return db.prepare(sql).all(...params);
}

/**
 * Get all relationships, with entity details joined.
 */
function getRelationships(db, opts = {}) {
  let sql = `
    SELECT r.*,
           se.name as source_name, se.type as source_type,
           te.name as target_name, te.type as target_type
    FROM relationships r
    JOIN entities se ON r.source_entity_id = se.id
    JOIN entities te ON r.target_entity_id = te.id
  `;
  const params = [];

  if (opts.entityId) {
    sql += ' WHERE r.source_entity_id = ? OR r.target_entity_id = ?';
    params.push(opts.entityId, opts.entityId);
  }

  sql += ' ORDER BY r.created_at DESC';

  if (opts.limit) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }

  return db.prepare(sql).all(...params);
}

/**
 * Get sessions that mention a specific entity.
 */
function getEntitySessions(db, entityId) {
  return db.prepare(`
    SELECT DISTINCT s.id, s.title, s.started_at, s.summary
    FROM relationships r
    JOIN sessions s ON r.session_id = s.id
    WHERE r.source_entity_id = ? OR r.target_entity_id = ?
    ORDER BY s.started_at DESC
    LIMIT 20
  `).all(entityId, entityId);
}

module.exports = {
  extractEntities,
  createSchema,
  upsertEntity,
  addRelationship,
  mergeExtractionResults,
  getEntities,
  getRelationships,
  getEntitySessions,
};
