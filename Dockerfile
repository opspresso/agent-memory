# syntax=docker/dockerfile:1

FROM node:24-trixie-slim AS base
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM base AS parser
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY src/infrastructure/document/requirements.txt ./requirements.txt
RUN python3 -m venv /opt/document-parser \
    && /opt/document-parser/bin/pip install --no-cache-dir -r requirements.txt

FROM base AS build
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:24-trixie-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_MANUAL_SIG_HANDLE=true
ENV DOCUMENT_PARSER_PYTHON=/opt/document-parser/bin/python

RUN apt-get update && apt-get install -y --no-install-recommends python3 libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app && useradd --system --gid app app
COPY --from=parser /opt/document-parser /opt/document-parser
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/database ./database
COPY --from=build --chown=app:app /app/scripts/init-database.mjs ./scripts/init-database.mjs
COPY --from=build --chown=app:app /app/src/infrastructure/database/schema-bootstrap.mjs ./src/infrastructure/database/schema-bootstrap.mjs
COPY --from=build --chown=app:app /app/src/infrastructure/document/convert_document.py ./src/infrastructure/document/convert_document.py
COPY --from=build --chown=app:app /app/public ./public
USER app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:3000/api/health").then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))'

CMD ["node", "server.js"]
