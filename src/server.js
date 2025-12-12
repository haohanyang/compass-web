#!/usr/bin/env node
'use strict';

const fastify = require('./app');

const args = fastify.args;

/** * @type {import('node-cache')}*/
const exportIds = fastify.exportIds;

/** * @type {import('./connection-manager').BaseConnectionManager} */
const connectionManager = fastify.connectionManager;

let shuttingDown = false;

connectionManager
  .init()
  .then(() =>
    fastify.listen({ port: args.port, host: args.host }, (err, address) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }

      console.log(`Server is running at ${address}`);

      // Clean up connections on shutdown
      const shutdown = async (signal) => {
        if (shuttingDown) {
          return;
        }

        shuttingDown = true;
        console.log(`Received ${signal}. Shutting down the server...`);

        // 10 seconds timeout to shutdown
        const timeout = setTimeout(() => {
          console.error('Forcefully shutting down after 10 seconds.');
          process.exit(1);
        }, 10 * 1000);

        try {
          await fastify.close();
          exportIds.close();
          console.log('Server closed successfully.');
        } catch (shutdownError) {
          console.error('Error during server shutdown:', shutdownError);
        } finally {
          clearTimeout(timeout);
          process.exit();
        }
      };

      for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => shutdown(signal));
      }
    })
  )
  .catch((err) => {
    console.error('Failed to initialize connections', err);
    process.exit(1);
  });
