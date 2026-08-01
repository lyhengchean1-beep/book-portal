# Deploying to the ESXi server

You already run another Docker Compose stack on this host. Nothing below touches
it, but the reasons why are worth reading once — the failure modes here are all
collisions, and collisions are silent until something restarts.

## What keeps the two stacks apart

| | Existing stack | This one |
|---|---|---|
| Directory | `/opt/digital-library` | `/opt/book-portal` |
| Compose project | derived from the folder | `book-portal`, set explicitly |
| Containers | `library_*` | `portal_mysql`, `portal_app` |
| Host port | 3000 | 3100 |
| MySQL | published on the host | not published at all |
| Volumes | `digital-library_*` | `book-portal_mysqldata`, `book-portal_data` |

Two things do the real work. The `name:` at the top of `docker-compose.yml`
pins the project name, so Compose namespaces every container, network and volume
under `book-portal` no matter what the folder is called. And this stack's MySQL
publishes no host port — the app reaches it over the compose network, so there
is nothing to collide with whatever is already on 3306.

## Rules that keep it safe

- **Always `cd` before any compose command.** `docker compose down` run in the
  wrong directory stops the wrong stack. There is no confirmation prompt.
- **Never `docker system prune -a`.** It deletes images not attached to a
  running container, which includes anything the other stack rebuilt recently.
  `docker image prune` on its own is fine.
- **Never commit `.env`.** It holds the Google client secret, the Gemini key and
  the database password. It is created by hand on each machine.

---

## Part 1 — Push to GitHub

From your Windows machine, in `D:\rua-book-portal`.

**1. Check the SSH key still works.**

```powershell
ssh -T git@github.com
```

You want `Hi <username>! You've successfully authenticated`. If it asks for a
password or refuses, the key is on the server rather than this machine — either
add one here, or do the push from the server instead.

**2. Confirm nothing secret is staged.**

```powershell
git init
git add -A
git status --short | Select-String "\.env"
```

That last command should print nothing at all. If `.env` appears, stop and check
`.gitignore` before going further.

**3. Create an empty private repo** on GitHub. No README, no `.gitignore` —
those exist here already.

**4. Commit and push.**

```powershell
git commit -m "Book portal"
git branch -M main
git remote add origin git@github.com:YOUR-USERNAME/book-portal.git
git push -u origin main
```

---

## Part 2 — Deploy on the server

SSH in.

**5. Clone into its own directory.**

```bash
sudo mkdir -p /opt/book-portal
sudo chown "$USER":"$USER" /opt/book-portal
git clone git@github.com:YOUR-USERNAME/book-portal.git /opt/book-portal
cd /opt/book-portal
```

If the clone asks for a password, the server has no key for this account. Either
generate one there and add it to GitHub, or add a deploy key for this repo
specifically — the latter is tidier, since a deploy key grants access to one
repository rather than everything you own.

**6. Check 3100 is actually free.**

```bash
sudo ss -tlnp | grep -E ':3100|:3000'
```

You should see 3000 in use by the other stack and nothing on 3100. If something
holds 3100, set a different `HOST_PORT` in `.env` at the next step.

**7. Write `.env` by hand.**

```bash
cp .env.example .env
nano .env
```

Fill in:

```
MYSQL_ROOT_PASSWORD=<new password, not the other stack's>
MYSQL_DATABASE=bookportal
MYSQL_USER=portal
MYSQL_PASSWORD=<new password>
DATABASE_URL=mysql://portal:<same password>@mysql:3306/bookportal

AUTH_SECRET=<openssl rand -base64 32>
AUTH_URL=http://<server-ip>:3100
AUTH_TRUST_HOST=true
HOST_PORT=3100

AUTH_GOOGLE_ID=<from Google Cloud>
AUTH_GOOGLE_SECRET=<from Google Cloud>
GEMINI_API_KEY=<from AI Studio>
GEMINI_MODEL=gemini-2.5-flash

ALLOWED_EMAIL_DOMAINS=rua.edu.kh
BOOTSTRAP_UPLOADER_EMAILS=<your email>
SEED_ADMIN_EMAIL=<your email>

DATA_DIR=/app/data
MAX_UPLOAD_MB=50
BLOCK_DOWNLOADS=false
```

`DATABASE_URL` uses `mysql` as the host — the compose service name, not
localhost, and not the Windows value you have been using. Percent-encode the
password there if it contains `@ : / ?`.

**8. Add the redirect URI in Google Cloud.**

Credentials → your OAuth client → Authorised redirect URIs:

```
http://<server-ip>:3100/api/auth/callback/google
```

Sign-in fails with `redirect_uri_mismatch` until this matches `AUTH_URL` exactly.

**9. Build and start.**

```bash
docker compose up -d --build
```

First build pulls Node and MySQL and takes a few minutes. Watch it:

```bash
docker compose logs -f app
```

It waits for MySQL, pushes the schema, seeds the faculty list, then starts.

**10. Confirm both stacks are up.**

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

You want `library_*` still running with their original uptimes — if any of them
show "Up 2 minutes", something restarted them and it is worth finding out why
before continuing.

Then open `http://<server-ip>:3100`, sign in, approve Drive access, and choose a
folder.

---

## Part 3 — A public address

Your existing quick tunnel is pinned to port 3000 and belongs to the other
stack. Leave it alone and add a hostname to the named tunnel instead — a named
tunnel serves as many hostnames as you give it.

In the tunnel's config, add a second ingress rule:

```yaml
ingress:
  # existing rules stay exactly as they are, above this one
  - hostname: library.your-domain
    service: http://localhost:3100
  - service: http_status:404
```

The catch-all `http_status:404` must stay last — cloudflared matches rules top
to bottom and ignores everything after it.

Then restart cloudflared, add the DNS route, and update two things together:

```
AUTH_URL=https://library.your-domain
```

plus `https://library.your-domain/api/auth/callback/google` in the Google Cloud
redirect URIs. Auth.js validates the callback against `AUTH_URL`, so changing
one without the other breaks sign-in. Restart the app afterwards:

```bash
cd /opt/book-portal && docker compose up -d
```

---

## Updating later

```bash
cd /opt/book-portal
git pull
docker compose up -d --build
```

The entrypoint runs `prisma db push` on every start, so schema changes apply
themselves. `.env` is untracked and survives the pull.

## If something goes wrong

```bash
cd /opt/book-portal
docker compose logs --tail 100 app     # this stack only
docker compose down                    # this stack only, data survives
```

`down` removes containers, not volumes, so the database and thumbnails are kept.
`down -v` deletes them — that is the one command to be careful with.

## Two loose ends

The Google client secret was pasted into a chat window earlier. Rotate it in
Google Cloud before this repo exists on GitHub: add a new secret on the OAuth
client, update `.env` in both places, then delete the old one.

Your Windows copy keeps working alongside this. The only difference between the
two `.env` files is `DATABASE_URL` — `127.0.0.1` there, `mysql` here — and
`AUTH_URL`. Both hosts can be registered as redirect URIs at the same time.
