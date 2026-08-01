"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteBookButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setWorking(true);
    setError(null);
    const res = await fetch(`/api/books/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "The book was not removed.");
      setWorking(false);
      return;
    }
    router.push("/books");
    router.refresh();
  }

  if (!confirming) {
    return (
      <button className="accession hover:text-alert" onClick={() => setConfirming(true)}>
        Remove this book
      </button>
    );
  }

  return (
    <div>
      <p className="text-sm leading-relaxed">
        Removing “{title}” deletes the PDF from Google Drive as well. Anyone holding the
        link will lose access.
      </p>
      <div className="mt-4 flex gap-3">
        <button className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={working}>
          Keep it
        </button>
        <button className="btn btn-danger" onClick={remove} disabled={working}>
          {working ? "Removing…" : "Remove"}
        </button>
      </div>
      {error && <p className="accession mt-3 text-alert">{error}</p>}
    </div>
  );
}
