import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";

/**
 * Google Drive, acting as the signed-in person.
 *
 * There is no service account and no Shared Drive requirement. Drive access is
 * granted by the user when they sign in, and each uploader picks their own
 * destination folder, so the only thing to configure is one OAuth client.
 */

export class DriveAuthError extends Error {}

/** Builds a Drive client for a user from their stored refresh token. */
export async function getUserDrive(userId: string): Promise<drive_v3.Drive> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { driveRefreshToken: true },
  });

  if (!user?.driveRefreshToken) {
    throw new DriveAuthError(
      "This account has not granted Drive access. Sign out, sign in again, and approve the Google permission screen.",
    );
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.AUTH_GOOGLE_ID,
    process.env.AUTH_GOOGLE_SECRET,
  );
  // googleapis exchanges this for a fresh access token on every call that
  // needs one, so nothing expires an hour after sign-in.
  oauth2.setCredentials({ refresh_token: user.driveRefreshToken });

  return google.drive({ version: "v3", auth: oauth2 });
}

// --- picking a destination --------------------------------------------------

export type DriveLocation = { id: string | null; name: string; shared: boolean };
export type DriveFolder = { id: string; name: string };

/** My Drive, plus any Shared Drives this person can write to. */
export async function listLocations(drive: drive_v3.Drive): Promise<DriveLocation[]> {
  const locations: DriveLocation[] = [{ id: null, name: "My Drive", shared: false }];

  try {
    const res = await drive.drives.list({ pageSize: 100, fields: "drives(id,name)" });
    for (const d of res.data.drives ?? []) {
      if (d.id) locations.push({ id: d.id, name: d.name ?? "Untitled", shared: true });
    }
  } catch {
    // Accounts with no Shared Drive access get an error here. My Drive alone
    // is a perfectly good answer, so this is not worth failing the request for.
  }

  return locations;
}

/** Top-level folders inside My Drive or a Shared Drive. */
export async function listFolders(
  drive: drive_v3.Drive,
  driveId: string | null,
): Promise<DriveFolder[]> {
  const params: drive_v3.Params$Resource$Files$List = {
    q:
      "mimeType = 'application/vnd.google-apps.folder' and trashed = false and " +
      `'${driveId ?? "root"}' in parents`,
    fields: "files(id,name)",
    orderBy: "name",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  };

  if (driveId) {
    params.corpora = "drive";
    params.driveId = driveId;
  }

  const res = await drive.files.list(params);
  return (res.data.files ?? [])
    .filter((f): f is { id: string; name: string } => Boolean(f.id))
    .map((f) => ({ id: f.id, name: f.name ?? "Untitled" }));
}

/**
 * Creates a folder. `parentId` is a folder ID, a Shared Drive ID (which acts as
 * that drive's root), or null for the root of My Drive.
 */
export async function createFolder(
  drive: drive_v3.Drive,
  parentId: string | null,
  name: string,
): Promise<DriveFolder> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId ?? "root"],
    },
    fields: "id, name",
    supportsAllDrives: true,
  });

  if (!res.data.id) throw new Error("Drive did not return a folder ID.");
  return { id: res.data.id, name: res.data.name ?? name };
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

// --- faculty subfolders -----------------------------------------------------

/** Escapes a value for a Drive `q` string literal. */
function q(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Finds a folder by exact name under a parent, or null. */
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

/**
 * Returns the subfolder for a faculty inside the uploader's main folder,
 * creating it the first time a book is filed under that faculty.
 *
 * The mapping is cached in FacultyFolder so the common path is one database
 * read rather than two Drive calls. A cached folder that has been deleted or
 * trashed in Drive is detected and replaced rather than failing the upload.
 */
export async function ensureFacultyFolder(
  drive: drive_v3.Drive,
  opts: { userId: string; parentId: string; facultyId: string; facultyName: string },
): Promise<string> {
  const { userId, parentId, facultyId, facultyName } = opts;

  const cached = await prisma.facultyFolder.findUnique({
    where: { userId_facultyId_parentId: { userId, facultyId, parentId } },
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
      // Deleted in Drive since we cached it. Fall through and re-resolve.
    }
    await prisma.facultyFolder.delete({ where: { id: cached.id } }).catch(() => {});
  }

  const folderId =
    (await findFolderByName(drive, parentId, facultyName)) ??
    (await createFolder(drive, parentId, facultyName)).id;

  await prisma.facultyFolder
    .create({ data: { userId, facultyId, parentId, folderId } })
    .catch(() => {}); // a concurrent upload may have written it first

  return folderId;
}
