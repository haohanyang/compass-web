# MongoDB Compass Web

![npm](https://img.shields.io/npm/v/compass-web.svg)

A port of the MongoDB Compass to Web. The frontend is rebuilt and re-packaged from the original [@mongodb-js/compass-web](https://www.npmjs.com/package/@mongodb-js/compass-web) v1.46.2. It provides an easy way deploy a MongoDB GUI and access it on a browser, while keeping most of the MongoDB Compass features.

## Supported Cloud Providers

- MongoDB Atlas
- Amazon DocumentDB
- Azure Cosmos DB

![screenshot](/images/screenshot7.png)

![screenshot](/images/screenshot6.png)

## Supported Features

The following features from Compass Desktop have been ported to Compass Web.

- Export query results to JSON/CSV (since 0.2.2)
- Import data from JSON/CSV (since 0.2.3)
- Gen AI (since 0.3.0)
- MongoDB connections edit (since 0.4.0)
- Mongo shell (since 0.5.0)

## Installation

- npm

Install [compass-web](https://www.npmjs.com/package/compass-web) npm package. Make sure `node-gyp` works in your environment.

```bash
npm install compass-web -g

compass-web --mongo-uri="mongodb://localhost:27017"
```

- Docker

Use Docker image [haohanyang/compass-web](https://hub.docker.com/r/haohanyang/compass-web)

```bash
docker pull haohanyang/compass-web

docker run -it --name compass-web -e CW_MONGO_URI="mongodb://localhost:27017" haohanyang/compass-web
```

- Docker Compose

```yaml
services:
  compass:
    image: haohanyang/compass-web
    container_name: compass-web
    environment:
      - CW_MONGO_URI=mongodb://mongo:27017
    depends_on:
      - mongo
    ports:
      - 8080:8080
    links:
      - mongo

  mongo:
    image: mongo
    container_name: compass-web-dev-mongo
    ports:
      - 27017:27017
```

Access Compass Web on http://localhost:8080

## Connection Strings

Pass one or more MongoDB connection strings, separated by spaces, via `--mongo-uri`. Those connections are fixed and can't change.

```bash
compass-web --mongo-uri="mongodb://db1:27017 mongodb+srv://cluster0.example.mongodb.net"
```

You can add and edit extra connections in the app by adding `--enable-edit-connections`. If `--master-password` is specified, the connections are encrypted and saved as `connections-<hash>.json`. Otherwise, connections are saved in memory, which will be discarded when server restarts.

## Command Line Options

All options can be set via CLI flags or environment variables prefixed with `CW_` (e.g. `--port` → `CW_PORT`).

| Flag                               | Env Var                             | Type    | Default       | Description                                                     |
| ---------------------------------- | ----------------------------------- | ------- | ------------- | --------------------------------------------------------------- |
| `--mongo-uri`                      | `CW_MONGO_URI`                      | string  | —             | MongoDB connection string(s), space-separated for multiple      |
| `--port`                           | `CW_PORT`                           | number  | `8080`        | Port to run the server on                                       |
| `--host`                           | `CW_HOST`                           | string  | `localhost`   | Host to run the server on                                       |
| `--base-route`                     | `CW_BASE_ROUTE`                     | string  | —             | Base route prefix for all routes, e.g. `/app`                   |
| `--app-name`                       | `CW_APP_NAME`                       | string  | `Compass Web` | Application name                                                |
| `--basic-auth-username`            | `CW_BASIC_AUTH_USERNAME`            | string  | —             | Legacy Basic HTTP auth (API only when OIDC is off)              |
| `--basic-auth-password`            | `CW_BASIC_AUTH_PASSWORD`            | string  | —             | Legacy Basic HTTP auth password                                 |
| `--oidc-issuer`                    | `CW_OIDC_ISSUER`                    | string  | —             | OIDC issuer URL (e.g. Keycloak realm)                           |
| `--oidc-client-id`                 | `CW_OIDC_CLIENT_ID`                 | string  | —             | OIDC client id                                                  |
| `--oidc-client-secret`             | `CW_OIDC_CLIENT_SECRET`             | string  | —             | OIDC client secret (omit for public clients)                    |
| `--oidc-redirect-uri`              | `CW_OIDC_REDIRECT_URI`              | string  | _(derived)_   | Full callback URL; derived from request host if unset           |
| `--oidc-scope`                     | `CW_OIDC_SCOPE`                     | string  | `openid profile email` | Scopes requested from the IdP                          |
| `--oidc-post-logout-redirect-uri`  | `CW_OIDC_POST_LOGOUT_REDIRECT_URI`  | string  | —             | Redirect target after logout                                    |
| `--oidc-allowed-groups`            | `CW_OIDC_ALLOWED_GROUPS`            | string  | —             | Comma-separated groups/roles allowed access (optional)          |
| `--oidc-groups-claim`              | `CW_OIDC_GROUPS_CLAIM`              | string  | `groups`      | ID token claim holding the user groups/roles                    |
| `--session-secret`                 | `CW_SESSION_SECRET`                 | string  | —             | Session cookie encryption secret (>=32 chars; required for OIDC) |
| `--enable-edit-connections`        | `CW_ENABLE_EDIT_CONNECTIONS`        | boolean | `false`       | Allow users to add/edit connections in the UI                   |
| `--master-password`                | `CW_MASTER_PASSWORD`                | string  | —             | Master password to encrypt/decrypt saved connection credentials |
| `--enable-shell`                   | `CW_ENABLE_SHELL`                   | boolean | `false`       | Enable the Mongo Shell                                          |
| `--max-upload-size`                | `CW_MAX_UPLOAD_SIZE`                | number  | `104857600`   | Maximum size in bytes accepted for JSON/CSV import uploads (100 MB) |
| `--export-gzip-level`              | `CW_EXPORT_GZIP_LEVEL`              | number  | `1`           | zlib gzip level for data exports; `0` disables compression      |
| `--enable-gen-ai`                  | `CW_ENABLE_GEN_AI`                  | boolean | `false`       | Enable GenAI query/aggregation features                         |
| `--enable-gen-ai-sample-documents` | `CW_ENABLE_GEN_AI_SAMPLE_DOCUMENTS` | boolean | `false`       | Upload sample documents to the GenAI service                    |
| `--openai-api-key`                 | `CW_OPENAI_API_KEY`                 | string  | —             | OpenAI API key for GenAI services                               |
| `--openai-model`                   | `CW_OPENAI_MODEL`                   | string  | `gpt-5-mini`  | OpenAI model used for GenAI                                     |
| `--query-system-prompt`            | `CW_QUERY_SYSTEM_PROMPT`            | string  | _(built-in)_  | System prompt for query generation                              |
| `--aggregation-system-prompt`      | `CW_AGGREGATION_SYSTEM_PROMPT`      | string  | _(built-in)_  | System prompt for aggregation generation                        |

## Access management

Compass Web supports two authentication options: Basic auth and OIDC. OIDC uses Authorization Code + PKCE with an encrypted session cookie. Authentication protects the Compass Web itself, not MongoDB database credentials.

### OIDC / OAuth (Keycloak, etc.)

```bash
compass-web \
  --mongo-uri="mongodb://localhost:27017" \
  --oidc-issuer="https://keycloak.example.com/realms/myrealm" \
  --oidc-client-id="compass-web" \
  --oidc-client-secret="<client-secret>" \
  --oidc-redirect-uri="https://compass.example.com/auth/callback" \
  --session-secret="a-random-string-of-at-least-32-characters"
```

Register `https://<host>/auth/callback` as a valid redirect URI in your IdP.
When running behind TLS-terminating ingress, omit `--oidc-redirect-uri` if the
ingress forwards `X-Forwarded-*` headers.

Auth routes:

- `/auth/login` — sign-in page with SSO button
- `/auth/login/oidc` — start SSO flow
- `/auth/callback` — OIDC redirect URI
- `/auth/logout` — sign out
- `/auth/me` — current session user

### Basic auth
Set `--basic-auth-username` and `--basic-auth-password`:
```bash
compass-web \
  --mongo-uri="mongodb://localhost:27017" \
  --basic-auth-username=admin \
  --basic-auth-password=secret
```

## Build

Clone the repo and fetch the upstream dependency [compass](https://github.com/mongodb-js/compass). `node-gyp` is needed to build the project.

```bash
git clone https://github.com/haohanyang/compass-web.git
cd compass-web && git submodule update --init --recursive --single-branch --depth 1
```

Build the dependencies

```bash
bash bootstrap.sh
pnpm i --frozen-lockfile
```

Build client and server.

```bash
pnpm run build-client
pnpm run build-server
```

Start the app

```bash
node dist/server.js --mongo-uri "mongodb://localhost:27017"
```

## Credits

[MongoDB Compass](https://github.com/mongodb-js/compass)

## License

[Server Side Public License](/LICENSE)
