"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Location = { id: string | null; name: string; shared: boolean };
type Folder = { id: string; name: string };

export default function StoragePicker({
  currentFolderName,
}: {
  currentFolderName: string | null;
}) {
  const router = useRouter();

  const [locations, setLocations] = useState<Location[] | null>(null);
  const [location, setLocation] = useState<Location | null>(null);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/drive/locations")
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error);
        setLocations(json.locations);
      })
      .catch((e) => setError(e.message));
  }, []);

  function chooseLocation(next: Location) {
    setLocation(next);
    setFolder(null);
    setFolders(null);
    setError(null);
    const query = next.id ? `?driveId=${encodeURIComponent(next.id)}` : "";
    fetch(`/api/drive/folders${query}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error);
        setFolders(json.folders);
      })
      .catch((e) => setError(e.message));
  }

  async function save() {
    if (!location || (!folder && !newFolderName.trim())) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/drive/destination", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driveId: location.id,
          driveName: location.name,
          folderId: folder?.id,
          folderName: folder?.name,
          newFolderName: newFolderName.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      router.push("/upload");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that folder.");
      setSaving(false);
    }
  }

  const ready = Boolean(location && (folder || newFolderName.trim()));

  return (
    <div>
      {currentFolderName && (
        <p className="notice mb-8">
          Books currently go to {currentFolderName}. Choosing a new folder only
          affects books added from now on.
        </p>
      )}

      <div className="grid gap-10 md:grid-cols-2 md:gap-14">
        <section>
          <p className="eyebrow mb-3">1 · Drive</p>
          {!locations && !error && <p className="accession">Loading…</p>}
          <ul className="-mx-2.5 space-y-0.5">
            {locations?.map((l) => (
              <li key={l.id ?? "root"}>
                <button
                  onClick={() => chooseLocation(l)}
                  className={`row ${location?.id === l.id ? "row-active" : ""}`}
                >
                  <span>{l.name}</span>
                  {l.shared && <span className="accession">Shared</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <p className="eyebrow mb-3">2 · Folder</p>

          {!location && <p className="accession">Choose a Drive first.</p>}

          {location && !folders && !error && <p className="accession">Loading…</p>}

          {folders && (
            <>
              {folders.length > 0 ? (
                <ul className="-mx-2.5 space-y-0.5">
                  {folders.map((f) => (
                    <li key={f.id}>
                      <button
                        onClick={() => {
                          setFolder(f);
                          setNewFolderName("");
                        }}
                        className={`row ${folder?.id === f.id ? "row-active" : ""}`}
                      >
                        <span>{f.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="accession">No folders here yet. Make one below.</p>
              )}

              <div className="mt-6">
                <label className="label" htmlFor="newFolder">
                  Or create a folder
                </label>
                <input
                  id="newFolder"
                  className="field"
                  value={newFolderName}
                  placeholder="Library books"
                  onChange={(e) => {
                    setNewFolderName(e.target.value);
                    if (e.target.value) setFolder(null);
                  }}
                />
              </div>
            </>
          )}
        </section>
      </div>

      {error && (
        <p
          role="alert"
          className="notice notice-error mt-8"
        >
          {error}
        </p>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-line pt-6">
        <button className="btn btn-primary" disabled={!ready || saving} onClick={save}>
          {saving ? "Saving…" : "Use this folder"}
        </button>
        {location && (
          <p className="accession">
            {location.name} / {folder?.name ?? (newFolderName || "…")}
          </p>
        )}
      </div>
    </div>
  );
}
