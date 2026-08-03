import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/types";

/**
 * What a new account gets. UPLOADER lets people add books; VIEWER only read.
 */
const DEFAULT_ROLE: Role =
  (process.env.DEFAULT_ROLE ?? "").trim().toUpperCase() === "UPLOADER" ? "UPLOADER" : "VIEWER";

/**
 * Which domains DEFAULT_ROLE applies to. Blank means everyone who can sign in.
 *
 * This is the gate that matters once ALLOWED_EMAIL_DOMAINS is empty: sign-in
 * open to the world is fine - readers are why the library exists - but writing
 * into the university's Drive should not be. Set this to rua.edu.kh and a
 * stranger can browse and read while only staff and students can upload.
 */
const uploaderDomains = (process.env.UPLOADER_EMAIL_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/** Named accounts that get UPLOADER whatever the rules above say. */
const bootstrapUploaders = (process.env.BOOTSTRAP_UPLOADER_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function grantedRole(email: string): Role {
  if (bootstrapUploaders.includes(email)) return "UPLOADER";
  if (DEFAULT_ROLE !== "UPLOADER") return "VIEWER";
  if (!uploaderDomains.length) return "UPLOADER";
  return uploaderDomains.some((d) => email.endsWith(`@${d}`)) ? "UPLOADER" : "VIEWER";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,

    async jwt({ token, profile, account }) {
      if (profile?.sub && profile.email) {
        const email = profile.email.toLowerCase();
        const granted = grantedRole(email);

        const user = await prisma.user.upsert({
          where: { googleSub: profile.sub },
          update: {
            email,
            name: profile.name,
            image: profile.picture as string | undefined,
            // Prisma skips undefined, so an ordinary sign-in - which no longer
            // asks for Drive and so returns no refresh token - leaves the
            // library account's stored token untouched.
            driveRefreshToken: account?.refresh_token ?? undefined,
          },
          create: {
            googleSub: profile.sub,
            email,
            name: profile.name,
            image: profile.picture as string | undefined,
            role: granted,
            driveRefreshToken: account?.refresh_token ?? undefined,
          },
        });

        // Raise an existing VIEWER to whatever the policy now grants; never
        // lower an UPLOADER or ADMIN, so a promotion made by hand survives
        // every later sign-in.
        let role = user.role as Role;
        if (role === "VIEWER" && granted !== "VIEWER") {
          const raised = await prisma.user.update({
            where: { id: user.id },
            data: { role: granted },
            select: { role: true },
          });
          role = raised.role as Role;
        }

        token.uid = user.id;
        token.role = role;
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

/** Changing the year folder is an installation-wide change, so admins only. */
export function canAdmin(role?: Role) {
  return role === "ADMIN";
}