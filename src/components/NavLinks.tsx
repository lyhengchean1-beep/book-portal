"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Highlights the section you are in. Split out of Nav because knowing the
 * current path needs the client, while the session lookup needs the server.
 */
export default function NavLinks({ canUpload }: { canUpload: boolean }) {
  const pathname = usePathname();

  const links = [
    { href: "/books", label: "Catalogue" },
    ...(canUpload
      ? [
          { href: "/upload", label: "Add a book" },
          { href: "/storage", label: "Storage" },
        ]
      : []),
  ];

  return (
    <nav className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors sm:px-2.5 ${
              active ? "bg-tint text-signal-deep" : "text-ink-soft hover:text-ink"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
