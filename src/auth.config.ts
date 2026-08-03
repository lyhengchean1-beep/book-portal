import type { NextAuthConfig, DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import type { Role } from "@/types";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role } & DefaultSession["user"];
  }
}

/** Who may sign in at all. Blank means any Google account, anywhere. */
export const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/**
 * What an ordinary sign-in asks for.
 *
 * All three are non-sensitive, so Google shows no unverified-app warning, the
 * app needs no verification, and there is no 100-user cap. That is what lets
 * anybody with a Google account use the library.
 *
 * Drive is deliberately absent. It is a restricted scope, and asking every
 * visitor for it is what produced the red warning screen - as well as being far
 * more access than a reader needs. Only the library account grants it, once,
 * from the Storage page.
 */
const BASE_SCOPES = ["openid", "email", "profile"];

/** Requested only by the "Connect the library Drive" action. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

/** Scope string for that one action: the basics plus Drive. */
export const OWNER_SCOPES = [...BASE_SCOPES, DRIVE_SCOPE].join(" ");

/**
 * The half of the config that must run on the Edge runtime, because
 * middleware.ts imports it. Nothing here may touch Prisma, Node APIs, or the
 * filesystem. The database-backed callbacks live in auth.ts.
 */
export const authConfig = {
  providers: [
    Google({
      authorization: {
        params: {
          scope: BASE_SCOPES.join(" "),
          // Narrows Google's account picker to one domain. Undefined when
          // ALLOWED_EMAIL_DOMAINS is blank, which is the open case.
          hd: allowedDomains[0] || undefined,
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/", error: "/" },
  callbacks: {
    signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      if (!email || !profile?.email_verified) return false;
      if (!allowedDomains.length) return true;
      return allowedDomains.some((d) => email.endsWith(`@${d}`));
    },

    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      if (token.role) session.user.role = token.role as Role;
      return session;
    },
  },
} satisfies NextAuthConfig;