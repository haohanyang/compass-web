/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 * @typedef {import('lowdb').Low<DbData>} LowT
 */

const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const assert = require('assert');
const { Low } = require('lowdb');
const { JSONFileWithEncryption } = require('./encryption');

const masterPassword = 'test-master-password';

const dbFilePath = path.join(__dirname, '..', 'test-encryption.json');
const saltFilePath = path.join(__dirname, '..', 'test-encryption.salt');

const connectionString = 'mongodb://username:password@localhost:27017';

beforeEach(() => {
  for (const filePath of [dbFilePath, saltFilePath]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

it('Should correctly encrypt connections', async () => {
  /** @type {LowT} */
  const db1 = new Low(new JSONFileWithEncryption(dbFilePath, masterPassword), {
    connections: [],
  });
  await db1.read();

  await db1.update(({ connections }) => {
    connections.push({
      connectionOptions: {
        connectionString: connectionString,
      },
    });
  });

  assert.strictEqual(db1.data.connections.length, 1);
  assert.strictEqual(
    db1.data.connections[0].connectionOptions.connectionString,
    connectionString
  );

  /** @type {DbData} */
  const encryptedData = JSON.parse(
    await fsPromises.readFile(dbFilePath, 'utf8')
  );
  assert.strictEqual(encryptedData.connections.length, 1);
  assert.notStrictEqual(
    encryptedData.connections[0].connectionOptions.connectionString,
    connectionString
  );

  // Read again

  /** @type {LowT} */
  const db2 = new Low(new JSONFileWithEncryption(dbFilePath, masterPassword), {
    connections: [],
  });
  await db2.read();

  assert.strictEqual(db2.data.connections.length, 1);
  assert.strictEqual(
    db2.data.connections[0].connectionOptions.connectionString,
    connectionString
  );
});
