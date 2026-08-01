import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const [books, faculties] = await Promise.all([
    prisma.book.count({ where: { status: "READY" } }).catch(() => 0),
    prisma.faculty.count().catch(() => 0),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center px-6 py-16">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-signal font-mono text-xs text-white">
          BP
        </span>
        <span className="font-display text-lg font-bold tracking-tight">Book Portal</span>
      </div>

      <h1 className="mt-10 max-w-3xl text-[clamp(2.75rem,8vw,5.5rem)]">
        Put a book where
        <br />
        everyone can <span className="text-signal">read it.</span>
      </h1>

      <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink-soft">
        Upload a PDF, tag it with the faculty it belongs to, and it becomes readable from
        any browser — no account needed to open it, no file passed around on a flash
        drive.
      </p>

      <form
        className="mt-10"
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/books" });
        }}
      >
        <button type="submit" className="btn btn-primary">
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
            <path
              fill="currentColor"
              d="M21.35 11.1h-9.17v2.98h5.27c-.23 1.37-1.6 4.02-5.27 4.02a5.9 5.9 0 0 1 0-11.8c1.7 0 2.84.72 3.5 1.35l2.38-2.3A9 9 0 1 0 12.18 21c5.2 0 8.64-3.65 8.64-8.8 0-.6-.06-1.05-.15-1.5Z"
            />
          </svg>
          Sign in with Google
        </button>
      </form>

      <dl className="mt-16 flex flex-wrap gap-x-14 gap-y-5 border-t border-line pt-6">
        <div>
          <dt className="accession">Books available</dt>
          <dd className="mt-1 font-display text-3xl">{books}</dd>
        </div>
        <div>
          <dt className="accession">Faculties</dt>
          <dd className="mt-1 font-display text-3xl">{faculties}</dd>
        </div>
        <div>
          <dt className="accession">Stored in</dt>
          <dd className="mt-1 font-display text-3xl">Google Drive</dd>
        </div>
      </dl>
    </main>
  );
}
