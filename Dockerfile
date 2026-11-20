# AEGIS Urban — imagen única para Render: compila la web y la API, y las sirve desde un solo servicio.
FROM node:20-bookworm-slim AS web
WORKDIR /web
COPY aegis-urban-frontend/package*.json ./
RUN npm ci
COPY aegis-urban-frontend/ ./
RUN npm run build

FROM node:20-bookworm-slim AS api
WORKDIR /api
COPY aegis-urban-backend/package*.json ./
RUN npm ci
COPY aegis-urban-backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
# Cliente de PostgreSQL 16 (psql para las migraciones; pg_dump/psql para los respaldos): debe ser de la
# misma versión mayor que el servidor, por eso se instala desde el repositorio oficial de PostgreSQL.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg     && install -d /usr/share/postgresql-common/pgdg     && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc     && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list     && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16     && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production BACKUP_MODO=local BACKUP_DIR=/tmp/backups
COPY --from=api /api/node_modules ./node_modules
COPY --from=api /api/dist ./dist
COPY --from=api /api/package.json ./package.json
COPY --from=api /api/database ./database
COPY --from=api /api/scripts ./scripts
COPY --from=web /web/dist ./public
EXPOSE 10000
CMD ["node", "scripts/render-start.js"]
