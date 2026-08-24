import type { ReactNode } from "react";
import Link from "next/link";
import WalletBar from "@/components/WalletBar";
import { NETWORK } from "@/lib/config";

/**
 * The product chrome. Everything behind "Open app" lives under this layout:
 * a header with the three places a signed-in person goes, and the account menu.
 *
 * Three links, not five. `Discover` is where money goes out, `Claim` is where
 * it comes in, `Proof` is the answer to "should I trust this" — and the two
 * personal pages (your card, your identity) hang off the account menu, where a
 * reader already looks for their own things.
 */
const NAV = [
  { href: "/app", label: "Discover" },
  { href: "/claim", label: "Claim" },
  { href: "/evidence", label: "Proof" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3">
          <Link href="/app" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-base font-black text-accent-fg">
              Pt
            </span>
            <span className="text-lg font-bold tracking-tight">Paytag</span>
            <span className="badge">{NETWORK}</span>
          </Link>

          <nav className="flex items-center gap-1" aria-label="Main">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-mute transition-colors hover:bg-raised hover:text-text"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto">
            <WalletBar />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        {children}
      </main>
    </>
  );
}
