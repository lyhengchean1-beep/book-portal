/**
 * pdf.js ships its worker as a separate file. Bundlers rewrite the default
 * worker path and it breaks at runtime, so we copy the worker into /public
 * and point GlobalWorkerOptions.workerSrc at "/pdf.worker.min.mjs".
 * Runs automatically on `npm install`.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, "");
const candidates = [
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "node_modules/pdfjs-dist/build/pdf.worker.mjs",
  "node_modules/pdfjs-dist/build/pdf.worker.min.js",
];

const source = candidates.map((c) => join(root, c)).find(existsSync);
if (!source) {
  console.warn("[pdf-worker] pdfjs-dist not installed yet - skipping copy.");
  process.exit(0);
}

mkdirSync(join(root, "public"), { recursive: true });
copyFileSync(source, join(root, "public/pdf.worker.min.mjs"));
console.log("[pdf-worker] copied worker -> public/pdf.worker.min.mjs");
