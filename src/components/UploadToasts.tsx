"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export type Toast = { id: string; title: string; bookId: string };

const LIFETIME_MS = 7000;
const EXIT_MS = 200;

/**
 * A single success message, bottom right on a desktop and across the bottom on
 * a phone. It reports what happened and offers the book rather than navigating
 * to it, so a run of uploads is never interrupted.
 */
function ToastCard({ toast, onDone }: { toast: Toast; onDone: (id: string) => void }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Two frames: the first paints the closed state, the second opens it, so
    // the transition actually runs instead of being skipped.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    const hide = setTimeout(() => setShown(false), LIFETIME_MS);
    const drop = setTimeout(() => onDone(toast.id), LIFETIME_MS + EXIT_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hide);
      clearTimeout(drop);
    };
  }, [toast.id, onDone]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-lg transition-all duration-200 ease-out motion-reduce:transition-none ${
        shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
    >
      <span
        aria-hidden
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tint text-signal"
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" aria-hidden>
          <path
            d="M4.5 10.5l3.5 3.5 7.5-8"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Added to the library</p>
        <p className="accession mt-0.5 truncate">{toast.title}</p>
        <Link
          href={`/books/${toast.bookId}`}
          className="mt-2 inline-block text-sm font-medium text-signal underline-offset-4 hover:underline"
        >
          Open the record
        </Link>
      </div>

      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setShown(false);
          setTimeout(() => onDone(toast.id), EXIT_MS);
        }}
        className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-husk hover:text-ink"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden>
          <path
            d="M5.5 5.5l9 9m0-9l-9 9"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

/** Stacks whatever is currently on screen. Newest sits at the bottom. */
export default function UploadToasts({
  toasts,
  onDone,
}: {
  toasts: Toast[];
  onDone: (id: string) => void;
}) {
  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[22rem]">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDone={onDone} />
      ))}
    </div>
  );
}