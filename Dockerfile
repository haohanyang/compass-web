# ============================================
# Stage 1: Builder
# ============================================
FROM node:24.22.1 AS builder

# Instala pnpm
RUN npm install -g pnpm

WORKDIR /app

# Instala node-gyp e ferramentas de build para pacotes nativos
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Instala node-gyp globalmente (necessário para compilar interruptor)
RUN npm install -g node-gyp

# Inicializa submódulos do git (compass/ é submódodo do MongoDB Compass Desktop)
RUN git init && \
    git remote add origin https://github.com/haohanyang/compass-web.git && \
    git fetch origin master && \
    git checkout -B master FETCH_HEAD && \
    git submodule update --init --recursive --single-branch --depth 1

# Executa bootstrap.sh (build das dependências nativas)
RUN bash bootstrap.sh

# Copia package.json e lockfile para instalar dependências
COPY package.json pnpm-lock.yaml ./

# Instala dependências do projeto
RUN pnpm install --frozen-lockfile

# Copia restante do código fonte
COPY . .

# Build do cliente (webpack)
RUN pnpm run build-client:production

# Build do servidor (rollup)
RUN pnpm run build-server:production

# ============================================
# Stage 2: Runtime
# ============================================
FROM node:24.22.1-slim

WORKDIR /usr/src/app

# Copia apenas os artefatos compilados
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Instala curl para o healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Cria diretório de dados persistente
RUN mkdir -p /data && chown node:node /data

USER node

ENV COMPASS_WEB_DATA_DIR=/data
VOLUME /data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8080/healthz || exit 1

CMD ["node", "dist/server.js", "--host", "0.0.0.0"]
