/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 */

const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { promisify } = require('util');
const { JSONFile } = require('lowdb/node');

const pbkdf2 = promisify(crypto.pbkdf2);

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
   * @type {string}
   */
  #saltPath;

  /**
   * @type {string}
   */
  #dataDir;

  /**
   * @param {PathLike} filename
   * @param {string} masterPassword
   */
  constructor(filename, masterPassword) {
    super(filename);
    this.#masterPassword = masterPassword;

    // Usa COMPASS_WEB_DATA_DIR como caminho base para armazenamento persistente
    // Se não estiver definida, usa o diretório do projeto
    this.#dataDir = process.env.COMPASS_WEB_DATA_DIR || path.resolve(__dirname, '..');

    const ext = path.extname(filename.toString());
    const fileName = path.basename(filename.toString(), ext);
    this.#saltPath = path.join(this.#dataDir, fileName + '.salt');

    // Garante que o diretório existe antes de qualquer operação
    fs.mkdir(this.#dataDir, { recursive: true }).then(() => {
      console.log('[Encryption] Data directory ensured:', this.#dataDir);
    }).catch((err) => {
      console.error('[Encryption] Failed to ensure data directory:', err.message);
    });

  }

  /**
   * Get or create a salt for key derivation
   * @returns {Promise<Buffer>}
   */
  async #getOrCreateSalt() {
    if (!this.#salt) {
      const saltPath = this.#saltPath;
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
      this.#encryptionKey = await pbkdf2(
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

    // this.path é a propriedade pública do JSONFile (lowdb)
    console.log('[Encryption] Writing to:', this.path);

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

    try {
      await super.write({ connections: encryptedConnections });
      console.log('[Encryption] Write successful to:', this.path);
    } catch (err) {
      console.error('[Encryption] Write failed:', err.message);
      throw err;
    }
  }
}

module.exports = {
  JSONFileWithEncryption,
};
