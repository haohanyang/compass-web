/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 */

const crypto = require('crypto');
const { JSONFile } = require('lowdb/node');

const algorithm = 'aes-256-gcm';

/**
 * Derives a 32-byte key from a password using PBKDF2
 * @param {string} password
 * @param {Buffer} salt
 * @returns {Buffer}
 */
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

/**
 *
 * @param {string} text
 * @param {string} password
 * @returns {string}
 */
function encrypt(text, password) {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(12); // 96-bit nonce for GCM

  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString(
    'hex'
  )}:${encrypted.toString('hex')}`;
}

/**
 *
 * @param {string} enc
 * @param {string} password
 * @returns
 */
function decrypt(enc, password) {
  const [saltHex, ivHex, tagHex, encryptedHex] = enc.split(':');

  // Derive the same key using the stored salt
  const salt = Buffer.from(saltHex, 'hex');
  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(
    algorithm,
    key,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString();
}

class JSONFileWithEncryption extends JSONFile {
  /**
   * @type {Buffer}
   */
  #encryptionKey;

  /**
   * @param {PathLike} filename
   * @param {string} masterPassword
   */
  constructor(filename, encryptionKey) {
    super(filename);
    this.#encryptionKey = Buffer.from(encryptionKey);
  }

  /**
   *
   * @returns {Promise<DbData>}
   */
  async read() {
    /** @type {DbData} */
    const { connections: encryptedConnections = [] } =
      (await super.read()) || {};

    const decryptedConnections = encryptedConnections.map((conn) => {
      const decryptedConnectionString = decrypt(
        conn.connectionOptions.connectionString,
        this.#encryptionKey
      );
      return {
        ...conn,
        connectionOptions: {
          ...conn.connectionOptions,
          connectionString: decryptedConnectionString,
        },
      };
    });

    return { connections: decryptedConnections };
  }

  /**
   *
   * @param {DbData} connectionData
   * @return {Promise<void>}
   */
  async write(connectionData) {
    const { connections: decryptedConnections } = connectionData;

    const encryptedConnections = decryptedConnections.map((conn) => {
      const encryptedConnectionString = encrypt(
        conn.connectionOptions.connectionString,
        this.#encryptionKey
      );
      return {
        ...conn,
        connectionOptions: {
          ...conn.connectionOptions,
          connectionString: encryptedConnectionString,
        },
      };
    });

    await super.write({ connections: encryptedConnections });
  }
}

module.exports = {
  JSONFileWithEncryption,
  encrypt,
  decrypt,
};
