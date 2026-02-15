/**
 * Guardian — Conversation Import Worker
 *
 * Async batch processor that imports parsed conversations into Guardian's
 * existing data layer (sessions, messages, FTS, embeddings).
 * Reports progress via callback, supports cancellation between batches.
 */

const log = require('./logger');

// ── Active imports for cancellation ──────────────────────────────

const _activeImports = new Map(); // batchId → { cancelled: false, status, progress, stats }

// ── Import Pipeline ──────────────────────────────────────────────

/**
 * Start an import of parsed conversations into the database.
 *
 * @param {Object} opts
 * @param {Array} opts.conversations - Normalized conversations from import-parser
 * @param {string} opts.batchId - Import batch ID
 * @param {Object} opts.database - Database module reference
 * @param {Object} opts.embeddings - Embeddings module reference (optional)
 * @param {Function} opts.onProgress - ({ phase, current, total, batchId, percent }) => void
 * @param {Function} opts.onComplete - ({ batchId, stats }) => void
 * @param {Function} opts.onError - ({ batchId, error }) => void
 * @param {number} [opts.batchSize=50] - Conversations per batch
 */
function startImport({ conversations, batchId, database, embeddings, onProgress, onComplete, onError, batchSize = 50 }) {
  const state = {
    cancelled: false,
    status: 'processing',
    progress: { phase: 'importing', current: 0, total: conversations.length, percent: 10 },
    stats: { imported: 0, skipped: 0, errors: 0 },
  };
  _activeImports.set(batchId, state);

  // Update batch status in DB
  try {
    database.importBatches.update(batchId, {
      status: 'processing',
      totalConversations: conversations.length,
    });
  } catch (e) {
    log.warn('Import worker: failed to update batch status:', e.message);
  }

  // Run async
  _processImport({ conversations, batchId, database, embeddings, onProgress, onComplete, onError, batchSize, state })
    .catch((e) => {
      log.error('Import worker: unexpected error:', e.message);
      state.status = 'failed';
      try {
        database.importBatches.update(batchId, {
          status: 'failed',
          errorMessage: e.message,
          completedAt: new Date().toISOString(),
        });
      } catch (_) {}
      if (onError) onError({ batchId, error: e.message });
    });
}

/**
 * Internal async processing loop.
 */
