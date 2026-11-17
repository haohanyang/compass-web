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

function proxyLog(message) {
  console.error(`compass-web: ${message}`);
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {import('@fastify/websocket').WebSocket} socket
 */
function handleMongoConnection(fastify, socket) {
  const args = fastify.args;

  /** @type {ConnectionString[]} */
  const mongoURIs = args.mongoURIs;

  const tlsParamEnabled = (connectionString, name) => {
    try {
      return connectionString.searchParams.get(name) === 'true';
    } catch (_e) {
      return false;
    }
  };

  // If any configured connection string requests insecure TLS, apply it globally
  // to all proxy TLS sockets. This covers cases where the driver resolves hosts
  // different from the seed host in the URI (e.g., AWS DocumentDB replicas).
  const globalTLSInsecure = mongoURIs.some(
    (connectionString) =>
      tlsParamEnabled(connectionString, 'tlsInsecure') ||
      tlsParamEnabled(connectionString, 'tlsAllowInvalidCertificates')
  );

  let mongoSocket;
  let target = 'unknown';

  proxyLog(
    `browser websocket open (total ${fastify.websocketServer.clients.size})`
  );

  socket.on('error', (err) => {
    proxyLog(`browser websocket error target=${target} message=${err.message}`);
  });

  socket.on('message', async (message) => {
    try {
      if (mongoSocket) {
        mongoSocket.write(decodeMessageWithTypeByte(message), 'binary');
        return;
      }

      // First message before socket is created is with connection info
      /** @type {import('mongodb').MongoClientOptions}*/
      const { tls: useSecureConnection, ...connectOptions } =
        decodeMessageWithTypeByte(message);
      target = `${connectOptions.host}:${connectOptions.port}`;

      mongoSocket = useSecureConnection
        ? (() => {
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
              (connectionString) => {
                try {
                  const hostMatches = (connectionString.hosts || []).some(
                    (h) => h.split(':')[0] === connectOptions.host
                  );
                  if (!hostMatches) return false;
                  return (
                    tlsParamEnabled(connectionString, 'tlsInsecure') ||
                    tlsParamEnabled(
                      connectionString,
                      'tlsAllowInvalidCertificates'
                    )
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

            /**  @type {import('tls').ConnectionOptions} */
            const tlsOptions = {
              host: connectOptions.host,
              port: connectOptions.port,
              minVersion: 'TLSv1.2',
            };

            // SNI with an IP address makes the handshake fail.
            if (!net.isIP(connectOptions.host)) {
              tlsOptions.servername = connectOptions.host;
            }

            if (wantInsecure) {
              tlsOptions.rejectUnauthorized = false;
              tlsOptions.checkServerIdentity = () => undefined;
            }

            proxyLog(
              `connecting tls target=${target} rejectUnauthorized=${tlsOptions.rejectUnauthorized !== false} servername=${tlsOptions.servername || ''}`
            );
            return tls.connect(tlsOptions);
          })()
        : (() => {
            proxyLog(`connecting tcp target=${target}`);
            return net.createConnection({
              host: connectOptions.host,
              port: connectOptions.port,
            });
          })();
      mongoSocket.setKeepAlive(true, 300000);
      mongoSocket.setTimeout(30000);
      mongoSocket.setNoDelay(true);
      const connectEvent = useSecureConnection ? 'secureConnect' : 'connect';
      let proxyClosed = false;
      SOCKET_ERROR_EVENT_LIST.forEach((evt) => {
        mongoSocket.on(evt, (err) => {
          if (proxyClosed) {
            return;
          }
          proxyClosed = true;
          const reason = (err && (err.message || err.code)) || evt;
          proxyLog(
            `mongo proxy failed target=${target} tls=${Boolean(useSecureConnection)} event=${evt} code=${(err && err.code) || ''} message=${reason}`
          );
          socket.close(evt === 'close' ? 1001 : 1011, String(reason).slice(0, 120));
          if (evt !== 'close') {
            mongoSocket.destroy();
          }
        });
      });
      mongoSocket.on(connectEvent, () => {
        proxyLog(`mongo proxy connected target=${target}`);
        mongoSocket.setTimeout(0);
        const encoded = encodeStringMessageWithTypeByte(
          JSON.stringify({ preMessageOk: 1 })
        );
        socket.send(encoded);
      });
      mongoSocket.on('data', (data) => {
        if (socket.readyState !== 1) {
          return;
        }
        socket.send(encodeBinaryMessageWithTypeByte(data));
      });
    } catch (err) {
      proxyLog(
        `mongo proxy setup failed target=${target} message=${err.message}`
      );
      socket.close(1011, String(err.message || 'proxy setup failed').slice(0, 120));
    }
  });

  socket.on('close', (code, reason) => {
    const reasonText = Buffer.isBuffer(reason) ? reason.toString() : String(reason || '');
    proxyLog(
      `browser websocket closed target=${target} code=${code} reason=${reasonText}`
    );
    mongoSocket?.removeAllListeners();
    mongoSocket?.destroy();
  });
}

/**
 * Websocket proxy for MongoDB connections
 * @param {import('fastify').FastifyInstance} fastify
 * @param {import('fastify').FastifyPluginOptions} opts
 * @param {import('fastify').FastifyPluginCallback} done
 */
module.exports = function (fastify, _opts, done) {
  fastify.get('/mongo', { websocket: true }, (socket) => {
    handleMongoConnection(fastify, socket);
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
