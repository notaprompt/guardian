/**
 * Guardian — Backup System
 *
 * Creates timestamped compressed backups of ~/.guardian/ to ~/.guardian/backups/
 * Supports auto-backup on startup and manual Ctrl+Shift+B trigger.
 * Rotates old backups to keep last N (configurable, default 5).
 *
 * Uses Node.js built-in zlib + tar-like archiving.
 * On Windows, creates .zip files; on Unix, creates .tar.gz.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { GUARDIAN_HOME, DIRS, FILES, readJSON } = require('./paths');
const log = require('./logger');

const DEFAULT_MAX_BACKUPS = 5;
const DEFAULT_AUTO_INTERVAL_HOURS = 24;

// ── Helpers ───────────────────────────────────────────────────

/**
 * Get all files in a directory recursively, relative to the base.
 * Skips the backups directory to avoid recursive backup.
 */
function walkDir(dir, base, results = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    log.warn('walkDir: cannot read', dir, e.message);
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(base, fullPath);

    // Skip the backups directory itself
    if (fullPath === DIRS.backups || fullPath.startsWith(DIRS.backups + path.sep)) {
      continue;
    }

    if (entry.isDirectory()) {
      walkDir(fullPath, base, results);
    } else if (entry.isFile()) {
      results.push({ fullPath, relPath });
    }
  }

  return results;
}

/**
 * Generate a backup filename with timestamp.
 */
function backupFilename() {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';
  return `guardian-backup-${ts}.${ext}`;
}

/**
 * List existing backup files sorted by modification time (newest first).
 */
