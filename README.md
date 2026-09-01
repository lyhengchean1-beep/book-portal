# Book Portal

Sign in with Google, pick a folder in your Drive, upload a book PDF. The portal
opens the link for viewing, so anyone can read it without a Google account.
Browse the library by faculty.

```
Next.js 15 (App Router)  UI + API routes
Auth.js v5               Google sign-in, Drive permission, domain restricted
MySQL 8 + Prisma         catalogue metadata
Google Drive API         the PDFs themselves, in the uploader's own Drive
pdf.js                   first-page preview, rendered in the browser
Tailwind CSS v4          styling
```

No service account, no Shared Drive requirement, no key file. Drive access is
granted by each person when they sign in.

---

## Setup

### 1. One Google OAuth client

At <https://console.cloud.google.com>:

1. Create a project.
2. **APIs & Services → Library → Google Drive API → Enable.**
3. **OAuth consent screen → Internal** if you have Google Workspace, otherwise
   External. Add the `.../auth/drive` scope.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   Authorised redirect URI:
   ```
   http://localhost:3000/api/auth/callback/google
   ```

Copy the client ID and secret. That is the whole Google setup.

> On an **Internal** consent screen the Drive scope needs no verification review.
> On **External** it works immediately for accounts you add as test users, but
> Google requires a review before opening it to everyone.

### 2. Environment

```bash
cp .env.example .env
openssl rand -base64 32   # paste into AUTH_SECRET
```

Fill in `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and the four `MYSQL_*` values.
`DATABASE_URL` repeats those MySQL values as a connection string — the host is
`mysql`, the compose service name, and if the password contains `@ : / ?` it
must be percent-encoded there (`@` becomes `%40`).

Set `ALLOWED_EMAIL_DOMAINS` to your institution's domain, and put your own
address in `BOOTSTRAP_UPLOADER_EMAILS` and `SEED_ADMIN_EMAIL` so you can upload
straight away.

### 3. Run it — pick one

#### A. XAMPP or WAMP

Both ship MySQL and phpMyAdmin, which is everything the portal needs from them.
Apache and PHP are not involved — this is a Node application and it serves
itself.

**1. Install Node.js 20 or newer** from nodejs.org. Neither XAMPP nor WAMP
includes it. Check with `node -v`.

**2. Start MySQL** from the XAMPP Control Panel, or from the WAMP tray icon
(wait for it to turn green).

**3. Create the database.** Open <http://localhost/phpmyadmin>, go to the SQL
tab, and run:

```sql
CREATE DATABASE bookportal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'portal'@'localhost' IDENTIFIED BY 'your-password';
GRANT ALL PRIVILEGES ON bookportal.* TO 'portal'@'localhost';
FLUSH PRIVILEGES;
```

**4. Point `.env` at it.** The `MYSQL_*` variables are only read by Docker
Compose, so on XAMPP you set two lines:

```
DATABASE_URL=mysql://portal:your-password@127.0.0.1:3306/bookportal
```

**5. Install and start:**

```bash
npm install
npm run setup     # generates the client, creates the tables, seeds faculties
npm run dev
```

Open <http://localhost:3000>. For a non-development run, use `npm run build`
then `npm start`.

Four things that catch people out on Windows:

- **XAMPP and WAMP both ship MariaDB** under the "MySQL" label. Prisma's `mysql`
  provider handles it — nothing to change.
- **Use `127.0.0.1`, not `localhost`,** in `DATABASE_URL`. On Windows,
  `localhost` can resolve to `::1` while MySQL listens on IPv4 only.
- **There is no `openssl`.** Generate `AUTH_SECRET` with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
- **If MySQL will not start,** something else holds port 3306 — usually an old
  MySQL service. Change the port in the control panel and update the port in
  `DATABASE_URL` to match.

*Optional — serve it on port 80 through Apache.* Uncomment `mod_proxy` and
`mod_proxy_http` in `httpd.conf`, then add:

```apache
<VirtualHost *:80>
  ServerName library.local
  ProxyPreserveHost On
  ProxyPass        /  http://127.0.0.1:3000/
  ProxyPassReverse /  http://127.0.0.1:3000/
</VirtualHost>
```

Then set `AUTH_URL=http://library.local` and add
`http://library.local/api/auth/callback/google` to the redirect URIs in Google
Cloud. Both, or sign-in breaks.

#### B. Docker

```bash
docker compose up -d --build
```

Fill in the four `MYSQL_*` values first; Compose creates the database from them.
The entrypoint waits for MySQL, pushes the schema, and seeds the faculty list.

---

Either way: open the portal, sign in, and approve the Google permission screen —
that is what grants Drive access. You are asked to choose a folder before your
first upload.

The seed uses `upsert`, so it re-runs safely — deliberately no `.seeded` marker
file, because that pattern silently stops new faculties from ever appearing
after the first start.

---

## How the flowchart maps onto the code

