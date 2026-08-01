import { redirect } from "next/navigation";
import { auth, canUpload } from "@/auth";
import { prisma } from "@/lib/prisma";
import Nav from "@/components/Nav";
import StoragePicker from "@/components/StoragePicker";

export const dynamic = "force-dynamic";

export default async function StoragePage() {
  const session = await auth();
  if (!session) redirect("/");
  if (!canUpload(session.user.role)) redirect("/books");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { folderName: true, driveName: true },
  });

  const current =
    user?.folderName && user?.driveName ? `${user.driveName} / ${user.folderName}` : null;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="eyebrow mb-3">Storage</p>
        <h1 className="max-w-2xl text-[clamp(2rem,5vw,3.25rem)]">
          Where should your books go?
        </h1>
        <p className="mt-4 max-w-xl text-ink-soft">
          Pick a folder in your own Google Drive, or in a Shared Drive if you have one.
          Every book you add lands there, and the portal opens each file for viewing so
          readers do not need a Google account.
        </p>

        <div className="mt-12">
          <StoragePicker currentFolderName={current} />
        </div>
      </main>
    </>
  );
}
