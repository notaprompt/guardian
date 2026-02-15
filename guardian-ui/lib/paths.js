"use strict";
/**
 * Guardian — Path Constants & Directory Initialization
 *
 * All persistent data lives under ~/.guardian/
 * This module defines the directory structure and ensures it exists.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILES = exports.DIRS = exports.GUARDIAN_HOME = void 0;
exports.initDirectories = initDirectories;
exports.readJSON = readJSON;
exports.writeJSON = writeJSON;
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
// ── Root ──────────────────────────────────────────────────────
exports.GUARDIAN_HOME = path_1.default.join(os_1.default.homedir(), '.guardian');
// ── Directory Structure ──────────────────────────────────────
exports.DIRS = {
    root: exports.GUARDIAN_HOME,
    config: path_1.default.join(exports.GUARDIAN_HOME, 'config'),
    data: path_1.default.join(exports.GUARDIAN_HOME, 'data'),
    notes: path_1.default.join(exports.GUARDIAN_HOME, 'notes'),
    notesStratch: path_1.default.join(exports.GUARDIAN_HOME, 'notes', 'scratch'),
    notesStructured: path_1.default.join(exports.GUARDIAN_HOME, 'notes', 'structured'),
    notesJournal: path_1.default.join(exports.GUARDIAN_HOME, 'notes', 'journal'),
    artifacts: path_1.default.join(exports.GUARDIAN_HOME, 'artifacts'),
    artifactsCode: path_1.default.join(exports.GUARDIAN_HOME, 'artifacts', 'code'),
    artifactsDocs: path_1.default.join(exports.GUARDIAN_HOME, 'artifacts', 'docs'),
    artifactsMedia: path_1.default.join(exports.GUARDIAN_HOME, 'artifacts', 'media'),
    backups: path_1.default.join(exports.GUARDIAN_HOME, 'backups'),
    logs: path_1.default.join(exports.GUARDIAN_HOME, 'logs'),
};
// ── File Paths ───────────────────────────────────────────────
exports.FILES = {
    database: path_1.default.join(exports.DIRS.data, 'guardian.db'),
    settings: path_1.default.join(exports.DIRS.config, 'settings.json'),
    layout: path_1.default.join(exports.DIRS.config, 'layout.json'),
    profile: path_1.default.join(exports.DIRS.config, 'profile.json'),
    keybindings: path_1.default.join(exports.DIRS.config, 'keybindings.json'),
    log: path_1.default.join(exports.DIRS.logs, 'guardian.log'),
};
// ── Initialize ───────────────────────────────────────────────
// Creates all directories if they don't exist.
// Safe to call multiple times.
function initDirectories() {
    for (const dir of Object.values(exports.DIRS)) {
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
    }
}
// ── Config Helpers ───────────────────────────────────────────
function readJSON(filePath, fallback = {}) {
    try {
        if (fs_1.default.existsSync(filePath)) {
            return JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
        }
    }
    catch (_) { /* corrupt file — return fallback */ }
    return fallback;
}
function writeJSON(filePath, data) {
    fs_1.default.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
