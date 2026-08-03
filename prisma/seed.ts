import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * `code` is both the label on the record card and the name of the folder on
 * Drive, so the two cannot drift apart and `driveFolder` is no longer needed.
 *
 * Every code below is a folder that already exists inside each year folder, so
 * nothing new gets created. Names are the university's own, from
 * rua.edu.kh/faculties.
 */
const FACULTIES: { code: string; name: string }[] = [
  { code: "AGR", name: "Faculty of Agronomy" },
  { code: "ANS", name: "Faculty of Animal Science" },
  { code: "VM", name: "Faculty of Veterinary Medicine" },
  { code: "DVM", name: "Department of Veterinary Medicine" },
  { code: "FOR", name: "Faculty of Forestry" },
  { code: "FIS", name: "Faculty of Fisheries and Aquaculture" },
  { code: "AGE", name: "Faculty of Agricultural Biosystems Engineering" },
  { code: "AERD", name: "Faculty of Agricultural Economics and Rural Development" },
  { code: "AGI", name: "Faculty of Agro-Industry" },
  { code: "LMA", name: "Faculty of Land Management and Land Administration" },
  { code: "MS", name: "Graduate School (Master's)" },
  { code: "PHD", name: "Graduate School (PhD)" },
];

/**
 * Old code -> new code, for the three faculties whose codes changed.
 *
 * Renaming the existing row rather than creating a new one is the whole point:
 * a Book holds a facultyId, so a rename keeps every book already filed under
 * the old code attached to it, while a fresh row would strand them.
 */
const RENAMES: Record<string, string> = {
  AER: "AERD", // Agricultural Economics and Rural Development
  AET: "AGE", // Agricultural Engineering -> Agricultural Biosystems Engineering
  AVM: "ANS", // the combined faculty is now Animal Science; VM and DVM are separate
};

async function renameFaculty(oldCode: string, newCode: string) {
  const existing = await prisma.faculty.findUnique({ where: { code: oldCode } });
  if (!existing) return;

  const target = FACULTIES.find((f) => f.code === newCode);
  if (!target) return;

  const clash = await prisma.faculty.findUnique({ where: { code: newCode } });
  if (clash) {
    const books = await prisma.book.count({ where: { facultyId: existing.id } });
    console.warn(
      `!  ${oldCode} cannot become ${newCode}: ${newCode} already exists. ` +
        `${books} book(s) still point at ${oldCode}.`,
    );
    return;
  }

  await prisma.faculty.update({
    where: { id: existing.id },
    data: { code: newCode, name: target.name, driveFolder: null },
  });
  console.log(`Renamed ${oldCode} -> ${newCode}.`);
}

async function main() {
  for (const [oldCode, newCode] of Object.entries(RENAMES)) {
    await renameFaculty(oldCode, newCode);
  }

  for (const f of FACULTIES) {
    await prisma.faculty.upsert({
      where: { code: f.code },
      // driveFolder cleared: the code is the folder name now.
      update: { name: f.name, driveFolder: null },
      create: { code: f.code, name: f.name },
    });
  }
  console.log(`Seeded ${FACULTIES.length} faculties.`);

  // Anything left over is a code this list does not know about - usually a
  // leftover from an earlier seed. Reported rather than deleted, because books
  // may still be attached to it.
  const extras = await prisma.faculty.findMany({
    where: { code: { notIn: FACULTIES.map((f) => f.code) } },
  });
  for (const e of extras) {
    const books = await prisma.book.count({ where: { facultyId: e.id } });
    console.warn(
      `!  ${e.code} (${e.name}) is not in the list and has ${books} book(s). ` +
        `Move them, then delete the faculty by hand.`,
    );
  }

  // Promote the admin named in SEED_ADMIN_EMAIL, if that user has signed in.
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail) {
    const updated = await prisma.user.updateMany({
      where: { email: adminEmail },
      data: { role: "ADMIN" },
    });
    console.log(
      updated.count
        ? `Promoted ${adminEmail} to ADMIN.`
        : `${adminEmail} has not signed in yet - run this again after their first sign-in.`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());