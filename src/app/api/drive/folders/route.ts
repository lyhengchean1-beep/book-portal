import { NextResponse } from "next/server";
import { auth, canUpload } from "@/auth";
import { getUserDrive, listFolders, DriveAuthError } from "@/lib/drive";

export const runtime = "nodejs";

/** GET /api/drive/folders?driveId=<id>   (omit driveId for My Drive) */
export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canUpload(session.user.role)) {
    return NextResponse.json({ error: "You do not have upload access." }, { status: 403 });
  }

  const driveId = new URL(req.url).searchParams.get("driveId") || null;

  try {
    const drive = await getUserDrive(session.user.id);
    return NextResponse.json({ folders: await listFolders(drive, driveId) });
  } catch (err) {
    if (err instanceof DriveAuthError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[drive] folders failed", err);
    return NextResponse.json({ error: "Could not list folders." }, { status: 502 });
  }
}
