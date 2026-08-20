import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { driveViewUrl } from "@/lib/links";

export const runtime = "nodejs";

/**
 * Escapes one CSV field.
 *
 * The leading-apostrophe guard matters: a title starting with = + - or @ is
 * treated as a formula by Excel and Google Sheets, which is how a spreadsheet
 * export turns into a code execution problem. Prefixing forces it to text.
 */
function cell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Parses a yyyy-mm-dd date from the query string.
 *
 * `end` is pushed to the following midnight so that a range of 1 May to 31 May
 * includes everything added on the 31st. Comparing against 00:00 on the 31st
 * would silently drop that whole day, which is the classic off-by-one in date
 * range filters.
 */
function parseDate(value: string | null, endOfDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

/**
 * GET /api/books/export?faculty=<id>&q=<text>&from=yyyy-mm-dd&to=yyyy-mm-dd
 *
 * Every book that is live and shared, as a CSV. Honours whatever filter the
 * catalogue is showing, so you export what you are looking at. All four
 * parameters are optional and combine.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const { searchParams } = new URL(req.url);
  const facultyId = searchParams.get("faculty") ?? undefined;
  const query = searchParams.get("q")?.trim();
  const from = parseDate(searchParams.get("from"));
  const to = parseDate(searchParams.get("to"), true);

  const books = await prisma.book.findMany({
    where: {
      status: "READY",
      driveFileId: { not: null },
      ...(facultyId ? { facultyId } : {}),
      ...(query
        ? { OR: [{ title: { contains: query } }, { author: { contains: query } }] }
        : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
        : {}),
    },
    include: { faculty: true, uploadedBy: { select: { name: true, email: true } } },
    omit: { thumbnail: true },
    orderBy: [{ createdAt: "desc" }, { title: "asc" }],
  });

  const header = [
    "Title",
    "Author",
    "Faculty",
    "Pages",
    "Link",
    "Added by",
    "Added on",
  ];

  type Row = {
    title: string;
    author: string;
    pageCount: number | null;
    driveFileId: string | null;
    createdAt: Date;
    faculty: { name: string };
    uploadedBy: { name: string | null; email: string };
  };

  const rows = (books as Row[]).map((b) => [
    b.title,
    b.author,
    b.faculty.name,
    b.pageCount ?? "",
    driveViewUrl(b.driveFileId as string),
    b.uploadedBy.name ?? b.uploadedBy.email,
    b.createdAt.toISOString().slice(0, 10),
  ]);

  // CRLF line endings and a UTF-8 BOM, so Excel opens Khmer titles correctly
  // instead of showing them as mojibake.
  const csv =
    "\uFEFF" +
    [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") +
    "\r\n";

  // Name the file after the range when there is one, so a folder full of
  // exports stays readable.
  const today = new Date().toISOString().slice(0, 10);
  const span =
    from || to
      ? `${searchParams.get("from") || "start"}_to_${searchParams.get("to") || today}`
      : today;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="book-links-${span}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
