#!/bin/sh
set -e

echo "Waiting for MySQL…"
until npx prisma db push --skip-generate >/dev/null 2>&1; do
  sleep 2
done
echo "Schema is up to date."

# `prisma db push` doubles as the readiness check: it fails until MySQL is
# accepting connections, and creates the schema on the first successful run.
# No mysqladmin, so no client/server TLS mismatch to work around.
#
# The seed uses upsert, so it is safe to run on every boot. Do not add a
# .seeded marker file - it silently stops new faculties from ever appearing.
npx tsx prisma/seed.ts || echo "Seed skipped."

exec "$@"
