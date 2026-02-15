/**
 * Guardian — Awareness-Trap Detection
 *
 * "Each cycle of accurate observation without successful intervention
 *  generates additional prediction error."
 *
 * This module analyzes conversation history to detect when a user is
 * repeatedly revisiting the same topic across sessions without resolution.
 * Guardian does NOT diagnose. It surfaces the pattern.
 */

const log = require('./logger');

// ── Meta-language patterns ──────────────────────────────────────
// Phrases that signal self-aware observation without action

const META_PATTERNS = [
  /\bi keep\b/i,
  /\bi notice i\b/i,
  /\bi always\b/i,
  /\bevery time i\b/i,
  /\bi['']m aware that i\b/i,
  /\bi know i should\b/i,
  /\bi realize i\b/i,
  /\bi see myself\b/i,
  /\bi catch myself\b/i,
  /\bhere i am again\b/i,
  /\bsame (thing|pattern|loop|cycle)\b/i,
  /\bback to (this|the same)\b/i,
  /\bstuck (on|in|with)\b/i,
  /\bkeep coming back to\b/i,
  /\bcan['']t stop\b/i,
  /\bcan['']t seem to\b/i,
  /\bstill haven['']t\b/i,
  /\bthis again\b/i,
];

// ── Action-item indicators ──────────────────────────────────────
// If these appear, the user is moving toward action, not trapped

const ACTION_PATTERNS = [
  /\bi will\b/i,
  /\bi['']m going to\b/i,
  /\blet me try\b/i,
  /\bnext step/i,
  /\baction item/i,
  /\btodo\b/i,
  /\bplan is to\b/i,
  /\bi did\b/i,
  /\bi started\b/i,
  /\bi finished\b/i,
  /\bi completed\b/i,
  /\bimplemented\b/i,
  /\bfixed\b/i,
  /\bresolved\b/i,
];

// ── Stop words for keyword extraction ───────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'don', 'now', 'and', 'but', 'or', 'if', 'while', 'about', 'up',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'am', 'it', 'its', 'my', 'me', 'we', 'our', 'you', 'your', 'he',
  'she', 'him', 'her', 'they', 'them', 'their', 'i', 'like', 'think',
  'know', 'want', 'get', 'make', 'go', 'see', 'say', 'also', 'well',
  'back', 'even', 'still', 'way', 'take', 'come', 'much', 'thing',
  'really', 'something', 'because', 'been', 'going', 'actually',
]);

// ── Keyword extraction ──────────────────────────────────────────

