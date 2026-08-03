import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, canUpload, canAdmin } from "@/auth";
import {
  getStorageDrive,
  rootFolderId,
  ROOT_FOLDER_NAME,
  listSubfolders,
  ensureFolder,
  activeYearFolder,
  setActiveYearFolder,
  DriveAuthError,
  DriveConfigError,
} from "@/lib/drive";

export const runtime = "nodejs";

function fail(err: unknown, what: string) {
  if (err instanceof DriveConfigError || err instanceof DriveAuthError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  console.error(`[drive] ${what} failed`, err);
  return NextResponse.json({ error: "Could not reach Google Drive." }, { status: 502 });
}

/**
 * GET /api/drive/years
 * The fixed root, the year folders inside it, and which one is being filed to.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canUpload(session.user.role)) {
    return NextResponse.json({ error: "You do not have upload access." }, { status: 403 });
  }

  try {
    const drive = await getStorageDrive();
    const root = { id: rootFolderId(), name: ROOT_FOLDER_NAME };
    const [years, active] = await Promise.all([
      listSubfolders(drive, root.id),
      activeYearFolder(drive),
    ]);
    return NextResponse.json({ root, years, active });
  } catch (err) {
    return fail(err, "years");
  }
}

const schema = z
  .object({
    folderId: z.string().trim().min(1).optional(),
    newFolderName: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => Boolean(v.folderId || v.newFolderName), {
    message: "Choose a year folder, or name a new one.",
  });

/**
 * POST /api/drive/years
 * Sets the year everything is filed under from now on. Admins only - it
 * changes where every uploader's next book lands, not just their own.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Only an admin can change the year folder." },
      { status: 403 },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Choose a year folder." },
      { status: 400 },
    );
  }

  try {
    const drive = await getStorageDrive();
    const root = rootFolderId();

    let folder;
    if (parsed.data.newFolderName) {
      folder = await ensureFolder(drive, root, parsed.data.newFolderName);
    } else {
      // Confirm the chosen folder is really a live child of the root, so a
      // stale or hand-edited ID cannot redirect the library somewhere else.
      const years = await listSubfolders(drive, root);
      const match = years.find((y) => y.id === parsed.data.folderId);
      if (!match) {
        return NextResponse.json(
          { error: "That folder is no longer inside the library folder." },
          { status: 400 },
        );
      }
      folder = match;
    }

    await setActiveYearFolder(folder);
    return NextResponse.json({ active: folder });
  } catch (err) {
    return fail(err, "set year");
  }
}
