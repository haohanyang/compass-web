'use strict';

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
} else {
  connectionManager = new InMemoryConnectionManager(args);
}

const workerRuntimeManager = new WorkerRuntimeManager(args);

// Setup the interval to check all sockets every 30 seconds
const checkLivenessInterval = setInterval(() => {
  fastify.websocketServer.clients.forEach((socket) => {
    if (socket.isAlive === false) {
      console.log('Terminating inactive socket');
      if (socket.sessionId) {
        workerRuntimeManager.terminateWorkerRuntime(socket.sessionId);
      } else {
        socket.terminate();
      }

      return;
    }

    socket.isAlive = false;
    socket.ping();
  });
}, 30000);

const exportIds = new NodeCache({ stdTTL: 3600 });

const fastify = require('fastify')({
  logger: true,
});

fastify.decorate('args', args);

fastify.decorate('exportIds', exportIds);

fastify.decorate('connectionManager', connectionManager);

fastify.decorate('workerRuntimeManager', workerRuntimeManager);

fastify.register(require('@fastify/static'), {
  root: __dirname,
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

fastify.register(require('@fastify/multipart'));

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
