import Link from "next/link";
import { titleCase } from "@/lib/text";

export type CardBook = {
  id: string;
  title: string;
  author: string;
  pageCount: number | null;
  hasThumb: boolean;
  createdAt: Date | string;
  faculty: { code: string; name: string };
};

/** First letters of the title, for books whose cover failed to render. */
function monogram(title: string) {
  return title
    .split(/\s+/)
    .filter((w) => /[a-z\u1780-\u17ff]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function BookCard({ book }: { book: CardBook }) {
  // Covers are set in full capitals, which is unreadable clamped to two lines.
  const title = titleCase(book.title);
  const added = new Date(book.createdAt).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <Link href={`/books/${book.id}`} className="group block focus-visible:outline-none">
      <div className="relative aspect-[1/1.35] overflow-hidden rounded-xl border border-line bg-husk shadow-sm transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-lg group-focus-visible:-translate-y-1 group-focus-visible:shadow-lg">
        {book.hasThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/books/${book.id}/thumbnail`}
            alt=""
            className="h-full w-full object-cover object-top"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full place-items-center bg-tint">
            <span className="font-display text-3xl text-signal/40">
              {monogram(title)}
            </span>
          </div>
        )}

        {/* Faculty code, legible over a light or dark cover. */}
        <span className="absolute left-2 top-2 rounded-md bg-ink/80 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-white backdrop-blur-sm">
          {book.faculty.code}
        </span>

        {/* Reveals on hover so the card reads as openable without a button
            competing with the cover for attention. */}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center bg-gradient-to-t from-ink/70 to-transparent pb-3 pt-10 text-xs font-semibold text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          Read
        </span>
      </div>

      {/* Clamped to two lines so every card in a row is the same height. The
          full title is on the book's own page. */}
      <h3
        className="mt-3 line-clamp-2 font-display text-[0.9375rem] leading-snug transition-colors group-hover:text-signal"
        title={title}
      >
        {title}
      </h3>
      <p className="mt-1 line-clamp-1 text-sm text-ink-soft">{book.author}</p>
      <p className="accession mt-1.5">
        {[book.pageCount ? `${book.pageCount} pp` : null, added].filter(Boolean).join(" · ")}
      </p>
    </Link>
  );
}
