import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getSetting, setSetting, KEYS } from "@/lib/settings";

/**
 * One Drive for the whole library.
 *
 * Every file is written by a single Google account - the one named in
 * DRIVE_OWNER_EMAIL - into a fixed folder tree:
 *
 *     <DRIVE_ROOT_FOLDER_ID>  e.g. សារណា
 *       └── <year>            chosen once by an admin, or created on demand
 *             └── <faculty>   created the first time a book is filed there
 *
 * Nobody picks a destination. Signing in does not need to give the portal
 * anything, and a new machine only needs the environment variables copied
 * across: no folder to choose again, no per-person setup.
 */

export class DriveAuthError extends Error {}
export class DriveConfigError extends Error {}

export type DriveFolder = { id: string; name: string };

const OWNER_EMAIL = (process.env.DRIVE_OWNER_EMAIL ?? "").trim().toLowerCase();
const OWNER_TOKEN = (process.env.DRIVE_OWNER_REFRESH_TOKEN ?? "").trim();
const ROOT_ID = (process.env.DRIVE_ROOT_FOLDER_ID ?? "").trim();

/** Display name for the root folder. Cosmetic - the ID is what files go into. */
export const ROOT_FOLDER_NAME = (process.env.DRIVE_ROOT_FOLDER_NAME ?? "").trim() || "Library";

export function rootFolderId(): string {
  if (!ROOT_ID) {
    throw new DriveConfigError(
      "DRIVE_ROOT_FOLDER_ID is not set. Open the main folder in Drive and copy the ID from the address bar.",
    );
  }
  return ROOT_ID;
}

/**
 * The refresh token the portal uploads with.
 *
 * Two ways to supply it. DRIVE_OWNER_REFRESH_TOKEN is fully portable - copy
 * the .env to a new machine and it works with nobody signing in. Otherwise the
 * token is read from the row of the account named in DRIVE_OWNER_EMAIL, which
 * means that account signs in to the portal once per installation.
 */
async function ownerRefreshToken(): Promise<string> {
  if (OWNER_TOKEN) return OWNER_TOKEN;

  if (!OWNER_EMAIL) {
    throw new DriveConfigError(
      "Set DRIVE_OWNER_EMAIL (or DRIVE_OWNER_REFRESH_TOKEN) so the portal knows which Drive holds the library.",
    );
  }

  const owner = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { driveRefreshToken: true },
  });

  if (!owner) {
    throw new DriveAuthError(
      `${OWNER_EMAIL} has not signed in to the portal yet. Sign in once with that account to connect the library Drive.`,
    );
  }
  if (!owner.driveRefreshToken) {
    throw new DriveAuthError(
      `${OWNER_EMAIL} signed in without approving Drive access. Sign out, sign in again, and accept the Google permission screen.`,
    );
  }

  return owner.driveRefreshToken;
}

/** A Drive client acting as the library account, whoever is signed in. */
export async function getStorageDrive(): Promise<drive_v3.Drive> {
  const refresh_token = await ownerRefreshToken();

  const oauth2 = new google.auth.OAuth2(
    process.env.AUTH_GOOGLE_ID,
    process.env.AUTH_GOOGLE_SECRET,
  );
  // googleapis exchanges this for a fresh access token on every call that needs
  // one, so nothing expires an hour after sign-in.
  oauth2.setCredentials({ refresh_token });

  return google.drive({ version: "v3", auth: oauth2 });
}

// --- folders ----------------------------------------------------------------

/** Escapes a value for a Drive `q` string literal. */
function q(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Immediate subfolders of a folder, newest name first. */
export async function listSubfolders(
  drive: drive_v3.Drive,
  parentId: string,
): Promise<DriveFolder[]> {
  const res = await drive.files.list({
    q: [
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
      `'${q(parentId)}' in parents`,
    ].join(" and "),
    fields: "files(id,name)",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (res.data.files ?? [])
    .filter((f): f is { id: string; name: string } => Boolean(f.id))
    .map((f) => ({ id: f.id, name: f.name ?? "Untitled" }))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
}

async function findFolderByName(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
): Promise<string | null> {
  const res = await drive.files.list({
    q: [
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
      `'${q(parentId)}' in parents`,
      `name = '${q(name)}'`,
    ].join(" and "),
    fields: "files(id)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return res.data.files?.[0]?.id ?? null;
}

export async function createFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
): Promise<DriveFolder> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id, name",
    supportsAllDrives: true,
  });

  if (!res.data.id) throw new Error("Drive did not return a folder ID.");
  return { id: res.data.id, name: res.data.name ?? name };
}

/** Find a folder by name under a parent, or make it. */
export async function ensureFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
): Promise<DriveFolder> {
  const existing = await findFolderByName(drive, parentId, name);
  return existing ? { id: existing, name } : createFolder(drive, parentId, name);
}

// --- the year folder --------------------------------------------------------

export async function setActiveYearFolder(folder: DriveFolder): Promise<void> {
  await setSetting(KEYS.yearFolderId, folder.id);
  await setSetting(KEYS.yearFolderName, folder.name);
}

/** The year folder shown in the UI, without spending a Drive call on it. */
export async function activeYearFolderName(): Promise<string> {
  return (await getSetting(KEYS.yearFolderName)) ?? String(new Date().getFullYear());
}

