"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export type Toast = {
  id: string;
  kind: "success" | "error";
  /** Headline. One short line. */
  title: string;
  /** Optional second line: the book, or why it failed. */
  detail?: string;
  /** Optional link out - the new record, or the one already in the library. */
  href?: string;
  linkLabel?: string;
};

// Failures need longer on screen than confirmations: there is something to read
// and act on, rather than a fact to register.
const LIFETIME = { success: 7000, error: 11000 } as const;
const EXIT_MS = 200;

function ToastCard({ toast, onDone }: { toast: Toast; onDone: (id: string) => void }) {
  const [shown, setShown] = useState(false);
  const isError = toast.kind === "error";

  useEffect(() => {
    // Two frames: the first paints the closed state, the second opens it, so
    // the transition actually runs instead of being skipped.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    const life = LIFETIME[toast.kind];
    const hide = setTimeout(() => setShown(false), life);
    const drop = setTimeout(() => onDone(toast.id), life + EXIT_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hide);
      clearTimeout(drop);
    };
  }, [toast.id, toast.kind, onDone]);

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={`pointer-events-auto flex items-start gap-3 rounded-2xl border bg-surface px-4 py-3.5 shadow-lg transition-all duration-200 ease-out motion-reduce:transition-none ${
        isError ? "border-alert/40" : "border-line"
      } ${shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}
    >
      <span
        aria-hidden
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${
          isError ? "bg-alert/12 text-alert" : "bg-tint text-signal"
        }`}
      >
        {isError ? (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" aria-hidden>
            <path
              d="M10 5.5v5m0 3.2v.1"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" aria-hidden>
            <path
              d="M4.5 10.5l3.5 3.5 7.5-8"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.detail && (
          <p className="accession mt-0.5 line-clamp-3 leading-relaxed">{toast.detail}</p>
        )}
        {toast.href && (
          <Link
            href={toast.href}
            className={`mt-2 inline-block text-sm font-medium underline-offset-4 hover:underline ${
              isError ? "text-alert" : "text-signal"
            }`}
          >
            {toast.linkLabel ?? "Open the record"}
          </Link>
        )}
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