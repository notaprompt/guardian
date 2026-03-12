"use strict";
/**
 * ForgeFrame Sync — Dual-Write Bridge
 *
 * Mirrors Guardian write operations to ForgeFrame MCP memory.
 * All calls are fire-and-forget (async, non-blocking, fail-silent).
 * Guardian's local SQLite remains the source of truth.
 */

const forgeframeMcp = require('./forgeframe-mcp');
const log = require('./logger');

/**
 * Mirror a note create/update to ForgeFrame memory.
 */
function syncNote(note) {
  if (!forgeframeMcp.isConnected()) return;
  const tags = _parseTags(note.tags);
  tags.push('source:guardian', 'type:note');
  if (note.type) tags.push(`note-type:${note.type}`);

  forgeframeMcp.memorySave(
    `${note.title || 'Untitled'}\n\n${note.content || ''}`.trim(),
    {
      tags,
      source: `guardian:note:${note.id}`,
    }
  ).catch((err) => log.debug('ForgeFrame sync note failed:', err?.message));
}

/**
 * Mirror a compression memory create to ForgeFrame memory.
 */
function syncCompression(item) {
  if (!forgeframeMcp.isConnected()) return;
  const tags = ['source:guardian', 'type:compression', `level:${item.level}`];
  if (item.status === 'pinned') tags.push('pinned');

  forgeframeMcp.memorySave(
    item.content,
    {
      tags,
      source: `guardian:compression:${item.id}`,
      strength: item.strength,
    }
  ).catch((err) => log.debug('ForgeFrame sync compression failed:', err?.message));
}

/**
 * Mirror a queue item to ForgeFrame memory.
 */
function syncQueueItem(item) {
  if (!forgeframeMcp.isConnected()) return;
  forgeframeMcp.memorySave(
    item.text,
    {
      tags: ['source:guardian', 'type:queue', `status:${item.status || 'open'}`],
      source: `guardian:queue:${item.id}`,
    }
  ).catch((err) => log.debug('ForgeFrame sync queue failed:', err?.message));
}

/**
 * Mirror session start to ForgeFrame.
 */
function syncSessionStart(sessionId, title) {
  if (!forgeframeMcp.isConnected()) return;
  forgeframeMcp.sessionStart(title || sessionId)
    .catch((err) => log.debug('ForgeFrame sync session start failed:', err?.message));
}

/**
 * Mirror session end to ForgeFrame.
 */
function syncSessionEnd() {
  if (!forgeframeMcp.isConnected()) return;
  forgeframeMcp.sessionEnd()
    .catch((err) => log.debug('ForgeFrame sync session end failed:', err?.message));
}

function _parseTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return [...tags];
  try { return JSON.parse(tags); } catch { return []; }
}

module.exports = {
  syncNote,
  syncCompression,
  syncQueueItem,
  syncSessionStart,
  syncSessionEnd,
};
