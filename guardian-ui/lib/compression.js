/**
 * Guardian — Hierarchical Compression Pipeline
 *
 * Four resolution levels:
 *   L0: raw transcript (exists in messages table)
 *   L1: session summary (created by summarizer, registered here)
 *   L2: patterns (cross-session themes, extracted by Haiku)
 *   L3: principles (distilled from patterns, extracted by Sonnet)
 *
 * Triggers: L1 auto after summarizer. L2 when 5+ L1s. L3 when 3+ L2s.
 * Decay: strength *= 0.97 daily. Retrieval reinforces (+0.15). Archive below 0.3.
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const log = require('./logger');

// ── Claude CLI resolution ─────────────────────────────────────────

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

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── L1: Register Summary ──────────────────────────────────────────

/**
 * Wrap a session summary as a compression L1 entry.
 * Returns { id, shouldTriggerL2 }
 */
function registerL1(db, sessionId, summary) {
  if (!summary || !summary.trim()) return { id: null, shouldTriggerL2: false };

  const id = makeId('cl');
  db.compression.create({
    id,
    level: 1,
    content: summary,
    sourceIds: [sessionId],
    strength: 1.0,
  });

  // Check if L2 threshold reached (5+ L1s since last L2)
  const l1Count = db.compression.countSinceLastCompression(1);
  const shouldTriggerL2 = l1Count >= 5;

  log.info('Compression: registered L1 for session', sessionId, '| L1 count since last L2:', l1Count, shouldTriggerL2 ? '→ triggering L2' : '');
  return { id, shouldTriggerL2 };
}

// ── L2: Extract Patterns ──────────────────────────────────────────

/**
 * Extract recurring patterns from recent L1 summaries via Haiku.
 */
function extractPatterns(db, { onComplete, onError }) {
  const l1Items = db.compression.listByLevel(1, { limit: 20 });
  if (l1Items.length < 3) {
    if (onError) onError(new Error('Not enough L1 items for pattern extraction'));
    return;
  }

  const summariesText = l1Items
    .map((item, i) => `[Session ${i + 1}]: ${item.content.slice(0, 500)}`)
    .join('\n\n');

  const prompt = `Analyze these session summaries and extract recurring patterns, themes, and tendencies. Return ONLY valid JSON, no markdown fences.

Session Summaries:
---
${summariesText}
---

Return JSON in this format:
{"patterns":[{"theme":"string describing the pattern","evidence":"brief supporting evidence from summaries","frequency":"how often this appears"}]}

Rules:
- Find 2-5 recurring patterns across multiple sessions
- Focus on behavioral patterns, recurring topics, work style tendencies
- Each pattern should appear in at least 2 sessions
- Be concise but specific`;

  const claudePath = getClaudePath();
  const args = ['-p', prompt, '--output-format', 'text', '--model', 'claude-haiku-4-5-20251001'];

  log.info('Compression: extracting L2 patterns from', l1Items.length, 'L1 items');

  let proc;
  try {
    proc = spawn(claudePath, args, {
      cwd: os.homedir(),
      env: cliEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });
  } catch (e) {
    if (onError) onError(new Error(`Failed to spawn Claude CLI: ${e.message}`));
    return;
  }

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  proc.on('close', (code) => {
    if (code !== 0) {
      if (onError) onError(new Error(`Claude CLI exited ${code}: ${(stderr || '').slice(0, 300)}`));
      return;
    }

    try {
      let jsonStr = stdout.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const parsed = JSON.parse(jsonStr);
      const patterns = Array.isArray(parsed.patterns) ? parsed.patterns.filter(p => p.theme) : [];

      const sourceIds = l1Items.map(item => item.id);
      const created = [];

      for (const pattern of patterns) {
        const id = makeId('cl');
        const content = `${pattern.theme}${pattern.evidence ? '\n\nEvidence: ' + pattern.evidence : ''}${pattern.frequency ? '\n\nFrequency: ' + pattern.frequency : ''}`;
        db.compression.create({
          id,
          level: 2,
          content,
          sourceIds,
          strength: 1.0,
        });
        created.push({ id, content });
      }

      log.info('Compression: extracted', created.length, 'L2 patterns');
      if (onComplete) onComplete(created);
    } catch (e) {
      if (onError) onError(new Error(`Failed to parse L2 result: ${e.message}`));
    }
  });

  proc.on('error', (e) => { if (onError) onError(e); });
}

// ── L3: Distill Principles ────────────────────────────────────────

/**
 * Distill enduring principles from L2 patterns via Sonnet.
 */
