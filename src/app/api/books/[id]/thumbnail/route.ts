import { auth } from "@/auth";
import { readThumbnail } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const { id } = await params;
  const jpeg = await readThumbnail(id);
  if (!jpeg) return new Response("No cover for that book.", { status: 404 });

  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
