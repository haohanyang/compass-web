const crypto = require('crypto');
const { Writable } = require('stream');
const { generateQuery, generateAggregation } = require('./gen-ai');
const DataService = require('./data-service');
const {
  exportJSONFromQuery,
  exportJSONFromAggregation,
} = require('../compass-import-export/export/export-json');
const {
  exportCSVFromQuery,
  exportCSVFromAggregation,
} = require('../compass-import-export/export/export-csv');
const {
  gatherFieldsFromQuery,
} = require('../compass-import-export/export/gather-fields');
const { importJSON } = require('../compass-import-export/import/import-json');
const {
  guessFileType,
} = require('../compass-import-export/import/guess-filetype');
const { importCSV } = require('../compass-import-export/import/import-csv');
const {
  listCSVFields,
} = require('../compass-import-export/import/list-csv-fields');
const {
  analyzeCSVFields,
} = require('../compass-import-export/import/analyze-csv-fields');
const pkgJson = require('../package.json');

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {import('fastify').FastifyPluginOptions} opts
 * @param {import('fastify').FastifyPluginCallback} done
 */
module.exports = function (fastify, opts, done) {
  const args = fastify.args;

  /** * @type {import('node-cache')}*/
  const exportIds = fastify.exportIds;

  /** @type {import('./connection-manager').ConnectionManager>} */
  const connectionManager = fastify.connectionManager;

  const settings = {
    enableGenAIFeatures: args.enableGenAiFeatures,
    enableGenAISampleDocumentPassing: args.enableGenAiSampleDocuments,
  };

  if (args.enableEditConnections) {
    settings.enableCreatingNewConnections = true;
  }

  if (args.basicAuth) {
    fastify.addHook('onRequest', fastify.basicAuth);
  }

  fastify.get('/version', (request, reply) => {
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
      const preferences = settings;

      reply.send({
        orgId: args.orgId,
        projectId: args.projectId,
        appName: args.appName,
        preferences: {
          ...preferences,
          enableGenAIFeaturesAtlasOrg: preferences.enableGenAIFeatures,
          enableGenAIFeaturesAtlasProject: preferences.enableGenAIFeatures,
          enableGenAISampleDocumentPassing:
            preferences.enableGenAISampleDocumentPassing,
          enableGenAISampleDocumentPassingOnAtlasProject:
            preferences.enableGenAISampleDocumentPassing,
          optInDataExplorerGenAIFeatures:
            preferences.optInDataExplorerGenAIFeatures ?? false,
          cloudFeatureRolloutAccess: {
            GEN_AI_COMPASS: preferences.enableGenAIFeatures,
          },
        },
      });
    } else {
      reply.status(404).send({
        message: 'Project not found',
      });
    }
  });

  fastify.get(
    '/explorer/v1/groups/:projectId/clusters/connectionInfo',
    async (request, reply) => {
      const connections = await connectionManager.getAllConnections();
      reply.send(connections);
    }
  );

  // Save connection
  fastify.post(
    '/explorer/v1/groups/:projectId/clusters/connectionInfo',
    async (request, reply) => {
      const connectionInfo = request.body;
      if (!connectionInfo) {
        reply.status(400).send({ error: 'connectionInfo is required' });
      }

      try {
        await connectionManager.saveConnectionInfo(connectionInfo);
        reply.send({ ok: true });
      } catch (err) {
        reply.status(400).send({ error: err.message });
      }
    }
  );

  // Delete connection
  fastify.delete(
    '/explorer/v1/groups/:projectId/clusters/connectionInfo/:connectionId',
    async (request, reply) => {
      const connectionId = request.params.connectionId;

      if (!connectionId) {
        reply.status(400).send({ error: 'connectionId is required' });
      }
      try {
        await connectionManager.deleteConnectionInfo(connectionId);
        reply.send({ ok: true });
      } catch (err) {
        reply.status(400).send({ error: err.message });
      }
    }
  );

  // Settings
  fastify.get('/settings', (request, reply) => {
    reply.send(settings);
  });

  fastify.post('/settings/optInDataExplorerGenAIFeatures', (request, reply) => {
    settings.optInDataExplorerGenAIFeatures = request.body.value;

    reply.send({ ok: true });
  });

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
      const mongoClient = await connectionManager.getMongoClientById(
        exportOptions.connectionId
      );

      if (!mongoClient) {
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
              ...exportOptions,
              dataService: new DataService(mongoClient),
              output: outputStream,
            });
          } else {
            res = await exportJSONFromAggregation({
              ...exportOptions,
              preferences: { getPreferences: () => exportOptions.preferences },
              dataService: new DataService(mongoClient),
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
              ...exportOptions,
              dataService: new DataService(mongoClient),
              output: outputStream,
            });
          } else {
            res = await exportCSVFromAggregation({
              ...exportOptions,
              preferences: { getPreferences: () => exportOptions.preferences },
              dataService: new DataService(mongoClient),
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

    const mongoClient = await connectionManager.getMongoClientById(
      connectionId
    );

    if (!mongoClient) {
      reply.status(400).send({ error: 'connection id not found' });
    }

    const res = await gatherFieldsFromQuery({
      ns: request.body.ns,
      dataService: new DataService(mongoClient),
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

      const mongoClient = await connectionManager.getMongoClientById(
        body.connectionId
      );
      if (!mongoClient) {
        reply.status(400).send({ error: 'connection id not found' });
      }

      try {
        const res = await importJSON({
          ...body,
          dataService: new DataService(mongoClient),
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

      const mongoClient = await connectionManager.getMongoClientById(
        body.connectionId
      );
      if (!mongoClient) {
        reply.status(400).send({ error: 'connection id not found' });
      }

      try {
        const res = await importCSV({
          ...body,
          dataService: new DataService(mongoClient),
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
          ...body,
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
          ...body,
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
    '/ai/v1/groups/:projectId/mql-query',
    { preHandler: fastify.csrfProtection },
    async (request, reply) => {
      const projectId = request.params.projectId;
      if (projectId !== args.projectId) {
        reply.status(400).send({ error: 'Project ID mismatch' });
      }

      if (!args.enableGenAiFeatures) {
        reply.status(400).send({ error: 'Gen AI is not enabled' });
      }

      if (!args.openaiApiKey) {
        reply.status(400).send({ error: 'Missing OpenAI API key' });
      }

      try {
        const query = await generateQuery(
          args.openaiApiKey,
          request.body,
          args
        );
        delete query.error;
        reply.send({
          content: {
            query,
          },
        });
      } catch (err) {
        reply.status(400).send({ error: err.message });
      }
    }
  );

  fastify.post(
    '/ai/v1/groups/:projectId/mql-aggregation',
    { preHandler: fastify.csrfProtection },
    async (request, reply) => {
      const projectId = request.params.projectId;
      if (projectId !== args.projectId) {
        reply.status(400).send({ error: 'Project ID mismatch' });
      }

      if (!args.enableGenAiFeatures) {
        reply.status(400).send({ error: 'Gen AI is not enabled' });
      }

      if (!args.openaiApiKey) {
        reply.status(400).send({ error: 'Missing OpenAI API key' });
      }

      try {
        const aggregation = await generateAggregation(
          args.openaiApiKey,
          request.body,
          args
        );

        delete aggregation.error;

        reply.send({
          content: {
            aggregation,
          },
        });
      } catch (err) {
        reply.status(400).send({ error: err.message });
      }
    }
  );

  fastify.setNotFoundHandler((request, reply) => {
    const csrfToken = reply.generateCsrf();
    reply.view('index.eta', { csrfToken, appName: args.appName });
  });

  done();
};
