/**
 * Guardian -- Librarian (Auto-Extraction Pipeline)
 *
 * "Claude as Librarian": extracts structured insights from conversation
 * sessions, auto-creates notes, files code artifacts, and links everything
 * to the knowledge graph. Runs asynchronously -- never blocks the UI.
 *
 * Spec: V.1.c Librarian Pipeline
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const log = require('./logger');
const { DIRS } = require('./paths');

// ── Claude CLI resolution (mirrors summarizer.js / knowledge-graph.js) ──

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

// ── Helpers ─────────────────────────────────────────────────────

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── 1. extractInsights ──────────────────────────────────────────

/**
 * Extract structured insights from a set of messages via Claude CLI (Haiku).
 *
 * @param {Array} messages - Array of { role, content }
 * @param {Object} opts
 * @param {Function} opts.onComplete - (insights) => void
 * @param {Function} opts.onError    - (err) => void
 */
function extractInsights(messages, { onComplete, onError }) {
  const conversationText = messages
    .filter((m) => m.content && m.content.trim())
    .map((m) => `[${m.role}]: ${m.content.slice(0, 2000)}`)
    .join('\n\n');

  if (!conversationText.trim()) {
    onError(new Error('No conversation content to extract insights from'));
    return;
  }

  // Cap at 12000 chars (same as knowledge-graph.js)
  const truncated = conversationText.slice(0, 12000);

  const prompt = `Analyze this conversation and extract structured insights. Return ONLY valid JSON, no markdown fences, no explanation.

Conversation:
---
${truncated}
---

Return JSON in exactly this format:
{"decisions":[{"topic":"string","rationale":"string"}],"codeSnippets":[{"language":"string","filename":"string","description":"string","code":"string"}],"questions":[{"text":"string","context":"string"}],"tasks":[{"description":"string","priority":"low|medium|high"}],"keyInsights":[{"text":"string","category":"string"}],"dailySummary":"one paragraph summary of what was accomplished"}

Rules:
- decisions: choices or conclusions made during the conversation
- codeSnippets: any significant code written or discussed (include the actual code)
- questions: open questions raised but not fully resolved
- tasks: action items or things to do that were identified
- keyInsights: important ideas, patterns, or learnings
- dailySummary: brief narrative of what was discussed and accomplished
- If a category has nothing, use an empty array (or empty string for dailySummary)
- Be concise but capture substantive content`;

  const claudePath = getClaudePath();
  const args = ['-p', prompt, '--output-format', 'text', '--model', 'claude-haiku-4-5-20251001'];

  log.info('Librarian: extracting insights');

  let proc;
  try {
    proc = spawn(claudePath, args, {
      cwd: os.homedir(),
      env: cliEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });
  } catch (e) {
    log.error('Librarian: failed to spawn Claude CLI:', e.message);
    onError(new Error(`Failed to spawn Claude CLI for extraction: ${e.message}`));
    return;
  }

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  proc.on('close', (code) => {
    if (code !== 0) {
      const errMsg = stderr.trim() || `Exit code ${code}`;
      log.warn('Librarian: extraction failed:', errMsg);
      onError(new Error(`Claude CLI exited with code ${code}: ${errMsg.slice(0, 500)}`));
      return;
    }

    try {
      // Handle markdown fences (same pattern as knowledge-graph.js)
      let jsonStr = stdout.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);

      // Validate and normalize structure
      const insights = {
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions.filter(
          (d) => d.topic && typeof d.topic === 'string'
        ) : [],
        codeSnippets: Array.isArray(parsed.codeSnippets) ? parsed.codeSnippets.filter(
          (s) => s.code && typeof s.code === 'string'
        ) : [],
        questions: Array.isArray(parsed.questions) ? parsed.questions.filter(
          (q) => q.text && typeof q.text === 'string'
        ) : [],
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks.filter(
          (t) => t.description && typeof t.description === 'string'
        ) : [],
        keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights.filter(
          (i) => i.text && typeof i.text === 'string'
        ) : [],
        dailySummary: typeof parsed.dailySummary === 'string' ? parsed.dailySummary : '',
      };

      log.info('Librarian: extracted', insights.decisions.length, 'decisions,',
        insights.codeSnippets.length, 'snippets,',
        insights.tasks.length, 'tasks,',
        insights.keyInsights.length, 'insights');

      onComplete(insights);
    } catch (e) {
      log.error('Librarian: failed to parse extraction result:', e.message);
      onError(new Error(`Failed to parse extraction result: ${e.message}\nRaw: ${stdout.slice(0, 500)}`));
    }
  });

  proc.on('error', (e) => {
    log.error('Librarian: process error:', e.message);
    onError(e);
  });
}

