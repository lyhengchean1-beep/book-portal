import { NextResponse } from "next/server";
import { auth, canDelete } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getUserDrive, deleteFile } from "@/lib/drive";
import { deleteThumbnail } from "@/lib/storage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { id } = await params;
  const book = await prisma.book.findUnique({ where: { id }, include: { faculty: true } });
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
  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) return NextResponse.json({ error: "No book with that ID." }, { status: 404 });

  // The file lives in the uploader's Drive, so removing it needs their
  // credentials rather than the admin's.
  if (book.driveFileId) {
    await getUserDrive(book.uploadedById)
      .then((drive) => deleteFile(drive, book.driveFileId as string))
      .catch(() => {});
  }
  await deleteThumbnail(book.id);
  await prisma.book.delete({ where: { id } });

  return NextResponse.json({ removed: id });
}
