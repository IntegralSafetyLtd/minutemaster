const crypto = require('crypto');
const os = require('os');

// Generate a machine-specific encryption key
// This uses hardware identifiers to create a unique key per machine
function getMachineKey() {
  const machineId = `${os.hostname()}-${os.platform()}-${os.arch()}`;
  // Derive a 32-byte key from machine identifier
  return crypto.createHash('sha256').update(machineId).digest();
}

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

/**
 * Encrypt sensitive data
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Encrypted text in base64 format
 */
function encrypt(text) {
  if (!text) return null;

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // Derive key from machine key and salt
  const key = crypto.pbkdf2Sync(getMachineKey(), salt, 100000, 32, 'sha512');

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt the text
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ]);

  // Get authentication tag
  const tag = cipher.getAuthTag();

  // Combine salt + iv + tag + encrypted data
  const result = Buffer.concat([salt, iv, tag, encrypted]);

  return result.toString('base64');
}

/**
 * Decrypt encrypted data
 * @param {string} encryptedData - Encrypted text in base64 format
 * @returns {string|null} - Decrypted plain text or null if decryption fails
 */
function decrypt(encryptedData) {
  if (!encryptedData) return null;

  try {
    // Convert from base64
    const buffer = Buffer.from(encryptedData, 'base64');

    // Extract components
    const salt = buffer.subarray(0, SALT_LENGTH);
    const iv = buffer.subarray(SALT_LENGTH, TAG_POSITION);
    const tag = buffer.subarray(TAG_POSITION, ENCRYPTED_POSITION);
    const encrypted = buffer.subarray(ENCRYPTED_POSITION);

    // Derive key from machine key and salt
    const key = crypto.pbkdf2Sync(getMachineKey(), salt, 100000, 32, 'sha512');

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  } catch (error) {
    console.error('Decryption failed:', error.message);
    return null;
  }
}

/**
 * Validate that encryption/decryption works correctly
 */
function validateCrypto() {
  const testData = 'test-api-key-12345';
  const encrypted = encrypt(testData);
  const decrypted = decrypt(encrypted);

  if (decrypted !== testData) {
    throw new Error('Crypto validation failed - encryption/decryption mismatch');
  }

  return true;
}

module.exports = {
  encrypt,
  decrypt,
  validateCrypto
};
