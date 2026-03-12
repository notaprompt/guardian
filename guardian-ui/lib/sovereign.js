/**
 * Guardian — Sovereign Encryption Module
 *
 * AES-256-GCM encryption for sensitive cognitive data (deep/private tiers).
 * Uses PBKDF2 for passphrase-based key derivation. No external dependencies.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha512';
const PREFIX = 'sov1:';

function _deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

/**
 * Encrypt plaintext with a passphrase.
 * Returns { iv, salt, ciphertext, tag } as base64 strings, packed into a prefixed blob.
 */
function encrypt(plaintext, passphrase) {
  if (!plaintext || !passphrase) throw new Error('plaintext and passphrase are required');
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = _deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack as prefixed colon-separated base64: sov1:salt:iv:tag:ciphertext
  const packed = PREFIX + [salt, iv, tag, encrypted].map((b) => b.toString('base64')).join(':');
  return packed;
}

/**
 * Decrypt a sovereign-encrypted blob with a passphrase.
 * Returns the original plaintext string.
 */
function decrypt(packed, passphrase) {
  if (!packed || !passphrase) throw new Error('packed blob and passphrase are required');
  if (!packed.startsWith(PREFIX)) throw new Error('Not a sovereign-encrypted blob');
  const parts = packed.slice(PREFIX.length).split(':');
  if (parts.length !== 4) throw new Error('Malformed encrypted blob');
  const [saltB64, ivB64, tagB64, dataB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const key = _deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
}

/**
 * Check if a string is a sovereign-encrypted blob.
 */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, isEncrypted };
