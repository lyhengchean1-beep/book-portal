import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Book Portal — Faculty Library",
  description: "Add a book to the shared library, or find one by faculty.",
};

// Explicit on purpose: this layout already hand-authors a <head> below for
// font links, and Next.js's own metadata/viewport resolution is what merges
// tags like this into that <head> - relying on the implicit framework
// default here leaves it unclear whether every page is actually getting a
// device-width viewport rather than a fixed one, which is the difference
// between a page that reflows on a phone and one that renders desktop-sized
// and gets shrunk to fit.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Noto+Sans+Khmer:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}