// ── 2. createAutoNotes ──────────────────────────────────────────

/**
 * Auto-create notes from extracted insights.
 *
 * @param {Object} db - database module (with .notes, .db())
 * @param {string} sessionId
 * @param {Object} insights - output from extractInsights
 * @returns {string[]} array of created note IDs
 */
function createAutoNotes(db, sessionId, insights) {
  const now = new Date().toISOString();
  const noteIds = [];
  const rawDb = db.db();

  const insertNoteSource = rawDb.prepare(`
    INSERT INTO note_sources (id, note_id, session_id, extraction_type, auto_generated, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `);

  // Decisions -> structured notes
  for (const decision of insights.decisions) {
    const id = makeId('n');
    const content = `**Decision:** ${decision.topic}\n\n**Rationale:** ${decision.rationale || 'Not specified'}`;
    db.notes.create({
      id,
      type: 'structured',
      title: `Decision: ${decision.topic.slice(0, 80)}`,
      content,
      tags: ['auto-extracted', 'decision'],
    });
    // Mark as auto-generated
    try {
      rawDb.prepare('UPDATE notes SET auto_generated = 1, source_session_id = ? WHERE id = ?')
        .run(sessionId, id);
    } catch (_) {}
    try {
      insertNoteSource.run(makeId('ns'), id, sessionId, 'decision', now);
    } catch (_) {}
    noteIds.push(id);
  }

  // Tasks -> structured notes
  for (const task of insights.tasks) {
    const id = makeId('n');
    const priority = task.priority || 'medium';
    const content = `**Task:** ${task.description}\n\n**Priority:** ${priority}`;
    db.notes.create({
      id,
      type: 'structured',
      title: `Task: ${task.description.slice(0, 80)}`,
      content,
      tags: ['auto-extracted', 'task', `priority-${priority}`],
    });
    try {
      rawDb.prepare('UPDATE notes SET auto_generated = 1, source_session_id = ? WHERE id = ?')
        .run(sessionId, id);
    } catch (_) {}
    try {
      insertNoteSource.run(makeId('ns'), id, sessionId, 'task', now);
    } catch (_) {}
    noteIds.push(id);
  }

  // Key insights -> scratch notes
  for (const insight of insights.keyInsights) {
    const id = makeId('n');
    const category = insight.category || 'general';
    const content = `${insight.text}`;
    db.notes.create({
      id,
      type: 'scratch',
      title: `Insight: ${insight.text.slice(0, 80)}`,
      content,
      tags: ['auto-extracted', 'insight', category],
    });
    try {
      rawDb.prepare('UPDATE notes SET auto_generated = 1, source_session_id = ? WHERE id = ?')
        .run(sessionId, id);
    } catch (_) {}
    try {
      insertNoteSource.run(makeId('ns'), id, sessionId, 'insight', now);
    } catch (_) {}
    noteIds.push(id);
  }

  // Questions -> scratch notes
  for (const question of insights.questions) {
    const id = makeId('n');
    const content = `**Question:** ${question.text}\n\n**Context:** ${question.context || 'From conversation'}`;
    db.notes.create({
      id,
      type: 'scratch',
      title: `Question: ${question.text.slice(0, 80)}`,
      content,
      tags: ['auto-extracted', 'question'],
    });
    try {
      rawDb.prepare('UPDATE notes SET auto_generated = 1, source_session_id = ? WHERE id = ?')
        .run(sessionId, id);
    } catch (_) {}
    try {
      insertNoteSource.run(makeId('ns'), id, sessionId, 'question', now);
    } catch (_) {}
    noteIds.push(id);
  }

  // Daily summary -> find or create today's journal note, append
  if (insights.dailySummary) {
    const today = todayDateStr();
    const journalTitle = `Journal: ${today}`;

    // Look for existing journal note for today
    const existingJournal = rawDb.prepare(
      "SELECT id, content FROM notes WHERE title = ? AND type = 'journal'"
    ).get(journalTitle);

    if (existingJournal) {
      const separator = '\n\n---\n\n';
      const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const appendedContent = existingJournal.content + separator + `**${timestamp}** — ${insights.dailySummary}`;
      db.notes.update(existingJournal.id, { content: appendedContent });
      noteIds.push(existingJournal.id);
    } else {
      const id = makeId('n');
      const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      db.notes.create({
        id,
        type: 'journal',
        title: journalTitle,
        content: `**${timestamp}** — ${insights.dailySummary}`,
        tags: ['auto-extracted', 'journal'],
      });
      try {
        rawDb.prepare('UPDATE notes SET auto_generated = 1, source_session_id = ? WHERE id = ?')
          .run(sessionId, id);
      } catch (_) {}
      try {
        insertNoteSource.run(makeId('ns'), id, sessionId, 'daily-summary', now);
      } catch (_) {}
      noteIds.push(id);
    }
  }

  log.info('Librarian: created', noteIds.length, 'auto-notes for session', sessionId);
  return noteIds;
}

