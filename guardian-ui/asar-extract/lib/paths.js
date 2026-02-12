/**
 * Guardian — Path Constants & Directory Initialization
 *
 * All persistent data lives under ~/.guardian/
 * This module defines the directory structure and ensures it exists.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// ── Root ──────────────────────────────────────────────────────
const GUARDIAN_HOME = path.join(os.homedir(), '.guardian');

// ── Directory Structure ──────────────────────────────────────
const DIRS = {
  root:               GUARDIAN_HOME,
  config:             path.join(GUARDIAN_HOME, 'config'),
  data:               path.join(GUARDIAN_HOME, 'data'),
  notes:              path.join(GUARDIAN_HOME, 'notes'),
  notesStratch:       path.join(GUARDIAN_HOME, 'notes', 'scratch'),
  notesStructured:    path.join(GUARDIAN_HOME, 'notes', 'structured'),
  notesJournal:       path.join(GUARDIAN_HOME, 'notes', 'journal'),
  artifacts:          path.join(GUARDIAN_HOME, 'artifacts'),
  artifactsCode:      path.join(GUARDIAN_HOME, 'artifacts', 'code'),
  artifactsDocs:      path.join(GUARDIAN_HOME, 'artifacts', 'docs'),
  artifactsMedia:     path.join(GUARDIAN_HOME, 'artifacts', 'media'),
  backups:            path.join(GUARDIAN_HOME, 'backups'),
  logs:               path.join(GUARDIAN_HOME, 'logs'),
};

// ── File Paths ───────────────────────────────────────────────
const FILES = {
  database:           path.join(DIRS.data, 'guardian.db'),
  settings:           path.join(DIRS.config, 'settings.json'),
  layout:             path.join(DIRS.config, 'layout.json'),
  profile:            path.join(DIRS.config, 'profile.json'),
  keybindings:        path.join(DIRS.config, 'keybindings.json'),
  log:                path.join(DIRS.logs, 'guardian.log'),
};

// ── Initialize ───────────────────────────────────────────────
// Creates all directories if they don't exist.
// Safe to call multiple times.
function initDirectories() {
  for (const dir of Object.values(DIRS)) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ── Config Helpers ───────────────────────────────────────────
function readJSON(filePath, fallback = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (_) { /* corrupt file — return fallback */ }
  return fallback;
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { GUARDIAN_HOME, DIRS, FILES, initDirectories, readJSON, writeJSON };
