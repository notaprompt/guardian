/**
 * Guardian — Application Logger
 *
 * Simple file-based logger with daily rotation.
 * Writes to ~/.guardian/logs/guardian.log
 */

import fs from 'fs';
import path from 'path';
import { FILES, DIRS } from './paths';

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB per file
const MAX_LOG_FILES = 5;

let _stream: fs.WriteStream | null = null;
let _currentPath: string | null = null;

function _getLogPath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(DIRS.logs, `guardian-${date}.log`);
}

function _ensureStream(): fs.WriteStream {
  const logPath = _getLogPath();
  if (_currentPath !== logPath) {
    if (_stream) {
      try { _stream.end(); } catch (_) {}
    }
    _stream = fs.createWriteStream(logPath, { flags: 'a' });
    _currentPath = logPath;
    _rotateOldLogs();
  }
  return _stream!;
}

function _rotateOldLogs(): void {
  try {
    const files = fs.readdirSync(DIRS.logs)
      .filter((f) => f.startsWith('guardian-') && f.endsWith('.log'))
      .sort()
      .reverse();
    // Keep only MAX_LOG_FILES most recent
    for (let i = MAX_LOG_FILES; i < files.length; i++) {
      fs.unlinkSync(path.join(DIRS.logs, files[i]));
    }
  } catch (_) { /* best-effort cleanup */ }
}

function _write(level: string, ...args: unknown[]): void {
  const ts = new Date().toISOString();
  const msg = args.map((a) =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ');
  const line = `[${ts}] [${level}] ${msg}\n`;

  // Write to file
  try {
    const stream = _ensureStream();
    stream.write(line);
  } catch (_) { /* don't crash on log failure */ }

  // Also write to console in dev
  if (level === 'ERROR') {
    console.error(`[guardian:${level}]`, ...args);
  } else if (level === 'WARN') {
    console.warn(`[guardian:${level}]`, ...args);
  }
}

const log = {
  info:  (...args: unknown[]): void => _write('INFO', ...args),
  warn:  (...args: unknown[]): void => _write('WARN', ...args),
  error: (...args: unknown[]): void => _write('ERROR', ...args),
  debug: (...args: unknown[]): void => _write('DEBUG', ...args),

  /** Close the stream on app shutdown */
  close(): void {
    if (_stream) {
      try { _stream.end(); } catch (_) {}
      _stream = null;
      _currentPath = null;
    }
  },
};

export = log;
