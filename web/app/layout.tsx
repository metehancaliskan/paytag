import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { WalletProvider } from "@/components/WalletProvider";
import { IS_TESTNET } from "@/lib/config";

export const metadata: Metadata = {
  title: "Paytag · pay a GitHub or X handle",
  description:
    "Pay someone who has no wallet, knowing nothing but their GitHub or X username. A Soroban contract holds it until the owner of the handle verifies the account and withdraws it.",
};

/**
 * Root layout: the document, the providers, and the one thing every page
 * shares — the testnet strip.
 *
 * THE THEME IS THE SYSTEM'S. There is no switch and no stored preference: the
 * palette in `globals.css` swaps on `prefers-color-scheme` and nothing else. A
 * three-way Light/Dark/Auto control asks a reader to make a decision they have
 * already made once, in their operating system, and it was the only reason this
 * document needed an inline script and `suppressHydrationWarning`. Both are
 * gone with it.
 *
 * No footer either. It held a contract link and a licence word under every
 * screen — a strip nobody came for, on a page whose job is the one above it.
 *
 * The header is NOT here. The site has two kinds of page and they want
 * different chrome: the landing page carries its own marketing header (one
 * button, no wallet), and everything under app/(app) gets the product header
 * with navigation and the account menu. Putting a single header here and then
 * hiding half of it per route is how a layout becomes a pile of conditions.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        <WalletProvider>
          <a className="skip-link" href="#main">
            Skip to content
          </a>

          {IS_TESTNET && (
            <p className="banner-warn">
              Test network. The money here is worth nothing.
            </p>
          )}

          {children}

        </WalletProvider>
      </body>
    </html>
  );
}
