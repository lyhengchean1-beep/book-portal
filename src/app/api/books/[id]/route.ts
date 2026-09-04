import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, canDelete, canEditBook } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  getStorageDrive,
  deleteFile,
  ensureFacultyFolder,
  activeYearFolder,
  moveAndRenameFile,
  getFileParents,
  DriveAuthError,
  DriveConfigError,
} from "@/lib/drive";
import { closeSequenceGap, claimSequenceNumber, sequencedFileName } from "@/lib/sequence";
import { deleteThumbnail } from "@/lib/storage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { id } = await params;
  const book = await prisma.book.findUnique({
    where: { id },
    include: { faculty: true },
    omit: { thumbnail: true },
  });
  if (!book || book.status !== "READY") {
    return NextResponse.json({ error: "No book with that ID." }, { status: 404 });
  }
  return NextResponse.json({ book });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canDelete(session.user.role)) {
    return NextResponse.json({ error: "Only an admin can remove a book." }, { status: 403 });
  }

  const { id } = await params;
  const book = await prisma.book.findUnique({ where: { id }, omit: { thumbnail: true } });
  if (!book) return NextResponse.json({ error: "No book with that ID." }, { status: 404 });

  // One client, reused for the delete itself and for the renumbering below -
  // every file belongs to the library Drive account, so this no longer
  // depends on the person who uploaded it still having a working token, which
  // is what used to make removing an ex-colleague's book fail silently.
  const drive =
    book.driveFileId || book.facultyFolderId ? await getStorageDrive().catch(() => null) : null;

  if (book.driveFileId && drive) {
    await deleteFile(drive, book.driveFileId).catch(() => {});
  }
  await deleteThumbnail(book.id);
  await prisma.book.delete({ where: { id } });

  // This book's slot leaves a gap in its faculty folder's numbering - close
  // it so a future upload's `count + 1` never collides with a real file.
  // Legacy books (no facultyFolderId/sequenceNumber) were never part of the
  // sequence, so there is nothing to close.
  if (book.facultyFolderId && book.sequenceNumber != null) {
    await closeSequenceGap(drive, book.facultyFolderId, book.sequenceNumber);
  }

  return NextResponse.json({ removed: id });
}

/**
 * PATCH /api/books/[id] - edit title, author, and/or faculty.
 *
 * Allowed for an admin on any book, or for the uploader on their own (see
 * canEditBook). Changing the faculty moves the file on Drive into the new
 * faculty's folder and gives it a fresh sequence number there, then closes
 * the gap left behind in the old folder - the same cascade DELETE runs, since
 * leaving this book's old faculty is no different from leaving the library
 * entirely as far as that folder's numbering is concerned.
 */
const editSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters").max(300),
  author: z.string().trim().min(2, "Author must be at least 2 characters").max(200),
  facultyId: z.string().trim().min(1, "Choose a faculty"),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { id } = await params;
  const book = await prisma.book.findUnique({ where: { id }, omit: { thumbnail: true } });
  if (!book) return NextResponse.json({ error: "No book with that ID." }, { status: 404 });

  const isOwner = book.uploadedById === session.user.id;
  if (!canEditBook(session.user.role, isOwner)) {
    return NextResponse.json(
      { error: "Only the person who added this book, or an admin, can edit it." },
      { status: 403 },
    );
  }
  if (book.status !== "READY") {
    return NextResponse.json(
      { error: "Only a book that finished uploading can be edited." },
      { status: 400 },
    );
  }

  const parsed = editSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the form and try again." },
      { status: 400 },
    );
  }

  const { title, author, facultyId } = parsed.data;
  const facultyChanged = facultyId !== book.facultyId;
  const authorChanged = author !== book.author;

  // Same duplicate rule as upload: title+author unique among READY books,
  // this one excepted.
  const duplicate = await prisma.book.findFirst({
    where: { status: "READY", title, author, id: { not: book.id } },
    select: { id: true, title: true, author: true },
  });
  if (duplicate) {
    return NextResponse.json(
      {
        error: "Another book already has this title and author.",
        detail: `${duplicate.title} — ${duplicate.author}`,
        duplicateId: duplicate.id,
      },
      { status: 409 },
    );
  }

  // No faculty change: update the fields, and if the author changed, keep
  // the Drive filename's author segment in sync - best-effort, since a stale
  // filename is cosmetic and should never block the edit itself.
  if (!facultyChanged) {
    const updated = await prisma.book.update({
      where: { id: book.id },
      data: { title, author },
      include: { faculty: true },
      omit: { thumbnail: true },
    });

    if (authorChanged && book.driveFileId && book.facultyFolderId && book.sequenceNumber != null) {
      await getStorageDrive()
        .then((drive) =>
          moveAndRenameFile(drive, {
            fileId: book.driveFileId!,
            name: sequencedFileName(book.sequenceNumber!, author),
          }),
        )
        .catch((err) => console.error(`[edit] Drive rename failed for book ${book.id}`, err));
    }

    return NextResponse.json({ book: updated });
  }

  const newFaculty = await prisma.faculty.findUnique({ where: { id: facultyId } });
  if (!newFaculty) {
    return NextResponse.json({ error: "That faculty no longer exists." }, { status: 400 });
  }

  let drive;
  try {
    drive = await getStorageDrive();
  } catch (err) {
    if (err instanceof DriveAuthError || err instanceof DriveConfigError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  const oldFacultyFolderId = book.facultyFolderId;
  const oldSequenceNumber = book.sequenceNumber;
  const wasSequenced = Boolean(oldFacultyFolderId && oldSequenceNumber != null);

  try {
    let newFacultyFolderId: string | null = null;
    let newSequenceNumber: number | null = null;

    if (wasSequenced) {
      // Same year folder as before, only the faculty changes. The year is
      // recovered from the FacultyFolder row the book is currently filed
      // under, rather than defaulting to whatever year is active today -
      // an edit should not silently re-file an old book into this year.
      const currentFolder = await prisma.facultyFolder.findFirst({
        where: { folderId: oldFacultyFolderId! },
      });
      if (!currentFolder) {
        throw new Error(
          "Could not find which year folder this book is currently filed under.",
        );
      }

      newFacultyFolderId = await ensureFacultyFolder(drive, {
        parentId: currentFolder.parentId,
        facultyId: newFaculty.id,
        folderName: newFaculty.driveFolder ?? newFaculty.code,
      });

      // Claim the slot in the destination folder before touching Drive, so
      // the file only ever moves once the new number is confirmed - see
      // claimSequenceNumber for why a plain count-then-write isn't safe
      // when an upload could be claiming a number in the same folder at the
      // same time.
      const destFolderId = newFacultyFolderId;
      newSequenceNumber = await claimSequenceNumber(destFolderId, (tx, n) =>
        tx.book.update({
          where: { id: book.id },
          data: { facultyId: newFaculty!.id, facultyFolderId: destFolderId, sequenceNumber: n },
        }),
      );

      if (book.driveFileId) {
        await moveAndRenameFile(drive, {
          fileId: book.driveFileId,
          addParents: newFacultyFolderId,
          removeParents: oldFacultyFolderId!,
          name: sequencedFileName(newSequenceNumber, author),
        });
      }
    } else if (book.driveFileId) {
      // Legacy book, predating facultyFolderId/sequenceNumber (see the
      // schema comment on Book): move it without pulling it into the
      // numbering scheme, keeping its existing title-based filename. There
      // is no stored folder to recover a year from, so - same as a fresh
      // upload - it goes into whichever year folder is active now.
      const year = await activeYearFolder(drive);
      const destFolderId = await ensureFacultyFolder(drive, {
        parentId: year.id,
        facultyId: newFaculty.id,
        folderName: newFaculty.driveFolder ?? newFaculty.code,
      });
      const currentParents = await getFileParents(drive, book.driveFileId);
      await moveAndRenameFile(drive, {
        fileId: book.driveFileId,
        addParents: destFolderId,
        removeParents: currentParents.join(","),
      });
    }

    // For a sequenced move, facultyId/facultyFolderId/sequenceNumber are
    // already committed above (claimed together, so a retry never leaves
    // them out of step with each other) - this only still needs to set it
    // for the legacy and no-faculty-change paths.
    const updated = await prisma.book.update({
      where: { id: book.id },
      data: {
        title,
        author,
        ...(wasSequenced ? {} : { facultyId: newFaculty.id }),
      },
      include: { faculty: true },
      omit: { thumbnail: true },
    });

    if (wasSequenced) {
      await closeSequenceGap(drive, oldFacultyFolderId!, oldSequenceNumber!);
    }

    return NextResponse.json({ book: updated });
  } catch (err) {
    console.error("[edit] faculty move failed", err);
    return NextResponse.json(
      { error: "Could not move the file to the new faculty. Nothing was changed." },
      { status: 502 },
    );
  }
}