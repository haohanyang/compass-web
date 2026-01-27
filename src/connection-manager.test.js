/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 * @typedef {import('lowdb').Low<DbData>} LowT
 */
const path = require('path');
const fs = require('fs').promises;
const assert = require('assert');
const { ConnectionString } = require('mongodb-connection-string-url');
const {
  InMemoryConnectionManager,
  FileStorageConnectionManager,
  CONNECTION_FILE_NAME,
} = require('./connection-manager');
const { decrypt } = require('./encryption');

const dbFilePath = path.join(__dirname, '..', CONNECTION_FILE_NAME);

describe('Test InMemoryConnectionManager', function () {
  const baseArgs = {
    mongoURIs: [new ConnectionString('mongodb://localhost:27017')],
  };

  it('Should save new connection', async function () {
    const connectionManager = new InMemoryConnectionManager(baseArgs);
    await connectionManager.init();

    const newConnectionInfo = {
      id: 'new-connection-id',
      connectionOptions: {
        connectionString: 'mongodb://user:pass@localhost:27018',
      },
    };

    await connectionManager.saveConnectionInfo(newConnectionInfo);

    const allConnections = await connectionManager.getAllConnections(false);
    assert.strictEqual(allConnections.length, 2);
    assert.strictEqual(
      allConnections[1].connectionOptions.connectionString,
      'mongodb://user:pass@localhost:27018'
    );
  });

  it('Should update existing connection', async function () {
    const connectionManager = new InMemoryConnectionManager(baseArgs);
    await connectionManager.init();

    const existingConnectionInfo = (
      await connectionManager.getAllConnections(false)
    )[0];

    existingConnectionInfo.connectionOptions.connectionString =
      'mongodb://updatedUser:updatedPass@localhost:27019';

    await connectionManager.saveConnectionInfo(existingConnectionInfo);

    const allConnections = await connectionManager.getAllConnections(false);
    assert.strictEqual(allConnections.length, 1);
    assert.strictEqual(
      allConnections[0].connectionOptions.connectionString,
      'mongodb://updatedUser:updatedPass@localhost:27019'
    );
  });

  it('Should delete existing connection', async function () {
    const connectionManager = new InMemoryConnectionManager(baseArgs);
    await connectionManager.init();

    const existingConnectionInfo = (
      await connectionManager.getAllConnections(false)
    )[0];

    await connectionManager.deleteConnectionInfo(existingConnectionInfo.id);

    const allConnections = await connectionManager.getAllConnections(false);
    assert.strictEqual(allConnections.length, 0);
  });
});

describe('Test FileStorageConnectionManager', function () {
  const masterPassword = 'secret-master-password';

  beforeEach(async function () {
    try {
      await fs.unlink(dbFilePath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  });

  it('Should save new connection', async function () {
    const manager = new FileStorageConnectionManager({
      mongoURIs: [new ConnectionString('mongodb://localhost:27017')],
      masterPassword,
    });
    await manager.init();

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
    assert.strictEqual(
      decrypt(
        dbFileContent.connections[0].connectionOptions.connectionString,
        masterPassword
      ),
      'mongodb://user:pass@localhost:27018'
    );
  });

  it('Should update existing connection', async function () {
    const manager = new FileStorageConnectionManager({
      mongoURIs: [new ConnectionString('mongodb://localhost:27017')],
      masterPassword,
    });
    await manager.init();

    const existingConnectionInfo = (await manager.getAllConnections(false))[0];

    existingConnectionInfo.connectionOptions.connectionString =
      'mongodb://updatedUser:updatedPass@localhost:27019';

    await manager.saveConnectionInfo(existingConnectionInfo);

    const allConnections = await manager.getAllConnections(false);
    assert.strictEqual(allConnections.length, 1);
    assert.strictEqual(
      allConnections[0].connectionOptions.connectionString,
      'mongodb://updatedUser:updatedPass@localhost:27019'
    );

    // Verify that the connection string is actually encrypted in the file
    /** @type {DbData} */
    const dbFileContent = JSON.parse(await fs.readFile(dbFilePath, 'utf-8'));

    assert.strictEqual(dbFileContent.connections.length, 1);
    assert.strictEqual(
      decrypt(
        dbFileContent.connections[0].connectionOptions.connectionString,
        masterPassword
      ),
      'mongodb://updatedUser:updatedPass@localhost:27019'
    );
  });

  it('Should delete existing connection', async function () {
    const manager = new FileStorageConnectionManager({
      mongoURIs: [new ConnectionString('mongodb://localhost:27017')],
      masterPassword,
    });
    await manager.init();

    const existingConnectionInfo = (await manager.getAllConnections(false))[0];

    await manager.deleteConnectionInfo(existingConnectionInfo.id);

    const allConnections = await manager.getAllConnections(false);
    assert.strictEqual(allConnections.length, 0);
  });

  it('Should read encrypted connections', async function () {
    const connectionContent = {
      connections: [
        {
          id: 'ok',
          connectionOptions: {
            connectionString:
              '205c1786a54f19531739157f4c505a9a:dda39adda4dab59d7e5a7c10:5e2ffddf38c7f8da11c61e31f76927ca:33820ec89e49196dcac43da15437db806d2c13cff2b75004d33a97d83f0f907c97e4e3',
          },
        },
      ],
    };

    await fs.writeFile(dbFilePath, JSON.stringify(connectionContent), 'utf-8');

    const manager = new FileStorageConnectionManager({
      mongoURIs: [],
      masterPassword,
    });
    await manager.init();

    const allConnections = await manager.getAllConnections(false);

    assert.strictEqual(allConnections.length, 1);
    assert.strictEqual(
      allConnections[0].connectionOptions.connectionString,
      'mongodb://user:pass@localhost:27018'
    );
  });
});