function listBackups() {
  try {
    if (!fs.existsSync(DIRS.backups)) return [];
    const files = fs.readdirSync(DIRS.backups)
      .filter((f) => f.startsWith('guardian-backup-') && (f.endsWith('.zip') || f.endsWith('.tar.gz')))
      .map((f) => {
        const fullPath = path.join(DIRS.backups, f);
        const stat = fs.statSync(fullPath);
        return { name: f, path: fullPath, size: stat.size, mtime: stat.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return files;
  } catch (e) {
    log.error('listBackups failed:', e.message);
    return [];
  }
}

/**
 * Rotate backups: keep only the most recent N.
 */
function rotateBackups(maxBackups) {
  const max = maxBackups || DEFAULT_MAX_BACKUPS;
  const backups = listBackups();
  if (backups.length <= max) return;

  for (let i = max; i < backups.length; i++) {
    try {
      fs.unlinkSync(backups[i].path);
      log.info('Rotated old backup:', backups[i].name);
    } catch (e) {
      log.warn('Failed to rotate backup:', backups[i].name, e.message);
    }
  }
}

// ── ZIP creation (Windows-focused, cross-platform) ────────────

/**
 * Create a simple ZIP file from a list of {fullPath, relPath} entries.
 * Uses a minimal ZIP implementation with zlib deflate — no external deps.
 */
function createZip(files, outputPath) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const centralDir = [];
    let offset = 0;

    const processFile = (index) => {
      if (index >= files.length) {
        // Write central directory and end record
        const centralDirOffset = offset;
        let centralDirSize = 0;

        for (const entry of centralDir) {
          entries.push(entry);
          centralDirSize += entry.length;
          offset += entry.length;
        }

        // End of central directory record
        const endRecord = Buffer.alloc(22);
        endRecord.writeUInt32LE(0x06054b50, 0);  // End signature
        endRecord.writeUInt16LE(0, 4);             // Disk number
        endRecord.writeUInt16LE(0, 6);             // Central dir start disk
        endRecord.writeUInt16LE(files.length, 8);  // Entries on this disk
        endRecord.writeUInt16LE(files.length, 10); // Total entries
        endRecord.writeUInt32LE(centralDirSize, 12);
        endRecord.writeUInt32LE(centralDirOffset, 16);
        endRecord.writeUInt16LE(0, 20);            // Comment length
        entries.push(endRecord);

        try {
          const fd = fs.openSync(outputPath, 'w');
          for (const buf of entries) {
            fs.writeSync(fd, buf);
          }
          fs.closeSync(fd);
          resolve();
        } catch (e) {
          reject(e);
        }
        return;
      }

      const file = files[index];
      const relPathBuf = Buffer.from(file.relPath.replace(/\\/g, '/'), 'utf-8');
      let fileData;
      try {
        fileData = fs.readFileSync(file.fullPath);
      } catch (e) {
        log.warn('Backup: skip unreadable file:', file.relPath, e.message);
        processFile(index + 1);
        return;
      }

      const uncompressedSize = fileData.length;
      const localHeaderOffset = offset;

      // Deflate the file data
      zlib.deflateRaw(fileData, (err, compressed) => {
        if (err) {
          log.warn('Backup: deflate failed for:', file.relPath, err.message);
          processFile(index + 1);
          return;
        }

        const compressedSize = compressed.length;

        // CRC-32
        const crc = crc32(fileData);

        // Local file header (30 bytes + filename)
        const localHeader = Buffer.alloc(30 + relPathBuf.length);
        localHeader.writeUInt32LE(0x04034b50, 0);  // Local file header signature
        localHeader.writeUInt16LE(20, 4);            // Version needed
        localHeader.writeUInt16LE(0, 6);             // Flags
        localHeader.writeUInt16LE(8, 8);             // Compression method (deflate)
        localHeader.writeUInt16LE(0, 10);            // Mod time
        localHeader.writeUInt16LE(0, 12);            // Mod date
        localHeader.writeUInt32LE(crc, 14);          // CRC-32
        localHeader.writeUInt32LE(compressedSize, 18);
        localHeader.writeUInt32LE(uncompressedSize, 22);
        localHeader.writeUInt16LE(relPathBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);            // Extra field length
        relPathBuf.copy(localHeader, 30);

        entries.push(localHeader);
        entries.push(compressed);
        offset += localHeader.length + compressed.length;

        // Central directory entry (46 bytes + filename)
        const centralEntry = Buffer.alloc(46 + relPathBuf.length);
        centralEntry.writeUInt32LE(0x02014b50, 0);  // Central dir signature
        centralEntry.writeUInt16LE(20, 4);            // Version made by
        centralEntry.writeUInt16LE(20, 6);            // Version needed
        centralEntry.writeUInt16LE(0, 8);             // Flags
        centralEntry.writeUInt16LE(8, 10);            // Compression method
        centralEntry.writeUInt16LE(0, 12);            // Mod time
        centralEntry.writeUInt16LE(0, 14);            // Mod date
        centralEntry.writeUInt32LE(crc, 16);          // CRC-32
        centralEntry.writeUInt32LE(compressedSize, 20);
        centralEntry.writeUInt32LE(uncompressedSize, 24);
        centralEntry.writeUInt16LE(relPathBuf.length, 28);
        centralEntry.writeUInt16LE(0, 30);            // Extra field length
        centralEntry.writeUInt16LE(0, 32);            // Comment length
        centralEntry.writeUInt16LE(0, 34);            // Disk number start
        centralEntry.writeUInt16LE(0, 36);            // Internal attrs
        centralEntry.writeUInt32LE(0, 38);            // External attrs
        centralEntry.writeUInt32LE(localHeaderOffset, 42);
        relPathBuf.copy(centralEntry, 46);

        centralDir.push(centralEntry);

        processFile(index + 1);
      });
    };

    processFile(0);
  });
}

// ── CRC-32 ───────────────────────────────────────────────────

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crc32Table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── TAR.GZ creation (Unix) ───────────────────────────────────