/**
 * The folder every upload is filed under, one level below the root.
 *
 * An admin chooses it on the Storage page. Until they do - and if the chosen
 * folder is later deleted - the portal falls back to a folder named for the
 * current calendar year, creating it if it is not there. That is what keeps
 * this working year after year with nobody touching anything in January.
 */
export async function activeYearFolder(drive: drive_v3.Drive): Promise<DriveFolder> {
  const chosen = await getSetting(KEYS.yearFolderId);

  if (chosen) {
    try {
      const res = await drive.files.get({
        fileId: chosen,
        fields: "id, name, trashed",
        supportsAllDrives: true,
      });
      if (res.data.id && !res.data.trashed) {
        return { id: res.data.id, name: res.data.name ?? chosen };
      }
    } catch {
      // Deleted in Drive since it was chosen. Fall through and rebuild.
    }
  }

  const folder = await ensureFolder(drive, rootFolderId(), String(new Date().getFullYear()));
  await setActiveYearFolder(folder);
  return folder;
}

// --- the faculty folder -----------------------------------------------------

/**
 * The faculty's folder inside the year folder, created on first use.
 *
 * `folderName` is Faculty.driveFolder if set, otherwise Faculty.code - so an
 * existing folder whose name does not match the code is filed into rather than
 * duplicated. The mapping is cached; a cached folder that has since been
 * deleted is detected and replaced rather than failing the upload.
 */
export async function ensureFacultyFolder(
  drive: drive_v3.Drive,
  opts: { parentId: string; facultyId: string; folderName: string },
): Promise<string> {
  const { parentId, facultyId, folderName } = opts;

  const cached = await prisma.facultyFolder.findUnique({
    where: { facultyId_parentId: { facultyId, parentId } },
  });

  if (cached) {
    try {
      const check = await drive.files.get({
        fileId: cached.folderId,
        fields: "id, trashed",
        supportsAllDrives: true,
      });
      if (!check.data.trashed) return cached.folderId;
    } catch {
      // Gone from Drive. Fall through and re-resolve.
    }
    await prisma.facultyFolder.delete({ where: { id: cached.id } }).catch(() => {});
  }

  const folder = await ensureFolder(drive, parentId, folderName);

  await prisma.facultyFolder
    .create({ data: { facultyId, parentId, folderId: folder.id } })
    .catch(() => {}); // a concurrent upload may have written it first

  return folder.id;
}

// --- storing a book ---------------------------------------------------------

export async function uploadPdf(
  drive: drive_v3.Drive,
  opts: { name: string; folderId: string; body: Readable | Buffer },
) {
  const body = Buffer.isBuffer(opts.body) ? Readable.from(opts.body) : opts.body;

  const res = await drive.files.create({
    requestBody: {
      name: opts.name,
      parents: [opts.folderId],
      mimeType: "application/pdf",
    },
    media: { mimeType: "application/pdf", body },
    fields: "id, name, size",
    supportsAllDrives: true,
  });

  if (!res.data.id) throw new Error("Drive did not return a file ID.");
  return { id: res.data.id, name: res.data.name ?? opts.name };
}

/**
 * Turns the file into "anyone with the link can view".
 * This is the step that makes the book readable without a Google account.
 */
export async function shareAnyoneReader(drive: drive_v3.Drive, fileId: string) {
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
    supportsAllDrives: true,
  });
}

/**
 * Optional hardening: hides the download and copy buttons in the Drive viewer
 * for anyone who only has read access. Not DRM - a determined reader can still
 * capture the pages - but it stops casual redistribution.
 */
export async function restrictDownload(drive: drive_v3.Drive, fileId: string) {
  await drive.files.update({
    fileId,
    requestBody: { copyRequiresWriterPermission: true },
    supportsAllDrives: true,
  });
}

/** Used to roll back an upload when the database write fails afterwards. */
export async function deleteFile(drive: drive_v3.Drive, fileId: string) {
  await drive.files.delete({ fileId, supportsAllDrives: true });
}

/**
 * Current parent folder IDs of a file.
 *
 * Needed before moving a file whose folder we do not already track in the
 * database - a legacy book uploaded before facultyFolderId existed has no
 * stored location to remove it from, so Drive has to be asked directly.
 */
export async function getFileParents(drive: drive_v3.Drive, fileId: string): Promise<string[]> {
  const res = await drive.files.get({
    fileId,
    fields: "parents",
    supportsAllDrives: true,
  });
  return res.data.parents ?? [];
}

/**
 * Moves a file to a different folder and/or renames it, in one Drive call.
 *
 * Used when a book's faculty is edited: the file leaves its old faculty
 * folder for the new one, and its name (which embeds the sequence number
 * and author) is updated to match. `addParents`/`removeParents` are
 * comma-joined ID strings, matching the Drive API's own parameter shape.
 */
export async function moveAndRenameFile(
  drive: drive_v3.Drive,
  opts: { fileId: string; name?: string; addParents?: string; removeParents?: string },
) {
  const { fileId, name, addParents, removeParents } = opts;
  await drive.files.update({
    fileId,
    ...(addParents ? { addParents } : {}),
    ...(removeParents ? { removeParents } : {}),
    requestBody: name ? { name } : {},
    supportsAllDrives: true,
  });
}