function extractKeywords(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

// ── Core analysis ───────────────────────────────────────────────

/**
 * Analyze recent sessions for awareness-trap patterns.
 *
 * @param {object} database - The database module
 * @param {string} currentSessionId - Current session to exclude from "past" analysis
 * @param {object} opts
 * @param {number} opts.windowDays - How many days back to look (default: 21)
 * @param {number} opts.minSessions - Minimum sessions with same topic (default: 3)
 * @returns {object|null} Detection result or null if no pattern found
 */
function analyze(database, currentSessionId, opts = {}) {
  const windowDays = opts.windowDays || 21;
  const minSessions = opts.minSessions || 3;

  try {
    // 1. Query sessions from the lookback window
    const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString();
    const sessions = database.sessions.list({ limit: 50 });
    const recentSessions = sessions.filter(
      (s) => s.started_at >= cutoff && s.id !== currentSessionId
    );

    if (recentSessions.length < minSessions) return null;

    // 2. Build keyword profile per session (user messages only)
    const sessionKeywords = {};
    const sessionMeta = {};

    for (const session of recentSessions) {
      const messages = database.messages.listBySession(session.id);
      const userMessages = messages.filter((m) => m.role === 'user');
      if (userMessages.length === 0) continue;

      const allText = userMessages.map((m) => m.content || '').join(' ');
      const keywords = extractKeywords(allText);

      // Count keyword frequency within session
      const freq = {};
      for (const kw of keywords) {
        freq[kw] = (freq[kw] || 0) + 1;
      }
      sessionKeywords[session.id] = freq;

      // Check for meta-language and action patterns
      let metaCount = 0;
      let actionCount = 0;
      for (const msg of userMessages) {
        const content = msg.content || '';
        for (const pat of META_PATTERNS) {
          if (pat.test(content)) metaCount++;
        }
        for (const pat of ACTION_PATTERNS) {
          if (pat.test(content)) actionCount++;
        }
      }

      sessionMeta[session.id] = {
        metaCount,
        actionCount,
        title: session.title,
        startedAt: session.started_at,
        messageCount: userMessages.length,
      };
    }

    const sessionIds = Object.keys(sessionKeywords);
    if (sessionIds.length < minSessions) return null;

    // 3. Find recurring topics: keywords that appear in 3+ sessions
    const keywordToSessions = {};
    for (const sid of sessionIds) {
      const topKw = Object.entries(sessionKeywords[sid])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([kw]) => kw);
      for (const kw of topKw) {
        if (!keywordToSessions[kw]) keywordToSessions[kw] = new Set();
        keywordToSessions[kw].add(sid);
      }
    }

    // Find keyword clusters that appear across minSessions+ sessions
    const recurringKeywords = Object.entries(keywordToSessions)
      .filter(([, sids]) => sids.size >= minSessions)
      .sort((a, b) => b[1].size - a[1].size);

    if (recurringKeywords.length === 0) return null;

    // 4. Pick the strongest recurring topic cluster
    // Group overlapping keywords (keywords co-occurring in the same sessions)
    const topKeyword = recurringKeywords[0][0];
    const topSessions = recurringKeywords[0][1];
    const relatedKeywords = recurringKeywords
      .filter(([, sids]) => {
        // At least 60% overlap with the top cluster
        const overlap = [...sids].filter((s) => topSessions.has(s)).length;
        return overlap >= Math.ceil(sids.size * 0.6);
      })
      .slice(0, 5)
      .map(([kw]) => kw);

    const topic = relatedKeywords.length > 1
      ? relatedKeywords.slice(0, 3).join(', ')
      : topKeyword;

    // 5. Score the detection
    const affectedSessions = [...topSessions];
    const sessionCount = affectedSessions.length;

    // Meta-language score: how many affected sessions have meta-commentary
    let totalMeta = 0;
    let totalAction = 0;
    for (const sid of affectedSessions) {
      const meta = sessionMeta[sid];
      if (meta) {
        totalMeta += meta.metaCount;
        totalAction += meta.actionCount;
      }
    }

    // Confidence: higher when more sessions, more meta-language, fewer actions
    const sessionScore = Math.min(1, (sessionCount - minSessions + 1) / 4); // 0-1
    const metaScore = Math.min(1, totalMeta / (sessionCount * 2)); // 0-1
    const actionPenalty = totalAction > 0 ? Math.min(0.5, totalAction / (totalMeta + totalAction + 1)) : 0;

    const confidence = Math.round(
      ((sessionScore * 0.4) + (metaScore * 0.4) + ((1 - actionPenalty) * 0.2)) * 100
    );

    // Only surface if confidence is meaningful
    if (confidence < 25) return null;

    // 6. Calculate time span
    const dates = affectedSessions
      .map((sid) => sessionMeta[sid]?.startedAt)
      .filter(Boolean)
      .sort();
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const spanDays = Math.ceil(
      (new Date(lastDate) - new Date(firstDate)) / 86400000
    );
    const spanText = spanDays <= 7
      ? '1 week'
      : spanDays <= 14
        ? '2 weeks'
        : `${Math.ceil(spanDays / 7)} weeks`;

    return {
      topic,
      keywords: relatedKeywords,
      sessionCount,
      spanDays,
      spanText,
      confidence,
      metaLanguageCount: totalMeta,
      actionItemCount: totalAction,
      affectedSessionIds: affectedSessions,
      detectedAt: new Date().toISOString(),
    };
  } catch (e) {
    log.error('Awareness analysis failed:', e.message);
    return null;
  }
}

/**
 * Check if this topic was recently dismissed.
 * Returns true if it should be suppressed.
 *
 * @param {object} database - The database module
 * @param {string} topic - The detected topic
 * @param {number} cooldownDays - How many days to suppress after dismiss (default: 7)
 */
function isDismissed(database, topic, cooldownDays = 7) {
  try {
    const cutoff = new Date(Date.now() - cooldownDays * 86400000).toISOString();
    const rows = database.db().prepare(`
      SELECT 1 FROM awareness_dismissals
      WHERE topic = ? AND dismissed_at > ?
      LIMIT 1
    `).all(topic, cutoff);
    return rows.length > 0;
  } catch (_) {
    // Table might not exist yet — that's fine
    return false;
  }
}

/**
 * Record a dismissal for a topic.
 */
function dismiss(database, topic) {
  try {
    _ensureDismissalTable(database);
    database.db().prepare(`
      INSERT INTO awareness_dismissals (topic, dismissed_at)
      VALUES (?, ?)
    `).run(topic, new Date().toISOString());
  } catch (e) {
    log.error('Awareness dismiss failed:', e.message);
  }
}

/**
 * Ensure the dismissal tracking table exists.
 */
function _ensureDismissalTable(database) {
  database.db().exec(`
    CREATE TABLE IF NOT EXISTS awareness_dismissals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      dismissed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_awareness_topic ON awareness_dismissals(topic, dismissed_at);
  `);
}

/**
 * Full detection pipeline: analyze + check dismissals + check profile setting.
 *
 * @param {object} database - The database module
 * @param {string} currentSessionId - Current session ID
 * @param {object} profile - User profile (checks awarenessPatterns setting)
 * @returns {object|null} Detection result or null
 */
function detect(database, currentSessionId, profile) {
  // Respect user setting — they can disable this entirely
  if (profile && profile.awarenessPatterns === false) return null;

  const result = analyze(database, currentSessionId);
  if (!result) return null;

  // Check if this topic was dismissed within cooldown
  if (isDismissed(database, result.topic)) return null;

  // Ensure dismissal table is ready for future operations
  _ensureDismissalTable(database);

  return result;
}

module.exports = { analyze, detect, dismiss, isDismissed, extractKeywords };
