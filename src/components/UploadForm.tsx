"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useFileDrop } from "@/hooks/use-file-drop";
import UploadToasts, { type Toast } from "./UploadToasts";
import type { PlateResult } from "./FirstPagePlate";

// pdf.js touches the DOM, so this never renders on the server.
const FirstPagePlate = dynamic(() => import("./FirstPagePlate"), { ssr: false });

type Faculty = { id: string; code: string; name: string };

/** Which fields were filled in for you, so they can be replaced or labelled. */
type Filled = { title: boolean; author: boolean };

export default function UploadForm({
  faculties,
  maxMb,
}: {
  faculties: Faculty[];
  maxMb: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [plate, setPlate] = useState<PlateResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);

  // Only for problems with the file itself, shown beside the drop zone because
  // that is what they are about. Everything that happens on submit goes to a
  // toast instead, so nothing has to be dismissed by hand.
  const [fileError, setFileError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [facultyId, setFacultyId] = useState("");
  const [filled, setFilled] = useState<Filled>({ title: false, author: false });

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [added, setAdded] = useState(0);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  function pushToast(toast: Omit<Toast, "id">) {
    setToasts((list) => [...list, { ...toast, id: crypto.randomUUID() }]);
  }

  // Read inside handlePlate, which runs after an await, so it must not close
  // over a stale render's value.
  const filledRef = useRef(filled);
  filledRef.current = filled;

  function accept(next: File | null) {
    setFileError(null);
    setPlate(null);

    // Suggested values belong to the old file, so they go with it. Anything
    // typed by hand stays.
    if (filled.title) setTitle("");
    if (filled.author) setAuthor("");
    setFilled({ title: false, author: false });

    if (!next) return setFile(null);

    if (next.type && next.type !== "application/pdf" && !/\.pdf$/i.test(next.name)) {
      setFile(null);
      return setFileError("Only PDF files can be added to the library.");
    }
    if (next.size > maxMb * 1024 * 1024) {
      setFile(null);
      return setFileError(
        `That file is ${(next.size / 1024 / 1024).toFixed(1)} MB. The limit is ${maxMb} MB.`,
      );
    }
    setFile(next);
  }

  // Drop a PDF anywhere on the page, not only on the box.
  const dragging = useFileDrop((dropped) => accept(dropped));

  async function handlePlate(result: PlateResult) {
    setPlate(result);

    // The local guess lands first so the field is never empty while the model
    // is still thinking, and is overwritten below if the model does better.
    if (result.title) {
      setTitle((current) => {
        if (current.trim()) return current;
        setFilled((f) => ({ ...f, title: true }));
        return result.title as string;
      });
    }

    setReading(true);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: result.scan, text: result.text }),
      });

      // 501 means cover reading is switched off. Not an error worth showing.
      if (!res.ok) return;

      const { title: t, author: a } = (await res.json()) as {
        title: string | null;
        author: string | null;
      };

      // Fill blanks and replace the local guess, but never touch what someone
      // typed by hand.
      if (t) {
        setTitle((current) => (!current.trim() || filledRef.current.title ? t : current));
      }
      if (a) setAuthor((current) => (current.trim() ? current : a));

      setFilled((f) => ({
        title: f.title || Boolean(t),
        author: f.author || Boolean(a),
      }));
    } catch {
      // Offline, or the API is down. The form still works.
    } finally {
      setReading(false);
    }
  }

  const ready = Boolean(file && plate && title.trim() && author.trim() && facultyId);
  const chosenFaculty = faculties.find((f) => f.id === facultyId);

  /**
   * Clears everything the next book needs to be different, and deliberately
   * keeps the faculty: books arrive in runs from one faculty at a time, and the
   * choice stays visible on screen either way.
   */
  function resetForNextBook() {
    setFile(null);
    setPlate(null);
    setTitle("");
    setAuthor("");
    setFilled({ title: false, author: false });
    setFileError(null);
  }

  async function submit() {
    if (!file || !ready) return;
    setSaving(true);

    const body = new FormData();
    body.set("file", file);
    body.set("title", title);
    body.set("author", author);
    body.set("facultyId", facultyId);
    if (plate) {
      body.set("thumbnail", plate.thumbnail);
      body.set("pageCount", String(plate.pageCount));
    }

    const savedTitle = title.trim();

    let res: Response;
    try {
      res = await fetch("/api/books", { method: "POST", body });
    } catch {
      // fetch() itself never got a response back - a real network failure
      // (connection dropped, DNS, offline). There is no status code to show.
      pushToast({
        kind: "error",
        title: "The upload did not finish.",
        detail: "Check the connection and try again. Nothing was saved.",
      });
      return;
    }

    let json: any;
    try {
      json = await res.json();
    } catch {
      // A response DID come back, just not one this app sent - most often an
      // intermediary (proxy, timeout page) returning HTML instead of JSON.
      // The status code narrows this down a lot in the server log.
      pushToast({
        kind: "error",
        title: "The upload did not finish.",
        detail: `The server sent back something that wasn't JSON (HTTP ${res.status}). Nothing was saved. If this keeps happening with larger files, check the server log for that status code around this time.`,
      });
      return;
    }

    try {
      if (!res.ok) {
        // The server refused it - most often because the same title and author
        // are already catalogued. Offer the existing record instead of just
        // saying no, and leave the form filled in so nothing has to be retyped.
        pushToast({
          kind: "error",
          title: json.error ?? "The upload did not finish.",
          detail: json.detail,
          href: json.duplicateId ? `/books/${json.duplicateId}` : undefined,
          linkLabel: "Open the book already in the library",
        });
        return;
      }

      // Stay put. The book is announced, offered, and the form is ready for the
      // next one - being thrown onto a record page after every upload made
      // adding a stack of books needlessly slow.
      pushToast({
        kind: "success",
        title: "Added to the library",
        detail: savedTitle,
        href: `/books/${json.book.id}`,
        linkLabel: "Open the record",
      });
      setAdded((n) => n + 1);
      resetForNextBook();
      router.refresh();
    } catch {
      pushToast({
        kind: "error",
        title: "The upload did not finish.",
        detail: "Check the connection and try again. Nothing was saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* pointer-events-none is load-bearing: an overlay that captures the
          pointer would swallow the drop it exists to advertise. */}
      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-signal/10 p-8 backdrop-blur-[2px]"
        >
          <div className="rounded-2xl border-2 border-dashed border-signal bg-surface px-12 py-10 text-center shadow-lg">
            <p className="font-display text-2xl">Drop the PDF</p>
            <p className="accession mt-2">Anywhere on this page · up to {maxMb} MB</p>
          </div>
        </div>
      )}

      <UploadToasts toasts={toasts} onDone={dismiss} />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-14">
        {/* Left: the plate, which doubles as the drop target */}
        <div>
          <p className="eyebrow mb-3">Page one</p>
          <FirstPagePlate
            file={file}
            dragging={dragging}
            onPick={() => inputRef.current?.click()}
            onRendered={handlePlate}
            onError={(m) => {
              setFileError(m);
              setFile(null);
            }}
          />

          {fileError && (
            <p role="alert" className="notice notice-error mt-4">
              {fileError}
            </p>
          )}

          {file && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => inputRef.current?.click()}
              >
                Choose a different file
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => accept(null)}>
                Remove
              </button>
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => {
              accept(e.target.files?.[0] ?? null);
              // Lets you re-pick the same file after removing it.
              e.target.value = "";
            }}
          />
        </div>

        {/* Right: three fields. Everything else comes from the file. */}
        <div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="title">
                Title
              </label>
              <input
                id="title"
                className="field"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setFilled((f) => ({ ...f, title: false }));
                }}
                placeholder="Soil Fertility Management in the Mekong Lowlands"
              />
              {reading ? (
                <p className="accession mt-2">Reading the cover…</p>
              ) : (
                filled.title && (
                  <p className="accession mt-2">
                    Read from the cover — edit it if it is wrong
                  </p>
                )
              )}
            </div>

            <div>
              <label className="label" htmlFor="author">
                Author
              </label>
              <input
                id="author"
                className="field"
                value={author}
                onChange={(e) => {
                  setAuthor(e.target.value);
                  setFilled((f) => ({ ...f, author: false }));
                }}
                placeholder="Family name, given name"
              />
              {!reading && filled.author && (
                <p className="accession mt-2">Read from the cover</p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="faculty">
                Faculty
              </label>
              <select
                id="faculty"
                className="field"
                value={facultyId}
                onChange={(e) => setFacultyId(e.target.value)}
              >
                <option value="">Choose one</option>
                {faculties.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} — {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-line pt-6">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!ready || saving}
              onClick={submit}
            >
              {saving ? "Adding to the library…" : "Add to the library"}
            </button>
            <p className="accession max-w-[40ch] leading-relaxed">
              {saving
                ? "Uploading to Drive and opening the link. Keep this tab open."
                : added > 0 && !file
                  ? `${added} book${added === 1 ? "" : "s"} added. Drop the next PDF to carry on.`
                  : chosenFaculty
                    ? `Files into ${chosenFaculty.name}, set to view mode.`
                    : "The link is set to view mode automatically once it uploads."}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}