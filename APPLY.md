# Shared library storage

Everyone uploads into one Google Drive, into one folder tree, and the tree is
fixed by environment variables rather than chosen in the interface.

```
សារណា                     DRIVE_ROOT_FOLDER_ID
  └── 2025                  set by an admin on /storage, or the current year
        └── AGR             created on first use, named from the faculty
              └── book.pdf
```

## Copy the files in

Every path here mirrors the repo. Copy over the top of the originals.

| File | Change |
|---|---|
| `prisma/schema.prisma` | `Setting` table, `Faculty.driveFolder`, `FacultyFolder` no longer keyed by user |
| `prisma/seed.ts` | Drive folder name per faculty |
| `src/lib/settings.ts` | **new** — key/value settings |
| `src/lib/drive.ts` | rewritten around one library account |
| `src/auth.ts` | `DEFAULT_ROLE`, role re-evaluated on later sign-ins, `canAdmin` |
| `src/app/api/books/route.ts` | uploads go to the shared Drive |
| `src/app/api/books/[id]/route.ts` | delete uses the shared Drive |
| `src/app/api/drive/years/route.ts` | **new** — list and set the year folder |
| `src/app/storage/page.tsx` | admin-only year setting |
| `src/components/YearPicker.tsx` | **new** — replaces `StoragePicker` |
| `src/app/upload/page.tsx` | no folder gate before the first upload |
| `src/components/Nav.tsx`, `NavLinks.tsx` | Storage is an admin link |

Delete these — nothing imports them any more:

```bash
rm src/components/StoragePicker.tsx
rm -r src/app/api/drive/locations src/app/api/drive/folders src/app/api/drive/destination
```

## Set the environment

Append `env.additions` to `.env` and fill in the two values at the top. On
Windows, keep the file as UTF-8 so `សារណា` survives.

## Migrate and start

```bash
npx prisma db push
npm run db:seed
```

`db push` drops `FacultyFolder.userId` and rebuilds its unique index. That table
is only a lookup cache, so losing its rows costs one extra Drive call per
faculty on the next upload — no books are affected.

## Connect the Drive

The account in `DRIVE_OWNER_EMAIL` signs in to the portal once and approves the
Google permission screen. That stores its refresh token, and every upload from
then on — from anybody — is written by that account.

To skip this on future machines, read the token out of the database once and
put it in `DRIVE_OWNER_REFRESH_TOKEN`:

```sql
SELECT driveRefreshToken FROM User WHERE email = 'cheanlyheng@rua.edu.kh';
```

Then `.env` alone is the whole setup.

## Check the faculty folder names

`prisma/seed.ts` maps each faculty to the folder it should file into. Three
needed mapping because the existing folders are not spelled like the codes:

| Faculty | Files into |
|---|---|
| AER — Agricultural Economics and Rural Development | `AERD` |
| AET — Agricultural Engineering and Technology | `AGE` |
| AVM — Animal Science and Veterinary Medicine | `ANS` — **guess, please confirm** |

The Drive has `ANS`, `DVM` and `VM` as three folders while the portal has one
combined faculty. Either fix `driveFolder` in the seed, or split the faculty in
two so it matches the folders in use. Get this wrong and the portal quietly
creates a new folder next to the one you already have.

## Two things to watch

**Refresh token lifetime.** If the OAuth consent screen in Google Cloud is still
in *Testing*, Google expires refresh tokens after seven days and uploads start
failing with `invalid_grant`. Publish the app, or mark it Internal if
`rua.edu.kh` is a Workspace domain.

**Drive quota.** Every book now counts against one account's storage. That
account was at 61.49 GB used. When it fills, uploads fail with
`storageQuotaExceeded` and the portal says so. Moving the library to a Shared
Drive later needs no code change — `DRIVE_ROOT_FOLDER_ID` can point at a folder
inside one, and the Drive calls already pass `supportsAllDrives`.