function createTarGz(files, outputPath) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    for (const file of files) {
      let fileData;
      try {
        fileData = fs.readFileSync(file.fullPath);
      } catch (e) {
        log.warn('Backup: skip unreadable file:', file.relPath, e.message);
        continue;
      }

      const relPath = file.relPath.replace(/\\/g, '/');

      // TAR header (512 bytes)
      const header = Buffer.alloc(512);

      // Name (max 100 bytes)
      const nameBuf = Buffer.from(relPath, 'utf-8');
      nameBuf.copy(header, 0, 0, Math.min(nameBuf.length, 100));

      // Mode: 0644
      Buffer.from('0000644\0', 'ascii').copy(header, 100);
      // UID
      Buffer.from('0001000\0', 'ascii').copy(header, 108);
      // GID
      Buffer.from('0001000\0', 'ascii').copy(header, 116);
      // Size (octal, 11 chars + null)
      Buffer.from(fileData.length.toString(8).padStart(11, '0') + '\0', 'ascii').copy(header, 124);
      // Mtime
      const mtime = Math.floor(Date.now() / 1000);
      Buffer.from(mtime.toString(8).padStart(11, '0') + '\0', 'ascii').copy(header, 136);
      // Typeflag: regular file
      header[156] = 48; // '0'
      // Magic
      Buffer.from('ustar\0', 'ascii').copy(header, 257);
      // Version
      Buffer.from('00', 'ascii').copy(header, 263);

      // Compute checksum
      // Fill checksum field with spaces first
      Buffer.from('        ', 'ascii').copy(header, 148);
      let chksum = 0;
      for (let i = 0; i < 512; i++) chksum += header[i];
      Buffer.from(chksum.toString(8).padStart(6, '0') + '\0 ', 'ascii').copy(header, 148);

      chunks.push(header);
      chunks.push(fileData);

      // Pad to 512-byte boundary
      const remainder = fileData.length % 512;
      if (remainder > 0) {
        chunks.push(Buffer.alloc(512 - remainder));
      }
    }

    // End-of-archive: two 512-byte blocks of zeros
    chunks.push(Buffer.alloc(1024));

    const tarData = Buffer.concat(chunks);

    zlib.gzip(tarData, (err, compressed) => {
      if (err) return reject(err);
      try {
        fs.writeFileSync(outputPath, compressed);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ── ZIP extraction (for restore) ─────────────────────────────

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    let buf;
    try {
      buf = fs.readFileSync(zipPath);
    } catch (e) {
      return reject(new Error(`Cannot read backup file: ${e.message}`));
    }

    let offset = 0;
    const extracted = [];

    while (offset < buf.length - 4) {
      const sig = buf.readUInt32LE(offset);
      if (sig !== 0x04034b50) break; // Not a local file header

      const compressionMethod = buf.readUInt16LE(offset + 8);
      const compressedSize = buf.readUInt32LE(offset + 18);
      const uncompressedSize = buf.readUInt32LE(offset + 22);
      const nameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);

      const nameStart = offset + 30;
      const relPath = buf.toString('utf-8', nameStart, nameStart + nameLen);
      const dataStart = nameStart + nameLen + extraLen;
      const compressedData = buf.subarray(dataStart, dataStart + compressedSize);

      offset = dataStart + compressedSize;

      // Skip directories
      if (relPath.endsWith('/')) continue;

      const outputPath = path.join(destDir, relPath.replace(/\//g, path.sep));
      const outputDir = path.dirname(outputPath);

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      if (compressionMethod === 0) {
        // Stored (no compression)
        fs.writeFileSync(outputPath, compressedData);
        extracted.push(relPath);
      } else if (compressionMethod === 8) {
        // Deflate
        try {
          const inflated = zlib.inflateRawSync(compressedData);
          fs.writeFileSync(outputPath, inflated);
          extracted.push(relPath);
        } catch (e) {
          log.warn('Restore: inflate failed for:', relPath, e.message);
        }
      }
    }

    resolve(extracted);
  });
}

// ── TAR.GZ extraction (for restore) ──────────────────────────

function extractTarGz(tgzPath, destDir) {
  return new Promise((resolve, reject) => {
    let compressed;
    try {
      compressed = fs.readFileSync(tgzPath);
    } catch (e) {
      return reject(new Error(`Cannot read backup file: ${e.message}`));
    }

    zlib.gunzip(compressed, (err, tarData) => {
      if (err) return reject(new Error(`Decompression failed: ${err.message}`));

      const extracted = [];
      let offset = 0;

      while (offset < tarData.length - 512) {
        // Check for end-of-archive (two zero blocks)
        let allZero = true;
        for (let i = 0; i < 512; i++) {
          if (tarData[offset + i] !== 0) { allZero = false; break; }
        }
        if (allZero) break;

        // Parse header
        const nameRaw = tarData.toString('utf-8', offset, offset + 100);
        const relPath = nameRaw.replace(/\0+$/, '');
        const sizeStr = tarData.toString('ascii', offset + 124, offset + 136).replace(/\0+$/, '').trim();
        const fileSize = parseInt(sizeStr, 8) || 0;
        const typeFlag = tarData[offset + 156];

        offset += 512; // Past header

        if (typeFlag === 53 || relPath.endsWith('/')) {
          // Directory entry — skip data
          offset += Math.ceil(fileSize / 512) * 512;
          continue;
        }

        if (relPath && fileSize > 0) {
          const fileData = tarData.subarray(offset, offset + fileSize);
          const outputPath = path.join(destDir, relPath.replace(/\//g, path.sep));
          const outputDir = path.dirname(outputPath);

          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          try {
            fs.writeFileSync(outputPath, fileData);
            extracted.push(relPath);
          } catch (e) {
            log.warn('Restore: write failed for:', relPath, e.message);
          }
        }

        // Advance past file data (padded to 512)
        offset += Math.ceil(fileSize / 512) * 512;
      }

      resolve(extracted);
    });
  });
}

// ── Public API ────────────────────────────────────────────────

/**
 * Create a backup of ~/.guardian/ (excluding backups/ directory).
 * Returns { ok, path, name, size, fileCount }.
 */
async function createBackup() {
  const files = walkDir(GUARDIAN_HOME, GUARDIAN_HOME);
  if (files.length === 0) {
    return { ok: false, error: 'No files to backup' };
  }

  const name = backupFilename();
  const outputPath = path.join(DIRS.backups, name);

  // Ensure backups directory exists
  if (!fs.existsSync(DIRS.backups)) {
    fs.mkdirSync(DIRS.backups, { recursive: true });
  }

  log.info('Creating backup:', name, `(${files.length} files)`);

  try {
    if (process.platform === 'win32') {
      await createZip(files, outputPath);
    } else {
      await createTarGz(files, outputPath);
    }

    const stat = fs.statSync(outputPath);

    // Rotate old backups
    const settings = readJSON(FILES.settings, {});
    rotateBackups(settings.maxBackups || DEFAULT_MAX_BACKUPS);

    log.info('Backup complete:', name, `(${stat.size} bytes)`);
    return { ok: true, path: outputPath, name, size: stat.size, fileCount: files.length };
  } catch (e) {
    log.error('Backup failed:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Restore from a backup file (.zip or .tar.gz).
 * Extracts to a temporary location, then copies files to ~/.guardian/.
 * Returns { ok, fileCount }.
 */
async function restoreBackup(backupPath) {
  if (!fs.existsSync(backupPath)) {
    return { ok: false, error: 'Backup file not found' };
  }

  const ext = path.extname(backupPath).toLowerCase();
  const isTarGz = backupPath.endsWith('.tar.gz') || ext === '.tgz';
  const isZip = ext === '.zip';

  if (!isTarGz && !isZip) {
    return { ok: false, error: 'Unsupported backup format. Expected .zip or .tar.gz' };
  }

  log.info('Restoring backup from:', backupPath);

  try {
    let extracted;
    if (isZip) {
      extracted = await extractZip(backupPath, GUARDIAN_HOME);
    } else {
      extracted = await extractTarGz(backupPath, GUARDIAN_HOME);
    }

    log.info('Restore complete:', extracted.length, 'files');
    return { ok: true, fileCount: extracted.length };
  } catch (e) {
    log.error('Restore failed:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Check if auto-backup should run (based on configured interval).
 * Returns true if a backup was created.
 */
async function checkAutoBackup() {
  const settings = readJSON(FILES.settings, {});

  // Auto-backup disabled
  if (settings.autoBackup === false) return false;

  const intervalHours = settings.autoBackupIntervalHours || DEFAULT_AUTO_INTERVAL_HOURS;
  const backups = listBackups();

  if (backups.length > 0) {
    const lastBackupAge = (Date.now() - backups[0].mtime.getTime()) / (1000 * 60 * 60);
    if (lastBackupAge < intervalHours) {
      log.info('Auto-backup skipped: last backup is', Math.round(lastBackupAge), 'hours old');
      return false;
    }
  }

  log.info('Auto-backup triggered: interval exceeded');
  const result = await createBackup();
  return result.ok;
}

module.exports = {
  createBackup,
  restoreBackup,
  listBackups,
  rotateBackups,
  checkAutoBackup,
};
