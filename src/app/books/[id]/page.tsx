import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, canDelete } from "@/auth";
import { prisma } from "@/lib/prisma";
import Nav from "@/components/Nav";
import { drivePreviewUrl, driveViewUrl, driveDownloadUrl } from "@/lib/links";
import { titleCase } from "@/lib/text";
import DeleteBookButton from "@/components/DeleteBookButton";

export const dynamic = "force-dynamic";

/**
 * Long titles get a smaller heading. A clamp alone cannot help here: it scales
 * with the viewport, not with the number of characters, so a 150-character
 * title renders at the same size as a five-word one and swamps the page.
 */
function headingSize(length: number) {
  if (length > 110) return "text-[clamp(1.125rem,3.5vw,1.375rem)]";
  if (length > 70) return "text-[clamp(1.25rem,4vw,1.625rem)]";
  if (length > 40) return "text-[clamp(1.375rem,4.5vw,1.875rem)]";
  return "text-[clamp(1.5rem,5vw,2.125rem)]";
}

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/");

  const { id } = await params;
  const book = await prisma.book.findUnique({
    where: { id },
    include: { faculty: true, uploadedBy: { select: { name: true, email: true } } },
    omit: { thumbnail: true },
  });

  if (!book || book.status !== "READY" || !book.driveFileId) notFound();

  const title = titleCase(book.title);
  const downloadsOff = process.env.BLOCK_DOWNLOADS === "true";
  const added = new Date(book.createdAt).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href={`/books?faculty=${book.facultyId}`}
          className="accession inline-flex items-center gap-1.5 hover:text-signal"
        >
          <span aria-hidden>←</span>
          <span className="truncate">{book.faculty.name}</span>
        </Link>

        {/* On a phone the details come first and the reader follows, because a
            76vh iframe above the title means scrolling past the document to
            find out what it is. order- swaps them back on a wide screen. */}
        <div className="mt-4 flex flex-col gap-6 lg:mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,330px)] lg:gap-12">
          <div className="order-2 overflow-hidden rounded-xl border border-line bg-surface shadow-md sm:rounded-2xl sm:shadow-lg lg:order-1">
            <iframe
              src={drivePreviewUrl(book.driveFileId)}
              title={`${title} — reader`}
              className="block h-[65vh] w-full sm:h-[72vh] lg:h-[76vh]"
              allow="autoplay"
            />
          </div>

          {/* Sticks while the document scrolls on desktop, so the actions stay
              reachable on a hundred-page thesis. */}
          <aside className="order-1 lg:order-2 lg:sticky lg:top-24 lg:self-start">
            <span className="inline-flex items-center rounded-full bg-tint px-2.5 py-1 font-mono text-[10px] tracking-wider text-signal-deep">
              {book.faculty.code}
            </span>

            {/* break-words stops an unbroken Khmer run or a long Latin word
                from pushing the column wider than the screen. */}
            <h1 className={`mt-3 break-words hyphens-auto ${headingSize(title.length)}`}>
              {title}
            </h1>
            <p className="mt-2 text-base text-ink-soft sm:text-lg">{book.author}</p>

            <div className="mt-5 flex flex-wrap gap-2">
              <a
                className="btn btn-primary"
                href={driveViewUrl(book.driveFileId)}
                target="_blank"
                rel="noreferrer"
              >
                Open full screen
              </a>
              {!downloadsOff && (
                <a
                  className="btn btn-ghost"
                  href={driveDownloadUrl(book.driveFileId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </a>
              )}
            </div>

            {book.description && (
              <p className="mt-6 text-sm leading-relaxed">{book.description}</p>
            )}

            <dl className="mt-6 rounded-xl border border-line bg-surface p-1 shadow-sm sm:rounded-2xl">
              <Row label="Faculty" value={book.faculty.name} />
              {book.year && <Row label="Published" value={String(book.year)} />}
              {book.pageCount && <Row label="Pages" value={String(book.pageCount)} />}
              {book.isbn && <Row label="ISBN" value={book.isbn} mono />}
              <Row label="Size" value={`${(book.sizeBytes / 1024 / 1024).toFixed(1)} MB`} />
              <Row label="Added by" value={book.uploadedBy.name ?? book.uploadedBy.email} />
              <Row label="Added on" value={added} />
            </dl>

            {canDelete(session.user.role) && (
              <div className="mt-6 border-t border-line pt-5">
                <DeleteBookButton id={book.id} title={title} />
              </div>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line px-3 py-2 text-sm last:border-b-0">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className={`min-w-0 break-words text-right ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
