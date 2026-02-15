/**
 * Guardian — Path Constants & Directory Initialization
 *
 * All persistent data lives under ~/.guardian/
 * This module defines the directory structure and ensures it exists.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';

// ── Root ──────────────────────────────────────────────────────
export const GUARDIAN_HOME: string = path.join(os.homedir(), '.guardian');

// ── Directory Structure ──────────────────────────────────────
export const DIRS = {
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
} as const;

// ── File Paths ───────────────────────────────────────────────
export const FILES = {
  database:           path.join(DIRS.data, 'guardian.db'),
  settings:           path.join(DIRS.config, 'settings.json'),
  layout:             path.join(DIRS.config, 'layout.json'),
  profile:            path.join(DIRS.config, 'profile.json'),
  keybindings:        path.join(DIRS.config, 'keybindings.json'),
  log:                path.join(DIRS.logs, 'guardian.log'),
} as const;

// ── Initialize ───────────────────────────────────────────────
// Creates all directories if they don't exist.
// Safe to call multiple times.
export function initDirectories(): void {
  for (const dir of Object.values(DIRS)) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ── Config Helpers ───────────────────────────────────────────
export function readJSON<T = Record<string, unknown>>(filePath: string, fallback: T = {} as T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    }
  } catch (_) { /* corrupt file — return fallback */ }
  return fallback;
}

export function writeJSON(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
