/**
 * Every Drive URL is derived from the file ID at render time.
 * Nothing but the ID is stored in the database.
 */

/** Embeddable viewer. Renders inside an iframe on our own page. */
export function drivePreviewUrl(fileId: string) {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

/** Full Drive viewer page, opened in a new tab. */
export function driveViewUrl(fileId: string) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * Direct download straight from Google. Fast, but it bypasses our server so
 * downloads are not counted. Use /api/books/:id/download instead when you
 * want the count, or when DOWNLOADS_ENABLED may be turned off later.
 */
export function driveDownloadUrl(fileId: string) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}
