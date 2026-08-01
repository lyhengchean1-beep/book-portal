import { NextResponse } from "next/server";
import { auth, canUpload } from "@/auth";
import { prisma } from "@/lib/prisma";
import { bookMetadataSchema, validatePdf } from "@/lib/pdf";
import { saveThumbnail, deleteThumbnail } from "@/lib/storage";
import {
  getUserDrive,
  uploadPdf,
  ensureFacultyFolder,
  shareAnyoneReader,
  restrictDownload,
  deleteFile,
  DriveAuthError,
} from "@/lib/drive";

export const runtime = "nodejs";
export const maxDuration = 300;

/** GET /api/books?faculty=<id>&q=<text> */
export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const facultyId = searchParams.get("faculty") ?? undefined;
  const q = searchParams.get("q")?.trim();

  const books = await prisma.book.findMany({
    where: {
      status: "READY",
      ...(facultyId ? { facultyId } : {}),
      // MySQL's default collation is case-insensitive, so `contains` needs no
      // mode flag - and Prisma rejects `mode` on MySQL anyway.
      ...(q
        ? {
            OR: [{ title: { contains: q } }, { author: { contains: q } }],
          }
        : {}),
    },
    include: { faculty: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ books });
}

/**
 * POST /api/books - multipart form: file + metadata + thumbnail data URL.
 *
 * The file goes into the uploader's own Drive folder, using the Drive
 * permission they granted at sign-in. The database row is written first as
 * PENDING so a failed upload can never leave an untracked file behind.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canUpload(session.user.role)) {
    return NextResponse.json(
      { error: "Your account can read the library but not add to it. Ask an admin for upload access." },
      { status: 403 },
    );
  }

  const uploader = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { folderId: true },
  });
  if (!uploader?.folderId) {
    return NextResponse.json(
      { error: "Choose a Drive folder before adding books.", needsStorage: true },
      { status: 409 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  const pdf = file instanceof File ? file : null;

  const head = pdf ? Buffer.from(await pdf.slice(0, 8).arrayBuffer()) : null;
  const fileError = validatePdf(pdf, head);
  if (fileError || !pdf) return NextResponse.json({ error: fileError }, { status: 400 });

  const parsed = bookMetadataSchema.safeParse({
    title: form.get("title"),
    author: form.get("author"),
    facultyId: form.get("facultyId"),
    pageCount: form.get("pageCount") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the form and try again." },
      { status: 400 },
    );
  }
  const meta = parsed.data;

  const faculty = await prisma.faculty.findUnique({ where: { id: meta.facultyId } });
  if (!faculty) {
    return NextResponse.json({ error: "That faculty no longer exists." }, { status: 400 });
  }

  let drive;
  try {
    drive = await getUserDrive(session.user.id);
  } catch (err) {
    if (err instanceof DriveAuthError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  // 1. Reserve the row.
  const book = await prisma.book.create({
    data: {
      title: meta.title,
      author: meta.author,
      facultyId: meta.facultyId,
      sizeBytes: pdf.size,
      pageCount: meta.pageCount ?? null,
      uploadedById: session.user.id,
      status: "PENDING",
    },
  });

  let driveFileId: string | null = null;
  const thumb = form.get("thumbnail");
  const hasThumb = typeof thumb === "string" && thumb.startsWith("data:image/");

  try {
    // 2. Store the first-page thumbnail we rendered in the browser.
    if (hasThumb) await saveThumbnail(book.id, thumb as string);

    // 3. File it under the faculty, creating that subfolder on first use.
    const facultyFolderId = await ensureFacultyFolder(drive, {
      userId: session.user.id,
      parentId: uploader.folderId,
      facultyId: faculty.id,
      facultyName: faculty.name,
    });

    // 4. Upload the PDF into that subfolder.
    const buffer = Buffer.from(await pdf.arrayBuffer());
    const safeName = `${meta.title} - ${meta.author}`.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 180);
    const uploaded = await uploadPdf(drive, {
      name: `${safeName}.pdf`,
      folderId: facultyFolderId,
      body: buffer,
    });
    driveFileId = uploaded.id;

    // 5. Open the link for viewing. This is what turns a private upload into a
    //    book anyone can read without a Google account.
    await shareAnyoneReader(drive, driveFileId);

    if (process.env.BLOCK_DOWNLOADS === "true") {
      await restrictDownload(drive, driveFileId);
    }

    // 6. Commit.
    const ready = await prisma.book.update({
      where: { id: book.id },
      data: { driveFileId, status: "READY", hasThumb },
      include: { faculty: true },
    });

    return NextResponse.json({ book: ready }, { status: 201 });
  } catch (err) {
    // Compensating rollback: no orphan file on Drive, no half-written row.
    if (driveFileId) await deleteFile(drive, driveFileId).catch(() => {});
    await deleteThumbnail(book.id);
    await prisma.book.update({
      where: { id: book.id },
      data: { status: "FAILED", failReason: String(err).slice(0, 500) },
    });

    console.error("[upload] failed", err);
    const raw = String(err);
    const message = raw.includes("storageQuotaExceeded")
      ? "Your Google Drive is full. Free up space, or choose a folder on a Shared Drive instead."
      : raw.includes("notFound")
        ? "That folder no longer exists in your Drive. Pick a new one under Storage."
        : "The upload did not finish. Nothing was saved. Try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
