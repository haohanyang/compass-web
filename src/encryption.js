/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 */

const crypto = require('crypto');
const { JSONFile } = require('lowdb/node');

const algorithm = 'aes-256-gcm';

/**
 *
 * @param {string} text
 * @param {crypto.CipherKey} key
 * @returns {string}
 */
function encrypt(text, key) {
  const iv = crypto.randomBytes(12); // 96-bit nonce for GCM

  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString(
    'hex'
  )}`;
}

/**
 *
 * @param {string} enc
 * @param {crypto.CipherKey} key
 * @returns
 */
function decrypt(enc, key) {
  const [ivHex, tagHex, encryptedHex] = enc.split(':');
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
