import type { NextAuthConfig, DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import type { Role } from "@/types";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role } & DefaultSession["user"];
  }
}

/** Comma-separated list, e.g. "rua.edu.kh". Empty means any Google account. */
export const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

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
          // Drive access is requested at sign-in, so there is no service
          // account to configure and no Shared Drive to arrange in advance.
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/drive",
          ].join(" "),
          // offline + consent is what makes Google return a refresh token.
          // Without both, uploads stop working an hour after sign-in.
          access_type: "offline",
          prompt: "consent",
          // Google shows only accounts from this domain in the picker. A
          // convenience, not a control - the signIn callback is the gate.
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
