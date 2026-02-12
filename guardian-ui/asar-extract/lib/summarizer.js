/**
 * Guardian -- Session Summarizer
 *
 * Generates 2-3 sentence summaries of chat sessions via Claude CLI.
 * Runs asynchronously after session ends -- never blocks the UI.
 * Gracefully degrades if summarization fails (session keeps null summary).
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const log = require('./logger');

// ── Claude CLI resolution (mirrors main.js logic) ───────────

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

// ── Summary Generation ──────────────────────────────────────

/**
 * Build a condensed transcript from session messages.
 * Keeps it short to stay well within context limits.
 */
function buildTranscript(messages) {
  if (!messages || messages.length === 0) return null;

  const lines = [];
  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const text = (msg.content || '').slice(0, 500);
    if (text.trim()) {
      lines.push(`${role}: ${text}`);
    }
  }

  // Cap total transcript to ~3000 chars to keep the summarization prompt small
  let transcript = lines.join('\n\n');
  if (transcript.length > 3000) {
    transcript = transcript.slice(0, 3000) + '\n...(truncated)';
  }
  return transcript;
}

/**
 * Generate a session summary asynchronously.
 *
 * @param {Object} opts
 * @param {string} opts.sessionId - Guardian session ID
 * @param {Array}  opts.messages  - Array of { role, content } message objects
 * @param {Function} opts.onComplete - Called with (sessionId, summary) on success
 * @param {Function} [opts.onError]  - Called with (sessionId, error) on failure
 */
function summarizeSession({ sessionId, messages, onComplete, onError }) {
  const transcript = buildTranscript(messages);
  if (!transcript) {
    log.info('Summarizer: no messages to summarize for session', sessionId);
    if (onError) onError(sessionId, new Error('No messages to summarize'));
    return;
  }

  const prompt = `You are summarizing a conversation for a personal knowledge management tool called Guardian. Write a 2-3 sentence summary of the following conversation. Focus on the main topics discussed and any key decisions or outcomes. Be concise and factual. Output ONLY the summary text, no labels or prefixes.\n\n---\n${transcript}\n---`;

  const claudePath = getClaudePath();
  const args = ['-p', prompt, '--output-format', 'text'];

  log.info('Summarizer: generating summary for session', sessionId);

  let proc;
  try {
    proc = spawn(claudePath, args, {
      cwd: os.homedir(),
      env: cliEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
  } catch (e) {
    log.error('Summarizer: failed to spawn Claude CLI:', e.message);
    if (onError) onError(sessionId, e);
    return;
  }

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  proc.on('close', (code) => {
    if (code === 0 && stdout.trim()) {
      const summary = stdout.trim().slice(0, 500); // Cap at 500 chars
      log.info('Summarizer: summary generated for session', sessionId);
      if (onComplete) onComplete(sessionId, summary);
    } else {
      const errMsg = stderr.trim() || `Exit code ${code}`;
      log.warn('Summarizer: failed for session', sessionId, ':', errMsg);
      if (onError) onError(sessionId, new Error(errMsg));
    }
  });

  proc.on('error', (e) => {
    log.error('Summarizer: process error for session', sessionId, ':', e.message);
    if (onError) onError(sessionId, e);
  });
}

module.exports = { summarizeSession, buildTranscript };
