# Update — deploy to a new ESXi VM

## New

| Path | What it is |
|---|---|
| `DEPLOY.md` | Full walkthrough: VM, Docker, GitHub key, deploy, tunnel |
| `scripts/server-bootstrap.sh` | Prepares a fresh Ubuntu VM in one command |

Mark it executable after cloning: `chmod +x scripts/server-bootstrap.sh`

## Replace

| Path | Why |
|---|---|
| `Dockerfile` | Build-time dummy `DATABASE_URL` and `AUTH_SECRET` |
| `docker-compose.yml` | Explicit project name, `HOST_PORT`, MySQL unpublished |
| `.gitignore` | Blocks every `.env` variant except the example |
| `.env.example` | Documents `HOST_PORT` |

Nothing changes on Windows. `npm run dev` is unaffected.

## The GitHub key

Your other VM's key stays where it is. This VM needs its own — a key belongs to
a machine, and GitHub rejects a public key already registered anywhere on the
platform, so copying the old one across does not work even if you wanted to.

The bootstrap script generates one and prints it. Register it as a **deploy
key** on the repository rather than an account key: it grants access to one
repository instead of everything your account can reach, so a compromised VM
cannot touch your other work. The server only pulls, so leave write access
unchecked.

## Why the Dockerfile changed

It would not have built. `next build` loads every route module to collect page
data, and `src/lib/prisma.ts` constructs `PrismaClient` at module scope. Prisma
throws when `DATABASE_URL` is absent, and `.dockerignore` deliberately keeps the
real `.env` out of the image — so the build had nothing to read. Two build args
supply throwaway values; real ones arrive at runtime through `env_file`.

## The one specification that matters

4 GB of RAM. `next build` peaks around 2 GB, and on a 2 GB VM the OOM reaper
kills it partway through, which appears as a build that stops with no error at
all. The bootstrap script adds swap when it finds less than 4 GB, but RAM is
better.

## Ports

On a dedicated VM the collisions do not apply — 3000, 3306 and every volume name
are yours alone. The compose file still defaults to host port 3100; set
`HOST_PORT=3000` in `.env` if you would rather have the plain port on a machine
that has nothing else on it.
