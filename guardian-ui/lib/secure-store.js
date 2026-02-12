/**
 * Guardian — Secure API Key Storage
 *
 * Encrypts API keys using Electron's safeStorage (DPAPI on Windows).
 * Falls back to AES-256-GCM with a machine-derived key when safeStorage
 * is unavailable (e.g. during tests or on unsupported platforms).
 *
 * Keys are stored in ~/.guardian/config/keys.enc as a JSON envelope
 * with base64-encoded encrypted values per provider.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DIRS } = require('./paths');
const log = require('./logger');

const KEYS_FILE = path.join(DIRS.config, 'keys.enc');

// ── Fallback cipher helpers (AES-256-GCM) ────────────────────
// Used only when Electron safeStorage is not available.

function _deriveFallbackKey() {
  // Deterministic machine key: sha256(hostname + homedir).
  // Not truly secret, but provides basic obfuscation at rest.
  const material = require('os').hostname() + require('os').homedir();
  return crypto.createHash('sha256').update(material).digest();
}

function _fallbackEncrypt(plaintext) {
  const key = _deriveFallbackKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack as iv:tag:ciphertext, all base64
  return [iv, tag, encrypted].map((b) => b.toString('base64')).join(':');
}

function _fallbackDecrypt(packed) {
  const key = _deriveFallbackKey();
  const [ivB64, tagB64, dataB64] = packed.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
}

// ── safeStorage access ───────────────────────────────────────

let _safeStorage = null;

function _getSafeStorage() {
  if (_safeStorage !== undefined && _safeStorage !== null) return _safeStorage;
  try {
    const { safeStorage } = require('electron');
    _safeStorage = safeStorage;
    return _safeStorage;
  } catch (_) {
    _safeStorage = null;
    return null;
  }
}

function _safeStorageAvailable() {
  const ss = _getSafeStorage();
  if (!ss) return false;
  try {
    return ss.isEncryptionAvailable();
  } catch (_) {
    return false;
  }
}

// ── Encrypt / Decrypt dispatchers ────────────────────────────

function _encrypt(plaintext) {
  if (_safeStorageAvailable()) {
    const ss = _getSafeStorage();
    return 'ss:' + ss.encryptString(plaintext).toString('base64');
  }
  return 'fb:' + _fallbackEncrypt(plaintext);
}

function _decrypt(stored) {
  if (stored.startsWith('ss:')) {
    const ss = _getSafeStorage();
    if (!ss) throw new Error('safeStorage unavailable; cannot decrypt safeStorage-encrypted key');
    const buf = Buffer.from(stored.slice(3), 'base64');
    return ss.decryptString(buf);
  }
  if (stored.startsWith('fb:')) {
    return _fallbackDecrypt(stored.slice(3));
  }
  throw new Error('Unknown encryption prefix in stored key');
}

// ── File I/O ─────────────────────────────────────────────────

function _readStore() {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
    }
  } catch (err) {
    log.error('secure-store: failed to read keys file', err.message);
  }
  return { version: 1, keys: {} };
}

function _writeStore(store) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

// ── Public API ───────────────────────────────────────────────

/** Initialize the secure store (ensure config dir exists). */
function init() {
  if (!fs.existsSync(DIRS.config)) {
    fs.mkdirSync(DIRS.config, { recursive: true });
  }
  log.info('secure-store: initialized',
    _safeStorageAvailable() ? '(safeStorage)' : '(AES-256-GCM fallback)');
}

/** Returns true if Electron safeStorage DPAPI encryption is available. */
function isAvailable() {
  return _safeStorageAvailable();
}

/** Store an API key for a provider (encrypted). */
function setKey(provider, key) {
  if (!provider || typeof provider !== 'string') {
    throw new Error('provider must be a non-empty string');
  }
  if (!key || typeof key !== 'string') {
    throw new Error('key must be a non-empty string');
  }
  const store = _readStore();
  store.keys[provider] = _encrypt(key);
  _writeStore(store);
  log.info('secure-store: key stored for', provider);
}

/** Retrieve a decrypted API key for a provider. Returns null if not found. */
function getKey(provider) {
  const store = _readStore();
  const encrypted = store.keys[provider];
  if (!encrypted) return null;
  try {
    return _decrypt(encrypted);
  } catch (err) {
    log.error('secure-store: failed to decrypt key for', provider, err.message);
    return null;
  }
}

/** Delete the stored key for a provider. Returns true if a key was removed. */
function deleteKey(provider) {
  const store = _readStore();
  if (!(provider in store.keys)) return false;
  delete store.keys[provider];
  _writeStore(store);
  log.info('secure-store: key deleted for', provider);
  return true;
}

/** List all providers that have stored keys. */
function listProviders() {
  const store = _readStore();
  return Object.keys(store.keys);
}

module.exports = { init, isAvailable, setKey, getKey, deleteKey, listProviders };
