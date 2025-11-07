/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 * @typedef {import('lowdb').Low<DbData>} LowT
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { Low } = require('lowdb');
const { JSONFileWithEncryption } = require('./encryption');

const masterPassword = 'test-master-password';

const dbFilePath = path.join(__dirname, '..', 'test-encryption.json');
const saltFilePath = path.join(__dirname, '..', 'test-encryption.salt');

describe('test', () => {
  beforeEach(() => {
    for (const filePath of [dbFilePath, saltFilePath]) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });

  it('test', async () => {
    /** @type {LowT} */
    const db = new Low(
      new JSONFileWithEncryption(
        path.join(__dirname, '..', 'test-encryption.json'),
        masterPassword
      ),
      {
        connections: [],
      }
    );

    await db.update(({ connections }) => {
      connections.push({
        connectionOptions: {
          connectionString: 'mongodb://localhost:27017',
        },
      });
    });

    const conn = db.data.connections;
    assert.equal(conn.length, 1);
  });
});
