#!/usr/bin/env node
'use strict';

const path = require('path');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const dns = require('dns').promises;
const { Writable } = require('stream');
const fastify = require('fastify')({
  logger: true,
});
const { Eta } = require('eta');
const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const { ConnectionString } = require('mongodb-connection-string-url');
const {
  decodeMessageWithTypeByte,
  encodeStringMessageWithTypeByte,
  encodeBinaryMessageWithTypeByte,
  SOCKET_ERROR_EVENT_LIST,
} = require('./lib/utils');
const NodeCache = require('node-cache');
const {
  exportJSONFromQuery,
  exportJSONFromAggregation,
} = require('./dist/compass-import-export/export/export-json');
const {
  exportCSVFromQuery,
  exportCSVFromAggregation,
} = require('./dist/compass-import-export/export/export-csv');
const {
  gatherFieldsFromQuery,
} = require('./dist/compass-import-export/export/gather-fields');
const {
  importJSON,
} = require('./dist/compass-import-export/import/import-json');
const {
  guessFileType,
} = require('./dist/compass-import-export/import/guess-filetype');
const { importCSV } = require('./dist/compass-import-export/import/import-csv');
const {
  listCSVFields,
} = require('./dist/compass-import-export/import/list-csv-fields');

const {
  analyzeCSVFields,
} = require('./dist/compass-import-export/import/analyze-csv-fields');

const DataService = require('./lib/data_service');

const args = yargs(hideBin(process.argv))
  .env('CW')
  .options('mongo-uri', {
    type: 'string',
    description:
      'MongoDB connection string, e.g. mongodb://localhost:27017. Multiple connections can be specified by separating them with whitespaces.',
    demandOption: true,
  })
  .version(require('./package.json').version)
  .options('port', {
    type: 'number',
    description: 'Port to run the server on',
    default: 8080,
  })
  .options('host', {
    type: 'string',
    description: 'Host to run the server on',
    default: 'localhost',
  })
  .options('org-id', {
    type: 'string',
    description: 'Organization ID for the connection',
    default: 'default-org-id',
  })
  .options('project-id', {
    type: 'string',
    description: 'Project ID for the connection',
    default: 'default-project-id',
  })
  .options('cluster-id', {
    type: 'string',
    description: 'Cluster ID for the connection',
    default: 'default-cluster-id',
  })
  .option('basic-auth-username', {
    type: 'string',
    description: 'Username for Basic HTTP authentication scheme',
  })
  .option('basic-auth-password', {
    type: 'string',
    description: 'Password for Basic HTTP authentication scheme',
  })
  .option('app-name', {
    type: 'string',
    description: 'Name of the application',
    default: 'Compass Web',
  })
  .parse();

let mongoURIStrings = args.mongoUri.trim().split(/\s+/);
/**
 * @type {Array<{uri: ConnectionString, raw: string, id: string, clientConnectionString?: string}>}
 */
const mongoURIs = [];

/**
 * @type {Object.<string, DataService>}
 */
const mongoServices = {};

// Validate MongoDB connection strings
let urlParsingError = '';
mongoURIStrings.forEach((uri, index) => {
  try {
    const mongoUri = new ConnectionString(uri);

    mongoURIs.push({
      uri: mongoUri,
      raw: uri,
      id: crypto.randomBytes(8).toString('hex'),
    });
  } catch (err) {
    urlParsingError += `Connection string no.${index + 1} is invalid: ${
      err.message
    }\n`;
  }
});

if (urlParsingError) {
  console.error(urlParsingError);
  process.exit(1);
}

