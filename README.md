# Book Portal — Project Context

Paste this whole document as your first message before asking an AI to change
anything in this codebase. It exists because an assistant once edited this
project without this context and deleted the reverse proxy entirely, causing
several hours of outage. Read it fully before touching any file.

---

## 0. The one rule above all others

**This document describes architecture and hard-won lessons. It is not a live
snapshot.** Files drift. As one concrete example: the `Book` model in
`prisma/schema.prisma` at one point gained a `facultyFolderId` +
`sequenceNumber` unique constraint that no version of this document ever
specified — something changed it outside the process that produced this
context. So: **before editing any file, `cat` or `view` it fresh.** Never
assume a file matches a description here, in a chat log, or in your own
memory of "how this usually looks." Confirm, then edit.

---

## 1. What this is

**Book Portal** — a digital library for the Royal University of Agriculture
(RUA), Cambodia. Staff and students sign in with Google, upload a PDF thesis
or book, the system reads the title and author off the cover automatically,
files the PDF into the university's shared Google Drive, and adds a catalogue
entry anyone can browse and read.

This is a production deployment for a real institution, not a prototype.

## 2. Stack

- **Next.js 15** (App Router), TypeScript
- **Prisma** ORM → **MySQL 8**
- **Auth.js** (NextAuth v5) with Google OAuth
- **Google Drive API** for file storage
- **Gemini API** for reading title/author off a cover image
- **Docker Compose** — three services: `mysql`, `app`, `caddy`
- **Caddy** (custom build with `caddy-dns/duckdns` plugin) as reverse proxy + TLS
- **DuckDNS** for the public hostname
- Deployed on an **Ubuntu 24.04 VM under VMware ESXi**

---

## 3. The core architecture — read this before proposing any change

### 3.1 One Drive account owns every file

There is no per-user Drive integration. One Google account — named in
`DRIVE_OWNER_EMAIL` — owns every uploaded file, regardless of who is signed in
when the upload happens. This was a deliberate rewrite from an earlier
per-uploader design, which produced one catalogue backed by several personal
Drive quotas and orphaned files when a staff member's account was deleted.

MySQL holds only catalogue metadata and small first-page thumbnails — never
the PDFs. **Losing the VM costs the catalogue, never the books.**

### 3.2 Folder hierarchy on Drive

```
<DRIVE_ROOT_FOLDER_ID>      fixed, never changes ("សារណា" — folder ID
                             1m-FSCDUQUK-L3s5Gt-KayidOQ8AWux4R)
  └── <year>                 chosen by an admin on /storage, or defaults
                             to the current calendar year and is created
                             on demand
        └── <faculty code>   created on first use; the Faculty.code field
                             IS the Drive folder name
              └── book.pdf
```

Nobody picks a destination during upload. `Faculty.code` must match an
existing Drive folder name exactly, or use `Faculty.driveFolder` as an
override — otherwise the portal creates a duplicate folder beside the real
one. Current codes (confirm against the live seed before trusting this):
`AGR, ANS, VM, DVM, FOR, FIS, AGE, AERD, AGI, LMA, MS, PHD`. Several were
renamed in place (`AER→AERD`, `AET→AGE`, `AVM→ANS`) specifically to preserve
existing books' `facultyId` links — never delete-and-recreate a Faculty row
to "fix" its code; that strands every book already filed under it.

### 3.3 Roles: VIEWER → UPLOADER → ADMIN

| Role | Can do | Granted by |
|---|---|---|
| VIEWER | browse and read | signing in at all |
| UPLOADER | + add books | `UPLOADER_EMAIL_DOMAINS` match, or `DEFAULT_ROLE=UPLOADER` |
| ADMIN | + remove books, set the year folder | `SEED_ADMIN_EMAIL`, applied by `npm run db:seed` |

**Roles only ever rise.** An existing VIEWER is raised to whatever the
current policy grants on their next sign-in; an UPLOADER or ADMIN is never
auto-lowered, so a manual promotion in the database survives every future
sign-in.

**The role is baked into the session's JWT at sign-in.** A database change
(`UPDATE User SET role=...`) has zero effect on an already-active session.
The affected person must sign out and back in. Do not "fix" a role problem by
looking for a bug in middleware — check whether they've signed in again
since the change, first.

### 3.4 Why only one account ever sees Google's warning

