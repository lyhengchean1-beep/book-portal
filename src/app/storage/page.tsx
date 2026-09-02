import { redirect } from "next/navigation";
import { auth, canAdmin } from "@/auth";
import { prisma } from "@/lib/prisma";
import Nav from "@/components/Nav";
import YearPicker from "@/components/YearPicker";
import ConnectDriveButton from "@/components/ConnectDriveButton";

export const dynamic = "force-dynamic";

export default async function StoragePage() {
  const session = await auth();
  if (!session) redirect("/");
  if (!canAdmin(session.user.role)) redirect("/books");

  const ownerEmail = (process.env.DRIVE_OWNER_EMAIL ?? "").trim().toLowerCase();
  const envToken = Boolean((process.env.DRIVE_OWNER_REFRESH_TOKEN ?? "").trim());

  const owner = ownerEmail
    ? await prisma.user.findUnique({
        where: { email: ownerEmail },
        select: { driveRefreshToken: true },
      })
    : null;

  const connected = envToken || Boolean(owner?.driveRefreshToken);

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="eyebrow mb-3">Storage</p>
        <h1 className="max-w-2xl text-[clamp(2rem,5vw,3.25rem)]">The library Drive</h1>
        <p className="mt-4 max-w-xl text-ink-soft">
          Every book lives in one Google Drive, in one folder. Inside it, books are sorted
          by year and then by faculty. Nobody signing in is asked for Drive access — only
          the account below has it, and it does the filing for everyone.
        </p>

        <section className="mt-10 rounded-2xl border border-line bg-surface px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow mb-1.5">Library account</p>
              <p className="truncate text-lg">{ownerEmail || "Not configured"}</p>
              <p className="accession mt-1.5">
                {!ownerEmail
                  ? "Set DRIVE_OWNER_EMAIL in .env and restart."
                  : envToken
                    ? "Connected using DRIVE_OWNER_REFRESH_TOKEN from .env."
                    : connected
                      ? "Connected. Uploads are working."
                      : "Not connected yet — uploads will fail until it is."}
              </p>
            </div>

            {ownerEmail && !envToken && (
              <ConnectDriveButton ownerEmail={ownerEmail} connected={connected} />
            )}
          </div>

          {ownerEmail && !envToken && (
            <p className="accession mt-4 max-w-prose border-t border-line pt-4 leading-relaxed">
              This signs you out and in as {ownerEmail}, because it is that account&apos;s
              permission the portal stores. Google will warn that the app is unverified —
              choose Advanced, then continue. It happens once, to this one account, and
              never to anybody else.
            </p>
          )}
        </section>

        <div className="mt-14">
          <p className="eyebrow mb-3">Filing</p>
          <YearPicker />
        </div>
      </main>
    </>
  );
}