function distillPrinciples(db, { onComplete, onError }) {
  const l2Items = db.compression.listByLevel(2, { limit: 15 });
  if (l2Items.length < 2) {
    if (onError) onError(new Error('Not enough L2 items for principle distillation'));
    return;
  }

  const patternsText = l2Items
    .map((item, i) => `[Pattern ${i + 1}]: ${item.content.slice(0, 400)}`)
    .join('\n\n');

  const prompt = `Analyze these behavioral patterns extracted from many work sessions. Distill them into enduring principles — concise truths about how this person works, thinks, and makes decisions. Return ONLY valid JSON, no markdown fences.

Patterns:
---
${patternsText}
---

Return JSON in this format:
{"principles":[{"principle":"a concise principle statement","reasoning":"why this is a core principle, not just a pattern"}]}

Rules:
- Extract 1-3 deep principles
- Principles should be timeless, not situational
- Each should synthesize multiple patterns
- Frame as "You tend to..." or "Your core approach is..."
- Be concise but insightful`;

  const claudePath = getClaudePath();
  const args = ['-p', prompt, '--output-format', 'text', '--model', 'claude-sonnet-4-5-20250929'];

  log.info('Compression: distilling L3 principles from', l2Items.length, 'L2 patterns');

  let proc;
  try {
    proc = spawn(claudePath, args, {
      cwd: os.homedir(),
      env: cliEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 90000,
    });
  } catch (e) {
    if (onError) onError(new Error(`Failed to spawn Claude CLI: ${e.message}`));
    return;
  }

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  proc.on('close', (code) => {
    if (code !== 0) {
      if (onError) onError(new Error(`Claude CLI exited ${code}: ${(stderr || '').slice(0, 300)}`));
      return;
    }

    try {
      let jsonStr = stdout.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const parsed = JSON.parse(jsonStr);
      const principles = Array.isArray(parsed.principles) ? parsed.principles.filter(p => p.principle) : [];

      const sourceIds = l2Items.map(item => item.id);
      const created = [];

      for (const principle of principles) {
        const id = makeId('cl');
        const content = `${principle.principle}${principle.reasoning ? '\n\nReasoning: ' + principle.reasoning : ''}`;
        db.compression.create({
          id,
          level: 3,
          content,
          sourceIds,
          strength: 1.0,
        });
        created.push({ id, content });
      }

      log.info('Compression: distilled', created.length, 'L3 principles');
      if (onComplete) onComplete(created);
    } catch (e) {
      if (onError) onError(new Error(`Failed to parse L3 result: ${e.message}`));
    }
  });

  proc.on('error', (e) => { if (onError) onError(e); });
}

// ── Retrieval ─────────────────────────────────────────────────────

/**
 * FTS retrieval at a specific compression level.
 */
function getAtResolution(db, query, level) {
  if (!query || !query.trim()) return [];
  const results = db.compression.search(query);
  return results.filter(r => r.level === level);
}

/**
 * Auto-resolve: short queries -> prefer L2/L3, detailed queries -> all levels.
 * Reinforces strength on retrieval.
 */
function autoResolve(db, query) {
  if (!query || !query.trim()) return '';

  const words = query.trim().split(/\s+/);
  const isShort = words.length <= 3;

  // Get relevant items via FTS
  let items = db.compression.search(query);

  if (items.length === 0) {
    // Fallback: get recent L2/L3 items
    const l3 = db.compression.listByLevel(3, { limit: 3 });
    const l2 = db.compression.listByLevel(2, { limit: 5 });
    items = [...l3, ...l2];
  }

  if (items.length === 0) return '';

  // Filter by resolution preference
  let filtered;
  if (isShort) {
    // Short queries: prefer L2/L3
    filtered = items.filter(i => i.level >= 2);
    if (filtered.length === 0) filtered = items;
  } else {
    filtered = items;
  }

  // Reinforce strength for retrieved items
  for (const item of filtered.slice(0, 5)) {
    try {
      db.compression.reinforceStrength(item.id);
    } catch (_) {}
  }

  // Format as context blocks
  const lines = [];

  const l3Items = filtered.filter(i => i.level === 3);
  const l2Items = filtered.filter(i => i.level === 2);

  if (l3Items.length > 0) {
    lines.push('[guardian-memory L3 — principles]');
    for (const item of l3Items.slice(0, 3)) {
      lines.push(`- ${item.content.split('\n')[0].slice(0, 300)}`);
    }
    lines.push('[/guardian-memory L3]');
  }

  if (l2Items.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('[guardian-memory L2 — patterns]');
    for (const item of l2Items.slice(0, 5)) {
      lines.push(`- ${item.content.split('\n')[0].slice(0, 300)}`);
    }
    lines.push('[/guardian-memory L2]');
  }

  return lines.join('\n');
}

module.exports = {
  registerL1,
  extractPatterns,
  distillPrinciples,
  getAtResolution,
  autoResolve,
};