Ordinary sign-in requests only `openid email profile` — non-sensitive scopes,
no unverified-app warning, no user cap, works for any Google account on
earth. **The Drive scope is never requested at ordinary sign-in.** It is
requested exactly once, by a dedicated "Connect the library Drive" button on
`/storage`, using `access_type=offline` + `prompt=consent`, signed in as the
`DRIVE_OWNER_EMAIL` account specifically. That is the only place in the
entire app that asks for Drive access, and the only account that ever sees
Google's warning screen.

If you're asked to "let more people sign in" or "fix the Google warning,"
check whether the fix accidentally adds the Drive scope to the base sign-in
flow — that would reintroduce the warning for everyone.

### 3.5 Duplicate detection

Before writing a new `Book` row, the API checks for an existing row with the
same `title` + `author` (case-insensitive — MySQL's default collation) **but
only among rows with `status = READY`**. PENDING and FAILED rows are ignored
deliberately, so a retry after a broken upload is never blocked by its own
failed attempt.

### 3.6 Upload flow

1. Browser renders page one of the dropped PDF client-side.
2. Gemini reads title + author off that render (retry + backoff + a lighter
   fallback model — the primary model returning 503 under load is common
   enough to plan for, not an edge case).
3. Duplicate check (3.5). A hit returns 409 with a link to the existing
   record, not just a refusal.
4. A `Book` row is reserved as `PENDING`.
5. The PDF uploads to Drive, into `<root>/<year>/<faculty>` (3.2).
6. The file is shared as anyone-with-link reader.
7. The row is updated to `READY`.
8. A toast confirms success; **the form stays on the page** and clears for
   the next upload rather than redirecting to the new record — this was a
   deliberate UX change so uploading a stack of books doesn't require
   navigating back after each one.

Any failure at steps 5–7 rolls back: the Drive file (if created) is deleted
and the row is marked `FAILED`. There is never an orphaned Drive file with no
database row, or a database row silently missing its file.

### 3.7 Session lifetime is short and deliberate

Default 8 hours (`SESSION_HOURS`), rolling (`updateAge` refreshes on
activity), with `prompt: select_account` forced on every sign-in. This is
because the portal is used from shared/lab computers — a stock 30-day
session would mean the next person to sit down is silently signed in as
whoever used it last. **Do not "simplify" this back to NextAuth's default.**
Forcing the account chooser matters as much as the short expiry: without it,
Google silently reuses whichever account is already signed in to that
browser, making the short session pointless on its own.

---

## 4. File map

| Path | Role |
|---|---|
| `src/auth.config.ts` | Edge-safe half of auth: providers, scopes, session length, domain gate. Imported by middleware — must never import Prisma or anything Node-only. |
| `src/auth.ts` | Node-only half: the `jwt` callback that upserts `User` rows and decides/raises roles. `canUpload`, `canDelete`, `canAdmin` helpers live here. |
| `src/lib/drive.ts` | All Drive logic: `rootFolderId`, `activeYearFolder`, `ensureFacultyFolder`, `uploadPdf`, `shareAnyoneReader`, `deleteFile`. The single source of truth for the folder hierarchy in 3.2. |
| `src/lib/settings.ts` | Tiny key/value helper over the `Setting` table — currently used only to store which year folder is active, so an admin can change it without a redeploy. |
| `src/lib/extract.ts` | Gemini cover-reading: retry with backoff, falls back to a lighter model, distinguishes "feature switched off" from "model busy" from "hard failure." |
| `src/app/api/books/route.ts` | `GET` (list/search), `POST` (upload — duplicate check, reserve row, upload, share, commit or roll back). |
| `src/app/api/books/[id]/route.ts` | `GET` one book; `DELETE` (admin-only) — **hard-deletes** the DB row, the Drive file, and the thumbnail. No undo, no soft-delete. |
| `src/app/api/drive/years/route.ts` | Admin lists/sets the active year folder. |
| `src/app/api/extract/route.ts` | HTTP wrapper around `extract.ts`; returns 501 if the feature is off, 503 if every model attempt was busy. |
| `src/components/UploadForm.tsx` | The upload UI. Stays on page after success (3.6.8), shows toasts, keeps the faculty selection between uploads. |
| `src/components/UploadToasts.tsx` | Success/error toast stack, auto-dismisses (errors linger longer than confirmations). |
| `src/components/YearPicker.tsx`, `ConnectDriveButton.tsx` | Admin-only pieces of `/storage`. |
| `src/components/Nav.tsx`, `NavLinks.tsx` | Role-gated nav — "Add a book" needs UPLOADER, "Storage" needs ADMIN. |
| `prisma/schema.prisma` | **Read fresh — see §0.** Originally: `User`, `Faculty` (code = Drive folder name), `Book`, `FacultyFolder` (a resolution cache, not a source of truth), `Setting`. |
| `prisma/seed.ts` | Faculty list with codes matching Drive folder names, in-place renames (never delete-and-recreate), admin promotion by email. |
| `docker-entrypoint.sh` | Waits for MySQL by polling `prisma db push` itself as the readiness check (no separate `mysqladmin` client needed). **Must include `--accept-data-loss`** — see §6. |
| `docker-compose.yml` | Three services. **`app` and `mysql` publish no host ports.** Caddy is the only ingress. See §5. |
| `proxy/Dockerfile` | Custom Caddy build: `caddy:2-builder` + `xcaddy build --with github.com/caddy-dns/duckdns`, then copies the binary into stock `caddy:2`. Compiling this from scratch takes several minutes — normal, not stuck. |
| `proxy/Caddyfile` | One site block: the DuckDNS hostname, DNS-01 TLS via the `duckdns` plugin, `reverse_proxy app:3000`. |

---

## 5. Deployment topology

```
Browser (LAN only — see §7 open issue)
  │  HTTPS
  ▼
portal_caddy   — ports 80, 443 published. Only ingress point.
  │  app:3000 (Compose network only, no host port)
  ▼
portal_app     — Next.js, no host port
  │  mysql:3306 (Compose network only, no host port)
  ▼
portal_mysql   — no host port at all
```

| Fact | Value |
|---|---|
| VM | Ubuntu 24.04, ESXi guest |
| Static LAN IP | `192.168.6.182` (pinned via DHCP reservation on MAC `00:0c:29:62:45:22`) |
| Gateway / DNS | `192.168.6.1` / `203.189.128.1`, `203.189.128.2` |
| Public hostname | `ruaportal.duckdns.org` — **currently resolves to the private LAN IP above**, see §7 |
| Repo path on VM | `/opt/book-portal` |
| Repo | `github.com/lyhengchean1-beep/book-portal`, branch `dev` |
| Deploy key | ed25519, generated **on the VM**, **read-only** on GitHub. The VM can only pull. |

**Why the deploy key is read-only:** it has no passphrase (an unattended
`git pull` can't type one), so if the server were ever compromised, a
write-capable key would let an attacker push malicious commits back to the
source repo. Read-only removes that path entirely. **Do not enable write
access on this key** to solve a "can't push from the server" problem — push
from the Windows development machine instead; the VM pulling only is the
correct direction of flow, not a limitation to route around.

---

## 6. Hard rules — incidents that already happened once

1. **Never remove or restructure the `caddy` service or the `proxy/` folder**
   without showing the current `docker-compose.yml` and `proxy/` contents
   first. An assistant did exactly this once, which also silently dropped
   the `data:` volume (thumbnails) and republished a host port on `app` that
   then fronted nothing. Diagnosing it cost hours because the symptom (502,
   then "waiting for MySQL forever") pointed nowhere near the real cause.

2. **`app` and `mysql` must never publish a host port** once Caddy is in
   front. Caddy reaches `app` as `app:3000` over the internal Compose
   network. A published port on `app` is an unencrypted path that bypasses
   TLS entirely, and Google sign-in would fail on it anyway since the OAuth
   callback is registered against the HTTPS hostname specifically.

3. **`DATABASE_URL` must use the Compose service name `mysql`**, never
   `127.0.0.1` or `localhost`. Inside the `app` container, `127.0.0.1` means
   the `app` container itself — nothing listens on 3306 there. This produces
   an infinite, silent "Waiting for MySQL…" with no error, because nothing
   ever actually fails; it just never succeeds.

4. **`docker-entrypoint.sh`'s `prisma db push` line must keep
   `--accept-data-loss`.** Without it, a schema change that needs
   confirmation (e.g., a new unique constraint) can't prompt inside a
   non-interactive container — the command just exits non-zero and the
   entrypoint's retry loop treats that identically to "MySQL isn't ready
   yet," producing an indefinite hang with zero visible error. This already
   consumed a full debugging session once. If you remove this flag,
   understand you are reintroducing that exact failure mode.

5. **YAML indentation in `docker-compose.yml`:** service names at 2 spaces,
   their own keys at 4. Get this wrong and a service silently nests inside
   the one above it, producing a "mapping key already defined" error that
   doesn't obviously point at indentation. Always run
   `docker compose config >/dev/null && echo ok` after editing, before `up`.

6. **`docker compose up` recreates containers and picks up `.env`/config
   changes; `docker compose restart` does not.** After editing `.env`, use
   `docker compose up -d app` (or the relevant service), not `restart`.
   `restart` is correct only for a bind-mounted file like the Caddyfile,
   which is read fresh at container start regardless.

7. **Check every environment variable name character-by-character before
   assuming a config is correct.** `DUCKDNS_TOKEN` was once typo'd as
   `DUCKDN_TOKEN` in the Caddyfile — Caddy doesn't error on an unknown
   template variable, it silently expands to empty, so the certificate
   request failed with a message about an empty token that gave no hint
   the real problem was a one-character typo three files away.

8. **State exact file paths with every change**, relative to `/opt/book-portal`
   on the VM or the equivalent Windows checkout path. Don't say "update the
   compose file" — say `/opt/book-portal/docker-compose.yml`.

9. **Never invent or assume a schema shape** — see §0. Read
   `prisma/schema.prisma` fresh every time before writing a migration,
   query, or seed change that depends on field names.

---

## 7. Known open issues — check here before re-solving from scratch

| Issue | Status | Already considered |
|---|---|---|
| Public internet access | **Unresolved.** `ruaportal.duckdns.org` resolves to a private LAN IP — reachable on campus Wi-Fi only, not from mobile data or off-campus. | Oracle Cloud Free Tier (card declined at signup); DigitalOcean (no free tier, $4–12/mo, only briefly tested with signup credit); Cloudflare Tunnel (**not compatible** with a DuckDNS-hosted domain without Cloudflare's $200/mo Business plan for partial CNAME setup — Tunnel needs Cloudflare to be authoritative for the zone); Tailscale Funnel (viable and free, but Tailscale's own docs frame it for personal/ephemeral use, not production); a small VPS as a WireGuard relay in front of the campus VM (viable, more moving parts). **Recommended actual fix, not yet actioned:** request `portal.rua.edu.kh` and a real public IP from RUA IT — solves the hostname, the certificate, and the reachability problem in one step, and was the plan before the DuckDNS path was taken as a faster interim. |
| Pre-fix thumbnails | **Unconfirmed.** Files exist on disk in `/app/data/thumbnails`, and `hasThumb=1` for every row in MySQL. A `curl` test without an authenticated session correctly 307-redirected to sign-in — that only proved the route requires auth, it did not confirm whether the images actually render for a signed-in user. Verify in an actual signed-in browser tab before assuming this is either broken or fixed. |
| Mangled characters in at least one title | **Not fixed.** At least one stored title (`Farmer's Knowledge…`) shows corrupted apostrophe bytes, visible via `mysql` CLI output. Cause not yet isolated — check `SHOW VARIABLES LIKE 'character_set%';` inside the MySQL container against the connection charset actually used by Prisma, and check whether the source PDF/OCR text was already mis-encoded before insert. |
| Hard delete, no undo | **By design, possibly worth revisiting.** Deleting a `Book` as admin removes the MySQL row, the Drive file, and the thumbnail — all three, immediately, no trash/undo. The Drive deletion is wrapped in a swallowed error (`.catch(() => {})`) so a Drive-side failure never blocks the deletion — but that also means a failed Drive delete can leave an orphaned file in Drive with nothing in the catalogue pointing to it, invisible from the UI. A soft-delete (`ARCHIVED` status, matching the existing `BookStatus` enum pattern) was discussed as a future option, not built. |

---

## 8. Before you change anything — protocol

1. Read the live file(s) you're about to touch. Don't trust a description
   from this document, a chat log, or memory of "how this usually looks."
2. State which exact file(s), by full path, you're about to change and why.
3. For `docker-compose.yml` or anything under `proxy/`: show the current
   content back before proposing a replacement, and confirm the change
   preserves — don't just assume it preserves — every currently-published
   port, every volume, and every service.
4. After any compose edit: `docker compose config >/dev/null && echo ok`
   before `up`.
5. After any `.env` edit: `docker compose up -d <service>`, not `restart`,
   for the change to take effect.
6. If a container hangs on start with no clear error in
   `docker compose logs`, suspect a swallowed error before suspecting
   "it just needs more time" — see incident #4 in §6.
7. Push happens from the Windows development machine, not the VM. The VM's
   deploy key is read-only by design (§5) — don't try to work around it.

---

## 9. Working style expected on this project

Direct, no narration of process. State file paths explicitly with every
code change. Execute given commands as given, without re-explaining unless
something actually goes wrong. Assume technical competence; explanations are
for surprising or load-bearing facts, not routine ones.