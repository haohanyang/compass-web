'use strict';

/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 * @typedef {import('lowdb').Low<DbData>} LowT
 */

const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const {
  resolveSRVRecord,
  parseOptions,
} = require('mongodb/lib/connection_string');
const { ConnectionString } = require('mongodb-connection-string-url');

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
   * @type {Map<string, {mongoClient: MongoClient, connectionInfo: ConnectionInfo}>}
   */
  connections;

  constructor(args) {
    this.connections = new Map();

    /** @type {ConnectionString[]} */
    const connectionStrings = args.mongoURIs;

    for (const uri of connectionStrings) {
      const id = crypto.randomBytes(8).toString('hex');

      this.connections.set(id, {
        mongoClient: new MongoClient(uri.href),
        connectionInfo: {
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

    for (const { connectionInfo } of this.connections.values()) {
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

  /**
   *
   * @param {string} id
   * @returns {Promise<MongoClient?>}
   */
  async getMongoClientById(id) {
    return Promise.resolve(this.connections.get(id)?.mongoClient);
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

  /**
   * @returns {Promise<void>}
   */
  async close() {
    await Promise.all(
      this.connections.values().map(({ mongoClient }) => mongoClient.close())
    );
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
    this.connections.set(connectionInfo.id, {
      mongoClient: new MongoClient(
        connectionInfo.connectionOptions.connectionString
      ),
      connectionInfo,
    });
  }
  /**
   * @param {string} id
   * @return {Promise<void>}
   */
  async deleteConnectionInfo(id) {
    const { mongoClient } = this.connections.get(id) || {};
    await mongoClient?.close();

    this.connections.delete(id);
  }
}

class FileStorageConnectionManager extends BaseConnectionManager {
  /**
   * @type {string}
   */
  #encryptionKey;

  constructor(args) {
    super(args);

    this.#encryptionKey = args.encryptionKey;
  }
  /**
   * @param {ConnectionInfo} connectionInfo
   * @return {Promise<void>}
   */
  async saveConnectionInfo(connectionInfo) {
    this.connections.set(connectionInfo.id, {
      mongoClient: new MongoClient(
        connectionInfo.connectionOptions.connectionString
      ),
      connectionInfo,
    });
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
  createConnectionManager,
};