// Create a client-safe connection string that avoids problematic SRV parsing in the frontend.
// The compass frontend has code paths that assume hosts array exists when parsing connection strings.
// For SRV URIs, we'll resolve the actual hosts and ports via DNS, then create a standard URI.
async function createClientSafeConnectionString(raw) {
  try {
    const cs = new ConnectionString(raw);
    console.log('Parsing connection string:', raw);
    console.log('Parsed CS - protocol:', cs.protocol, 'hostname:', cs.hostname, 'hosts:', cs.hosts);

    const isSrv = cs.protocol && cs.protocol.includes('srv');

    if (!isSrv) {
      return raw; // Non-SRV URIs are fine as-is
    }

    // For SRV URIs, resolve the actual hosts and ports
    // Some versions of mongodb-connection-string-url use placeholder for hostname
    // but populate hosts array correctly, so prefer hosts[0] over hostname
    let hostname = cs.hostname;
    if (!hostname || hostname === '__this_is_a_placeholder__') {
      if (cs.hosts && cs.hosts.length > 0) {
        hostname = cs.hosts[0];
        console.log('Using hostname from hosts array:', hostname);
      } else {
        console.log('No valid hostname found, using original connection string');
        return raw;
      }
    }

    try {
      const srvRecords = await dns.resolveSrv(`_mongodb._tcp.${hostname}`);
      if (!Array.isArray(srvRecords) || srvRecords.length === 0) {
        // Fallback to hostname with default port if SRV resolution fails
        const fallbackHost = `${hostname}:27017`;
        const hostList = [fallbackHost];

        let auth = '';
        if (cs.username) {
          auth += encodeURIComponent(cs.username);
          if (cs.password) auth += `:${encodeURIComponent(cs.password)}`;
          auth += '@';
        }

        const pathname = cs.pathname || '';
        const params = cs.searchParams?.toString() || '';
        const query = params ? `?${params}` : '';

        return `mongodb://${auth}${hostList.join(',')}${pathname}${query}`;
      }

      // Use the resolved SRV records
      const hostList = srvRecords.map((record) => `${record.name}:${record.port}`);

      let auth = '';
      if (cs.username) {
        auth += encodeURIComponent(cs.username);
        if (cs.password) auth += `:${encodeURIComponent(cs.password)}`;
        auth += '@';
      }

      const pathname = cs.pathname || '';
      const params = cs.searchParams?.toString() || '';
      const query = params ? `?${params}` : '';

      return `mongodb://${auth}${hostList.join(',')}${pathname}${query}`;
    } catch (dnsError) {
      console.warn('Failed to resolve SRV record for', hostname, ':', dnsError.message);
      return raw; // Fallback to original if DNS resolution fails
    }
  } catch (_e) {
    return raw; // Fallback to original if parsing fails
  }
}

// Precompute client-safe connection strings
async function initializeClientSafeConnectionStrings() {
  await Promise.all(
    mongoURIs.map(async (entry) => {
      entry.clientConnectionString = await createClientSafeConnectionString(entry.raw);
      console.log(`Converted connection string for ${entry.id}:`);
      console.log(`  Original: ${entry.raw}`);
      console.log(`  Client-safe: ${entry.clientConnectionString}`);
    })
  );
}

// Initialize connection strings
initializeClientSafeConnectionStrings().catch((err) => {
  console.error('Failed to initialize client-safe connection strings:', err);
});

// Validate basic auth settings
let basicAuth = null;

if (args.basicAuthUsername || args.basicAuthPassword) {
  if (!args.basicAuthPassword) {
    console.error('Basic auth password is not set');
    process.exit(1);
  } else if (!args.basicAuthUsername) {
    console.error('Basic auth username is not set');
    process.exit(1);
  }

  basicAuth = {
    username: args.basicAuthUsername,
    password: args.basicAuthPassword,
  };
}

for (const { uri, id } of mongoURIs) {
  mongoServices[id] = new DataService(uri.href);
}

let shuttingDown = false;

// If any configured connection string requests insecure TLS, apply it globally
// to all proxy TLS sockets. This covers cases where the driver resolves hosts
// different from the seed host in the URI (e.g., AWS DocumentDB replicas).
const globalTLSInsecure = mongoURIs.some(({ uri }) => {
  try {
    const params = uri.searchParams;
    return (
      params.get('tlsInsecure') === 'true' ||
      params.get('tlsAllowInvalidCertificates') === 'true'
    );
  } catch (_e) {
    return false;
  }
});

const exportIds = new NodeCache({ stdTTL: 3600 });

fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'dist'),
});

fastify.register(require('@fastify/view'), {
  engine: {
    eta: new Eta(),
  },
  root: path.join(__dirname, 'dist'),
});

fastify.register(require('@fastify/websocket'));

fastify.register(require('@fastify/cookie'));

fastify.register(require('@fastify/csrf-protection'), {
  getToken: (req) => {
    return req.headers['csrf-token'];
  },
  sessionPlugin: '@fastify/cookie',
});

