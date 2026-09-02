# Deploying to Render

Same Prisma + MySQL code as the Docker Compose setup - just pointed at an
external database instead of a sibling container. See `DEPLOY.md` for the
self-hosted VM alternative, which has none of the free-tier limits below
but needs hardware to run on.

## 1. Database: Aiven MySQL (free)

Render doesn't offer managed MySQL, only Postgres and Key Value. Aiven's
free tier is real MySQL, not a wire-compatible substitute, so nothing about
the schema or queries changes.

1. Sign up at aiven.io - no card required.
2. New service → MySQL → free plan → create. Takes a couple of minutes to
   provision.
3. On the service's Overview page, note the host, port, user (usually
   `avnadmin`), password, and default database name. Download the CA
   certificate from the same page.
4. Save the certificate as `prisma/aiven-ca.pem` and commit it - it's a
   public certificate, not a secret.
5. Build the connection string in Prisma's documented MySQL-SSL format:

   ```
   mysql://USER:PASSWORD@HOST:PORT/DATABASE?sslcert=aiven-ca.pem&sslaccept=strict
   ```

   Percent-encode `@ : / ?` if they appear in the password (`@` becomes
   `%40`) - same rule the compose `.env` already calls out.

`prisma/schema.prisma` stays on `provider = "mysql"`. `docker-entrypoint.sh`
already retries `prisma db push` until it connects, which works against
Aiven exactly as it does against the compose container - nothing about the
entrypoint changes either.

## 2. Push the branch Render will build

`dev` may already be pushed, but GitHub's default branch is `main`. Either
point Render at `dev` directly, or merge first:

```bash
git checkout main && git merge dev && git push
```

## 3. Create the web service

Render dashboard → New → Web Service → connect
`lyhengchean1-beep/book-portal` → pick the branch. Render should detect the
Dockerfile automatically (Environment: Docker). Choose the Free instance
type.

## 4. Environment variables

Everything from `.env.example` except `MYSQL_*` and `HOST_PORT`, which are
compose-only:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Aiven string from step 1 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | from Google Cloud |
| `AUTH_SECRET` | fresh value from `openssl rand -base64 32` |
| `AUTH_URL` | `https://<your-service>.onrender.com` |
| `AUTH_TRUST_HOST` | `true` |
| `ALLOWED_FORWARDED_HOSTS` | `<your-service>.onrender.com` |
| `ALLOWED_EMAIL_DOMAINS` | `rua.edu.kh` |
| `DEFAULT_ROLE` | `UPLOADER` |
| `SEED_ADMIN_EMAIL` | your email |
| `DRIVE_OWNER_EMAIL` | your email |
| `DRIVE_ROOT_FOLDER_ID` / `DRIVE_ROOT_FOLDER_NAME` | from Drive |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | from AI Studio |
| `MAX_UPLOAD_MB` | `50` |
| `BLOCK_DOWNLOADS` | `false` |

`ALLOWED_FORWARDED_HOSTS` and `AUTH_URL` can't be filled in correctly until
Render assigns the `.onrender.com` hostname on first deploy. Set everything
else, deploy once, then come back and set these two plus the OAuth redirect
below, and redeploy.

## 5. Google OAuth redirect

Google Cloud Console → your OAuth client → Authorised redirect URIs → add:

```
https://<your-service>.onrender.com/api/auth/callback/google
```

Must match `AUTH_URL` exactly, or sign-in fails with `redirect_uri_mismatch`.

## 6. Deploy and verify

Watch the build log for `npm ci` → `prisma generate` → `next build`. Free
instances run on 512MB RAM; if the build machine shares that limit, a
silent stop partway through the log - no error, it just stops - means it
ran out of memory mid-`next build`. Retry once; if it keeps happening, the
build needs more resources than the free instance's build step gets.

Once live, sign in once as `DRIVE_OWNER_EMAIL` to grant Drive access, then
run an upload end to end before trusting it.

## What's different from the VM

Thumbnails used to need a persistent disk - `DEPLOY.md`'s old backup step
tarred a separate volume for exactly that reason. They don't need one any
more: a thumbnail is a column on the book row, so it survives a redeploy
the same way the rest of the catalogue does, and nothing here needs a
Render Disk.

What free Render doesn't remove: web services spin down after 15 minutes
idle and take up to a minute to wake on the next request. That's the one
real trade-off left, since the database lives on Aiven rather than Render's
own (no free-Postgres expiry to worry about either, for the same reason).
Fine for demoing the portal or sharing it for feedback; if the department
is meant to rely on it daily, a Starter instance (~$7/mo, no spin-down) is
the fix, and Aiven's MySQL doesn't need to change either way.
