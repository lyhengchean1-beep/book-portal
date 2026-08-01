# Update — server deployment

## New

| Path | What it is |
|---|---|
| `DEPLOY.md` | The full walkthrough: GitHub, server, tunnel |

## Replace

| Path | Why |
|---|---|
| `Dockerfile` | Build-time dummy `DATABASE_URL` and `AUTH_SECRET` |
| `docker-compose.yml` | Explicit project name, host port 3100, MySQL unpublished |
| `.gitignore` | Blocks every `.env` variant except the example |
| `.env.example` | Documents `HOST_PORT` |

Nothing here changes how the app runs on Windows. `npm run dev` is unaffected.

## Why each change matters

**The Dockerfile would have failed to build.** `next build` loads every route
module to collect page data, and `src/lib/prisma.ts` constructs `PrismaClient`
at module scope. Prisma throws when `DATABASE_URL` is absent, and
`.dockerignore` deliberately keeps the real `.env` out of the image — so the
build had no value to read. Two build args supply throwaway values. Nothing
connects to them; real values arrive at runtime through `env_file`.

**Compose needed a project name.** Without `name:` at the top, Compose derives
one from the directory. Two projects in similarly named folders can then share
container, network and volume names, and the first `docker compose up` to run
quietly adopts the other's resources. `name: book-portal` pins it.

**Port 3000 was already taken** by the other stack on that host. The app now
publishes on 3100 by default, changeable through `HOST_PORT` in `.env`. The
container still listens on 3000 internally.

**MySQL no longer publishes a host port at all.** The app reaches it over the
compose network, so there is nothing to collide with the MySQL already on 3306,
and the database is not reachable from the LAN.

**`.gitignore` blocked `.env` but not `.env.production` or `.env.server`.** The
pattern is now `.env.*` with `!.env.example`, which is the shape that survives
someone inventing a new suffix at 11pm.
