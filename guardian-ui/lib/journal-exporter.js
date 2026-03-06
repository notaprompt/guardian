/**
 * Guardian — Journal Exporter
 *
 * Converts normalized conversations (from import-parser) into:
 *   1. Journal Markdown — identical format to extract-claude-export.mjs output
 *   2. Training JSONL — one conversation per line, ready for fine-tuning
 *
 * Works with any source: ChatGPT, Claude, or future formats.
 */

const fs = require('fs');
const path = require('path');
const log = require('./logger');

// ── Source Labels ────────────────────────────────────────────────

const SOURCE_LABELS = {
  chatgpt: 'ChatGPT',
  claude_export: 'Claude',
  claude: 'Claude',
};

function assistantLabel(source) {
  return SOURCE_LABELS[source] || 'Assistant';
}

function sourceHeader(source) {
  const label = assistantLabel(source);
  return `${label} Export`;
}

// ── Date Formatting ─────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unknown date';
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatExportDate() {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ── Markdown Journal ────────────────────────────────────────────

/**
 * Format a single normalized conversation into journal markdown.
 * Matches the exact format of extract-claude-export.mjs.
 *
 * @param {Object} conv - Normalized conversation from import-parser
 * @param {string} conv.title
 * @param {string} conv.createdAt
 * @param {string} conv.source
 * @param {Array} conv.messages - [{ role, content, timestamp }]
 * @returns {string}
 */
function formatConversation(conv) {
  const lines = [];
  const title = conv.title || 'Untitled';
  const date = formatDate(conv.createdAt);
  const msgs = conv.messages || [];
  const humanCount = msgs.filter(m => m.role === 'user').length;
  const label = assistantLabel(conv.source);

  lines.push(`## ${title}`);
  lines.push(`**${date}** -- ${msgs.length} messages, ${humanCount} from you`);
  lines.push('');

  for (const msg of msgs) {
    const time = formatTime(msg.timestamp);
    const sender = msg.role === 'user' ? 'You' : label;
    const text = (msg.content || '').trim();
    if (!text) continue;

    lines.push(`**${sender}** ${time}`);
    lines.push('');
    lines.push(text);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Convert an array of normalized conversations to journal markdown.
 *
 * @param {Array} conversations - From import-parser
 * @param {Object} [opts]
 * @param {string} [opts.source] - Override source label (auto-detected if omitted)
 * @returns {string} Full journal markdown
 */
function toJournalMarkdown(conversations, opts = {}) {
  // Sort chronologically
  const sorted = [...conversations].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );

  const source = opts.source || sorted[0]?.source || 'unknown';
  const parts = [];

  parts.push(`# ${sourceHeader(source)} -- Full Journal`);
  parts.push(`Exported: ${formatExportDate()}`);
  parts.push(`${sorted.length} conversations, chronological order, oldest first`);
  parts.push('');
  parts.push('Every word preserved exactly as written. Nothing removed, nothing replaced.');
  parts.push('');
  parts.push('---');
  parts.push('');

  for (const conv of sorted) {
    parts.push(formatConversation(conv));
    parts.push('');
    parts.push('<br><br>');
    parts.push('');
  }

  return parts.join('\n');
}

// ── Training JSONL ──────────────────────────────────────────────

/**
 * Convert conversations to training JSONL.
 * Each line is a conversation in OpenAI fine-tune format:
 *   {"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
 *
 * Filters out conversations with fewer than 2 messages.
 *
 * @param {Array} conversations - From import-parser
 * @returns {string} JSONL string
 */
function toTrainingJsonl(conversations) {
  const lines = [];

  for (const conv of conversations) {
    const msgs = (conv.messages || []).filter(m =>
      (m.role === 'user' || m.role === 'assistant') &&
      m.content && m.content.trim()
    );

    if (msgs.length < 2) continue;

    const entry = {
      messages: msgs.map(m => ({
        role: m.role,
        content: m.content.trim(),
      })),
    };

    lines.push(JSON.stringify(entry));
  }

  return lines.join('\n');
}

// ── Write to Disk ───────────────────────────────────────────────

/**
 * Write journal markdown and training JSONL to a directory.
 *
 * @param {Array} conversations - Normalized conversations
 * @param {string} outputDir - Directory to write into
 * @param {Object} [opts]
 * @param {string} [opts.source] - Source label override
 * @param {boolean} [opts.markdown=true] - Write markdown journal
 * @param {boolean} [opts.jsonl=true] - Write training JSONL
 * @returns {{ ok: boolean, files: string[], stats: Object, error?: string }}
 */
function writeJournal(conversations, outputDir, opts = {}) {
  const writeMarkdown = opts.markdown !== false;
  const writeJsonl = opts.jsonl !== false;
  const source = opts.source || conversations[0]?.source || 'unknown';
  const sourceSlug = source.replace(/[^a-z0-9]/gi, '-').toLowerCase();

  try {
    fs.mkdirSync(outputDir, { recursive: true });

    const files = [];
    const stats = {
      conversations: conversations.length,
      messages: conversations.reduce((sum, c) => sum + (c.messages?.length || 0), 0),
      userMessages: conversations.reduce(
        (sum, c) => sum + (c.messages?.filter(m => m.role === 'user').length || 0), 0
      ),
    };

    if (writeMarkdown) {
      const md = toJournalMarkdown(conversations, { source });
      const mdPath = path.join(outputDir, `${sourceSlug}-journal.md`);
      fs.writeFileSync(mdPath, md, 'utf-8');
      const mdSize = (Buffer.byteLength(md) / 1024 / 1024).toFixed(1);
      files.push(mdPath);
      stats.markdownSize = `${mdSize} MB`;
      log.info(`Journal exporter: wrote ${mdPath} (${mdSize} MB)`);
    }

    if (writeJsonl) {
      const jsonl = toTrainingJsonl(conversations);
      const jsonlPath = path.join(outputDir, `${sourceSlug}-training.jsonl`);
      fs.writeFileSync(jsonlPath, jsonl, 'utf-8');
      const jsonlLines = jsonl.split('\n').filter(Boolean).length;
      const jsonlSize = (Buffer.byteLength(jsonl) / 1024 / 1024).toFixed(1);
      files.push(jsonlPath);
      stats.trainingConversations = jsonlLines;
      stats.jsonlSize = `${jsonlSize} MB`;
      log.info(`Journal exporter: wrote ${jsonlPath} (${jsonlLines} conversations, ${jsonlSize} MB)`);
    }

    return { ok: true, files, stats };
  } catch (e) {
    log.error('Journal exporter: write failed:', e.message);
    return { ok: false, files: [], stats: {}, error: e.message };
  }
}

module.exports = {
  formatConversation,
  toJournalMarkdown,
  toTrainingJsonl,
  writeJournal,
  assistantLabel,
};
