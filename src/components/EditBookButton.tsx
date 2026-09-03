"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Faculty = { id: string; code: string; name: string };

/**
 * Opens into an inline edit form on the book's own page. Changing the
 * faculty moves the file to the new faculty's folder on Drive - worth
 * saying up front, since it is the one edit here with a side effect outside
 * the database.
 */
export default function EditBookButton({
  id,
  title: initialTitle,
  author: initialAuthor,
  facultyId: initialFacultyId,
  faculties,
}: {
  id: string;
  title: string;
  author: string;
  facultyId: string;
  faculties: Faculty[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [author, setAuthor] = useState(initialAuthor);
  const [facultyId, setFacultyId] = useState(initialFacultyId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facultyChanged = facultyId !== initialFacultyId;
  const dirty =
    title.trim() !== initialTitle || author.trim() !== initialAuthor || facultyChanged;
  const ready = Boolean(title.trim() && author.trim() && facultyId);

  function cancel() {
    setEditing(false);
    setTitle(initialTitle);
    setAuthor(initialAuthor);
    setFacultyId(initialFacultyId);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/books/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), author: author.trim(), facultyId }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error ?? "The book was not updated.");
        return;
      }

      setEditing(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button className="btn btn-ghost" onClick={() => setEditing(true)}>
        Edit
      </button>
    );
  }

  return (
    <div className="panel p-4 sm:p-5">
      <div className="grid gap-4">
        <div>
          <label className="label" htmlFor="edit-title">
            Title
          </label>
          <input
            id="edit-title"
            className="field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
          />
        </div>

        <div>
          <label className="label" htmlFor="edit-author">
            Author
          </label>
          <input
            id="edit-author"
            className="field"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            disabled={saving}
          />
        </div>

        <div>
          <label className="label" htmlFor="edit-faculty">
            Faculty
          </label>
          <select
            id="edit-faculty"
            className="field"
            value={facultyId}
            onChange={(e) => setFacultyId(e.target.value)}
            disabled={saving}
          >
            {faculties.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} — {f.name}
              </option>
            ))}
          </select>
          {facultyChanged && (
            <p className="accession mt-2">
              Moves the PDF to {faculties.find((f) => f.id === facultyId)?.name}&apos;s folder on
              Drive.
            </p>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="notice notice-error mt-4">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty || !ready}>
          {saving ? (facultyChanged ? "Moving the file…" : "Saving…") : "Save changes"}
        </button>
        <button className="btn btn-ghost" onClick={cancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