async function _processImport({ conversations, batchId, database, embeddings, onProgress, onComplete, onError, batchSize, state }) {
  const total = conversations.length;
  const db = database.db();

  // Prepare statements for bulk insert
  const insertSession = db.prepare(`
    INSERT INTO sessions (id, project_id, claude_session_id, title, model, started_at, source, import_batch_id, original_id, message_count)
    VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMessage = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, thinking, attachments, tokens_in, tokens_out, timestamp)
    VALUES (?, ?, ?, ?, NULL, NULL, 0, 0, ?)
  `);

  const insertMessageFts = db.prepare(`
    INSERT INTO messages_fts(rowid, content, thinking)
    VALUES ((SELECT rowid FROM messages WHERE id = ?), ?, '')
  `);

  const insertSessionFts = db.prepare(`
    INSERT INTO sessions_fts(rowid, title, summary)
    VALUES ((SELECT rowid FROM sessions WHERE id = ?), ?, '')
  `);

  // Check for existing imports (deduplication)
  const checkExisting = db.prepare(
    'SELECT id FROM sessions WHERE source = ? AND original_id = ?'
  );

  // Process in batches
  for (let i = 0; i < total; i += batchSize) {
    // Check for cancellation between batches
    if (state.cancelled) {
      log.info('Import worker: cancelled at conversation', i, '/', total);
      state.status = 'cancelled';
      try {
        database.importBatches.update(batchId, {
          status: 'cancelled',
          importedConversations: state.stats.imported,
          skippedConversations: state.stats.skipped,
          completedAt: new Date().toISOString(),
        });
      } catch (_) {}
      if (onComplete) onComplete({ batchId, stats: state.stats });
      _activeImports.delete(batchId);
      return;
    }

    const batchEnd = Math.min(i + batchSize, total);
    const batch = conversations.slice(i, batchEnd);

    // Wrap each batch in a transaction for performance
    const importBatch = db.transaction((items) => {
      for (const conv of items) {
        try {
          // Deduplication: skip if already imported
          const existing = checkExisting.get(conv.source, conv.id);
          if (existing) {
            state.stats.skipped++;
            continue;
          }

          // Create session
          const sessionId = `s_imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          insertSession.run(
            sessionId,
            conv.title || 'Imported conversation',
            conv.model || null,
            conv.createdAt || new Date().toISOString(),
            conv.source,
            batchId,
            conv.id,
            conv.messageCount || conv.messages.length
          );

          // Index session title in FTS
          try { insertSessionFts.run(sessionId, conv.title || ''); } catch (_) {}

          // Create messages
          for (let m = 0; m < conv.messages.length; m++) {
            const msg = conv.messages[m];
            const msgId = `m_imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${m}`;
            insertMessage.run(
              msgId,
              sessionId,
              msg.role,
              msg.content || '',
              msg.timestamp || conv.createdAt || new Date().toISOString()
            );

            // Index message in FTS
            try { insertMessageFts.run(msgId, msg.content || ''); } catch (_) {}
          }

          state.stats.imported++;
        } catch (e) {
          state.stats.errors++;
          log.warn('Import worker: failed to import conversation:', e.message);
        }
      }
    });

    try {
      importBatch(batch);
    } catch (e) {
      log.error('Import worker: batch transaction failed:', e.message);
      state.stats.errors += batch.length;
    }

    // Report progress
    const current = Math.min(batchEnd, total);
    const percent = Math.round(10 + (current / total) * 70); // 10-80%
    state.progress = { phase: 'importing', current, total, percent };
    if (onProgress) onProgress({ phase: 'importing', current, total, batchId, percent });
  }

  // ── Indexing phase (80-95%) ─────────────────────────────────────
  state.progress = { phase: 'indexing', current: 0, total: state.stats.imported, percent: 80 };
  if (onProgress) onProgress({ phase: 'indexing', current: 0, total: state.stats.imported, batchId, percent: 80 });

  // Queue imported sessions for embedding generation
  if (embeddings && state.stats.imported > 0) {
    try {
      const importedSessions = db.prepare(
        'SELECT id FROM sessions WHERE import_batch_id = ?'
      ).all(batchId);

      let indexed = 0;
      for (const session of importedSessions) {
        if (state.cancelled) break;
        try {
          const msgs = database.messages.listBySession(session.id);
          if (msgs.length >= 2) {
            embeddings.indexSession({
              sessionId: session.id,
              messages: msgs,
              onComplete: () => {
                indexed++;
                log.info('Import worker: indexed session', session.id);
              },
              onError: (sid, err) => {
                log.warn('Import worker: embedding failed for', sid, ':', err?.message || err);
              },
            });
          }
        } catch (e) {
          log.warn('Import worker: embedding setup failed for', session.id, ':', e.message);
        }
      }
    } catch (e) {
      log.warn('Import worker: embedding indexing phase failed:', e.message);
    }
  }

  // Report indexing progress
  state.progress = { phase: 'indexing', current: state.stats.imported, total: state.stats.imported, percent: 95 };
  if (onProgress) onProgress({ phase: 'indexing', current: state.stats.imported, total: state.stats.imported, batchId, percent: 95 });

  // ── Complete ────────────────────────────────────────────────────
  state.status = 'complete';
  state.progress = { phase: 'complete', current: total, total, percent: 100 };
  if (onProgress) onProgress({ phase: 'complete', current: total, total, batchId, percent: 100 });

  try {
    database.importBatches.update(batchId, {
      status: 'complete',
      importedConversations: state.stats.imported,
      skippedConversations: state.stats.skipped,
      completedAt: new Date().toISOString(),
    });
  } catch (e) {
    log.warn('Import worker: failed to update batch completion:', e.message);
  }

  log.info(`Import worker: batch ${batchId} complete — imported: ${state.stats.imported}, skipped: ${state.stats.skipped}, errors: ${state.stats.errors}`);
  if (onComplete) onComplete({ batchId, stats: state.stats });
  _activeImports.delete(batchId);
}

// ── Cancellation ─────────────────────────────────────────────────

/**
 * Cancel an in-progress import. Takes effect between batches.
 * @param {string} batchId
 */
function cancelImport(batchId) {
  const state = _activeImports.get(batchId);
  if (state) {
    state.cancelled = true;
    log.info('Import worker: cancel requested for batch', batchId);
    return true;
  }
  return false;
}

// ── Status ───────────────────────────────────────────────────────

/**
 * Get the current status of an import batch.
 * @param {string} batchId
 * @returns {{ status: string, progress: Object, stats: Object } | null}
 */
function getImportStatus(batchId) {
  const state = _activeImports.get(batchId);
  if (state) {
    return {
      status: state.status,
      progress: state.progress,
      stats: state.stats,
    };
  }
  return null;
}

module.exports = {
  startImport,
  cancelImport,
  getImportStatus,
};
