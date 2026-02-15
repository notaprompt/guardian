"use strict";
/**
 * Guardian — Application Logger
 *
 * Simple file-based logger with daily rotation.
 * Writes to ~/.guardian/logs/guardian.log
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const paths_1 = require("./paths");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB per file
const MAX_LOG_FILES = 5;
let _stream = null;
let _currentPath = null;
function _getLogPath() {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path_1.default.join(paths_1.DIRS.logs, `guardian-${date}.log`);
}
function _ensureStream() {
    const logPath = _getLogPath();
    if (_currentPath !== logPath) {
        if (_stream) {
            try {
                _stream.end();
            }
            catch (_) { }
        }
        _stream = fs_1.default.createWriteStream(logPath, { flags: 'a' });
        _currentPath = logPath;
        _rotateOldLogs();
    }
    return _stream;
}
function _rotateOldLogs() {
    try {
        const files = fs_1.default.readdirSync(paths_1.DIRS.logs)
            .filter((f) => f.startsWith('guardian-') && f.endsWith('.log'))
            .sort()
            .reverse();
        // Keep only MAX_LOG_FILES most recent
        for (let i = MAX_LOG_FILES; i < files.length; i++) {
            fs_1.default.unlinkSync(path_1.default.join(paths_1.DIRS.logs, files[i]));
        }
    }
    catch (_) { /* best-effort cleanup */ }
}
function _write(level, ...args) {
    const ts = new Date().toISOString();
    const msg = args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    const line = `[${ts}] [${level}] ${msg}\n`;
    // Write to file
    try {
        const stream = _ensureStream();
        stream.write(line);
    }
    catch (_) { /* don't crash on log failure */ }
    // Also write to console in dev
    if (level === 'ERROR') {
        console.error(`[guardian:${level}]`, ...args);
    }
    else if (level === 'WARN') {
        console.warn(`[guardian:${level}]`, ...args);
    }
}
const log = {
    info: (...args) => _write('INFO', ...args),
    warn: (...args) => _write('WARN', ...args),
    error: (...args) => _write('ERROR', ...args),
    debug: (...args) => _write('DEBUG', ...args),
    /** Close the stream on app shutdown */
    close() {
        if (_stream) {
            try {
                _stream.end();
            }
            catch (_) { }
            _stream = null;
            _currentPath = null;
        }
    },
};
module.exports = log;
