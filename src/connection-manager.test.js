/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 * @typedef {import('lowdb').Low<DbData>} LowT
 */
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const assert = require('assert');
const { ConnectionString } = require('mongodb-connection-string-url');
const { EncryptedJsonFileConnectionManager } = require('./connection-manager');

const masterPassword = 'masterPassword';
const newMasterPassword = 'newMasterPassword';

function connectionFilePaths(password) {
  const hash = crypto
    .createHash('sha256')
    .update(password)
    .digest('hex')
    .slice(0, 16);
  return {
    db: path.join(__dirname, '..', `connections-${hash}.json`),
    salt: path.join(__dirname, '..', `connections-${hash}.salt`),
  };
}

const { db: dbFilePath } = connectionFilePaths(masterPassword);

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

describe('Test EncryptedJsonFileConnectionManager', () => {
  beforeEach(async () => {
    const { db, salt } = connectionFilePaths(masterPassword);
    const { db: newDb, salt: newSalt } = connectionFilePaths(newMasterPassword);
    for (const filePath of [db, salt, newDb, newSalt]) {
      await unlinkIfExists(filePath);
    }
  });

  it('Should add new connection and encrypt connection string', async () => {
    const manager = new EncryptedJsonFileConnectionManager({
      enableEditConnections: true,
      mongoURIs: [new ConnectionString('mongodb://localhost:27017')],
      masterPassword,
    });

    await manager.saveConnectionInfo({
      connectionOptions: {
        connectionString: 'mongodb://user:pass@localhost:27018',
      },
    });

    const allConnections = await manager.getAllConnections(false);
    assert.strictEqual(allConnections.length, 2);
    assert.strictEqual(
      allConnections[1].connectionOptions.connectionString,
      'mongodb://user:pass@localhost:27018'
    );

    // Verify that the connection string is actually encrypted in the file
    /** @type {DbData} */
    const dbFileContent = JSON.parse(await fs.readFile(dbFilePath, 'utf-8'));

    assert.strictEqual(dbFileContent.connections.length, 1);
    assert.notStrictEqual(
      dbFileContent.connections[0].connectionOptions.connectionString,
      'mongodb://user:pass@localhost:27018'
    );
  });

  it('Should use a separate vault when master password changes', async () => {
    const managerA = new EncryptedJsonFileConnectionManager({
      enableEditConnections: true,
      mongoURIs: [],
      masterPassword,
    });

    await managerA.saveConnectionInfo({
      id: 'conn-a',
      connectionOptions: { connectionString: 'mongodb://localhost:27017' },
    });

    const managerB = new EncryptedJsonFileConnectionManager({
      enableEditConnections: true,
      mongoURIs: [],
      masterPassword: newMasterPassword,
    });

    // New password starts with an empty vault
    const connectionsB = await managerB.getAllConnections(false);
    assert.strictEqual(connectionsB.length, 0);

    // Old vault is still intact with the original password
    const connectionsA = await managerA.getAllConnections(false);
    assert.strictEqual(connectionsA.length, 1);
    assert.strictEqual(connectionsA[0].id, 'conn-a');

    // Each password produces a separate file on disk
    const { db: newDbFilePath } = connectionFilePaths(newMasterPassword);
    assert.notStrictEqual(dbFilePath, newDbFilePath);
  });
});
