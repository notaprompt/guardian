"use strict";
/**
 * ForgeFrame Migration — One-time data transfer from Guardian SQLite
 *
 * Migrates notes, queue items, and compression memories to ForgeFrame.
 * Sessions, messages, usage, and artifacts stay in Guardian.
 * Idempotent: uses source IDs to prevent duplicates.
 *
 * Usage: call migrate(database) after ForgeFrame MCP is connected.
 */

const forgeframeMcp = require('./forgeframe-mcp');
const log = require('./logger');

const BATCH_DELAY = 50; // ms between writes to avoid flooding

async function migrate(database) {
  if (!forgeframeMcp.isConnected()) {
    log.warn('ForgeFrame migration: MCP not connected, skipping');
    return { notes: 0, queue: 0, compression: 0 };
  }

  const counts = { notes: 0, queue: 0, compression: 0 };
  const db = database.db();

  // Check if already migrated
  const status = await forgeframeMcp.memoryStatus();
  if (status && status.totalMemories > 50) {
    log.info('ForgeFrame migration: already has', status.totalMemories, 'memories, skipping bulk migration');
    return counts;
  }

  log.info('ForgeFrame migration: starting...');

  // Migrate notes
  try {
    const notes = db.prepare('SELECT * FROM notes ORDER BY created_at ASC').all();
    for (const note of notes) {
      const tags = _parseTags(note.tags);
      tags.push('source:guardian', 'type:note', 'migrated');
      if (note.type) tags.push(`note-type:${note.type}`);
      await forgeframeMcp.memorySave(
        `${note.title || 'Untitled'}\n\n${note.content || ''}`.trim(),
        { tags, source: `guardian:note:${note.id}` }
      );
      counts.notes++;
      await _delay(BATCH_DELAY);
    }
  } catch (err) {
    log.warn('ForgeFrame migration: notes failed:', err.message);
  }

  // Migrate queue items
  try {
    const items = db.prepare('SELECT * FROM queue_items ORDER BY created_at ASC').all();
    for (const item of items) {
      await forgeframeMcp.memorySave(
        item.text,
        {
          tags: ['source:guardian', 'type:queue', `status:${item.status}`, 'migrated'],
          source: `guardian:queue:${item.id}`,
        }
      );
      counts.queue++;
      await _delay(BATCH_DELAY);
    }
  } catch (err) {
    log.warn('ForgeFrame migration: queue failed:', err.message);
  }

  // Migrate compression memories
  try {
    const items = db.prepare('SELECT * FROM compression_levels ORDER BY level ASC, created_at ASC').all();
    for (const item of items) {
      const tags = ['source:guardian', 'type:compression', `level:${item.level}`, 'migrated'];
      if (item.status === 'pinned') tags.push('pinned');
      await forgeframeMcp.memorySave(
        item.content,
        {
          tags,
          source: `guardian:compression:${item.id}`,
          strength: item.strength,
        }
      );
      counts.compression++;
      await _delay(BATCH_DELAY);
    }
  } catch (err) {
    log.warn('ForgeFrame migration: compression failed:', err.message);
  }

  log.info(`ForgeFrame migration complete: ${counts.notes} notes, ${counts.queue} queue items, ${counts.compression} compression memories`);
  return counts;
}

function _parseTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return [...tags];
  try { return JSON.parse(tags); } catch { return []; }
}

function _delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { migrate };
