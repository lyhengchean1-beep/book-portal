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
 * How long a sign-in lasts, in hours. Default 8 - one working day.
 *
 * The library is read on shared computers, and NextAuth's own default of 30
 * days means the next person to sit down is still signed in as whoever used it
 * last. Making the cookie expire on browser close is not an option: Chrome
 * restores cookies on restart, so a session cookie outlives the window anyway.
 * A short lifetime is the only thing that actually works.
 */
const SESSION_HOURS = Number(process.env.SESSION_HOURS ?? 8) || 8;
const SESSION_MAX_AGE = SESSION_HOURS * 60 * 60;

const BASE_SCOPES = ["openid", "email", "profile"];

/** Requested only by the "Connect the library Drive" action. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

/** Scope string for that one action: the basics plus Drive. */
export const OWNER_SCOPES = [...BASE_SCOPES, DRIVE_SCOPE].join(" ");

export const authConfig = {
  providers: [
    Google({
      authorization: {
        params: {
          scope: BASE_SCOPES.join(" "),
          // Always show the account chooser. Without this, Google silently
          // reuses whichever account is already signed in to the browser - so
          // on a shared machine the portal session expiring achieves nothing,
          // because the next click signs the same person straight back in.
          prompt: "select_account",
          hd: allowedDomains[0] || undefined,
        },
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE,
    // Rolling: the clock resets on activity, at most once an hour. Somebody
    // reading for a whole afternoon is never thrown out mid-book, while an
    // abandoned session dies SESSION_HOURS after the last page view.
    updateAge: 60 * 60,
  },

  // Kept in step with the cookie, so a stolen token cannot outlive the session
  // it belongs to.
  jwt: { maxAge: SESSION_MAX_AGE },

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