FROM node:22-alpine

# Prisma's query engine needs openssl on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
COPY scripts ./scripts
RUN npm ci

COPY . .

RUN npx prisma generate && npm run build

# Thumbnails live here. Mount a volume so they survive a rebuild.
RUN mkdir -p /app/data/thumbnails

EXPOSE 3000
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
