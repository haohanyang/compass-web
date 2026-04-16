#!/usr/bin/env node
'use strict';

const fastify = require('./app');

const args = fastify.args;

/** * @type {import('node-cache')}*/
const exportIds = fastify.exportIds;

/** * @type {import('./connection-manager').ConnectionManager} */
const connectionManager = fastify.connectionManager;

let shuttingDown = false;

fastify.listen({ port: args.port, host: args.host }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  console.log(`Server is running at ${address}`);

  const shutdown = async (signal) => {
    if (shuttingDown) {
      console.log('Shutdown already in progress...');
      return;
    }

    shuttingDown = true;
    console.log(`Received ${signal}. Shutting down the server...`);

    const timeout = setTimeout(() => {
      console.error('Forcefully shutting down after 10 seconds.');
      process.exit(1);
    }, 10 * 1000).unref();

    let exitCode = 0;
    try {
      await fastify.close();
      exportIds.close();
      await fastify.workerRuntimeManager.close();
      await connectionManager.close();
      console.log('Server closed successfully.');
    } catch (shutdownError) {
      console.error('Error during server shutdown:', shutdownError);
      exitCode = 1;
    } finally {
      clearTimeout(timeout);
      process.exit(exitCode);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown(signal));
  }
});
