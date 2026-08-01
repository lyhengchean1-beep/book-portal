import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

// Edge-safe instance: authConfig deliberately excludes anything Prisma-backed.
const { auth } = NextAuth(authConfig);

/** Everything except the landing page and the auth endpoints needs a session. */
export default auth((req) => {
  const isSignedIn = Boolean(req.auth);
  const { pathname } = req.nextUrl;

  if (!isSignedIn && pathname !== "/") {
    const url = new URL("/", req.nextUrl.origin);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isSignedIn && pathname === "/") {
    return NextResponse.redirect(new URL("/books", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|pdf.worker.min.mjs).*)"],
};
