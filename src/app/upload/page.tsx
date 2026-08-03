import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, canUpload, canAdmin } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROOT_FOLDER_NAME, activeYearFolderName } from "@/lib/drive";
import Nav from "@/components/Nav";
import UploadForm from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const session = await auth();
  if (!session) redirect("/");

  if (!canUpload(session.user.role)) {
    return (
      <>
        <Nav />
        <main className="mx-auto max-w-2xl px-6 py-20">
          <h1 className="text-4xl">Your account can read, but not add</h1>
          <p className="mt-4 text-ink-soft">
            Ask a library administrator to give {session.user.email} upload access, then
            sign out and back in.
          </p>
        </main>
      </>
    );
  }

  // No folder to choose any more - everyone writes to the same library Drive,
  // so the old redirect to /storage on first upload is gone.
  const [faculties, year] = await Promise.all([
    prisma.faculty.findMany({ orderBy: { name: "asc" } }),
    activeYearFolderName(),
  ]);
  const maxMb = Number(process.env.MAX_UPLOAD_MB ?? 50);

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="eyebrow mb-3">New record</p>
        <h1 className="max-w-2xl text-[clamp(2rem,5vw,3.25rem)]">Add a book</h1>
        <p className="mt-4 max-w-xl text-ink-soft">
          Check that page one looks right before you save. The file is filed under{" "}
          {ROOT_FOLDER_NAME} / {year} /{" "}
          <span className="whitespace-nowrap">the faculty you choose</span>, and the link
          is opened for viewing straight away.{" "}
          {canAdmin(session.user.role) && (
            <Link href="/storage" className="underline hover:text-signal">
              Change the year
            </Link>
          )}
        </p>

        <div className="mt-12">
          <UploadForm faculties={faculties} maxMb={maxMb} />
        </div>
      </main>
    </>
  );
}
