import Link from "next/link";
import { auth, canUpload, canAdmin, signOut } from "@/auth";
import NavLinks from "./NavLinks";

export default async function Nav() {
  const session = await auth();
  if (!session) return null;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:gap-6 sm:px-6 sm:py-3">
        <Link
          href="/books"
          className="flex shrink-0 items-center gap-2 font-display text-lg font-bold tracking-tight"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-signal font-mono text-xs text-white">
            BP
          </span>
          {/* The mark alone on a phone. Three nav links plus a wordmark plus an
              action does not fit at 360px, and the badge still identifies it. */}
          <span className="hidden sm:inline">Book Portal</span>
        </Link>

        <NavLinks
          canUpload={canUpload(session.user.role)}
          canAdmin={canAdmin(session.user.role)}
        />

        <div className="flex shrink-0 items-center gap-3">
          <span className="accession hidden max-w-[22ch] truncate lg:inline">
            {session.user.email}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="rounded-lg px-2 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:text-alert sm:px-2.5"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
