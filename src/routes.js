const crypto = require('crypto');
const { Writable } = require('stream');
const {
  resolveSRVRecord,
  parseOptions,
} = require('mongodb/lib/connection_string');
const { MongoDBNamespace } = require('mongodb/lib/utils');
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
 *
 * @param {import('fastify').FastifyInstance} instance
 */
function registerRoutes(instance) {
  const args = instance.args;

  /** * @type {import('node-cache')}*/
  const exportIds = instance.exportIds;

  /** @type {Record<string, import('mongodb').MongoClient>} */
  const mongoClients = instance.mongoClients;

  if (args.basicAuth) {
    instance.addHook('onRequest', instance.basicAuth);
  }

  instance.get('/version', (request, reply) => {
    reply.send({
      version: pkgJson.version,
      source: `https://github.com/haohanyang/compass-web/tree/v${pkgJson.version}`,
    });
  });

  instance.get('/projectId', (request, reply) => {
    reply.type('text/plain').send(args.projectId);
  });

  instance.get('/cloud-mongodb-com/v2/:projectId/params', (request, reply) => {
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

  instance.get(
    '/explorer/v1/groups/:projectId/clusters/connectionInfo',
    async (request, reply) => {
      const connectionInfos = await Promise.all(
        args.mongoURIs.map(async ({ uri, id }) => {
          const clientConnectionString = await createClientSafeConnectionString(
            uri
          );
          return {
            id: id,
            connectionOptions: {
              connectionString: clientConnectionString,
            },
            atlasMetadata: {
              orgId: args.orgId,
              projectId: args.projectId,
              clusterUniqueId: args.clusterId,
              clusterName:
                (uri.hosts && uri.hosts[0]) ||
                uri.hostname ||
                'unknown-cluster',
              clusterType: 'REPLICASET',
              clusterState: 'IDLE',
              metricsId: 'metricsid',
              metricsType: 'replicaSet',
              supports: {
                globalWrites: false,
                rollingIndexes: false,
              },
            },
          };
        })
      );
      reply.send(connectionInfos);
    }
  );

  instance.post(
    '/export-csv',
    { preHandler: instance.csrfProtection },
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

  instance.post(
    '/export-json',
    { preHandler: instance.csrfProtection },
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

  instance.get('/export/:exportId', async (request, reply) => {
    const exportId = request.params.exportId;
    const exportOptions = exportIds.get(exportId);

    if (exportOptions) {
      const mongoClient = mongoClients[exportOptions.connectionId];

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

  instance.post('/gather-fields', async (request, reply) => {
    const connectionId = request.body.connectionId;

    const mongoClient = mongoClients[connectionId];

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

  instance.post(
    '/guess-filetype',
    { onRequest: instance.csrfProtection },
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

  instance.post(
    '/upload-json',
    { preHandler: instance.csrfProtection },
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

      const mongoClient = mongoClients[body.connectionId];
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

  instance.post(
    '/upload-csv',
    { preHandler: instance.csrfProtection },
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

      const mongoClient = mongoClients[body.connectionId];
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

  instance.post(
    '/list-csv-fields',
    { preHandler: instance.csrfProtection },
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

  instance.post(
    '/analyze-csv-fields',
    { preHandler: instance.csrfProtection },
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

  instance.setNotFoundHandler((request, reply) => {
    const csrfToken = reply.generateCsrf();
    reply.view('index.eta', { csrfToken, appName: args.appName });
  });
}

/**
 * Create a client-safe connection string that avoids problematic SRV parsing in the frontend.
 * The compass frontend has code paths that assume hosts array exists when parsing connection strings.
 * For SRV URIs, we'll resolve the actual hosts and ports using the MongoDB driver utilities.
 * @param {import('mongodb-connection-string-url').ConnectionString} cs
 */
async function createClientSafeConnectionString(cs) {
  try {
    const isSrv = cs.protocol && cs.protocol.includes('srv');

    if (!isSrv) {
      return cs.href; // Non-SRV URIs are fine as-is
    }

    const res = await resolveSRVRecord(parseOptions(cs.toString()));
    cs.protocol = 'mongodb';
    cs.isSRV = false;
    cs.hosts = res.map((address) => address.toString());

    return cs.toString();
  } catch (_e) {
    return cs.href; // Fallback to original if SRV resolution fails
  }
}

/**
 *
 * @param {import('mongodb').MongoClient} mongoClient
 * @param {object} exportOptions
 */
function buildCursor(mongoClient, exportOptions) {
  const ns = MongoDBNamespace.fromString(exportOptions.ns);

  if (exportOptions.query) {
    const { filter, ...options } = exportOptions.query;

    options.promoteValues = false;
    options.bsonRegExp = true;

    return mongoClient
      .db(ns.db)
      .collection(ns.collection)
      .find(filter, options);
  } else {
    const { stages, options = {} } = exportOptions.aggregation;

    options.promoteValues = false;
    options.bsonRegExp = true;

    return mongoClient
      .db(ns.db)
      .collection(ns.collection)
      .aggregate(stages, options);
  }
}

module.exports = { registerRoutes };
