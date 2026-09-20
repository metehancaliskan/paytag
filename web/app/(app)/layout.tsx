import type { ReactNode } from "react";
import Link from "next/link";
import WalletBar from "@/components/WalletBar";
import IdentityProvider from "@/components/IdentityProvider";
import HeaderNav from "@/components/HeaderNav";
import IdentityChips from "@/components/IdentityChips";
import Logo from "@/components/Logo";
import { NETWORK } from "@/lib/config";

/**
 * The product chrome. Everything behind "Open app" lives under this layout.
 *
 * Three things sit in the header and they are the three questions a reader has
 * on every screen: where can I go (the nav), who have I proved I am (the
 * identity chips), and what am I holding (the wallet). The first two used to
 * be one list inside the account dropdown, which hid the half of the product
 * that decides whether any of the money is yours.
 *
 * ONE ROW OR TWO. The row order here is deliberate rather than whatever
 * wrapping produced: the mark and the wallet stay together on the first line
 * at every width, because those are the two things a reader looks for when
 * they arrive and when they are about to sign something. The nav and the chips
 * take a second full-width line on a phone (`order-3`, `w-full`) and rejoin
 * the first from `sm` up. Everything renders once — a second WalletBar for a
 * second breakpoint would mean two balance fetches and two dropdowns that can
 * disagree.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    // One identity fetch for the whole product, here rather than in each of the
    // eight components that need it. Settings alone used to ask five times, with
    // five loading states that could contradict each other on screen.
    <IdentityProvider>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3 sm:gap-x-6 sm:px-5">
          <Link
            href="/app"
            className="mr-auto flex items-center gap-2.5 sm:mr-0"
          >
            <Logo size={38} />
            <span className="text-2xl font-bold tracking-tight">Paytag</span>
            {/* The banner above this header already says the money is not
                real; on a phone the badge is the third label in a row that
                has no room for three. */}
            <span className="badge hidden sm:inline-flex">{NETWORK}</span>
          </Link>

          <div className="order-3 flex w-full items-center gap-2 sm:order-none sm:w-auto sm:flex-1">
            <HeaderNav />
            <IdentityChips className="ml-auto" />
          </div>

          <WalletBar />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-5 sm:py-8">
        {children}
      </main>
    </IdentityProvider>
  );
}
