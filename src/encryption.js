/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 */

const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { JSONFile } = require('lowdb/node');

const dbSaltName = 'connections.salt';

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 64;
const ITERATIONS = 100000;
const DIGEST = 'sha256';

class JSONFileWithEncryption extends JSONFile {
  /**
   * @type {string}
   */
  #masterPassword;

  /**
   * @type {Buffer?}
   */
  #encryptionKey;

  /**
   * @type {Buffer?}
   */
  #salt;

  /**
   * @param {PathLike} filename
   * @param {string} masterPassword
   */
  constructor(filename, masterPassword) {
    super(filename);
    this.#masterPassword = masterPassword;
  }

  /**
   * Get or create a salt for key derivation
   * @returns {Promise<Buffer>}
   */
  async #getOrCreateSalt() {
    if (!this.#salt) {
      const saltPath = path.resolve(__dirname, '..', dbSaltName);
      try {
        const saltHex = await fs.readFile(saltPath, 'utf8');
        this.#salt = Buffer.from(saltHex, 'hex');
      } catch (error) {
        // Salt doesn't exist, create new one
        this.#salt = crypto.randomBytes(SALT_LENGTH);
        await fs.writeFile(saltPath, this.#salt.toString('hex'), 'utf8');
      }
    }
    return this.#salt;
  }

  /**
   * @returns {Promise<Buffer>}
   */
  async #getEncryptionKey() {
    const salt = await this.#getOrCreateSalt();

    if (!this.#encryptionKey) {
      this.#encryptionKey = crypto.pbkdf2Sync(
        this.#masterPassword,
        salt,
        ITERATIONS,
        KEY_LENGTH,
        DIGEST
      );
    }
    return this.#encryptionKey;
  }

  /**
   * Encrypt a connection string
   * @param {string} connectionString
   * @returns
   */
  async #encrypt(connectionString) {
    const encryptionKey = await this.#getEncryptionKey();

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);

    let encrypted = cipher.update(connectionString, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combine IV + encrypted data + auth tag
    return iv.toString('hex') + ':' + encrypted + ':' + authTag.toString('hex');
  }

  /**
   * Decrypt a connection string
   * @param {string} encryptedData
   * @returns
   */
  async #decrypt(encryptedData) {
    const encryptionKey = await this.#getEncryptionKey();

    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   *
   * @returns {Promise<DbData>}
   */
  async read() {
    /** @type {DbData} */
    const { connections: encryptedConnections = [] } =
      (await super.read()) || {};

    const decryptedConnections = await Promise.all(
      encryptedConnections.map(async (conn) => {
        const decryptedConnectionString = await this.#decrypt(
          conn.connectionOptions.connectionString
        );
        return {
          ...conn,
          connectionOptions: {
            ...conn.connectionOptions,
            connectionString: decryptedConnectionString,
          },
        };
      })
    );

    return { connections: decryptedConnections };
  }

  /**
   *
   * @param {DbData} connectionData
   * @return {Promise<void>}
   */
  async write(connectionData) {
    const { connections: decryptedConnections } = connectionData;

    const encryptedConnections = await Promise.all(
      decryptedConnections.map(async (conn) => {
        const encryptedConnectionString = await this.#encrypt(
          conn.connectionOptions.connectionString
        );
        return {
          ...conn,
          connectionOptions: {
            ...conn.connectionOptions,
            connectionString: encryptedConnectionString,
          },
        };
      })
    );

    await super.write({ connections: encryptedConnections });
  }
}

module.exports = {
  JSONFileWithEncryption,
};
