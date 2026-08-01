"use client";

import { useEffect, useRef, useState } from "react";

export type PlateResult = {
  /** 520px JPEG, stored as the book's cover. */
  thumbnail: string;
  /** 1100px JPEG, sent for cover reading and then discarded. */
  scan: string;
  pageCount: number;
  /** Local fallback guess, used only when cover reading is unavailable. */
  title: string | null;
  /** Page-one text layer. Empty string on a scanned PDF. */
  text: string;
};

/** pdf.js text items, minus the type import (its path moves between versions). */
type RawItem = { str?: string; transform?: number[] };

/**
 * Local fallback title guess: the PDF's own metadata title when it is not
 * export junk, otherwise the largest type on the page. Good enough to fill the
 * field instantly while the cover reader is still working, and the only source
 * available when GEMINI_API_KEY is not set.
 */
function readTitle(metaTitle: unknown, items: RawItem[]): string | null {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();

  if (typeof metaTitle === "string") {
    const candidate = clean(metaTitle);
    const junk = /\.(doc|docx|pdf|indd|tex)\b|^untitled$|^microsoft word/i;
    if (candidate.length >= 3 && !junk.test(candidate)) return candidate.slice(0, 300);
  }

  // Group text into lines by vertical position, keeping the largest glyph size.
  const lines = new Map<number, { size: number; parts: string[] }>();
  for (const item of items) {
    const text = item.str?.trim();
    if (!text || !item.transform) continue;
    const size = Math.abs(item.transform[3] ?? 0);
    const y = Math.round(item.transform[5] ?? 0);
    const line = lines.get(y);
    if (line) {
      line.parts.push(text);
      line.size = Math.max(line.size, size);
    } else {
      lines.set(y, { size, parts: [text] });
    }
  }

  const rows = [...lines.entries()]
    .map(([y, l]) => ({ y, size: l.size, text: clean(l.parts.join(" ")) }))
    .filter((r) => r.text.length >= 3);

  if (!rows.length) return null;

  const biggest = Math.max(...rows.map((r) => r.size));
  const title = rows
    .filter((r) => r.size >= biggest * 0.95)
    .sort((a, b) => b.y - a.y) // PDF y grows upward, so top of page first
    .map((r) => r.text)
    .join(" ");

  return clean(title).slice(0, 300) || null;
}

/**
 * Renders page one of the chosen PDF in the browser, before anything is sent
 * anywhere. Shows that the right file was picked, produces the JPEG that
 * becomes the book's cover, and hands back the material the cover reader needs.
 *
 * pdf.js needs the DOM, so this is imported with ssr: false and the library
 * itself is imported lazily inside the effect.
 */
export default function FirstPagePlate({
  file,
  onRendered,
  onError,
  onPick,
  dragging,
}: {
  file: File | null;
  onRendered: (result: PlateResult) => void;
  onError: (message: string) => void;
  onPick?: () => void;
  dragging?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [pages, setPages] = useState<number | null>(null);

  useEffect(() => {
    if (!file) {
      setState("idle");
      setPages(null);
      return;
    }

    let cancelled = false;
    setState("reading");

    (async () => {
      const pdfjs = await import("pdfjs-dist");
      // The worker is copied into /public by scripts/copy-pdf-worker.mjs.
      // Bundlers rewrite the packaged path, so it is set explicitly.
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

      const data = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data }).promise;
      const page = await doc.getPage(1);

      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;

      // Render at 2x for a crisp plate on retina screens, then downscale when
      // encoding so the stored cover stays small.
      const viewport = page.getViewport({ scale: 2 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is unavailable in this browser.");

      await page.render({ canvas, canvasContext: ctx, viewport } as never).promise;
      if (cancelled) return;

      /** Re-encodes the rendered page at a given width. */
      const encode = (width: number, quality: number) => {
        const out = document.createElement("canvas");
        const ratio = width / canvas.width;
        out.width = width;
        out.height = Math.round(canvas.height * ratio);
        out.getContext("2d")?.drawImage(canvas, 0, 0, out.width, out.height);
        return out.toDataURL("image/jpeg", quality);
      };

      // Two sizes from one render: a small cover for the catalogue grid, and a
      // larger one for the model, because the author's name on these covers is
      // small enough to disappear at thumbnail width.
      const thumbnail = encode(520, 0.82);
      const scan = encode(1100, 0.72);

      let title: string | null = null;
      let text = "";
      try {
        const [meta, content] = await Promise.all([
          doc.getMetadata(),
          page.getTextContent(),
        ]);
        text = (content.items as RawItem[])
          .map((i) => i.str ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        title = readTitle(
          (meta.info as { Title?: unknown } | undefined)?.Title,
          content.items as RawItem[],
        );
      } catch {
        // A scanned PDF has no text layer. The page still renders, and the
        // vision model reads it from the image.
      }

      if (cancelled) return;
      setPages(doc.numPages);
      setState("done");
      onRendered({ thumbnail, scan, pageCount: doc.numPages, title, text });
    })().catch((err) => {
      if (cancelled) return;
      console.error(err);
      setState("error");
      onError("That PDF could not be opened. It may be corrupted or password protected.");
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  if (!file) {
    return (
      <button
        type="button"
        onClick={onPick}
        className={`flex aspect-[1/1.35] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-8 text-center transition-colors ${
          dragging
            ? "border-signal bg-tint"
            : "border-line bg-surface hover:border-signal hover:bg-tint"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="h-8 w-8 text-signal"
          aria-hidden
        >
          <path d="M12 16V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
        </svg>
        <span className="max-w-[24ch] text-sm leading-relaxed text-ink-soft">
          Drop a PDF here, or click to choose one
        </span>
      </button>
    );
  }

  return (
    <figure className="m-0">
      <div
        className={`relative overflow-hidden rounded-2xl border border-line bg-surface shadow-lg ${
          state === "done" ? "plate-in plate-sweep" : ""
        }`}
      >
        <canvas ref={canvasRef} className="block h-auto w-full" />
        {state === "reading" && (
          <div className="absolute inset-0 grid aspect-[1/1.35] place-items-center bg-husk">
            <p className="accession">Reading page one…</p>
          </div>
        )}
        {state === "error" && (
          <div className="grid aspect-[1/1.35] place-items-center bg-husk p-6 text-center">
            <p className="accession text-alert">Could not read this file</p>
          </div>
        )}
      </div>

      <figcaption className="accession mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="truncate">{file.name}</span>
        <span aria-hidden>·</span>
        <span>{(file.size / 1024 / 1024).toFixed(1)} MB</span>
        {pages !== null && (
          <>
            <span aria-hidden>·</span>
            <span>{pages} pages</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
