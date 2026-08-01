import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, canUpload } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getUserDrive, createFolder, DriveAuthError } from "@/lib/drive";

export const runtime = "nodejs";

const schema = z.object({
  driveId: z.string().nullable(),
  driveName: z.string().min(1),
  // Either pick an existing folder, or name a new one to create.
  folderId: z.string().optional(),
  folderName: z.string().optional(),
  newFolderName: z.string().trim().min(1).max(120).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canUpload(session.user.role)) {
    return NextResponse.json({ error: "You do not have upload access." }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a folder first." }, { status: 400 });
  }
  const { driveId, driveName, newFolderName } = parsed.data;

  try {
    let folderId = parsed.data.folderId;
    let folderName = parsed.data.folderName;

    if (newFolderName) {
      const drive = await getUserDrive(session.user.id);
      const created = await createFolder(drive, driveId, newFolderName);
      folderId = created.id;
      folderName = created.name;
    }

    if (!folderId || !folderName) {
      return NextResponse.json({ error: "Choose a folder first." }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { driveId, driveName, folderId, folderName },
    });

    // The cached faculty subfolders lived inside the old main folder, so they
    // no longer apply. They are rebuilt on the next upload per faculty.
    await prisma.facultyFolder.deleteMany({ where: { userId: session.user.id } });

    return NextResponse.json({ driveName, folderName });
  } catch (err) {
    if (err instanceof DriveAuthError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[drive] destination failed", err);
    return NextResponse.json({ error: "Could not save that folder." }, { status: 502 });
  }
}
