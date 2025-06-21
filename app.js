#!/usr/bin/env node
'use strict';

const path = require('path');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const fastify = require('fastify')({
  logger: true,
});
const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const { ConnectionString } = require('mongodb-connection-string-url');

// WebSocket message utilities
const SOCKET_ERROR_EVENT_LIST = ['error', 'close', 'timeout', 'parseError'];

function encodeStringMessageWithTypeByte(message) {
  const utf8Encoder = new TextEncoder();
  const utf8Array = utf8Encoder.encode(message);
  return encodeMessageWithTypeByte(utf8Array, 0x01);
}

function encodeBinaryMessageWithTypeByte(message) {
  return encodeMessageWithTypeByte(message, 0x02);
}

function encodeMessageWithTypeByte(message, type) {
  const encoded = new Uint8Array(message.length + 1);
  encoded[0] = type;
  encoded.set(message, 1);
  return encoded;
}

function decodeMessageWithTypeByte(message) {
  const typeByte = message[0];
  if (typeByte === 0x01) {
    const jsonBytes = message.subarray(1);
    const textDecoder = new TextDecoder('utf-8');
    const jsonStr = textDecoder.decode(jsonBytes);
    return JSON.parse(jsonStr);
  } else if (typeByte === 0x02) {
    return message.subarray(1);
  }
}

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
const mongoURIs = [];

// Validate MongoDB connection strings
let urlParsingError = '';
mongoURIStrings.forEach((uri, index) => {
  try {
    const mongoUri = new ConnectionString(uri);

    mongoURIs.push({
      uri: mongoUri,
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

let shuttingDown = false;

fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'dist'),
});

fastify.register(require('@fastify/websocket'));

// Websocket proxy for MongoDB connections
fastify.register(async function (fastify) {
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
          const { tls: useSecureConnection, ...connectOptions } =
            decodeMessageWithTypeByte(message);

          console.log(
            'setting up new%s connection to %s:%s',
            useSecureConnection ? ' secure' : '',
            connectOptions.host,
            connectOptions.port
          );
          mongoSocket = useSecureConnection
            ? tls.connect({
                servername: connectOptions.host,
                ...connectOptions,
              })
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

  fastify.get('/projectId', function handler(request, reply) {
    reply.type('text/plain').send(args.projectId);
  });

  fastify.get(
    '/cloud-mongodb-com/v2/:projectId/params',
    function handler(request, reply) {
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
    }
  );

  fastify.get(
    '/explorer/v1/groups/:projectId/clusters/connectionInfo',
    function handler(request, reply) {
      reply.send(
        mongoURIs.map(({ uri, id }) => ({
          id: id,
          connectionOptions: {
            connectionString: uri.href,
          },
          atlasMetadata: {
            orgId: args.orgId,
            projectId: args.projectId,
            clusterUniqueId: args.clusterId,
            clusterName: uri.hosts[0],
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

  fastify.setNotFoundHandler(function (request, reply) {
    reply.sendFile('index.html');
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

      let exitCode = 0;
      fastify
        .close()
        .then(
          () => {},
          (err) => {
            console.error(err);
            exitCode = 1;
          }
        )
        .finally(() => {
          clearTimeout(timeout);
          process.exit(exitCode);
        });
    });
  }
});
