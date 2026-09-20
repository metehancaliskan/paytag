"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The three verbs, and which one you are looking at.
 *
 * A header that does not say where you are makes every page look like the same
 * page — which on a product with three destinations is most of the navigation
 * gone. The active link is the one thing here that needs the client, and it is
 * the whole reason this is not part of the layout.
 *
 * `startsWith` rather than equality so a nested page keeps its parent lit:
 * `/p/gh/torvalds` is still Dashboard as far as a reader is concerned.
 */
const NAV = [
  { href: "/app", label: "Dashboard" },
  { href: "/send", label: "Send" },
  { href: "/claim", label: "Claim" },
];

export default function HeaderNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="Main">
      {NAV.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={active ? "nav-link nav-link-active" : "nav-link"}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
