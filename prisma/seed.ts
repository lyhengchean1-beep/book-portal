import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Edit this list to match your institution's actual faculty structure.
// `code` is what shows on the record card, so keep it to 3-4 characters.
const FACULTIES = [
  { code: "AGR", name: "Agronomy" },
  { code: "AVM", name: "Animal Science and Veterinary Medicine" },
  { code: "AER", name: "Agricultural Economics and Rural Development" },
  { code: "FIS", name: "Fisheries" },
  { code: "FOR", name: "Forestry" },
  { code: "AGI", name: "Agro-Industry" },
  { code: "LMA", name: "Land Management and Administration" },
  { code: "AET", name: "Agricultural Engineering and Technology" },
];

async function main() {
  for (const f of FACULTIES) {
    await prisma.faculty.upsert({
      where: { code: f.code },
      update: { name: f.name },
      create: f,
    });
  }
  console.log(`Seeded ${FACULTIES.length} faculties.`);

  // Promote the first admin listed in SEED_ADMIN_EMAIL, if that user has signed in.
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
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
