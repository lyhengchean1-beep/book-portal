import { NextResponse } from "next/server";
import { auth, canUpload } from "@/auth";
import { getUserDrive, listLocations, DriveAuthError } from "@/lib/drive";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canUpload(session.user.role)) {
    return NextResponse.json({ error: "You do not have upload access." }, { status: 403 });
  }

  try {
    const drive = await getUserDrive(session.user.id);
    return NextResponse.json({ locations: await listLocations(drive) });
  } catch (err) {
    if (err instanceof DriveAuthError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[drive] locations failed", err);
    return NextResponse.json({ error: "Could not reach Google Drive." }, { status: 502 });
  }
}
