FROM node:22-alpine

# Prisma's query engine needs openssl on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
COPY scripts ./scripts
RUN npm ci

COPY . .

# `next build` loads every route module to collect page data, and
# src/lib/prisma.ts constructs PrismaClient at module scope. Prisma throws if
# DATABASE_URL is absent, so the build needs *a* value - it never connects.
# .dockerignore keeps the real .env out of the image, which is why this is
# needed at all. Runtime values come from env_file in docker-compose.yml.
ARG DATABASE_URL="mysql://build:build@127.0.0.1:3306/build"
ARG AUTH_SECRET="build-only-not-a-real-secret"
ENV DATABASE_URL=$DATABASE_URL
ENV AUTH_SECRET=$AUTH_SECRET
ENV NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate && npm run build

EXPOSE 3000
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