| Flowchart box | Where it lives |
|---|---|
| User opens portal | `src/app/page.tsx` |
| Sign in with Google | `src/auth.config.ts` — also requests the Drive scope |
| Backend validates Google token | `src/auth.ts` → `jwt` callback, stores the refresh token |
| Authorized? | `src/auth.config.ts` → `signIn` callback (domain check) |
| **Choose a Drive folder** *(new)* | `src/app/storage/page.tsx` |
| Open dashboard | `src/app/books/page.tsx` |
| Upload book / details / faculty | `src/components/UploadForm.tsx` |
| **Render page 1 preview** *(added)* | `src/components/FirstPagePlate.tsx` |
| Validate PDF | `src/lib/pdf.ts` — magic bytes, not the extension |
| Upload PDF to Google Drive | `src/lib/drive.ts` → `uploadPdf` |
| Set view permission | `src/lib/drive.ts` → `shareAnyoneReader` |
| **Rollback on failure** *(added)* | `POST /api/books` catch block |
| Save details + file ID | `prisma.book.update` |
| Faculty filter → query → display | `src/app/books/page.tsx` |
| Open Drive preview | `src/app/books/[id]/page.tsx` — embedded iframe |

---

## Day-to-day

**Upload rights.** Everyone starts as `VIEWER`. After they have signed in once:

```sql
UPDATE User SET role = 'UPLOADER' WHERE email = 'someone@your-domain';
```

They must sign out and back in — the role travels in the session token. `ADMIN`
also allows removing books.

**Faculties.** Edit `prisma/seed.ts`, then
`docker compose exec app npm run db:seed`.

**Changing your folder.** Storage in the top nav. Existing books stay where they
are; only new uploads move.

**Turning downloads off.** `BLOCK_DOWNLOADS=true` sets
`copyRequiresWriterPermission` on newly uploaded files, hiding Drive's download
and copy buttons. Not DRM, but it stops casual redistribution.

**Public address.** Point your tunnel at port 3000, set `AUTH_URL` to the public
hostname, and add `https://<hostname>/api/auth/callback/google` to the redirect
URIs in Google Cloud. Those two must change together — Auth.js validates the
callback against `AUTH_URL`.

---

## Notes on decisions

**Books live in the uploader's Drive.** A service account cannot store files at
all — it has a 0 GB quota, which is why the usual advice starts with arranging a
Shared Drive. Asking each person for Drive access at sign-in skips that entirely.
If you would rather keep everything in one place, point everyone at the same
folder on a Shared Drive from the Storage screen; the code is identical.

**`access_type: offline` with `prompt: consent`.** Both are needed for Google to
return a refresh token. Without them, uploads stop working an hour after sign-in.
The cost is that the permission screen appears on every sign-in.

**Only the Drive file ID is stored.** URLs are derived at render time in
`src/lib/links.ts`. IDs are permanent; Drive's URL formats are not.

**Thumbnails live in MySQL**, as a BLOB column on the book row. Drive returns a
`thumbnailLink`, but it expires after a few hours and is rate-limited - and a
disk file wouldn't survive a redeploy on a host with no persistent disk.

**Filenames are numbered per faculty, not title-based.** A book becomes
`3.Sok Pisey.pdf` inside its faculty's Drive folder, where the number is
`prisma.book.count({ where: { facultyFolderId } }) + 1` at upload time -
scoped to `facultyFolderId`, not `facultyId` alone, so switching the active
year folder on the Storage page starts each faculty back at 1 rather than
continuing a lifetime count. Books uploaded before this existed have
`sequenceNumber: null` and keep their original title-based filename; nothing
renumbers them retroactively.

**The PDF check is on the file header.** A reported MIME type and a `.pdf` suffix
are both spoofable; `%PDF-` in the first five bytes is not.

**The database row is written before the upload**, as `PENDING`. If the upload or
the permission call fails, the Drive file is deleted and the row is marked
`FAILED` with the reason.

**Search relies on MySQL's collation.** Prisma's `mode: "insensitive"` is
PostgreSQL-only and errors on MySQL. `utf8mb4_unicode_ci` is already
case-insensitive, and the compose file pins it.

---

## Layout

```
prisma/schema.prisma          User, Faculty, Book, Role, BookStatus (MySQL)
prisma/seed.ts                faculty list - edit this
src/auth.config.ts            edge-safe auth (imported by middleware)
src/auth.ts                   full auth, stores the Drive refresh token
src/lib/drive.ts              all Google Drive calls, as the signed-in user
src/lib/pdf.ts                validation + metadata schema
src/lib/links.ts              Drive URL builders
src/lib/storage.ts            thumbnail read/write
src/app/page.tsx              landing + sign in
src/app/storage/page.tsx      choose a Drive folder
src/app/books/page.tsx        catalogue, faculty rail, search
src/app/books/[id]/page.tsx   embedded reader
src/app/upload/page.tsx       add a book
src/app/api/drive/            locations, folders, destination
src/app/api/books/            list, upload, detail, delete, thumbnail
src/components/               FirstPagePlate, UploadForm, StoragePicker, BookCard, Nav
```

Two things not to undo. Prisma maps a bare `String` to `VARCHAR(191)` on MySQL,
which truncates real book titles, so `title`, `author` and `description` carry
explicit `@db` types. And the auth config is split in two because
`middleware.ts` runs on the Edge runtime, which cannot load Prisma — merging
`auth.config.ts` back into `auth.ts` compiles, then fails at runtime.
