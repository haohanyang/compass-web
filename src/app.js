'use strict';

const path = require('path');
const { Eta } = require('eta');
const NodeCache = require('node-cache');
const {
  InMemoryConnectionManager,
  EncryptedJsonFileConnectionManager,
} = require('./connection-manager');
const { WorkerRuntimeManager } = require('./worker-runtime-manager');
const { readCliArgs } = require('./cli');
const { registerAuth } = require('./auth');

global.Worker = require('web-worker');

const args = readCliArgs();

let connectionManager;

if (args.masterPassword) {
  connectionManager = new EncryptedJsonFileConnectionManager(args);
  if (args.enableEditConnections) {
    const directory = args.connectionsDir
      ? path.resolve(args.connectionsDir)
      : path.resolve(__dirname, '..');
    console.log(`Encrypted connection credentials directory: ${directory}`);
  }
} else {
  connectionManager = new InMemoryConnectionManager(args);
  if (args.enableEditConnections) {
    console.log(
      'Connection edits stay in memory. Set CW_MASTER_PASSWORD to write them to disk.'
    );
  }
}

const workerRuntimeManager = new WorkerRuntimeManager(args);

// Setup the interval to check all sockets every 30 seconds
const checkLivenessInterval = setInterval(() => {
  fastify.websocketServer.clients.forEach((socket) => {
    // Mongo proxy sockets are not pinged. Ingress controllers often drop
    // WebSocket ping/pong, and a missed pong was closing live connections.
    if (!socket.sessionId) {
      return;
    }
    if (socket.isAlive === false) {
      console.error(
        `compass-web: terminating inactive shell socket (${socket.sessionId})`
      );
      workerRuntimeManager.terminateWorkerRuntime(socket.sessionId);
      return;
    }

    socket.isAlive = false;
    socket.ping();
  });
}, 30000);

const exportIds = new NodeCache({ stdTTL: 3600 });

const Fastify = require('fastify');

const fastify = Fastify({
  logger: true,
  logController: new Fastify.LogController({
    disableRequestLogging: true,
  }),
  trustProxy: Boolean(args.auth?.oidc),
});

fastify.decorate('args', args);

fastify.decorate('exportIds', exportIds);

fastify.decorate('connectionManager', connectionManager);

fastify.decorate('workerRuntimeManager', workerRuntimeManager);

fastify.register(require('@fastify/static'), {
  root: __dirname,
  prefix: args.baseRoute ? '/' + args.baseRoute + '/' : '/',
});

fastify.register(require('@fastify/view'), {
  engine: {
    eta: new Eta(),
  },
  root: __dirname,
});

fastify.register(require('@fastify/websocket'));

fastify.register(require('@fastify/cookie'));

fastify.register(require('@fastify/formbody'));

fastify.register(require('@fastify/csrf-protection'), {
  getToken: (req) => {
    return req.headers['csrf-token'];
  },
  sessionPlugin: '@fastify/cookie',
});

fastify.register(require('@fastify/multipart'), {
  limits: { fileSize: args.maxUploadSize },
  throwFileSizeLimit: true,
});

registerAuth(fastify);

fastify.get('/healthz', { logLevel: 'silent' }, async (_request, reply) => {
  reply.send({ status: 'ok' });
});

fastify.after(() => {
  const baseRoute = args.baseRoute;

  fastify.register(require('./ws'), {
    prefix: baseRoute ? '/' + baseRoute : undefined,
  });
  fastify.register(require('./routes'), {
    prefix: baseRoute ? `/${baseRoute}/api` : '/api',
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (baseRoute && !request.url.startsWith('/' + baseRoute)) {
      reply.status(404).send({ error: 'Not found' });
      return;
    }
    const csrfToken = reply.generateCsrf();
    reply.view('index.eta', {
      csrfToken,
      appName: args.appName,
      baseRoute: baseRoute,
    });
  });
});

// Clean up interval if server closes
fastify.addHook('onClose', (_instance, done) => {
  clearInterval(checkLivenessInterval);
  done();
});

module.exports = fastify;
