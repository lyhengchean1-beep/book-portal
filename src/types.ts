/**
 * Role is declared here rather than imported from @prisma/client so that the
 * app still typechecks before `prisma generate` has run (CI, fresh clone).
 * The values match the enum in prisma/schema.prisma exactly.
 */
export type Role = "VIEWER" | "UPLOADER" | "ADMIN";
