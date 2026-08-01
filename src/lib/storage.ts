import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

/**
 * First-page thumbnails live on our own disk, not on Drive.
 * Drive's thumbnailLink expires after a few hours and is rate limited, so it
 * is the wrong thing to hang a browse grid on.
 */
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const THUMB_DIR = join(DATA_DIR, "thumbnails");

export async function saveThumbnail(bookId: string, dataUrl: string) {
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Thumbnail is not a data URL.");
  await mkdir(THUMB_DIR, { recursive: true });
  await writeFile(join(THUMB_DIR, `${bookId}.jpg`), Buffer.from(base64, "base64"));
}

export async function readThumbnail(bookId: string) {
  try {
    return await readFile(join(THUMB_DIR, `${bookId}.jpg`));
  } catch {
    return null;
  }
}

export async function deleteThumbnail(bookId: string) {
  try {
    await unlink(join(THUMB_DIR, `${bookId}.jpg`));
  } catch {
    /* already gone */
  }
}
