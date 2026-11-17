FROM node:24.22.3 AS builder
ARG COMPASS_WEB_VERSION=0.5.2
WORKDIR /build
COPY package.json rollup.config.js ./
COPY src ./src
COPY vendors ./vendors
COPY compass/packages/compass-import-export/src /tmp/compass-import-export/src
COPY docker/import-export.tsconfig.json /tmp/import-export.tsconfig.json
# routes.js requires the built import/export package that bootstrap normally
# copies to ../compass-import-export. Transpile only the server modules.
RUN npm install -g typescript@6.0.3 --no-fund --no-audit \
    && tsc -p /tmp/import-export.tsconfig.json
# Full Node image has Python and a compiler. interruptor needs both.
# NODE_ENV stays unset here so npm installs rollup from devDependencies.
RUN npm install --no-fund --no-audit --ignore-scripts \
    && NODE_ENV=production npx rollup -c
RUN npm i -g compass-web@${COMPASS_WEB_VERSION} --no-fund --no-audit \
    && npm cache clean --force \
    && cp /build/dist/server.js /usr/local/lib/node_modules/compass-web/dist/server.js

FROM node:24.22.3-slim
COPY --from=builder /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/compass-web/dist/server.js /usr/local/bin/compass-web
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && apt-get upgrade -y --no-install-recommends libgnutls30 libgcrypt20 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
RUN chown -R node:node /usr/local/lib/node_modules/compass-web
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8080/healthz || exit 1
CMD [ "compass-web", "--host", "0.0.0.0" ]
