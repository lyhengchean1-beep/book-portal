"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Export button with an optional date range.
 *
 * Closed, it is a one-click export of whatever the catalogue is currently
 * filtered to. Open, it adds a from/to range on top of that filter. The two
 * combine, so "Agronomy, added in May" is one export rather than a spreadsheet
 * edit afterwards.
 */
export default function ExportCsv({
  facultyId,
  query,
}: {
  facultyId?: string;
  query?: string;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape, the two things people expect from a
  // popover and notice immediately when they are missing.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function href(withRange: boolean) {
    const params = new URLSearchParams();
    if (facultyId) params.set("faculty", facultyId);
    if (query) params.set("q", query);
    if (withRange) {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    const qs = params.toString();
    return `/api/books/export${qs ? `?${qs}` : ""}`;
  }

  const invalid = Boolean(from && to && from > to);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div ref={boxRef} className="relative">
      <div className="flex">
        <a className="btn btn-ghost rounded-r-none" href={href(false)}>
          Export CSV
        </a>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Export a date range"
          className="btn btn-ghost -ml-px rounded-l-none px-2.5"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-4 shadow-lg">
          <p className="label">Added between</p>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              className="field"
              value={from}
              max={to || today}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From date"
            />
            <input
              type="date"
              className="field"
              value={to}
              min={from || undefined}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              aria-label="To date"
            />
          </div>

          <p className="accession mt-3 leading-relaxed">
            {invalid
              ? "The first date is after the second."
              : from || to
                ? "Both days are included. Leave one blank for open-ended."
                : "Leave both blank to export everything."}
          </p>

          <div className="mt-4 flex items-center gap-2">
            <a
              className={`btn btn-primary ${invalid ? "pointer-events-none opacity-45" : ""}`}
              href={href(true)}
              onClick={() => setOpen(false)}
              aria-disabled={invalid}
            >
              Export range
            </a>
            {(from || to) && (
              <button
                type="button"
                className="accession hover:text-signal"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
