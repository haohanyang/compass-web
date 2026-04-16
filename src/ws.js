'use strict';

const net = require('net');
const tls = require('tls');
const { EventEmitter } = require('events');
const { ConnectionString } = require('mongodb-connection-string-url');

// WebSocket message utilities
const SOCKET_ERROR_EVENT_LIST = ['error', 'close', 'timeout', 'parseError'];

/**
 * @param {string} message
 * @returns
 */
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

/**
 *
 * @param {import('ws').RawData} message
 * @returns
 */
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

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {import('@fastify/websocket').WebSocket} socket
 * @param {import('fastify').FastifyRequest} request
 */
function handleMongoConnection(fastify, socket, request) {
  const args = fastify.args;

  /** @type {ConnectionString[]} */
  const mongoURIs = args.mongoURIs;

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

  socket.isAlive = false;

  request.log.info(
    `new ws connection (total ${fastify.websocketServer.clients.size})`
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

      request.log.info(
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
            const wantInsecureFromServerConfig = mongoURIs.some(({ uri }) => {
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
            });

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
      const connectEvent = useSecureConnection ? 'secureConnect' : 'connect';
      SOCKET_ERROR_EVENT_LIST.forEach((evt) => {
        mongoSocket.on(evt, (err) => {
          request.log.info('server socket error event (%s)', evt, err);
          socket.close(evt === 'close' ? 1001 : 1011);
        });
      });
      mongoSocket.on(connectEvent, () => {
        request.log.info(
          `server socket connected at ${connectOptions.host}:${connectOptions.port}`
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

/**
 * Websocket proxy for MongoDB connections
 * @param {import('fastify').FastifyInstance} fastify
 * @param {import('fastify').FastifyPluginOptions} opts
 * @param {import('fastify').FastifyPluginCallback} done
 */
module.exports = function (fastify, _opts, done) {
  fastify.get('/mongo', { websocket: true }, (socket, request) => {
    handleMongoConnection(fastify, socket, request);
  });

  fastify.get('/shell', { websocket: true }, (socket, request) => {
    /** @type {import('./worker-runtime-manager').WorkerRuntimeManager} */
    const workerRuntimeManager = fastify.workerRuntimeManager;

    let sessionId = null;
    socket.isAlive = true;

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    /**
     * @param {string} reqId
     * @param {boolean} ok
     * @param {any} [payload]
     * @param {{ name: string, message: string, code?: string }} [error]
     */
    function respond(reqId, ok, payload, error) {
      socket.send(
        JSON.stringify(
          ok
            ? { id: reqId, ok: true, payload }
            : { id: reqId, ok: false, error }
        )
      );
    }

    socket.on('message', async (rawMessage) => {
      let reqId;
      try {
        const { id, type, payload } = JSON.parse(rawMessage.toString());
        reqId = id;

        switch (type) {
          case 'init': {
            sessionId = payload.id;
            socket.sessionId = sessionId;
            const emitter = new EventEmitter();
            emitter.emit('mongosh:new-user', '<compass user>');
            await workerRuntimeManager.createWorkerRuntime({
              ...payload,
              emitter,
            });
            workerRuntimeManager.createWorkerRuntimeSocket(sessionId, socket);
            request.log.info(`Shell session ${sessionId} initialized`);
            respond(reqId, true, null);
            break;
          }
          case 'evaluate': {
            const rt = workerRuntimeManager.getWorkerRuntime(sessionId);
            if (!rt)
              throw Object.assign(new Error('Runtime not initialized'), {
                name: 'RuntimeError',
              });
            respond(reqId, true, await rt.evaluate(payload.code));
            break;
          }
          case 'completions': {
            const rt = workerRuntimeManager.getWorkerRuntime(sessionId);
            if (!rt)
              throw Object.assign(new Error('Runtime not initialized'), {
                name: 'RuntimeError',
              });
            respond(reqId, true, await rt.getCompletions(payload.code));
            break;
          }
          case 'shellPrompt': {
            const rt = workerRuntimeManager.getWorkerRuntime(sessionId);
            if (!rt)
              throw Object.assign(new Error('Runtime not initialized'), {
                name: 'RuntimeError',
              });
            respond(reqId, true, { prompt: await rt.getShellPrompt() });
            break;
          }
          case 'interrupt': {
            const rt = workerRuntimeManager.getWorkerRuntime(sessionId);
            if (!rt)
              throw Object.assign(new Error('Runtime not initialized'), {
                name: 'RuntimeError',
              });
            respond(reqId, true, { result: await rt.interrupt() });
            break;
          }
          default:
            respond(reqId, false, undefined, {
              name: 'Error',
              message: `Unknown message type: ${type}`,
            });
        }
      } catch (err) {
        request.log.error(`Shell session ${sessionId} error: ${err.message}`);
        if (reqId) {
          respond(reqId, false, undefined, {
            name: err.name || 'Error',
            message: err.message,
            code: err.code,
          });
        }
      }
    });

    socket.on('close', async () => {
      request.log.info(`Shell session ${sessionId} closed`);
      if (sessionId) {
        await workerRuntimeManager.terminateWorkerRuntime(sessionId);
      }
    });

    socket.on('error', (err) => {
      request.log.error(`Shell socket error: ${err.message}`);
    });
  });

  done();
};
