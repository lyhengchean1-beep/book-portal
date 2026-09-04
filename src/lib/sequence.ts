import type { drive_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { moveAndRenameFile } from "@/lib/drive";

/**
 * Minimal shape used from a Prisma transaction client - narrower than
 * Prisma's own generated `TransactionClient` type so this file doesn't
 * depend on exactly how that type is named or re-exported by whichever
 * Prisma version is actually installed (that turned out to vary enough
 * between environments to not be worth relying on here).
 */
type PrismaTransaction = {
  book: {
    count: (args: { where: { facultyFolderId: string } }) => Promise<number>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    findMany: (args: {
      where: { facultyFolderId: string; sequenceNumber: { gt: number } };
      orderBy: { sequenceNumber: "asc" };
      select: { id: true; author: true; sequenceNumber: true; driveFileId: true };
    }) => Promise<{ id: string; author: string; sequenceNumber: number | null; driveFileId: string | null }[]>;
  };
};

/**
 * The filename scheme for a sequenced book: "12.Sok Pisey.pdf". Kept in one
 * place so upload, delete, and edit never drift from each other - see the
 * matching comment on Book.facultyFolderId in prisma/schema.prisma.
 */
export function sequencedFileName(sequenceNumber: number, author: string) {
  const safeAuthor = author.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 180);
  return `${sequenceNumber}.${safeAuthor}.pdf`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** P2002: the unique constraint was actually hit. P2034: Prisma's code for a
 *  serializable transaction that lost a write conflict - both are expected
 *  outcomes of two requests touching the same folder at once, not real
 *  errors, and both are meant to be retried. */
function isRetryableConflict(err: unknown): boolean {
  const code = typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
  return code === "P2002" || code === "P2034";
}

/**
 * Claims the next sequence number in a faculty folder.
 *
 * First cut of this just counted, then wrote, outside any transaction -
 * that's two round trips, so two requests racing for the same folder could
 * both count before either wrote. Retrying on the resulting P2002 mostly
 * covered it, until a same-folder edit's multi-row renumbering (see
 * closeSequenceGap) turned out to hold that folder in a half-shifted state
 * for several round trips at a time - long enough that all 5 quick retries
 * could land inside the same window and keep colliding with whichever row
 * happened to be mid-shift. A serializable transaction around count+write
 * closes that: MySQL now guarantees this transaction's view of the folder
 * doesn't change under it, and surfaces a real conflict (P2034) instead of
 * silently letting it through, rather than this code having to reason about
 * exactly how big a window is "long enough."
 *
 * `apply` is whatever write actually claims the number - upload and edit
 * claim it differently (a fresh row vs. an existing one), so the caller
 * supplies it. It receives the transaction client, not the plain prisma
 * client - the write has to happen inside the same transaction as the count
 * for the atomicity above to mean anything.
 */
export async function claimSequenceNumber(
  facultyFolderId: string,
  apply: (tx: PrismaTransaction, sequenceNumber: number) => Promise<unknown>,
  attempts = 8,
): Promise<number> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx: PrismaTransaction) => {
          const sequenceNumber = (await tx.book.count({ where: { facultyFolderId } })) + 1;
          await apply(tx, sequenceNumber);
          return sequenceNumber;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (err) {
      if (!isRetryableConflict(err) || attempt === attempts) throw err;
      // Small randomised, growing delay: enough that two requests retrying
      // in lockstep don't just collide again immediately, without making a
      // normal upload noticeably slower.
      await sleep(30 + Math.floor(Math.random() * 80 * attempt));
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
 * The database side runs as one serializable transaction rather than a bare
 * loop of updates - a folder with dozens of books can need a couple dozen
 * sequential writes to close a gap near the front, and while that's
 * in-flight the folder was previously visible to any other request in a
 * half-renumbered state (see claimSequenceNumber). Everyone else now either
 * sees this folder before the cascade or after, never mid-shift.
 *
 * Drive renames happen after that transaction commits, outside it - a slow
 * network call to Drive has no business holding a database transaction
 * open, and these were already best-effort/non-blocking (a failed rename
 * just leaves that one filename stale until the next edit touches it).
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
  const affected = await prisma.$transaction(
    async (tx: PrismaTransaction) => {
      const rows = await tx.book.findMany({
        where: { facultyFolderId, sequenceNumber: { gt: vacatedSequenceNumber } },
        orderBy: { sequenceNumber: "asc" },
        select: { id: true, author: true, sequenceNumber: true, driveFileId: true },
      });

      // Ascending order on purpose: shifting 2->1 before 3->2 always writes
      // into the slot the previous step just vacated, so the constraint
      // never sees a collision partway through this transaction either.
      for (const book of rows) {
        await tx.book.update({
          where: { id: book.id },
          data: { sequenceNumber: book.sequenceNumber! - 1 },
        });
      }

      return rows;
    },
    { isolationLevel: "Serializable" },
  );

  for (const book of affected) {
    if (!drive || !book.driveFileId) continue;
    await moveAndRenameFile(drive, {
      fileId: book.driveFileId,
      name: sequencedFileName(book.sequenceNumber! - 1, book.author),
    }).catch((err) => {
      console.error(`[sequence] Drive rename failed for book ${book.id}`, err);
    });
  }
}