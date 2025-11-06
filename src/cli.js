'use strict';

const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const { ConnectionString } = require('mongodb-connection-string-url');
const pkgJson = require('../package.json');
const { AGGREGATION_SYSTEM_PROMPT, QUERY_SYSTEM_PROMPT } = require('./gen-ai');

function readCliArgs() {
  const args = yargs(hideBin(process.argv))
    .env('CW')
    .options('mongo-uri', {
      type: 'string',
      description:
        'MongoDB connection string, e.g. mongodb://localhost:27017. Multiple connections can be specified by separating them with whitespaces.',
      demandOption: true,
    })
    .version(pkgJson.version)
    .options('port', {
      type: 'number',
      description: 'Port to run the server on',
      default: 8080,
    })
    .options('host', {
      type: 'string',
      description: 'Host to run the server on',
      default: 'localhost',
    })
    .options('org-id', {
      type: 'string',
      description: 'Organization ID for the connection',
      default: 'default-org-id',
    })
    .options('project-id', {
      type: 'string',
      description: 'Project ID for the connection',
      default: 'default-project-id',
    })
    .options('cluster-id', {
      type: 'string',
      description: 'Cluster ID for the connection',
      default: 'default-cluster-id',
    })
    .option('basic-auth-username', {
      type: 'string',
      description: 'Username for Basic HTTP authentication scheme',
    })
    .option('basic-auth-password', {
      type: 'string',
      description: 'Password for Basic HTTP authentication scheme',
    })
    .option('app-name', {
      type: 'string',
      description: 'Name of the application',
      default: 'Compass Web',
    })
    .option('openai-api-key', {
      type: 'string',
      description: 'OpenAI API key for GenAI services',
    })
    .option('query-system-prompt', {
      type: 'string',
      description:
        'System prompt for query generation. If not set, a default prompt will be used.',
      default: QUERY_SYSTEM_PROMPT,
    })
    .option('aggregation-system-prompt', {
      type: 'string',
      description:
        'System prompt for aggregation generation. If not set, a default prompt will be used.',
      default: AGGREGATION_SYSTEM_PROMPT,
    })
    .option('openai-model', {
      type: 'string',
      description: 'OpenAI model used in GenAI service.',
      default: 'gpt-5-mini',
    })
    .option('enable-gen-ai-features', {
      type: 'boolean',
      description: 'Enable GenAI features',
      default: false,
    })
    .option('enable-gen-ai-sample-documents', {
      type: 'boolean',
      description: 'Enable upload sample documents to GenAI service.',
      default: false,
    })
    .options('enable-edit-connections', {
      type: 'boolean',
      description: 'Allow user to edit connections in the UI',
      default: false,
    })
    .parse();

  let mongoURIStrings = args.mongoUri.trim().split(/\s+/);
  /**
   * @type {ConnectionString[]}
   */
  const mongoURIs = [];

  // Validate MongoDB connection strings
  let errMessage = '';
  mongoURIStrings.forEach((uri, index) => {
    try {
      const mongoUri = new ConnectionString(uri);

      mongoURIs.push(mongoUri);
    } catch (err) {
      errMessage += `Connection string no.${index + 1} is invalid: ${
        err.message
      }\n`;
    }
  });

  if (errMessage) {
    throw new Error(errMessage);
  }

  // Validate basic auth settings
  let basicAuth = null;

  if (args.basicAuthUsername || args.basicAuthPassword) {
    if (!args.basicAuthPassword) {
      errMessage = 'Basic auth password is not set';
    } else if (!args.basicAuthUsername) {
      errMessage = 'Basic auth username is not set';
    }

    if (errMessage) {
      throw new Error(errMessage);
    }

    basicAuth = {
      username: args.basicAuthUsername,
      password: args.basicAuthPassword,
    };
  }

  return { ...args, mongoURIs, basicAuth };
}

module.exports = { readCliArgs };
