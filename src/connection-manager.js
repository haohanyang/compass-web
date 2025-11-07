'use strict';

/**
 * @typedef {import('../compass/packages/connection-info/src').ConnectionInfo} ConnectionInfo
 * @typedef {{connections: ConnectionInfo[]}} DbData
 * @typedef {import('lowdb').Low<DbData>} Low
 */

const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const {
  resolveSRVRecord,
  parseOptions,
} = require('mongodb/lib/connection_string');
const { ConnectionString } = require('mongodb-connection-string-url');

const dbFileName = 'connections.json';
const dbSaltName = 'connections.salt';

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 64;
const ITERATIONS = 100000;
const DIGEST = 'sha256';

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
   * @type {Low?}
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
   * @returns {Low<DbData>}
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

export class JSONFileWithEncryption extends JSONFile {
  /**
   * @type {string}
   */
  #masterPassword;

  /**
   * @type {Buffer?}
   */
  #encryptionKey;

  /**
   * @type {Buffer?}
   */
  #salt;

  /**
   * @param {PathLike} filename
   * @param {string} masterPassword
   */
  constructor(filename, masterPassword) {
    super(filename);
    this.#masterPassword = masterPassword;
  }

  /**
   * Get or create a salt for key derivation
   * @returns {Promise<Buffer>}
   */
  async #getOrCreateSalt() {
    if (!this.#salt) {
      const saltPath = path.resolve(__dirname, '..', dbSaltName);
      try {
        const saltHex = await fs.readFile(saltPath, 'utf8');
        this.#salt = Buffer.from(saltHex, 'hex');
      } catch (error) {
        // Salt doesn't exist, create new one
        this.#salt = crypto.randomBytes(SALT_LENGTH);
        await fs.writeFile(saltPath, this.#salt.toString('hex'), 'utf8');
      }
    }
    return this.#salt;
  }

  /**
   * @returns {Promise<Buffer>}
   */
  async #getEncryptionKey() {
    const salt = await this.#getOrCreateSalt();

    if (!this.#encryptionKey) {
      this.#encryptionKey = crypto.pbkdf2Sync(
        this.#masterPassword,
        salt,
        ITERATIONS,
        KEY_LENGTH,
        DIGEST
      );
    }
    return this.#encryptionKey;
  }

  /**
   * Encrypt a connection string
   * @param {string} connectionString
   * @returns
   */
  async #encrypt(connectionString) {
    const encryptionKey = await this.#getEncryptionKey();

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);

    let encrypted = cipher.update(connectionString, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combine IV + encrypted data + auth tag
    return iv.toString('hex') + ':' + encrypted + ':' + authTag.toString('hex');
  }

  /**
   * Decrypt a connection string
   * @param {string} encryptedData
   * @returns
   */
  async #decrypt(encryptedData) {
    const encryptionKey = await this.#getEncryptionKey();

    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   *
   * @returns {Promise<DbData>}
   */
  async read() {
    /** @type {DbData} */
    const { connections: encryptedConnections } = super.read();

    const decryptedConnections = await Promise.all(
      encryptedConnections.map(async (conn) => {
        const decryptedConnectionString = await this.#decrypt(
          conn.connectionOptions.connectionString
        );
        return {
          ...conn,
          connectionOptions: {
            ...conn.connectionOptions,
            connectionString: decryptedConnectionString,
          },
        };
      })
    );

    return { connections: decryptedConnections };
  }

  /**
   *
   * @param {DbData} connectionData
   * @return {Promise<void>}
   */
  async write(connectionData) {
    const { connections: decryptedConnections } = connectionData;

    const encryptedConnections = await Promise.all(
      decryptedConnections.map(async (conn) => {
        const encryptedConnectionString = await this.#encrypt(
          conn.connectionOptions.connectionString
        );
        return {
          ...conn,
          connectionOptions: {
            ...conn.connectionOptions,
            connectionString: encryptedConnectionString,
          },
        };
      })
    );

    await super.write({ connections: encryptedConnections });
  }
}
