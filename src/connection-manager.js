'use strict';

/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 * @typedef {import('lowdb').Low<DbData>} LowT
 */
const path = require('path');
const crypto = require('crypto');
const { Low } = require('lowdb');
const {
  resolveSRVRecord,
  parseOptions,
} = require('mongodb/lib/connection_string');
const { ConnectionString } = require('mongodb-connection-string-url');
const { JSONFileWithEncryption } = require('./encryption');

const CONNECTION_FILE_NAME = 'connections.json';

/**
 *
 * @param {object} args
 * @returns {BaseConnectionManager}
 */
function createConnectionManager(args) {
  if (!args.enableEditConnections) {
    return new BaseConnectionManager(args);
  } else {
    return new InMemoryConnectionManager(args);
  }
}

/**
 * Base class
 * @class
 */
class BaseConnectionManager {
  /**
   * @type {Map<string, ConnectionInfo>}
   */
  connections;

  constructor(args) {
    this.connections = new Map();

    /** @type {ConnectionString[]} */
    const connectionStrings = args.mongoURIs;

    for (const uri of connectionStrings) {
      const id = crypto.randomBytes(8).toString('hex');

      this.connections.set(id, {
        id: id,
        connectionOptions: {
          connectionString: uri.href,
        },
        atlasMetadata: {
          orgId: args.orgId,
          projectId: args.projectId,
          clusterUniqueId: args.clusterId,
          clusterName: uri.searchParams.get('name') ?? uri.hosts[0],
          clusterType: 'REPLICASET',
          clusterState: 'IDLE',
          metricsId: 'metricsid',
          metricsType: 'replicaSet',
          supports: {
            globalWrites: false,
            rollingIndexes: false,
          },
        },
      });
    }
  }

  /**
   * @param {boolean} [resolveSrv=true] resolveSrv
   * @returns {Promise<Array<ConnectionInfo>>}
   */
  async getAllConnections(resolveSrv = true) {
    /** @type {ConnectionInfo} */
    const connections = [];

    for (const connectionInfo of this.connections.values()) {
      if (resolveSrv) {
        const clientConnectionString = await createClientSafeConnectionString(
          new ConnectionString(
            connectionInfo.connectionOptions.connectionString
          )
        );

        connections.push({
          ...connectionInfo,
          connectionOptions: {
            connectionString: clientConnectionString,
          },
        });
      } else {
        connections.push(connectionInfo);
      }
    }

    return connections;
  }

  async init() {
    // no-op
  }

  /**
   * @param {ConnectionInfo} connectionInfo
   * @return {Promise<void>}
   */
  async saveConnectionInfo(connectionInfo) {
    throw new Error('Cannot save connection');
  }

  /**
   * @param {string} id
   * @return {Promise<void>}
   */
  async deleteConnectionInfo(id) {
    throw new Error('Cannot delete connection');
  }

  getConnectionStringById(id) {
    const connectionInfo = this.connections.get(id);
    return connectionInfo?.connectionOptions.connectionString;
  }
}

/**
 * @class
 * @extends {BaseConnectionManager}
 */
class InMemoryConnectionManager extends BaseConnectionManager {
  /**
   * @param {ConnectionInfo} connectionInfo
   * @return {Promise<void>}
   */
  async saveConnectionInfo(connectionInfo) {
    this.connections.set(connectionInfo.id, connectionInfo);
  }

  /**
   * @param {string} id
   * @return {Promise<void>}
   */
  async deleteConnectionInfo(id) {
    this.connections.delete(id);
  }
}

class FileStorageConnectionManager extends BaseConnectionManager {
  /**
   * Master password for encryption
   * @type {string}
   */
  #masterPassword;

  /**
   * Storage of editable connections
   * @type {LowT?}
   */
  #db;

  constructor(args) {
    super(args);

    if (!args.masterPassword) {
      throw new Error(
        'Master password is required for encrypting connection strings'
      );
    }

    this.#masterPassword = args.masterPassword;
  }

  async init() {
    if (this.#db) {
      return;
    }

    const storePath = path.resolve(__dirname, '..', CONNECTION_FILE_NAME);

    this.#db = new Low(
      new JSONFileWithEncryption(storePath, this.#masterPassword),
      {
        connections: [],
      }
    );

    await this.#db.read();
  }

  /**
   * @param {ConnectionInfo} connectionInfo
   */
  async saveConnectionInfo(connectionInfo) {
    if (!this.#db) {
      throw new Error('Connection not initialized');
    }

    await this.#db.update(({ connections }) => {
      const existingIndex = connections.findIndex(
        (c) => c.id === connectionInfo.id
      );
      if (existingIndex === -1) {
        connections.push(connectionInfo);
      } else {
        connections[existingIndex] = connectionInfo;
      }
    });

    this.connections.set(connectionInfo.id, connectionInfo);
  }

  /**
   * @param {string} id
   */
  async deleteConnectionInfo(id) {
    if (!this.#db) {
      throw new Error('Connection not initialized');
    }

    this.#db.data.connections = this.#db.data.connections.filter(
      (c) => c.id !== id
    );
    await this.#db.write();
    this.connections.delete(id);
  }
}

/**
 * Create a client-safe connection string that avoids problematic SRV parsing in the frontend.
 * The compass frontend has code paths that assume hosts array exists when parsing connection strings.
 * For SRV URIs, we'll resolve the actual hosts and ports using the MongoDB driver utilities.
 * @param {ConnectionString} cs
 */
async function createClientSafeConnectionString(cs) {
  try {
    const isSrv = cs.isSRV;

    if (!isSrv) {
      return cs.href; // Non-SRV URIs are fine as-is
    }

    const res = await resolveSRVRecord(parseOptions(cs.href));

    const csCopy = cs.clone();
    csCopy.protocol = 'mongodb';
    csCopy.hosts = res.map((address) => address.toString());

    return csCopy.toString();
  } catch (err) {
    console.error(
      `Failed to create client safe connection string: ${cs.redact().href}`,
      err
    );
    return cs.href;
  }
}

module.exports = {
  BaseConnectionManager,
  InMemoryConnectionManager,
  FileStorageConnectionManager,
  createConnectionManager,
  CONNECTION_FILE_NAME,
};
