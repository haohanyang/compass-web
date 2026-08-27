const crypto = require('crypto');
const zlib = require('zlib');
const { Readable, Writable } = require('stream');
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
module.exports = function (fastify, _opts, done) {
  const args = fastify.args;

  /** * @type {import('node-cache')}*/
  const exportIds = fastify.exportIds;

  /** @type {import('./connection-manager').ConnectionManager>} */
  const connectionManager = fastify.connectionManager;

  const settings = {
    enableGenAIFeatures: args.enableGenAi,
    enableGenAISampleDocumentPassing: args.enableGenAiSampleDocuments,
  };

  if (args.enableEditConnections) {
    settings.enableCreatingNewConnections = true;
  }

  // `await request.file()` resolves as soon as the parser reaches the first
  // file part, so any form field sent *after* the file (as the browser client
  // does with `json`) is not parsed yet and is silently missing from
  // `file.fields`. Iterating `request.parts()` and draining each file stream
  // lets the parser continue past the file, so the `json` field is read
  // regardless of which order the client sends the two parts in. The file is
  // buffered in memory, bounded by `--max-upload-size`.
  async function readMultipartUpload(request, maxBytes) {
    let buffer = null;
    let rawJson;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const chunks = [];
        let total = 0;
        for await (const chunk of part.file) {
          total += chunk.length;
          if (total > maxBytes) {
            throw new Error(
              `Uploaded file exceeds the ${maxBytes} byte limit (set --max-upload-size to raise it)`
            );
          }
          chunks.push(chunk);
        }
        if (part.file.truncated) {
          throw new Error(
            'Uploaded file was truncated by the multipart parser'
          );
        }
        buffer = Buffer.concat(chunks);
      } else if (part.fieldname === 'json') {
        rawJson = part.value;
      }
    }

    return {
      hasFile: buffer !== null,
      rawJson,
      stream: () => Readable.from(buffer),
    };
  }

  fastify.get('/version', (_request, reply) => {
    reply.send({
      version: pkgJson.version,
      source: `https://github.com/haohanyang/compass-web/tree/v${pkgJson.version}`,
    });
  });

  fastify.get('/settings', (_request, reply) => {
    const preferences = settings;

    reply.send({
      appName: args.appName,
      preferences: {
        ...preferences,
        enableGenAIFeaturesAtlasOrg: preferences.enableGenAIFeatures,
        enableGenAIFeaturesAtlasProject: preferences.enableGenAIFeatures,
        enableGenAISampleDocumentPassingOnAtlasProject:
          preferences.enableGenAISampleDocumentPassing,
        optInDataExplorerGenAIFeatures: preferences.enableGenAIFeatures,
        cloudFeatureRolloutAccess: {
          GEN_AI_COMPASS: preferences.enableGenAIFeatures,
        },
        wsBaseUrl: args.baseRoute ? '/' + args.baseRoute : '',
        cloudBaseUrl: args.baseRoute ? `/${args.baseRoute}/api` : '/api',
        atlasApiBaseUrl: args.baseRoute ? `/${args.baseRoute}/api` : '/api',
        authPortalUrl: '',
        enableShell: args.enableShell,
      },
    });
  });

  fastify.get('/connection-info', async (_request, reply) => {
    const connections = await connectionManager.getAllConnections();
    reply.send(connections);
  });

  // Save connection
  fastify.post('/connection-info', async (request, reply) => {
    const connectionInfo = request.body;
    if (!connectionInfo) {
      return reply.status(400).send({ error: 'connectionInfo is required' });
    }

    try {
      await connectionManager.saveConnectionInfo(connectionInfo);
      reply.send({ ok: true });
    } catch (err) {
      reply.status(400).send({ error: err.message });
    }
  });

  // Delete connection
  fastify.delete('/connection-info/:connectionId', async (request, reply) => {
    const connectionId = request.params.connectionId;

    if (!connectionId) {
      return reply.status(400).send({ error: 'connectionId is required' });
    }
    try {
      await connectionManager.deleteConnectionInfo(connectionId);
      reply.send({ ok: true });
    } catch (err) {
      reply.status(400).send({ error: err.message });
    }
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
        return;
      }

      reply.raw.setHeader('Content-Type', 'application/octet-stream');

      // JSON/CSV exports compress extremely well -- every document repeats
      // the same keys. Compress here, before the socket buffer, rather than
      // at a reverse proxy: registering @fastify/compress wouldn't help
      // anyway, since it hooks onSend and this handler writes straight to
      // reply.raw, bypassing the reply lifecycle entirely. Content-Encoding
      // is transport-level, so the browser still saves a plain .json/.csv
      // file regardless of whether this branch is taken.
      const exportSink = (() => {
        const acceptEncoding = String(request.headers['accept-encoding'] || '');
        if (args.exportGzipLevel <= 0 || !/\bgzip\b/.test(acceptEncoding)) {
          return reply.raw;
        }
        reply.raw.setHeader('Content-Encoding', 'gzip');
        reply.raw.setHeader('Vary', 'Accept-Encoding');
        const gzip = zlib.createGzip({ level: args.exportGzipLevel });
        gzip.pipe(reply.raw);
        return gzip;
      })();

      let res;
      const outputStream = new Writable({
        objectMode: true,
        write: (chunk, encoding, callback) => {
          // exportSink.write() returns false once its buffer is full.
          // Ignoring that (as before) drains the export source as fast as
          // it can produce data regardless of how fast the client is
          // reading, so a slow client makes the whole export accumulate in
          // the socket buffer -- RSS then tracks the collection size instead
          // of staying flat. Waiting for 'drain' applies backpressure instead.
          if (exportSink.write(chunk)) {
            callback();
          } else {
            exportSink.once('drain', callback);
          }
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
        // Ending the gzip stream flushes it and, through the pipe, ends the
        // response; when exportSink is reply.raw itself this is unchanged.
        exportSink.end();
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
      return reply.status(400).send({ error: 'connection id not found' });
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
        return reply.status(400).send({ error: 'No file' });
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
      const upload = await readMultipartUpload(request, args.maxUploadSize);

      if (!upload.hasFile) {
        return reply.status(400).send({ error: 'No file' });
      }

      const rawJson = upload.rawJson;
      if (!rawJson) {
        return reply.status(400).send({ error: 'No json body' });
      }

      const body = JSON.parse(rawJson);

      const mongoClient = await connectionManager.getMongoClientById(
        body.connectionId
      );
      if (!mongoClient) {
        return reply.status(400).send({ error: 'connection id not found' });
      }

      try {
        const res = await importJSON({
          ...body,
          dataService: new DataService(mongoClient),
          input: upload.stream(),
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
      const upload = await readMultipartUpload(request, args.maxUploadSize);

      if (!upload.hasFile) {
        return reply.status(400).send({ error: 'No file' });
      }

      const rawJson = upload.rawJson;
      if (!rawJson) {
        return reply.status(400).send({ error: 'No json body' });
      }

      const body = JSON.parse(rawJson);

      const mongoClient = await connectionManager.getMongoClientById(
        body.connectionId
      );
      if (!mongoClient) {
        return reply.status(400).send({ error: 'connection id not found' });
      }

      try {
        const res = await importCSV({
          ...body,
          dataService: new DataService(mongoClient),
          input: upload.stream(),
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
      const upload = await readMultipartUpload(request, args.maxUploadSize);

      if (!upload.hasFile) {
        return reply.status(400).send({ error: 'No file' });
      }

      const rawJson = upload.rawJson;
      if (!rawJson) {
        return reply.status(400).send({ error: 'No json body' });
      }

      const body = JSON.parse(rawJson);

      try {
        const res = await listCSVFields({
          ...body,
          input: upload.stream(),
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
      const upload = await readMultipartUpload(request, args.maxUploadSize);

      if (!upload.hasFile) {
        return reply.status(400).send({ error: 'No file' });
      }

      const rawJson = upload.rawJson;
      if (!rawJson) {
        return reply.status(400).send({ error: 'No json body' });
      }

      const body = JSON.parse(rawJson);

      try {
        const res = await analyzeCSVFields({
          ...body,
          input: upload.stream(),
        });

        reply.send(res);
      } catch (err) {
        console.error(err);
        reply.status(502).send({ error: err.message ?? 'Unknown error' });
      }
    }
  );

  fastify.post(
    '/ai/mql-query',
    { preHandler: fastify.csrfProtection },
    async (request, reply) => {
      if (!args.enableGenAi) {
        return reply.status(400).send({ error: 'Gen AI is not enabled' });
      }

      if (!args.openaiApiKey) {
        return reply.status(400).send({ error: 'Missing OpenAI API key' });
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
    '/ai/mql-aggregation',
    { preHandler: fastify.csrfProtection },
    async (request, reply) => {
      if (!args.enableGenAi) {
        return reply.status(400).send({ error: 'Gen AI is not enabled' });
      }

      if (!args.openaiApiKey) {
        return reply.status(400).send({ error: 'Missing OpenAI API key' });
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

  done();
};
