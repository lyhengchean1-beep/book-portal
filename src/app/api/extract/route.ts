import { NextResponse } from "next/server";
import { auth, canUpload } from "@/auth";
import { extractCoverFieldsResilient, NoExtractorError } from "@/lib/extract";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Roughly 6 MB of base64, which is far more than a page render needs. */
const MAX_IMAGE_CHARS = 8_000_000;

/** POST { image: dataURL, text: string } -> { title, author } */
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canUpload(session.user.role)) {
    return NextResponse.json({ error: "You do not have upload access." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { image?: unknown; text?: unknown }
    | null;

  const image = typeof body?.image === "string" ? body.image : "";
  if (!image.startsWith("data:image/jpeg;base64,")) {
    return NextResponse.json({ error: "Send a JPEG data URL." }, { status: 400 });
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return NextResponse.json({ error: "That page render is too large." }, { status: 413 });
  }

  try {
    const result = await extractCoverFieldsResilient({
      imageBase64: image.slice(image.indexOf(",") + 1),
      text: typeof body?.text === "string" ? body.text : "",
    });
    return NextResponse.json(result);
  } catch (err) {
    // 501 rather than 500: the feature is switched off, nothing is broken. The
    // form treats it as "no suggestion" and stays usable.
    if (err instanceof NoExtractorError) {
      return NextResponse.json({ error: "Cover reading is turned off." }, { status: 501 });
    }
    console.error("[extract] failed", err);
    return NextResponse.json({ error: "Could not read the cover." }, { status: 502 });
  }
}