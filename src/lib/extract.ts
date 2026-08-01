/**
 * Reads the title and author off a book cover.
 *
 * Heuristics do not survive contact with these covers: a Cambodian thesis cover
 * puts the university seal behind the text, prints everything twice in Khmer and
 * English, and hides the student's name inside the seal at small size. The
 * largest glyph on the page is usually the institution, not the title. So the
 * rendered page goes to a vision model instead, which also means scanned PDFs
 * with no text layer work exactly like digital ones.
 */

import { titleCase } from "@/lib/text";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export class NoExtractorError extends Error {}

export type Extracted = { title: string | null; author: string | null };

const PROMPT = `You are cataloguing the cover page of a work held by a university library in Cambodia.

These covers are usually bilingual Khmer and English. They normally carry a university seal, the institution name, a faculty name, a degree or programme line, a supervisor, and a date. None of those are what you are asked for.

Return exactly two fields:

title - the title of the work itself. If the cover shows it in both Khmer and English, return the English wording. Never return the university name, the faculty name, the degree, or the year.

author - the personal name of the student or author. It is often printed inside or beside the seal, sometimes in both scripts. If both scripts appear, return the Latin-script form using normal capitalisation rather than block capitals. If the cover labels a supervisor or adviser separately, that is not the author.

Text on the page may overlap the seal artwork; read through it. If a field genuinely does not appear on the page, return an empty string for it. Do not guess and do not invent.`;

/** "PON KAKADA" -> "Pon Kakada". Left alone if it is already mixed case. */
function normaliseName(value: string) {
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s\-'\u2019])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function clean(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length >= 2 ? text.slice(0, max) : null;
}

export async function extractCoverFields(opts: {
  /** Base64 JPEG of page one, without the data-URL prefix. */
  imageBase64: string;
  /** Page-one text layer, if the PDF has one. Empty string for scans. */
  text: string;
}): Promise<Extracted> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new NoExtractorError("GEMINI_API_KEY is not set.");

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const parts: Record<string, unknown>[] = [
    { inline_data: { mime_type: "image/jpeg", data: opts.imageBase64 } },
    { text: PROMPT },
  ];

  // The text layer is a cross-check, not the primary source. It arrives in
  // reading order rather than visual order, so it is useful for spelling and
  // useless for working out which line is the title.
  if (opts.text.trim()) {
    parts.push({
      text: `For spelling only, here is the text layer of the same page:\n\n${opts.text.slice(0, 4000)}`,
    });
  }

  const res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { title: { type: "STRING" }, author: { type: "STRING" } },
          required: ["title", "author"],
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof raw !== "string") return { title: null, author: null };

  const parsed = JSON.parse(raw) as { title?: unknown; author?: unknown };
  const author = clean(parsed.author, 200);

  const title = clean(parsed.title, 300);

  return {
    // Covers are set in full capitals. Stored that way, a long title is close
    // to unreadable at heading size, so it is normalised on the way in.
    title: title ? titleCase(title) : null,
    author: author ? normaliseName(author) : null,
  };
}
