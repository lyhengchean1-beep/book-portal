"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Folder = { id: string; name: string };

/**
 * The root folder is fixed by DRIVE_ROOT_FOLDER_ID and shown, not chosen. The
 * only decision left is which year inside it new books are filed under.
 */
export default function YearPicker() {
  const router = useRouter();

  const [root, setRoot] = useState<Folder | null>(null);
  const [years, setYears] = useState<Folder[] | null>(null);
  const [active, setActive] = useState<Folder | null>(null);
  const [choice, setChoice] = useState<Folder | null>(null);
  const [newYear, setNewYear] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/drive/years")
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error);
        setRoot(json.root);
        setYears(json.years);
        setActive(json.active);
        setChoice(json.active);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function save() {
    if (!choice && !newYear.trim()) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch("/api/drive/years", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: newYear.trim() ? undefined : choice?.id,
          newFolderName: newYear.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      setActive(json.active);
      setChoice(json.active);
      setNewYear("");
      setYears((prev) =>
        prev && !prev.some((y) => y.id === json.active.id) ? [json.active, ...prev] : prev,
      );
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that year.");
    } finally {
      setSaving(false);
    }
  }

  const target = newYear.trim() || choice?.name;
  const changed = Boolean(target && target !== active?.name);

  return (
    <div>
      <p className="notice mb-8">
        {active
          ? `New books are filed under ${root?.name ?? "the library folder"} / ${active.name} / the faculty's folder. Books already in the library stay where they are.`
          : "Reading the library folder from Google Drive…"}
      </p>

      <div className="grid gap-10 md:grid-cols-2 md:gap-14">
        <section>
          <p className="eyebrow mb-3">Library folder</p>
          {root ? (
            <>
              <p className="text-lg">{root.name}</p>
              <p className="accession mt-2">
                Fixed for every account. Change it by editing DRIVE_ROOT_FOLDER_ID and
                restarting.
              </p>
            </>
          ) : (
            !error && <p className="accession">Loading…</p>
          )}
        </section>

        <section>
          <p className="eyebrow mb-3">Year</p>

          {!years && !error && <p className="accession">Loading…</p>}

          {years && (
            <>
              {years.length > 0 ? (
                <ul className="-mx-2.5 space-y-0.5">
                  {years.map((y) => (
                    <li key={y.id}>
                      <button
                        onClick={() => {
                          setChoice(y);
                          setNewYear("");
                          setSaved(false);
                        }}
                        className={`row ${!newYear && choice?.id === y.id ? "row-active" : ""}`}
                      >
                        <span>{y.name}</span>
                        {active?.id === y.id && <span className="accession">In use</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="accession">
                  No folders inside the library folder yet. Make the first one below.
                </p>
              )}

              <div className="mt-6">
                <label className="label" htmlFor="newYear">
                  Or start a new year
                </label>
                <input
                  id="newYear"
                  className="field"
                  value={newYear}
                  placeholder={String(new Date().getFullYear() + 1)}
                  onChange={(e) => {
                    setNewYear(e.target.value);
                    setSaved(false);
                  }}
                />
                <p className="accession mt-2">
                  A folder with this name is used if it already exists, and created if it
                  does not.
                </p>
              </div>
            </>
          )}
        </section>
      </div>

      {error && (
        <p role="alert" className="notice notice-error mt-8">
          {error}
        </p>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-line pt-6">
        <button className="btn btn-primary" disabled={!changed || saving} onClick={save}>
          {saving ? "Saving…" : "File new books here"}
        </button>
        {target && (
          <p className="accession">
            {root?.name} / {target} / faculty
          </p>
        )}
        {saved && !changed && <p className="accession">Saved.</p>}
      </div>
    </div>
  );
}
