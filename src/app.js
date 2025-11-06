'use strict';

const { Eta } = require('eta');
const NodeCache = require('node-cache');
const { ConnectionManager } = require('./connection-manager');
const { readCliArgs } = require('./cli');
const { registerWs } = require('./ws');
const { registerAuth } = require('./auth');
const { registerRoutes } = require('./routes');

const args = readCliArgs();

const connectionManager = new ConnectionManager(args);

const exportIds = new NodeCache({ stdTTL: 3600 });

const fastify = require('fastify')({
  logger: true,
});

fastify.decorate('args', args);

fastify.decorate('exportIds', exportIds);

fastify.decorate('connectionManager', connectionManager);

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

// CSRF protection
fastify.register(require('@fastify/csrf-protection'), {
  getToken: (req) => {
    return req.headers['csrf-token'];
  },
  sessionPlugin: '@fastify/cookie',
});

// File upload
fastify.register(require('@fastify/multipart'));

registerWs(fastify);

registerAuth(fastify);

fastify.after(() => {
  registerRoutes(fastify);
});

module.exports = fastify;
