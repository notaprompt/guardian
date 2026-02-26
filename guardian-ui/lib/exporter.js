/**
 * Guardian — Export System
 *
 * Export conversations, notes, and artifacts in Markdown or JSON format.
 * Markdown exports include YAML frontmatter for metadata portability.
 */

const fs = require('fs');
const path = require('path');
const log = require('./logger');

// ── YAML Frontmatter ─────────────────────────────────────────

/**
 * Build a YAML frontmatter block from a metadata object.
 */
function buildFrontmatter(meta) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(meta)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${String(item).replace(/"/g, '\\"')}`);
      }
    } else {
      const str = String(value);
      // Quote strings that contain special YAML characters
      if (str.includes(':') || str.includes('#') || str.includes('"') || str.includes("'")) {
        lines.push(`${key}: "${str.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${str}`);
      }
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// ── Session/Conversation Export ──────────────────────────────

/**
 * Export a conversation session as Markdown.
 * Returns the Markdown string.
 */
function exportSessionAsMarkdown(session, messages) {
  const meta = {
    title: session.title || 'Untitled Session',
    date: session.started_at,
    ended: session.ended_at || null,
    model: session.model || null,
    tokens_in: session.tokens_in || 0,
    tokens_out: session.tokens_out || 0,
    session_id: session.id,
    export_format: 'guardian-session',
  };

  const parts = [buildFrontmatter(meta), ''];
  parts.push(`# ${meta.title}`);
  parts.push('');

  if (session.summary) {
    parts.push(`> ${session.summary}`);
    parts.push('');
  }

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Claude' : 'System';
    const timestamp = msg.timestamp ? ` *(${new Date(msg.timestamp).toLocaleString()})*` : '';

    parts.push(`## ${role}${timestamp}`);
    parts.push('');

    if (msg.thinking) {
      parts.push('<details>');
      parts.push('<summary>Thinking</summary>');
      parts.push('');
      parts.push(msg.thinking);
      parts.push('');
      parts.push('</details>');
      parts.push('');
    }

    parts.push(msg.content || '*(empty)*');
    parts.push('');
    parts.push('---');
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Export a conversation session as JSON.
 * Returns the JSON string (full data fidelity).
 */
function exportSessionAsJSON(session, messages) {
  const data = {
    export_format: 'guardian-session',
    export_version: 1,
    exported_at: new Date().toISOString(),
    session: {
      id: session.id,
      title: session.title,
      summary: session.summary || null,
      model: session.model || null,
      started_at: session.started_at,
      ended_at: session.ended_at || null,
      tokens_in: session.tokens_in || 0,
      tokens_out: session.tokens_out || 0,
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      thinking: m.thinking || null,
      attachments: m.attachments ? JSON.parse(m.attachments) : null,
      tokens_in: m.tokens_in || 0,
      tokens_out: m.tokens_out || 0,
      timestamp: m.timestamp,
    })),
  };

  return JSON.stringify(data, null, 2);
}

// ── Note Export ───────────────────────────────────────────────

/**
 * Export a note as Markdown with YAML frontmatter.
 */
function exportNoteAsMarkdown(note) {
  let tags = [];
  if (note.tags) {
    try {
      tags = typeof note.tags === 'string' ? JSON.parse(note.tags) : note.tags;
    } catch { tags = []; }
  }

  const meta = {
    title: note.title || 'Untitled',
    type: note.type || 'scratch',
    created: note.created_at,
    updated: note.updated_at,
    export_format: 'guardian-note',
  };
  if (tags.length > 0) meta.tags = tags;

  const parts = [buildFrontmatter(meta), ''];

  if (note.title) {
    parts.push(`# ${note.title}`);
    parts.push('');
  }

  parts.push(note.content || '');

  return parts.join('\n');
}

/**
 * Export a note as JSON.
 */
function exportNoteAsJSON(note) {
  let tags = [];
  if (note.tags) {
    try {
      tags = typeof note.tags === 'string' ? JSON.parse(note.tags) : note.tags;
    } catch { tags = []; }
  }

  const data = {
    export_format: 'guardian-note',
    export_version: 1,
    exported_at: new Date().toISOString(),
    note: {
      id: note.id,
      type: note.type || 'scratch',
      title: note.title || '',
      content: note.content || '',
      tags,
      created_at: note.created_at,
      updated_at: note.updated_at,
    },
  };

  return JSON.stringify(data, null, 2);
}

// ── Bulk Export ───────────────────────────────────────────────

/**
 * Export all notes as individual Markdown files into a directory.
 * Returns { ok, count, dir }.
 */
function exportAllNotesAsMarkdown(notes, outputDir) {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    let count = 0;
    for (const note of notes) {
      const md = exportNoteAsMarkdown(note);
      const safeName = (note.title || `note-${note.id}`)
        .replace(/[<>:"/\\|?*]/g, '_')
        .slice(0, 100);
      const filePath = path.join(outputDir, `${safeName}.md`);
      fs.writeFileSync(filePath, md, 'utf-8');
      count++;
    }

    log.info('Exported', count, 'notes to', outputDir);
    return { ok: true, count, dir: outputDir };
  } catch (e) {
    log.error('Bulk note export failed:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Export a full data dump as JSON (all sessions + messages + notes).
 * Returns the JSON string.
 */
function exportFullDataAsJSON(database, opts = {}) {
  const sessions = database.sessions.list();
  const allMessages = {};
  for (const s of sessions) {
    allMessages[s.id] = database.messages.listBySession(s.id);
  }
  let notes = database.notes.list();
  if (opts.excludeSovereign) {
    notes = notes.filter((n) => n.sensitivity !== 'sovereign');
  }
  const usage = database.usage.list({ limit: 10000 });

  const data = {
    export_format: 'guardian-full',
    export_version: 1,
    exported_at: new Date().toISOString(),
    sessions: sessions.map((s) => ({
      ...s,
      messages: (allMessages[s.id] || []).map((m) => ({
        ...m,
        attachments: m.attachments ? JSON.parse(m.attachments) : null,
      })),
    })),
    notes: notes.map((n) => ({
      ...n,
      tags: typeof n.tags === 'string' ? JSON.parse(n.tags) : (n.tags || []),
    })),
    usage,
  };

  return JSON.stringify(data, null, 2);
}

module.exports = {
  buildFrontmatter,
  exportSessionAsMarkdown,
  exportSessionAsJSON,
  exportNoteAsMarkdown,
  exportNoteAsJSON,
  exportAllNotesAsMarkdown,
  exportFullDataAsJSON,
};
