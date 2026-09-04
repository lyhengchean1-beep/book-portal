import { NextResponse } from "next/server";
import { auth, canUpload } from "@/auth";
import { prisma } from "@/lib/prisma";
import { bookMetadataSchema, validatePdf } from "@/lib/pdf";
import { saveThumbnail, deleteThumbnail } from "@/lib/storage";
import { claimSequenceNumber } from "@/lib/sequence";
import {
  getStorageDrive,
  activeYearFolder,
  ensureFacultyFolder,
  uploadPdf,
  shareAnyoneReader,
  restrictDownload,
  deleteFile,
  DriveAuthError,
  DriveConfigError,
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
      ...(q ? { OR: [{ title: { contains: q } }, { author: { contains: q } }] } : {}),
    },
    include: { faculty: true },
    // Cover bytes are served by /api/books/[id]/thumbnail, never inlined
    // here - a JSON array of every book's raw image data would be enormous.
    omit: { thumbnail: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ books });
}

/**
 * POST /api/books - multipart form: file + metadata + thumbnail data URL.
 *
 * The file goes into the shared library Drive, under
 * <root> / <year> / <faculty>. The database row is written first as PENDING, so
 * a failed upload can never leave an untracked file behind.
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

  // Trimmed once here and used for both the duplicate check and the row, so a
  // stray trailing space can never make the same book look like a new one.
  const title = parsed.data.title.trim();
  const author = parsed.data.author.trim();
  const { facultyId, pageCount } = parsed.data;

  /**
   * A thesis is identified well enough by its title and its author, so the pair
   * is treated as unique. Enforced here rather than by a database index because
   * a retry after a failed upload must still be allowed: only READY rows count,
   * and the PENDING and FAILED rows left by earlier attempts are ignored.
   *
   * The comparison is case-insensitive for free - that is MySQL's default
   * collation - so "SOTH CHANNAVY" will not slip past "Soth Channavy".
   */
  const duplicate = await prisma.book.findFirst({
    where: { status: "READY", title, author },
    select: { id: true, title: true, author: true },
  });
  if (duplicate) {
    return NextResponse.json(
      {
        error: "This book is already in the library.",
        detail: `${duplicate.title} — ${duplicate.author}`,
        duplicateId: duplicate.id,
      },
      { status: 409 },
    );
  }

  const faculty = await prisma.faculty.findUnique({ where: { id: facultyId } });
  if (!faculty) {
    return NextResponse.json({ error: "That faculty no longer exists." }, { status: 400 });
  }

  let drive;
  let year;
  try {
    drive = await getStorageDrive();
    year = await activeYearFolder(drive);
  } catch (err) {
    if (err instanceof DriveAuthError || err instanceof DriveConfigError) {
      // 409 rather than 403: nothing is wrong with this person's account, the
      // installation is not finished.
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  // 1. Reserve the row.
  const book = await prisma.book.create({
    data: {
      title,
      author,
      facultyId,
      sizeBytes: pdf.size,
      pageCount: pageCount ?? null,
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

    // 3. Find the faculty folder inside this year, creating it on first use.
    const facultyFolderId = await ensureFacultyFolder(drive, {
      parentId: year.id,
      facultyId: faculty.id,
      folderName: faculty.driveFolder ?? faculty.code,
    });

    // 3.5. Claim this book's number within that folder. Scoped to the
    // folder rather than just the faculty, so switching the active year on
    // the Storage page starts each faculty back at 1. See claimSequenceNumber
    // for why this retries instead of just failing on a collision.
    const sequenceNumber = await claimSequenceNumber(facultyFolderId, (n) =>
      prisma.book.update({
        where: { id: book.id },
        data: { facultyFolderId, sequenceNumber: n },
      }),
    );

    // 4. Upload the PDF into that folder.
    const buffer = Buffer.from(await pdf.arrayBuffer());
    const safeAuthor = author.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 180);
    const uploaded = await uploadPdf(drive, {
      name: `${sequenceNumber}.${safeAuthor}.pdf`,
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
      omit: { thumbnail: true },
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
      ? "The library Google Drive is full. An admin needs to free up space or move the library to a Shared Drive."
      : raw.includes("notFound")
        ? "The library folder is missing from Drive. An admin should check the year folder under Storage."
        : "The upload did not finish. Nothing was saved. Try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}