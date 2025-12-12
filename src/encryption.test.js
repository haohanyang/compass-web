/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 * @typedef {import('lowdb').Low<DbData>} LowT
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const assert = require('assert');
const { Low } = require('lowdb');
const { JSONFileWithEncryption, decrypt, encrypt } = require('./encryption');

const dbFilePath = path.join(__dirname, '..', 'test-connections.json');
const saltFilePath = path.join(__dirname, '..', 'test-encryption.salt');

describe('Encryption and decryption', function () {
  it('Should correctly encrypt and decrypt text', function () {
    const key = crypto.randomBytes(32);
    const text = 'This is a secret message.';

    const encryptedText = encrypt(text, key);
    const decryptedText = decrypt(encryptedText, key);

    assert.strictEqual(decryptedText, text);
  });
});

describe('JSONFileWithEncryption', function () {
  const key = crypto.randomBytes(32);

  beforeEach(async () => {
    for (const filePath of [dbFilePath]) {
      try {
        await fs.unlink(filePath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
    }
  });

  it('Should correctly encrypt connections', async () => {
    const connectionString = 'mongodb://username:password@localhost:27017';

    /** @type {LowT} */
    const db = new Low(new JSONFileWithEncryption(dbFilePath, key), {
      connections: [],
    });
    await db.read();

    await db.update(({ connections }) => {
      connections.push({
        connectionOptions: {
          connectionString: connectionString,
        },
      });
    });

    assert.strictEqual(db.data.connections.length, 1);
    assert.strictEqual(
      db.data.connections[0].connectionOptions.connectionString,
      connectionString
    );

    /** @type {DbData} */
    const encryptedData = JSON.parse(await fs.readFile(dbFilePath, 'utf8'));
    assert.strictEqual(encryptedData.connections.length, 1);
    assert.strictEqual(
      decrypt(
        encryptedData.connections[0].connectionOptions.connectionString,
        key
      ),
      connectionString
    );
  });
});