// ── 3. fileArtifacts ────────────────────────────────────────────

/**
 * Write code/doc artifacts to ~/.guardian/artifacts/ and record in DB.
 *
 * @param {string} sessionId
 * @param {Object} insights - output from extractInsights
 * @param {Object} db - database module (for artifacts table)
 * @returns {string[]} array of artifact IDs
 */
function fileArtifacts(sessionId, insights, db) {
  const artifactIds = [];

  for (const snippet of insights.codeSnippets) {
    const language = (snippet.language || 'text').toLowerCase();
    const filename = snippet.filename || `snippet_${Date.now()}.${extForLang(language)}`;
    const description = snippet.description || '';

    // Ensure language subdirectory exists
    const langDir = path.join(DIRS.artifactsCode, language);
    if (!fs.existsSync(langDir)) {
      fs.mkdirSync(langDir, { recursive: true });
    }

    const filePath = path.join(langDir, filename);

    // Write the file
    try {
      fs.writeFileSync(filePath, snippet.code, 'utf-8');
    } catch (e) {
      log.warn('Librarian: failed to write artifact:', filePath, e.message);
      continue;
    }

    // Record in artifacts table
    const id = makeId('art');
    try {
      const rawDb = db.db();
      rawDb.prepare(`
        INSERT INTO artifacts (id, session_id, type, title, language, file_path, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, sessionId, 'code', description || filename, language, filePath, snippet.code, new Date().toISOString());
      artifactIds.push(id);
    } catch (e) {
      log.warn('Librarian: failed to record artifact in DB:', e.message);
    }
  }

  log.info('Librarian: filed', artifactIds.length, 'artifacts for session', sessionId);
  return artifactIds;
}

/**
 * Map language names to file extensions.
 */
function extForLang(language) {
  const map = {
    javascript: 'js', typescript: 'ts', python: 'py', rust: 'rs',
    go: 'go', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs',
    ruby: 'rb', php: 'php', swift: 'swift', kotlin: 'kt',
    html: 'html', css: 'css', sql: 'sql', bash: 'sh', shell: 'sh',
    json: 'json', yaml: 'yaml', xml: 'xml', markdown: 'md', text: 'txt',
  };
  return map[language] || 'txt';
}

// ── 4. linkToGraph ──────────────────────────────────────────────

/**
 * Link knowledge graph entities from this session to the created notes/artifacts.
 *
 * @param {Object} db - database module
 * @param {string} sessionId
 * @param {string[]} noteIds
 * @param {string[]} artifactIds
 * @returns {{ entitiesLinked: number }}
 */
function linkToGraph(db, sessionId, noteIds, artifactIds) {
  const rawDb = db.db();
  const now = new Date().toISOString();
  let entitiesLinked = 0;

  // Find entities that were seen in this session via relationships table
  let entityIds = [];
  try {
    entityIds = rawDb.prepare(`
      SELECT DISTINCT source_entity_id AS entity_id FROM relationships WHERE session_id = ?
      UNION
      SELECT DISTINCT target_entity_id AS entity_id FROM relationships WHERE session_id = ?
    `).all(sessionId, sessionId).map((r) => r.entity_id);
  } catch (_) {
    // relationships table may not have data for this session yet
  }

  if (entityIds.length === 0) return { entitiesLinked: 0 };

  const insertEntityNote = rawDb.prepare(`
    INSERT OR IGNORE INTO entity_notes (id, entity_id, note_id, relevance, created_at)
    VALUES (?, ?, ?, 1.0, ?)
  `);

  const insertEntityArtifact = rawDb.prepare(`
    INSERT OR IGNORE INTO entity_artifacts (id, entity_id, artifact_id, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const linkTx = rawDb.transaction(() => {
    for (const entityId of entityIds) {
      for (const noteId of noteIds) {
        try {
          insertEntityNote.run(makeId('en'), entityId, noteId, now);
          entitiesLinked++;
        } catch (_) {}
      }
      for (const artifactId of artifactIds) {
        try {
          insertEntityArtifact.run(makeId('ea'), entityId, artifactId, now);
        } catch (_) {}
      }
    }
  });
  linkTx();

  log.info('Librarian: linked', entityIds.length, 'entities to', noteIds.length, 'notes and', artifactIds.length, 'artifacts');
  return { entitiesLinked };
}

// ── 5. getRelevantContext ───────────────────────────────────────

/**
 * Query relevant past notes for context injection into chat prompts.
 *
 * @param {Object} db - database module
 * @param {string} message - the user's current message
 * @param {Object} [opts]
 * @param {number} [opts.maxNotes=5]
 * @returns {string} formatted context string
 */
function getRelevantContext(db, message, opts = {}) {
  const maxNotes = opts.maxNotes || 5;
  const rawDb = db.db();

  if (!message || !message.trim()) return '';

  // Build FTS query: quote each word for prefix matching
  const words = message.trim().split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return '';

  const ftsQuery = words.map((w) => `"${w.replace(/['"]/g, '')}"`).join(' OR ');

  let notes = [];
  try {
    notes = rawDb.prepare(`
      SELECT n.id, n.type, n.title, n.content, n.updated_at, n.auto_generated
      FROM notes_fts fts
      JOIN notes n ON n.rowid = fts.rowid
      WHERE notes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, maxNotes);
  } catch (_) {
    // FTS can fail on malformed queries -- fall back to recent auto-generated notes
    try {
      notes = rawDb.prepare(`
        SELECT id, type, title, content, updated_at, auto_generated
        FROM notes
        WHERE auto_generated = 1
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(maxNotes);
    } catch (_) {}
  }

  if (notes.length === 0) {
    // Even without matching notes, try compression memory
    let memoryContext = '';
    try {
      const compressionPipeline = require('./compression');
      memoryContext = compressionPipeline.autoResolve(db, message) || '';
    } catch (_) {}

    // Inject drift-aware context if reframe accuracy is low
    try {
      const driftScore = db.reframe.getDriftScore(30);
      if (driftScore !== null && driftScore < 0.6) {
        const pct = Math.round((1 - driftScore) * 100);
        const driftLines = [];
        driftLines.push('');
        driftLines.push('[guardian-drift-note]');
        driftLines.push(`The user has flagged ${pct}% of recent reframes as inaccurate. Prioritize reflecting the user's own language and framing. Avoid contrast framing and emotional relabeling unless the user explicitly asks for reframing.`);
        driftLines.push('[/guardian-drift-note]');
        memoryContext = (memoryContext ? memoryContext + '\n' : '') + driftLines.join('\n');
      }
    } catch (_) { /* reframe module may not be ready */ }

    return memoryContext || '';
  }

  // Format as context block
  const lines = ['[Relevant notes from your knowledge base:]', ''];
  for (const note of notes) {
    const snippet = (note.content || '').slice(0, 300);
    lines.push(`- **${note.title || 'Untitled'}** (${note.type}): ${snippet}`);
  }

  // Inject hierarchical compression memory (L2 patterns + L3 principles)
  try {
    const compressionPipeline = require('./compression');
    const memoryContext = compressionPipeline.autoResolve(db, message);
    if (memoryContext) {
      lines.push('');
      lines.push(memoryContext);
    }
  } catch (_) { /* compression module may not be ready */ }

  // Inject drift-aware context if reframe accuracy is low
  try {
    const driftScore = db.reframe.getDriftScore(30);
    if (driftScore !== null && driftScore < 0.6) {
      const pct = Math.round((1 - driftScore) * 100);
      lines.push('');
      lines.push('[guardian-drift-note]');
      lines.push(`The user has flagged ${pct}% of recent reframes as inaccurate. Prioritize reflecting the user's own language and framing. Avoid contrast framing and emotional relabeling unless the user explicitly asks for reframing.`);
      lines.push('[/guardian-drift-note]');
    }
  } catch (_) { /* reframe module may not be ready */ }

  return lines.join('\n');
}

// ── 6. runPipeline ──────────────────────────────────────────────

/**
 * Orchestrate the full librarian pipeline:
 *   extractInsights -> createAutoNotes -> fileArtifacts -> linkToGraph
 *
 * @param {Object} opts
 * @param {string}   opts.sessionId
 * @param {Array}    opts.messages   - Array of { role, content }
 * @param {Object}   opts.db         - database module
 * @param {Function} opts.onComplete - ({ notesCreated, artifactsFiled, entitiesLinked }) => void
 * @param {Function} [opts.onError]  - (err) => void
 */
function runPipeline({ sessionId, messages, db, onComplete, onError }) {
  log.info('Librarian: starting pipeline for session', sessionId);

  // Mark session extraction as in-progress
  try {
    db.sessions.update(sessionId, { extractionStatus: 'running' });
  } catch (_) {}

  extractInsights(messages, {
    onComplete(insights) {
      try {
        // Step 2: create notes
        const noteIds = createAutoNotes(db, sessionId, insights);

        // Step 3: file artifacts
        const artifactIds = fileArtifacts(sessionId, insights, db);

        // Step 4: link to knowledge graph
        const { entitiesLinked } = linkToGraph(db, sessionId, noteIds, artifactIds);

        // Step 5: detect reframes (async, fire-and-forget — don't block pipeline)
        try {
          const reframeDetector = require('./reframe-detector');
          reframeDetector.detectReframes(messages, db, sessionId, {
            onComplete: (count) => log.info('Reframe detection: found', count, 'events for session', sessionId),
            onError: (err) => log.warn('Reframe detection failed for', sessionId, ':', err.message),
          });
        } catch (e) { log.warn('Reframe detector not available:', e.message); }

        // Mark session extraction as complete
        try {
          db.sessions.update(sessionId, { extractionStatus: 'complete' });
        } catch (_) {}

        const result = {
          notesCreated: noteIds.length,
          artifactsFiled: artifactIds.length,
          entitiesLinked,
        };

        log.info('Librarian: pipeline complete for session', sessionId, JSON.stringify(result));
        if (onComplete) onComplete(result);
      } catch (e) {
        log.error('Librarian: pipeline post-extraction error:', e.message);
        try {
          db.sessions.update(sessionId, { extractionStatus: 'error' });
        } catch (_) {}
        if (onError) onError(e);
      }
    },
    onError(err) {
      log.warn('Librarian: extraction failed for session', sessionId, ':', err.message);
      try {
        db.sessions.update(sessionId, { extractionStatus: 'error' });
      } catch (_) {}
      if (onError) onError(err);
    },
  });
}

module.exports = {
  extractInsights,
  createAutoNotes,
  fileArtifacts,
  linkToGraph,
  getRelevantContext,
  runPipeline,
};
