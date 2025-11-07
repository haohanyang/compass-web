/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 * @typedef {import('lowdb').Low<DbData>} LowT
 */
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const assert = require('assert');
const { ConnectionString } = require('mongodb-connection-string-url');
const { ConnectionManager } = require('./connection-manager');

const dbFilePath = path.join(__dirname, '..', 'connections.json');
const saltFilePath = path.join(__dirname, '..', 'connections.salt');

beforeEach(() => {
  for (const filePath of [dbFilePath, saltFilePath]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

it('Should add new connection and encrypt connection string', async () => {
  const manager = new ConnectionManager({
    enableEditConnections: true,
    mongoURIs: [new ConnectionString('mongodb://localhost:27017')],
    masterPassword: 'masterPassword',
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
  const dbFileContent = JSON.parse(
    await fsPromises.readFile(dbFilePath, 'utf-8')
  );

  assert.strictEqual(dbFileContent.connections.length, 1);
  assert.notStrictEqual(
    dbFileContent.connections[0].connectionOptions.connectionString,
    'mongodb://user:pass@localhost:27018'
  );
});
