import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { WalletProvider } from "@/components/WalletProvider";
import ThemeToggle, { THEME_INIT_SCRIPT } from "@/components/ThemeToggle";
import { IS_TESTNET, ESCROW_ID, explorerContract } from "@/lib/config";

export const metadata: Metadata = {
  title: "Paytag — pay a GitHub or X handle",
  description:
    "Pay someone who has no wallet, knowing nothing but their GitHub or X username. It waits in a Soroban escrow until the owner of the handle verifies the account and withdraws it.",
};

/**
 * Root layout: the document, the providers, and the two things every page
 * shares — the testnet strip and the footer.
 *
 * The header is NOT here. The site has two kinds of page and they want
 * different chrome: the landing page carries its own marketing header (one
 * button, no wallet), and everything under app/(app) gets the product header
 * with navigation and the account menu. Putting a single header here and then
 * hiding half of it per route is how a layout becomes a pile of conditions.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script below sets data-theme before
    // React sees the document, so the server markup and the DOM differ by that
    // one attribute on purpose.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <WalletProvider>
          <a className="skip-link" href="#main">
            Skip to content
          </a>

          {IS_TESTNET && (
            <p className="banner-warn">
              Test network — the money here is worth nothing.
            </p>
          )}

          {children}

          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 text-xs text-mute">
              <span>
                Escrow{" "}
                <a
                  className="mono link"
                  href={explorerContract(ESCROW_ID)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {ESCROW_ID.slice(0, 6)}…{ESCROW_ID.slice(-4)}
                </a>
                {/* The repository link goes here once the repo is public —
                    docs/SECURITY.md has the checklist that gates that. */}
                <span className="ml-3">MIT</span>
              </span>
              <ThemeToggle />
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
