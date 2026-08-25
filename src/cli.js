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
    .option('basic-auth-username', {
      type: 'string',
      description: 'Username for Basic HTTP authentication scheme',
    })
    .option('basic-auth-password', {
      type: 'string',
      description: 'Password for Basic HTTP authentication (legacy; API only).',
    })
    .option('oidc-issuer', {
      type: 'string',
      description:
        'OIDC issuer URL, e.g. https://keycloak.example.com/realms/myrealm. Enables OIDC/OAuth login.',
    })
    .option('oidc-client-id', {
      type: 'string',
      description: 'OIDC client id',
    })
    .option('oidc-client-secret', {
      type: 'string',
      description: 'OIDC client secret.',
    })
    .option('oidc-redirect-uri', {
      type: 'string',
      description:
        'Full OIDC callback URL, e.g. https://compass.example.com/auth/callback. If unset, it is derived from the request host and base route.',
    })
    .option('oidc-scope', {
      type: 'string',
      description: 'OIDC scopes to request',
      default: 'openid profile email',
    })
    .option('oidc-post-logout-redirect-uri', {
      type: 'string',
      description: 'Where the IdP should redirect after logout',
    })
    .option('oidc-allowed-groups', {
      type: 'string',
      description:
        'Comma-separated list of groups/roles allowed to access the app. If unset, any authenticated user is allowed.',
    })
    .option('oidc-groups-claim', {
      type: 'string',
      description: 'ID token claim that holds the user groups/roles',
      default: 'groups',
    })
    .option('session-secret', {
      type: 'string',
      description:
        'Secret used to encrypt the session cookie (at least 32 characters). Required when OIDC is enabled.',
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
    .option('enable-gen-ai', {
      type: 'boolean',
      description: 'Enable GenAI to generate queries',
      default: false,
    })
    .option('enable-gen-ai-sample-documents', {
      type: 'boolean',
      description: 'Enable upload sample documents to GenAI service.',
      default: false,
    })
    .option('base-route', {
      type: 'string',
      description: 'Base route prefix for all application routes, e.g. /app',
      default: '',
    })
    .options('enable-edit-connections', {
      type: 'boolean',
      description: 'Allow user to edit connections in the UI',
      default: false,
    })
    .options('master-password', {
      type: 'string',
      description: 'Master password to encrypt/decrypt connection credentials',
    })
    .options('enable-shell', {
      type: 'boolean',
      description: 'Enable Mongo Shell',
      default: false,
    })
    .option('max-upload-size', {
      type: 'number',
      description:
        'Maximum size in bytes accepted for JSON/CSV import uploads',
      default: 100 * 1024 * 1024,
    })
    .parse();

  /**
   * @type {ConnectionString[]}
   */
  const mongoURIs = [];

  // Validate MongoDB connection strings
  let errMessage = '';

  if (args.mongoUri) {
    let mongoURIStrings = args.mongoUri.trim().split(/\s+/);

    mongoURIStrings.forEach((uri, index) => {
      try {
        const mongoUri = new ConnectionString(uri);

        mongoUri.searchParams.set('appName', args.appName);

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
  }

  if (mongoURIs.length === 0 && !args.enableEditConnections) {
    console.warn('MongoDB urls are not specified');
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

  // OIDC issuer/client settings.
  let oidcPartial = null;

  if (args.oidcIssuer || args.oidcClientId) {
    const missing = [];

    if (!args.oidcIssuer) {
      missing.push('--oidc-issuer');
    }
    if (!args.oidcClientId) {
      missing.push('--oidc-client-id');
    }

    if (missing.length) {
      throw new Error(
        `OIDC is misconfigured. Missing or invalid: ${missing.join(', ')}`
      );
    }

    oidcPartial = {
      issuer: args.oidcIssuer,
      clientId: args.oidcClientId,
      clientSecret: args.oidcClientSecret || undefined,
      redirectUri: args.oidcRedirectUri || undefined,
      scope: args.oidcScope,
      postLogoutRedirectUri: args.oidcPostLogoutRedirectUri || undefined,
      allowedGroups: args.oidcAllowedGroups
        ? args.oidcAllowedGroups
            .split(',')
            .map((g) => g.trim())
            .filter(Boolean)
        : null,
      groupsClaim: args.oidcGroupsClaim,
    };
  }

  const auth = buildAuthConfig(args, oidcPartial);

  const baseRoute = args.baseRoute.trim().replace(/^\/+|\/+$/g, '');
  return { ...args, mongoURIs, basicAuth, auth, baseRoute };
}

/**
 * @param {Record<string, any>} args
 * @param {object | null} oidcPartial
 * @returns {import('./auth').AuthConfig | null}
 */
function buildAuthConfig(args, oidcPartial) {
  if (!oidcPartial) {
    return null;
  }

  if (!args.sessionSecret || args.sessionSecret.length < 32) {
    throw new Error('OIDC requires --session-secret (at least 32 characters)');
  }

  return {
    enabled: true,
    sessionRequired: true,
    sessionSecret: args.sessionSecret,
    oidc: oidcPartial,
  };
}

module.exports = { readCliArgs };