// Websocket proxy for MongoDB connections
fastify.register(async (fastify) => {
  fastify.get(
    '/clusterConnection/:projectId',
    { websocket: true },
    (socket, req) => {
      if (req.params.projectId !== args.projectId) {
        return;
      }

      console.log(
        'new ws connection (total %s)',
        fastify.websocketServer.clients.size
      );
      let mongoSocket;

      socket.on('message', async (message) => {
        if (mongoSocket) {
          mongoSocket.write(decodeMessageWithTypeByte(message), 'binary');
        } else {
          // First message before socket is created is with connection info
          /** @type {import('mongodb').MongoClientOptions}*/
          const { tls: useSecureConnection, ...connectOptions } =
            decodeMessageWithTypeByte(message);

          console.log(
            'setting up new%s connection to %s:%s',
            useSecureConnection ? ' secure' : '',
            connectOptions.host,
            connectOptions.port
          );
          mongoSocket = useSecureConnection
            ? (() => {
                /**  @type {import('tls').ConnectionOptions} */
                const tlsOptions = {
                  servername: connectOptions.host,
                  // Ensure TLS 1.2+ for services like AWS DocDB
                  minVersion: 'TLSv1.2',
                  ...connectOptions,
                };

                const isTrue = (v) =>
                  v === true || v === 'true' || v === 1 || v === '1';
                const isFalse = (v) =>
                  v === false || v === 'false' || v === 0 || v === '0';

                // Honor insecure TLS flags coming from the client connection options
                // Mongo connection strings often use `tlsInsecure=true` to skip CA validation
                const wantInsecureFromClient =
                  isTrue(connectOptions.tlsInsecure) ||
                  isTrue(connectOptions.tlsAllowInvalidCertificates) ||
                  isFalse(connectOptions.rejectUnauthorized);

                // Also honor insecure flags from the configured CW_MONGO_URI for this host
                const wantInsecureFromServerConfig = mongoURIs.some(
                  ({ uri }) => {
                    try {
                      const hostMatches = (uri.hosts || []).some(
                        (h) => h.split(':')[0] === connectOptions.host
                      );
                      if (!hostMatches) return false;
                      const params = uri.searchParams;
                      return (
                        params.get('tlsInsecure') === 'true' ||
                        params.get('tlsAllowInvalidCertificates') === 'true'
                      );
                    } catch (_e) {
                      return false;
                    }
                  }
                );

                const wantInsecure =
                  globalTLSInsecure ||
                  wantInsecureFromClient ||
                  wantInsecureFromServerConfig;

                if (wantInsecure) {
                  tlsOptions.rejectUnauthorized = false;
                }

                // Allow skipping hostname validation when requested or when tlsInsecure=true
                if (
                  wantInsecure ||
                  isTrue(connectOptions.tlsAllowInvalidHostnames)
                ) {
                  tlsOptions.checkServerIdentity = () => undefined;
                }

                // Some environments (e.g., DocDB with TLS only) still require SNI
                if (!tlsOptions.servername) {
                  tlsOptions.servername = connectOptions.host;
                }

                return tls.connect(tlsOptions);
              })()
            : net.createConnection(connectOptions);
          mongoSocket.setKeepAlive(true, 300000);
          mongoSocket.setTimeout(30000);
          mongoSocket.setNoDelay(true);
          const connectEvent = useSecureConnection
            ? 'secureConnect'
            : 'connect';
          SOCKET_ERROR_EVENT_LIST.forEach((evt) => {
            mongoSocket.on(evt, (err) => {
              console.log('server socket error event (%s)', evt, err);
              socket.close(evt === 'close' ? 1001 : 1011);
            });
          });
          mongoSocket.on(connectEvent, () => {
            console.log(
              'server socket connected at %s:%s',
              connectOptions.host,
              connectOptions.port
            );
            mongoSocket.setTimeout(0);
            const encoded = encodeStringMessageWithTypeByte(
              JSON.stringify({ preMessageOk: 1 })
            );
            socket.send(encoded);
          });
          mongoSocket.on('data', async (data) => {
            socket.send(encodeBinaryMessageWithTypeByte(data));
          });
        }
      });

      socket.on('close', () => {
        mongoSocket?.removeAllListeners();
        mongoSocket?.end();
      });
    }
  );
});

fastify.register(require('@fastify/multipart'));

if (basicAuth) {
  fastify.register(require('@fastify/basic-auth'), {
    validate: (username, password, _req, _reply, done) => {
      if (username === basicAuth.username && password === basicAuth.password) {
        done();
      } else {
        done(new Error('Authentication error'));
      }
    },
    authenticate: true,
  });
}

