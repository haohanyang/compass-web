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

const dbFileName = 'connections.json';

export class ConnectionManager {
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

  /**
   * @param {boolean} resolveSrv
   * @returns {Promise<Array<ConnectionInfo>>}
   */
  async getAllConnections(resolveSrv = true) {
    let dbData = { connections: [] };
    if (this.#editable) {
      dbData = this.#getDb().data;
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
   * @returns {LowT}
   */
  #getDb() {
    if (!this.#db) {
      const storePath = path.resolve(__dirname, '..', dbFileName);

      this.#db = new Low(
        new JSONFileWithEncryption(storePath, this.#masterPassword),
        {
          connections: [],
        }
      );
    }
    return this.#db;
  }

  /**
   * @param {ConnectionInfo} connectionInfo
   */
  async saveConnectionInfo(connectionInfo) {
    if (this.#editable) {
      const db = this.#getDb();

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

  /**
   * @param {string} id
   */
  async deleteConnectionInfo(id) {
    if (this.#editable) {
      const db = this.#getDb();

      await this.#mongoClients.get(id)?.close();
      this.#mongoClients.delete(id);

      db.data.connections = db.data.connections.filter((c) => c.id !== id);
      await db.write();
    } else {
      throw new Error('Editing connections is disabled');
    }
  }

  close() {
    return Promise.all(
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
