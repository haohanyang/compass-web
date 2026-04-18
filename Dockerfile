FROM node:24 AS builder
ARG COMPASS_WEB_VERSION=latest
RUN npm i -g compass-web@${COMPASS_WEB_VERSION} --no-fund --no-audit \
    && npm cache clean --force

FROM node:24-slim
COPY --from=builder /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/compass-web/dist/server.js /usr/local/bin/compass-web
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
RUN chown -R node:node /usr/local/lib/node_modules/compass-web
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8080/healthz || exit 1
CMD [ "compass-web", "--host", "0.0.0.0" ]
