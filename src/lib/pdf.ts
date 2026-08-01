import { z } from "zod";

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024;

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

/**
 * A browser-reported MIME type and a .pdf extension are both trivially
 * spoofable. The only check that means anything is the file header.
 */
export function looksLikePdf(bytes: Buffer) {
  return bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

/** Title, author and faculty. Everything else is read from the file itself. */
export const bookMetadataSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters").max(300),
  author: z.string().trim().min(2, "Author must be at least 2 characters").max(200),
  facultyId: z.string().trim().min(1, "Choose a faculty"),
  pageCount: z.coerce.number().int().positive().optional(),
});

export type BookMetadata = z.infer<typeof bookMetadataSchema>;

/** Validates the uploaded file itself. Returns a human-readable reason on failure. */
export function validatePdf(file: File | null, head: Buffer | null): string | null {
  if (!file) return "Attach a PDF file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${
      MAX_UPLOAD_BYTES / 1024 / 1024
    } MB.`;
  }
  if (head && !looksLikePdf(head)) {
    return "That file is not a PDF. Only PDF files can be added to the library.";
  }
  return null;
}