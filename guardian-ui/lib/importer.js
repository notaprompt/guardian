/**
 * Guardian — Import System
 *
 * Import Markdown files as structured notes, with support for:
 * - Plain Markdown files
 * - Obsidian-style YAML frontmatter (tags, aliases, links)
 * - Guardian backup archives (.zip / .tar.gz)
 */

const fs = require('fs');
const path = require('path');
const log = require('./logger');
const backup = require('./backup');
const { generateId } = require('./database');

// ── YAML Frontmatter Parser ──────────────────────────────────

/**
 * Parse YAML frontmatter from a Markdown string.
 * Returns { meta: {}, content: string }.
 * Supports basic YAML: key: value, key: [array], tags with #, aliases.
 */
function parseFrontmatter(text) {
  if (!text.startsWith('---')) {
    return { meta: {}, content: text };
  }

  const endIndex = text.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { meta: {}, content: text };
  }

  const yamlBlock = text.slice(4, endIndex).trim();
  const content = text.slice(endIndex + 4).trim();
  const meta = {};

  let currentKey = null;
  let currentArray = null;

  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Array item: "  - value"
    if (trimmed.startsWith('- ') && currentKey && currentArray) {
      const val = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
      currentArray.push(val);
      continue;
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    // Save previous array if any
    if (currentKey && currentArray) {
      meta[currentKey] = currentArray;
      currentArray = null;
      currentKey = null;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (!rawValue) {
      // Empty value — next lines might be array items
      currentKey = key;
      currentArray = [];
      continue;
    }

    // Inline array: [val1, val2]
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      meta[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      currentKey = null;
      currentArray = null;
      continue;
    }

    // Scalar value
    meta[key] = rawValue.replace(/^["']|["']$/g, '');
    currentKey = null;
    currentArray = null;
  }

  // Save last array if pending
  if (currentKey && currentArray) {
    meta[currentKey] = currentArray;
  }

  return { meta, content };
}

// ── Markdown File Import ─────────────────────────────────────

/**
 * Import a single Markdown file as a Guardian note.
 * Returns a note object ready for database insertion.
 */
function importMarkdownFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  let text;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    return { ok: false, error: `Cannot read file: ${e.message}` };
  }

  const { meta, content } = parseFrontmatter(text);
  const fileName = path.basename(filePath, path.extname(filePath));

  // Determine note type from frontmatter or filename
  let type = 'structured';
  if (meta.type && ['scratch', 'structured', 'journal'].includes(meta.type)) {
    type = meta.type;
  } else if (meta.export_format === 'guardian-note' && meta.type) {
    type = meta.type;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(fileName)) {
    type = 'journal';
  }

  // Extract title: from frontmatter, first heading, or filename
  let title = meta.title || '';
  if (!title) {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      title = headingMatch[1].trim();
    } else {
      title = fileName;
    }
  }

  // Build tags from various frontmatter sources (Obsidian compatibility)
  const tags = [];
  if (meta.tags) {
    const rawTags = Array.isArray(meta.tags) ? meta.tags : [meta.tags];
    for (const t of rawTags) {
      // Handle comma-separated tags and #-prefixed tags
      const parts = String(t).split(',').map((p) => p.trim().replace(/^#/, ''));
      tags.push(...parts.filter(Boolean));
    }
  }
  if (meta.aliases) {
    const aliases = Array.isArray(meta.aliases) ? meta.aliases : [meta.aliases];
    for (const a of aliases) {
      tags.push(`alias:${a}`);
    }
  }

  // Preserve extra Obsidian metadata as tags
  const knownKeys = new Set(['title', 'type', 'tags', 'aliases', 'date', 'created', 'updated', 'export_format', 'export_version', 'exported_at']);
  for (const [key, value] of Object.entries(meta)) {
    if (!knownKeys.has(key) && typeof value === 'string') {
      tags.push(`${key}:${value}`);
    }
  }

  const now = new Date().toISOString();
  const note = {
    id: generateId('import'),
    type,
    title,
    content,
    tags,
    createdAt: meta.created || meta.date || now,
    updatedAt: meta.updated || now,
  };

  return { ok: true, note };
}

// ── Batch Import ─────────────────────────────────────────────

/**
 * Import multiple Markdown files.
 * Accepts an array of file paths.
 * Returns { ok, imported: [], errors: [] }.
 */
function importMarkdownFiles(filePaths) {
  const imported = [];
  const errors = [];

  for (const filePath of filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.md' && ext !== '.markdown' && ext !== '.txt') {
      errors.push({ file: filePath, error: 'Unsupported file type (expected .md or .txt)' });
      continue;
    }

    const result = importMarkdownFile(filePath);
    if (result.ok) {
      imported.push(result.note);
    } else {
      errors.push({ file: filePath, error: result.error });
    }
  }

  log.info('Import batch:', imported.length, 'imported,', errors.length, 'errors');
  return { ok: true, imported, errors };
}

/**
 * Import from an Obsidian vault directory.
 * Recursively finds all .md files and imports them.
 * Returns { ok, imported: [], errors: [] }.
 */
function importObsidianVault(vaultDir) {
  if (!fs.existsSync(vaultDir)) {
    return { ok: false, error: `Directory not found: ${vaultDir}`, imported: [], errors: [] };
  }

  const mdFiles = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      // Skip hidden directories (.obsidian, .trash, etc.)
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        mdFiles.push(fullPath);
      }
    }
  }
  walk(vaultDir);

  log.info('Obsidian vault scan:', mdFiles.length, 'files found in', vaultDir);
  return importMarkdownFiles(mdFiles);
}

// ── Guardian Backup Import ───────────────────────────────────

/**
 * Import from a Guardian backup archive (.zip or .tar.gz).
 * Delegates to backup.restoreBackup().
 */
async function importBackup(backupPath) {
  const ext = path.extname(backupPath).toLowerCase();
  const isTarGz = backupPath.endsWith('.tar.gz') || ext === '.tgz';
  const isZip = ext === '.zip';

  if (!isTarGz && !isZip) {
    return { ok: false, error: 'Unsupported backup format. Expected .zip or .tar.gz' };
  }

  return backup.restoreBackup(backupPath);
}

module.exports = {
  parseFrontmatter,
  importMarkdownFile,
  importMarkdownFiles,
  importObsidianVault,
  importBackup,
};
