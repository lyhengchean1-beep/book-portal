import type { drive_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { moveAndRenameFile } from "@/lib/drive";

/**
 * The filename scheme for a sequenced book: "12.Sok Pisey.pdf". Kept in one
 * place so upload, delete, and edit never drift from each other - see the
 * matching comment on Book.facultyFolderId in prisma/schema.prisma.
 */
export function sequencedFileName(sequenceNumber: number, author: string) {
  const safeAuthor = author.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 180);
  return `${sequenceNumber}.${safeAuthor}.pdf`;
}

/**
 * Claims the next sequence number in a faculty folder.
 *
 * Counting the folder and writing the result back is two round trips, so two
 * requests racing for the same folder can both count before either writes -
 * this was already a known, documented trade-off (see the comment it used to
 * live next to in books/route.ts), accepted because the unique constraint on
 * (facultyFolderId, sequenceNumber) turns it into a clean failure rather
 * than two files silently sharing a number. In production that "clean
 * failure" turned out to mean a real, repeated upload failure for whoever
 * lost the race - uploading a stack of books is the normal way to use this
 * page, which makes near-simultaneous requests to the same folder the
 * expected case, not a rare edge. So: catch exactly that collision and
 * recount, rather than surface it.
 *
 * `apply` is whatever write actually claims the number - upload and edit
 * claim it differently (a fresh row vs. an existing one), so the caller
 * supplies it.
 */
export async function claimSequenceNumber(
  facultyFolderId: string,
  apply: (sequenceNumber: number) => Promise<unknown>,
  attempts = 5,
): Promise<number> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const sequenceNumber = (await prisma.book.count({ where: { facultyFolderId } })) + 1;
    try {
      await apply(sequenceNumber);
      return sequenceNumber;
    } catch (err) {
      const lostTheRace = typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
      if (!lostTheRace || attempt === attempts) throw err;
      // Someone else's request claimed this number between our count and our
      // write. Loop around and count again - `attempts` exists only so a
      // genuinely broken constraint fails loudly instead of looping forever.
    }
  }
  // Unreachable - the loop above always returns or throws - but keeps the
  // return type honest instead of implying `undefined` is possible.
  throw new Error(`Could not claim a sequence number in ${facultyFolderId} after ${attempts} attempts.`);
}

/**
 * Closes the gap a book leaves behind in its old facultyFolderId.
 *
 * Every remaining book in that folder with a higher sequenceNumber moves
 * down by one, in the database and (best-effort) on Drive, so the folder
 * stays a dense 1..N run. This matters beyond tidiness: uploads assign the
 * next number as `count + 1`, so a gap left after a delete or a faculty
 * change would make a future upload collide with a real file's number.
 *
 * Processed in ascending order on purpose - shifting 2->1 before 3->2 always
 * writes into the slot the previous step just vacated, so the
 * (facultyFolderId, sequenceNumber) unique constraint never sees a
 * collision partway through.
 *
 * `drive` may be null (the caller could not get a Drive client): the
 * database still gets renumbered correctly, only the Drive renames are
 * skipped, matching how a hard delete already tolerates Drive being
 * unreachable rather than blocking the database change on it.
 */
export async function closeSequenceGap(
  drive: drive_v3.Drive | null,
  facultyFolderId: string,
  vacatedSequenceNumber: number,
) {
  const affected = await prisma.book.findMany({
    where: { facultyFolderId, sequenceNumber: { gt: vacatedSequenceNumber } },
    orderBy: { sequenceNumber: "asc" },
    select: { id: true, author: true, sequenceNumber: true, driveFileId: true },
  });

  for (const book of affected) {
    const newSequenceNumber = book.sequenceNumber! - 1;

    await prisma.book.update({
      where: { id: book.id },
      data: { sequenceNumber: newSequenceNumber },
    });

    if (drive && book.driveFileId) {
      await moveAndRenameFile(drive, {
        fileId: book.driveFileId,
        name: sequencedFileName(newSequenceNumber, book.author),
      }).catch((err) => {
        // The database is the source of truth for numbering and is already
        // correct at this point; a failed rename just leaves that one
        // filename stale on Drive until the next edit touches it.
        console.error(`[sequence] Drive rename failed for book ${book.id}`, err);
      });
    }
  }
}