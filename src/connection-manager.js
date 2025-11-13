'use strict';

/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 * @typedef {import('lowdb').Low<DbData>} LowT
 */

const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { Low } = require('lowdb');
const {
  resolveSRVRecord,
  parseOptions,
} = require('mongodb/lib/connection_string');
const { ConnectionString } = require('mongodb-connection-string-url');
const { JSONFileWithEncryption } = require('./encryption');

const dbFileName = 'connections.json';

/**
 * Base class
 * @class
 */
export class ConnectionManager {
  constructor() {
    if (new.target === ConnectionManager) {
      throw new TypeError('Cannot instantiate ConnectionManager');
    }
  }

  /**
   * @param {boolean} [resolveSrv=true] resolveSrv
   * @returns {Promise<Array<ConnectionInfo>>}
   */
  async getAllConnections(resolveSrv = true) {
    throw new Error('Not implemented');
  }

  /**
   *
   * @param {string} id
   * @returns {Promise<MongoClient?>}
   */
  async getMongoClientById(id) {
    throw new Error('Not implemented');
  }

  /**
   * @param {ConnectionInfo} connectionInfo
   * @return {Promise<void>}
   */
  async saveConnectionInfo(connectionInfo) {
    throw new Error('Not implemented');
  }

  /**
   * @param {string} id
   * @return {Promise<void>}
   */
  async deleteConnectionInfo(id) {
    throw new Error('Not implemented');
  }

  /**
   * @returns {Promise<void>}
   */
  close() {
    throw new Error('Not implemented');
  }
}

/**
 * @class
 * @extends {ConnectionManager}
 */
export class InMemoryConnectionManager extends ConnectionManager {
  /**
   * @type {boolean}
   */
  #editable;

  /**
   * @type {Map<string, {mongoClient: MongoClient, connectionInfo: ConnectionInfo}>}
   */
  #connections;

  constructor(args) {
    this.#editable = args.enableEditConnections;

    this.#connections = new Map();

    /** @type {ConnectionString[]} */
    const connectionStrings = args.mongoURIs;

    for (const uri of connectionStrings) {
      const id = randomBytes(8).toString('hex');

      this.#connections.set(id, {
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
            clusterName:
              (uri.hosts && uri.hosts[0]) || uri.hostname || 'unknown-cluster',
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

  async getAllConnections(resolveSrv = true) {
    /** @type {ConnectionInfo} */
    const connections = [];

    for (const { connectionInfo } of this.#connections.values()) {
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

  getMongoClientById(id) {
    return Promise.resolve(this.#connections.get(id)?.mongoClient);
  }

  async deleteConnectionInfo(id) {
    if (this.#editable) {
      const { mongoClient } = this.#connections.get(id) || {};
      await mongoClient?.close();

      this.#connections.delete(id);
    } else {
      throw new Error('Editing connections is disabled');
    }
  }

  async close() {
    await Promise.all(
      this.#connections.values().map(({ mongoClient }) => mongoClient.close())
    );
  }
}

/**
 * @class
 * @extends {ConnectionManager}
 */
export class EncryptedJsonFileConnectionManager extends ConnectionManager {
  /**
   * @type {boolean}
   */
  #editable;

  /**
   * Connections from command line
   * @type {ConnectionInfo[]}>}
   */
  #presetConnections;

  /**
   * Storage of editable connections
   * @type {LowT?}
   */
  #db;

  /**
   * @type {Map<string, MongoClient>}
   */
  #mongoClients;

  /**
   * @type {string}
   */
  #masterPassword;

  constructor(args) {
    this.#editable = args.enableEditConnections;
    this.#presetConnections = [];
    this.#mongoClients = new Map();
    this.#masterPassword = args.masterPassword;

    /** @type {ConnectionString[]} */
    const connectionStrings = args.mongoURIs;

    connectionStrings.forEach((uri) => {
      const id = crypto.randomBytes(8).toString('hex');

      /** @type {ConnectionInfo} */
      const connectionInfo = {
        id: id,
        connectionOptions: {
          connectionString: uri.href,
        },
        atlasMetadata: {
          orgId: args.orgId,
          projectId: args.projectId,
          clusterUniqueId: args.clusterId,
          clusterName:
            (uri.hosts && uri.hosts[0]) || uri.hostname || 'unknown-cluster',
          clusterType: 'REPLICASET',
          clusterState: 'IDLE',
          metricsId: 'metricsid',
          metricsType: 'replicaSet',
          supports: {
            globalWrites: false,
            rollingIndexes: false,
          },
        },
      };

      this.#presetConnections.push(connectionInfo);
      this.#mongoClients.set(id, new MongoClient(uri.href));
    });
  }

  async getAllConnections(resolveSrv = true) {
    let dbData = { connections: [] };
    if (this.#editable) {
      dbData = (await this.#getDb()).data;
    }

    /** @type {ConnectionInfo[]} */
    const connections = [];

    for (const connectionInfo of [
      ...this.#presetConnections,
      ...dbData.connections,
    ]) {
      if (resolveSrv) {
        const clientConnectionString = await createClientSafeConnectionString(
          new ConnectionString(
            connectionInfo.connectionOptions.connectionString
          )
        );

        connections.push({
          ...connectionInfo,
          connectionOptions: {
            ...connectionInfo.connectionOptions,
            connectionString: clientConnectionString,
          },
        });
      } else {
        connections.push(connectionInfo);
      }
    }

    return connections;
  }

  async getMongoClientById(id) {
    /**
     * @type {MongoClient?}
     */
    let mongoClient;

    mongoClient = this.#mongoClients.get(id);
    if (mongoClient) {
      return mongoClient;
    }

    const allConnections = await this.getAllConnections(false);
    const uri = allConnections.find((c) => c.id === id)?.connectionOptions
      .connectionString;

    if (uri) {
      mongoClient = new MongoClient(uri);
      this.#mongoClients.set(id, mongoClient);
    }

    return mongoClient;
  }

  /**
   * @returns {Promise<LowT>}
   */
  async #getDb() {
    if (!this.#db) {
      const storePath = path.resolve(__dirname, '..', dbFileName);

      this.#db = new Low(
        new JSONFileWithEncryption(storePath, this.#masterPassword),
        {
          connections: [],
        }
      );

      await this.#db.read();
    }
    return this.#db;
  }

  async saveConnectionInfo(connectionInfo) {
    if (this.#editable) {
      const db = await this.#getDb();

      await db.update(({ connections }) => {
        const existingIndex = connections.findIndex(
          (c) => c.id === connectionInfo.id
        );
        if (existingIndex === -1) {
          connections.push(connectionInfo);
        } else {
          connections[existingIndex] = connectionInfo;
        }
      });

      await this.#mongoClients.get(connectionInfo.id)?.close();
      this.#mongoClients.set(
        connectionInfo.id,
        new MongoClient(connectionInfo.connectionOptions.connectionString)
      );
    } else {
      throw new Error('Editing connections is disabled');
    }
  }

  async deleteConnectionInfo(id) {
    if (this.#editable) {
      const db = await this.#getDb();

      await this.#mongoClients.get(id)?.close();
      this.#mongoClients.delete(id);

      db.data.connections = db.data.connections.filter((c) => c.id !== id);
      await db.write();
    } else {
      throw new Error('Editing connections is disabled');
    }
  }

  async close() {
    await Promise.all(
      this.#mongoClients.values().map((mongoClient) => mongoClient.close())
    );
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
