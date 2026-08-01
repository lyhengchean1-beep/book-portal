import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/types";

/** These accounts get UPLOADER on first sign-in. Everyone else starts as VIEWER. */
const bootstrapUploaders = (process.env.BOOTSTRAP_UPLOADER_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,

    /**
     * Runs in the Node runtime only. On the first sign-in `profile` is present,
     * so this is where our own user row is created and the role is stamped onto
     * the token for the middleware to read later.
     */
    async jwt({ token, profile, account }) {
      if (profile?.sub && profile.email) {
        const email = profile.email.toLowerCase();
        const user = await prisma.user.upsert({
          where: { googleSub: profile.sub },
          update: {
            email,
            name: profile.name,
            image: profile.picture as string | undefined,
            // Prisma skips undefined, so a sign-in that returns no refresh
            // token leaves the stored one intact rather than erasing it.
            driveRefreshToken: account?.refresh_token ?? undefined,
          },
          create: {
            googleSub: profile.sub,
            email,
            name: profile.name,
            image: profile.picture as string | undefined,
            role: bootstrapUploaders.includes(email) ? "UPLOADER" : "VIEWER",
            driveRefreshToken: account?.refresh_token ?? undefined,
          },
        });
        token.uid = user.id;
        token.role = user.role;
      }
      return token;
    },
  },
});

export function canUpload(role?: Role) {
  return role === "UPLOADER" || role === "ADMIN";
}

export function canDelete(role?: Role) {
  return role === "ADMIN";
}
