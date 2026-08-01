import Link from "next/link";

export type RailFaculty = { id: string; code: string; name: string; count: number };

/**
 * A vertical rail costs a phone user a screen of scrolling before they reach a
 * single book, so below `lg` the same links render as a horizontally scrolling
 * strip of chips instead.
 */
export default function FacultyRail({
  faculties,
  total,
  activeId,
  query,
}: {
  faculties: RailFaculty[];
  total: number;
  activeId?: string;
  query?: string;
}) {
  const suffix = query ? `&q=${encodeURIComponent(query)}` : "";
  const href = (id: string) => `/books?faculty=${id}${suffix}`;
  const allHref = query ? `/books?q=${encodeURIComponent(query)}` : "/books";

  const used = faculties.filter((f) => f.count > 0 || f.id === activeId);
  const empty = faculties.filter((f) => f.count === 0 && f.id !== activeId);

  return (
    <>
      {/* Phone and tablet: one scrolling row. -mx-4 lets it bleed to the screen
          edge so the last chip does not look cut off mid-word. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-2">
          <Chip href={allHref} label="All" count={total} active={!activeId} />
          {used.map((f) => (
            <Chip
              key={f.id}
              href={href(f.id)}
              label={f.code}
              title={f.name}
              count={f.count}
              active={f.id === activeId}
            />
          ))}
        </div>
      </div>

      {/* Desktop: the rail. */}
      <div className="hidden lg:sticky lg:top-24 lg:block">
        <p className="eyebrow mb-3">Faculty</p>

        <ul className="-mx-2.5 space-y-0.5">
          <Row href={allHref} label="All faculties" count={total} active={!activeId} />
          {used.map((f) => (
            <Row
              key={f.id}
              href={href(f.id)}
              code={f.code}
              label={f.name}
              count={f.count}
              active={f.id === activeId}
            />
          ))}
        </ul>

        {/* On a young library most faculties are empty, and eight of them push
            the ones with books off the screen. `details` folds them away with
            no JavaScript. */}
        {empty.length > 0 && (
          <details className="group mt-2">
            <summary className="accession cursor-pointer list-none px-2.5 py-1.5 hover:text-signal">
              {empty.length} empty
              <span className="ml-1 inline-block transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>
            <ul className="-mx-2.5 mt-1 space-y-0.5 opacity-60">
              {empty.map((f) => (
                <Row
                  key={f.id}
                  href={href(f.id)}
                  code={f.code}
                  label={f.name}
                  count={0}
                  active={false}
                />
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}

function Chip({
  href,
  label,
  title,
  count,
  active,
}: {
  href: string;
  label: string;
  title?: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      title={title}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "border-signal bg-signal text-white"
          : "border-line bg-surface text-ink hover:border-signal"
      }`}
    >
      {label}
      <span
        className={`font-mono text-[10px] tabular-nums ${
          active ? "text-white/75" : "text-ink-soft"
        }`}
      >
        {count}
      </span>
    </Link>
  );
}

function Row({
  href,
  code,
  label,
  count,
  active,
}: {
  href: string;
  code?: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <li>
      <Link href={href} className={`row ${active ? "row-active" : ""}`} title={label}>
        <span className="flex min-w-0 items-baseline gap-2">
          {code && (
            <span className="shrink-0 font-mono text-[10px] tracking-wider text-ink-soft">
              {code}
            </span>
          )}
          {/* One line with an ellipsis. Eight faculty names at full length turn
              the rail into a wall of wrapped text; the code and the tooltip
              carry the identification. */}
          <span className="truncate">{label}</span>
        </span>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
            active ? "bg-signal text-white" : "bg-husk text-ink-soft"
          }`}
        >
          {count}
        </span>
      </Link>
    </li>
  );
}
