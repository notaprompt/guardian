/**
 * Guardian -- Performance Profiling & Monitoring
 *
 * Phase 4 targets: startup < 2s, memory < 300MB, no jank.
 *
 * Provides:
 *   - Startup timing (mark/measure milestones)
 *   - Memory sampling (periodic RSS / heap snapshots)
 *   - Performance markers for IPC handlers
 *   - Logging to ~/.guardian/logs/performance.log
 */

const fs = require('fs');
const path = require('path');
const { DIRS } = require('./paths');

let _stream = null;
let _startupStart = Date.now();
const _marks = {};
let _memorySampler = null;

// ── Log file ────────────────────────────────────────────────────

function _ensureStream() {
  if (_stream) return _stream;
  const logPath = path.join(DIRS.logs, 'performance.log');
  _stream = fs.createWriteStream(logPath, { flags: 'a' });
  return _stream;
}

function _log(category, message, data) {
  const ts = new Date().toISOString();
  const extra = data !== undefined ? ' ' + JSON.stringify(data) : '';
  const line = `[${ts}] [${category}] ${message}${extra}\n`;
  try {
    _ensureStream().write(line);
  } catch (_) { /* never crash on perf logging */ }
}

// ── Startup Timing ──────────────────────────────────────────────

function markStartupBegin() {
  _startupStart = Date.now();
  _marks['startup:begin'] = _startupStart;
  _log('STARTUP', 'begin');
}

function mark(name) {
  const now = Date.now();
  _marks[name] = now;
  const sinceStart = now - _startupStart;
  _log('MARK', name, { sinceStartMs: sinceStart });
}

function measure(name, startMark, endMark) {
  const start = _marks[startMark];
  const end = endMark ? _marks[endMark] : Date.now();
  if (start === undefined) return null;
  const duration = end - start;
  _log('MEASURE', name, { durationMs: duration, start: startMark, end: endMark || 'now' });
  return duration;
}

function markStartupComplete() {
  mark('startup:complete');
  const total = measure('startup:total', 'startup:begin', 'startup:complete');
  const target = 2000;
  if (total > target) {
    _log('WARN', `Startup exceeded ${target}ms target`, { actualMs: total });
  } else {
    _log('STARTUP', 'within target', { actualMs: total, targetMs: target });
  }
  return total;
}

// ── Memory Sampling ─────────────────────────────────────────────

function getMemorySnapshot() {
  const mem = process.memoryUsage();
  return {
    rss: Math.round(mem.rss / 1024 / 1024),         // MB
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    external: Math.round(mem.external / 1024 / 1024),
  };
}

function logMemory(label) {
  const snap = getMemorySnapshot();
  _log('MEMORY', label || 'snapshot', snap);
  const target = 300;
  if (snap.rss > target) {
    _log('WARN', `RSS ${snap.rss}MB exceeds ${target}MB target`);
  }
  return snap;
}

function startMemorySampling(intervalMs) {
  if (_memorySampler) return;
  const interval = intervalMs || 60000; // default 1 minute
  _memorySampler = setInterval(() => {
    logMemory('periodic');
  }, interval);
  // Don't prevent process exit
  if (_memorySampler.unref) _memorySampler.unref();
  _log('MEMORY', 'sampling started', { intervalMs: interval });
}

function stopMemorySampling() {
  if (_memorySampler) {
    clearInterval(_memorySampler);
    _memorySampler = null;
    _log('MEMORY', 'sampling stopped');
  }
}

// ── IPC Handler Timing ──────────────────────────────────────────

/**
 * Wrap an IPC handler to measure its execution time.
 * Usage: ipcMain.handle('channel', perf.wrapIPC('channel', handler))
 */
function wrapIPC(channel, handler) {
  return async (event, ...args) => {
    const start = Date.now();
    try {
      const result = await handler(event, ...args);
      const duration = Date.now() - start;
      if (duration > 100) {
        _log('IPC', `${channel} slow`, { durationMs: duration });
      }
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      _log('IPC', `${channel} error`, { durationMs: duration, error: err.message });
      throw err;
    }
  };
}

// ── Renderer Timing (via IPC) ───────────────────────────────────

function logRendererMetric(name, data) {
  _log('RENDERER', name, data);
}

// ── Cleanup ─────────────────────────────────────────────────────

function close() {
  stopMemorySampling();
  if (_stream) {
    try { _stream.end(); } catch (_) {}
    _stream = null;
  }
}

module.exports = {
  markStartupBegin,
  mark,
  measure,
  markStartupComplete,
  getMemorySnapshot,
  logMemory,
  startMemorySampling,
  stopMemorySampling,
  wrapIPC,
  logRendererMetric,
  close,
};
