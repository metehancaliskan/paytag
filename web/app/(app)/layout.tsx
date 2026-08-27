import type { ReactNode } from "react";
import Link from "next/link";
import WalletBar from "@/components/WalletBar";
import IdentityProvider from "@/components/IdentityProvider";
import Logo from "@/components/Logo";
import { Sliders } from "@/components/icons";
import { NETWORK } from "@/lib/config";

/**
 * The product chrome. Everything behind "Open app" lives under this layout:
 * a header with the three places a signed-in person goes, and the account menu.
 *
 * Three links, and they are the three verbs: `Dashboard` is who can be paid,
 * `Send` is paying a handle you already know, `Claim` is money coming in. The
 * personal pages (your card, your identity) hang off Settings, where a reader
 * already looks for their own things.
 */
const NAV = [
  { href: "/app", label: "Dashboard" },
  { href: "/send", label: "Send" },
  { href: "/claim", label: "Claim" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    // One identity fetch for the whole product, here rather than in each of the
    // eight components that need it. Settings alone used to ask five times, with
    // five loading states that could contradict each other on screen.
    <IdentityProvider>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3">
          <Link href="/app" className="flex items-center gap-2.5">
            <Logo size={30} />
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

          <div className="ml-auto flex items-center gap-2">
            {/* Settings is a destination, not a menu item hidden inside the
                account chip. Everything personal lives on one page, so the way
                to it is on every page. */}
            <Link
              href="/profile"
              aria-label="Settings"
              title="Settings"
              className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-mute transition-colors hover:border-line-strong hover:text-text"
            >
              <Sliders />
            </Link>
            <WalletBar />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        {children}
      </main>
    </IdentityProvider>
  );
}
