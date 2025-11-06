'use strict';

const { randomBytes } = require('crypto');
const { MongoClient } = require('mongodb');
const {
  resolveSRVRecord,
  parseOptions,
} = require('mongodb/lib/connection_string');
const { ConnectionString } = require('mongodb-connection-string-url');

export class ConnectionManager {
  /**
   * @type {boolean}
   */
  #editable;

  /**
   * @type {Map<string, {mongoClient: MongoClient, connectionInfo: import('../compass/packages/connection-info/src').ConnectionInfo}>}
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

  /**
   * @param {boolean} resolveSrv
   * @returns {Promise<Array<import('../compass/packages/connection-info/src').ConnectionInfo>>}
   */
  async getAllConnections(resolveSrv = true) {
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
    return this.#connections.get(id)?.mongoClient;
  }

  async close() {
    return Promise.all(
      this.#connections.values().map(({ mongoClient }) => mongoClient.close())
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
