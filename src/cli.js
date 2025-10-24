'use strict';

const crypto = require('crypto');
const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const { ConnectionString } = require('mongodb-connection-string-url');
const pkgJson = require('../package.json');

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
    .parse();

  let mongoURIStrings = args.mongoUri.trim().split(/\s+/);
  /**
   * @type {Array<{uri: ConnectionString, raw: string, id: string, clientConnectionString?: string}>}
   */
  const mongoURIs = [];

  // Validate MongoDB connection strings
  let errMessage = '';
  mongoURIStrings.forEach((uri, index) => {
    try {
      const mongoUri = new ConnectionString(uri);

      mongoURIs.push({
        uri: mongoUri,
        id: crypto.randomBytes(8).toString('hex'),
      });
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
