import { prisma } from "./prisma";

/**
 * First-page thumbnails live in the database, not on disk.
 *
 * They used to be written to DATA_DIR/thumbnails, which worked fine on a VM
 * with a real disk. Render's free web services have an ephemeral filesystem
 * and can't attach a persistent disk at all, so anything written there is
 * gone on the next deploy or spin-down/spin-up cycle. A thumbnail is one
 * rendered page - small enough that a BLOB column is simpler than wiring up
 * a second storage backend, and it means one mysqldump backs up the whole
 * library instead of a database dump plus a separate volume tarball.
 *
 * Not Drive: Drive's thumbnailLink expires after a few hours and is rate
 * limited, so it's the wrong thing to hang a browse grid on.
 */

export async function saveThumbnail(bookId: string, dataUrl: string) {
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Thumbnail is not a data URL.");
  await prisma.book.update({
    where: { id: bookId },
    data: { thumbnail: Buffer.from(base64, "base64") },
  });
}

export async function readThumbnail(bookId: string) {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { thumbnail: true },
  });
  return book?.thumbnail ?? null;
}

export async function deleteThumbnail(bookId: string) {
  await prisma.book
    .update({ where: { id: bookId }, data: { thumbnail: null } })
    .catch(() => {
      /* row already gone */
    });
}
