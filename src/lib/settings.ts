import { prisma } from "@/lib/prisma";

/**
 * Installation-wide settings. Small enough that a key/value table beats a
 * migration every time a new one appears.
 */

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export const KEYS = {
  yearFolderId: "driveYearFolderId",
  yearFolderName: "driveYearFolderName",
} as const;