fastify.after(() => {
  if (basicAuth) {
    fastify.addHook('onRequest', fastify.basicAuth);
  }

  fastify.get('/version', (request, reply) => {
    const pkgJson = require('./package.json');
    reply.send({
      version: pkgJson.version,
      source: `https://github.com/haohanyang/compass-web/tree/v${pkgJson.version}`,
    });
  });

  fastify.get('/projectId', (request, reply) => {
    reply.type('text/plain').send(args.projectId);
  });

  fastify.get('/cloud-mongodb-com/v2/:projectId/params', (request, reply) => {
    if (request.params.projectId == args.projectId) {
      reply.send({
        orgId: args.orgId,
        projectId: args.projectId,
        appName: args.appName,
      });
    } else {
      reply.status(404).send({
        message: 'Project not found',
      });
    }
  });

  fastify.get(
    '/explorer/v1/groups/:projectId/clusters/connectionInfo',
    (request, reply) => {
      reply.send(
        mongoURIs.map(({ uri, id, clientConnectionString }) => ({
          id: id,
          connectionOptions: {
            connectionString: clientConnectionString || uri.href,
          },
          atlasMetadata: {
            orgId: args.orgId,
            projectId: args.projectId,
            clusterUniqueId: args.clusterId,
            clusterName: (uri.hosts && uri.hosts[0]) || uri.hostname || 'unknown-cluster',
            clusterType: 'REPLICASET',
            clusterState: 'IDLE',
            metricsId: 'metricsid',
            metricsType: 'replicaSet',
            supports: {
              globalWrites: false,
              rollingIndexes: false,
            },
          },
        }))
      );
    }
  );

  fastify.post(
    '/export-csv',
    { preHandler: fastify.csrfProtection },
    (request, reply) => {
      // TODO: validate
      const exportId = crypto.randomBytes(8).toString('hex');
      exportIds.set(exportId, {
        ...request.body,
        type: 'csv',
      });

      reply.send(exportId);
    }
  );

  fastify.post(
    '/export-json',
    { preHandler: fastify.csrfProtection },
    (request, reply) => {
      // TODO: validate
      const exportId = crypto.randomBytes(8).toString('hex');
      exportIds.set(exportId, {
        ...request.body,
        type: 'json',
      });

      reply.send(exportId);
    }
  );

  fastify.get('/export/:exportId', async (request, reply) => {
    const exportId = request.params.exportId;
    const exportOptions = exportIds.get(exportId);

    if (exportOptions) {
      const mongoService = mongoServices[exportOptions.connectionId];

      if (!mongoService) {
        reply.status(400).send({
          error: "Connection doesn't exist",
        });
      }

      reply.raw.setHeader('Content-Type', 'application/octet-stream');

      let res;
      const outputStream = new Writable({
        objectMode: true,
        write: (chunk, encoding, callback) => {
          reply.raw.write(chunk);
          callback();
        },
      });

      try {
        if (exportOptions.type == 'json') {
          reply.raw.setHeader(
            'Content-Disposition',
            `attachment; filename="${exportOptions.ns}.json"`
          );

          if (exportOptions.query) {
            res = await exportJSONFromQuery({
              ns: exportOptions.ns,
              query: exportOptions.query,
              dataService: mongoService,
              output: outputStream,
            });
          } else {
            res = await exportJSONFromAggregation({
              ns: exportOptions.ns,
              aggregation: exportOptions.aggregation,
              preferences: exportOptions.preferences,
              dataService: mongoService,
              output: outputStream,
            });
          }
        } else {
          reply.raw.setHeader(
            'Content-Disposition',
            `attachment; filename="${exportOptions.ns}.csv"`
          );

          if (exportOptions.query) {
            res = await exportCSVFromQuery({
              ns: exportOptions.ns,
              query: exportOptions.query,
              dataService: mongoService,
              output: outputStream,
            });
          } else {
            res = await exportCSVFromAggregation({
              ns: exportOptions.ns,
              aggregation: exportOptions.aggregation,
              preferences: exportOptions.preferences,
              dataService: mongoService,
              output: outputStream,
            });
          }
        }

        console.log(`Export ${exportId} result`, res);
      } catch (err) {
        console.error(`Export ${exportId} failed`, err);
      } finally {
        reply.raw.end();
      }
    } else {
      reply.status(404).send({
        error: 'Export not found',
      });
    }
  });

  fastify.post('/gather-fields', async (request, reply) => {
    const connectionId = request.body.connectionId;

    const mongoService = connectionId ? mongoServices[connectionId] : null;

    if (!mongoService) {
      reply.status(400).send({ error: 'connection id not found' });
    }

    const res = await gatherFieldsFromQuery({
      ns: request.body.ns,
      dataService: mongoService,
      query: request.body.query,
      sampleSize: request.body.sampleSize,
    });

    reply.send({
      docsProcessed: res.docsProcessed,
      paths: res.paths,
    });
  });

  fastify.post(
    '/guess-filetype',
    { onRequest: fastify.csrfProtection },
    async (request, reply) => {
      const file = await request.file();

      if (!file) {
        reply.status(400).send({ error: 'No file' });
      }

      const res = await guessFileType({
        input: file.file,
      });

      reply.send(res);
    }
  );

  fastify.post(
    '/upload-json',
    { preHandler: fastify.csrfProtection },
    async (request, reply) => {
      const file = await request.file();

      if (!file) {
        reply.status(400).send({ error: 'No file' });
      }

      const rawJson = file.fields.json?.value;
      if (!rawJson) {
        reply.status(400).send({ error: 'No json body' });
      }

      const body = JSON.parse(rawJson);

      const mongoService = body.connectionId
        ? mongoServices[body.connectionId]
        : null;
      if (!mongoService) {
        reply.status(400).send({ error: 'connection id not found' });
      }

      try {
        const res = await importJSON({
          dataService: mongoService,
          ns: body.ns,
          jsonVariant: body.jsonVariant,
          input: file.file,
          stopOnErrors: body.stopOnErrors,
        });

        reply.send(res);
      } catch (err) {
        console.error(err);
        reply.status(502).send({ error: err.message ?? 'Unknown error' });
      }
    }
  );

  fastify.post(
    '/upload-csv',
    { preHandler: fastify.csrfProtection },
    async (request, reply) => {
      const file = await request.file();

      if (!file) {
        reply.status(400).send({ error: 'No file' });
      }

      const rawJson = file.fields.json?.value;
      if (!rawJson) {
        reply.status(400).send({ error: 'No json body' });
      }

      const body = JSON.parse(rawJson);

      const mongoService = body.connectionId
        ? mongoServices[body.connectionId]
        : null;
      if (!mongoService) {
        reply.status(400).send({ error: 'connection id not found' });
      }

      try {
        const res = await importCSV({
          dataService: mongoService,
          ns: body.ns,
          delimiter: body.delimiter,
          fields: body.fields,
          input: file.file,
        });

        reply.send(res);
      } catch (err) {
        console.error(err);
        reply.status(502).send({ error: err.message ?? 'Unknown error' });
      }
    }
  );

  fastify.post(
    '/list-csv-fields',
    { preHandler: fastify.csrfProtection },
    async (request, reply) => {
      const file = await request.file();

      if (!file) {
        reply.status(400).send({ error: 'No file' });
      }

      const rawJson = file.fields.json?.value;
      if (!rawJson) {
        reply.status(400).send({ error: 'No json body' });
      }

      const body = JSON.parse(rawJson);

      try {
        const res = await listCSVFields({
          newline: body.newline,
          delimiter: body.delimiter,
          input: file.file,
        });

        reply.send(res);
      } catch (err) {
        console.error(err);
        reply.status(502).send({ error: err.message ?? 'Unknown error' });
      }
    }
  );

  fastify.post(
    '/analyze-csv-fields',
    { preHandler: fastify.csrfProtection },
    async (request, reply) => {
      const file = await request.file();

      if (!file) {
        reply.status(400).send({ error: 'No file' });
      }

      const rawJson = file.fields.json?.value;
      if (!rawJson) {
        reply.status(400).send({ error: 'No json body' });
      }

      const body = JSON.parse(rawJson);

      try {
        const res = await analyzeCSVFields({
          newline: body.newline,
          delimiter: body.delimiter,
          input: file.file,
          ignoreEmptyStrings: body.ignoreEmptyStrings,
        });

        reply.send(res);
      } catch (err) {
        console.error(err);
        reply.status(502).send({ error: err.message ?? 'Unknown error' });
      }
    }
  );

  fastify.setNotFoundHandler((request, reply) => {
    const csrfToken = reply.generateCsrf();
    reply.view('index.eta', { csrfToken, appName: args.appName });
  });
});

fastify.listen({ port: args.port, host: args.host }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  // Clean up connections on shutdown
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      console.log('Shutting down the server...');

      // 20 seconds timeout to shutdown
      const timeout = setTimeout(() => {
        console.warn('Forcefully shutting down after 20 seconds.');
        process.exit(1);
      }, 20 * 1000);

      exportIds.close();

      Promise.allSettled([
        fastify.close(),
        // Close all MongoDB clients
        Object.entries(mongoServices).map(([_, service]) =>
          service.disconnect()
        ),
      ]).finally(() => {
        clearTimeout(timeout);
        process.exit();
      });
    });
  }
});
