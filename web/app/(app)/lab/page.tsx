import type { Metadata } from "next";
import Link from "next/link";
import LabPanel from "@/components/LabPanel";

export const metadata: Metadata = {
  title: "Lab · Paytag",
  description:
    "An experiment: an escrow that lends the money from the moment it is deposited.",
  // Not a page for anyone but us.
  robots: { index: false, follow: false },
};

/**
 * The laboratory.
 *
 * Paytag's escrow holds money still until somebody claims it. This page asks
 * what the other version would look like — the one where the deposit is lent
 * the instant it arrives and the waiting itself pays — and answers it against
 * a real pool with real money rather than in an argument.
 *
 * It is wired to its own contract and shares nothing with the product: no
 * storage, no contract id, no code. Deposits here do not appear on any other
 * screen, and claims here need no verified handle, because the question was
 * about the money and not about the identities.
 *
 * What it found is written up in docs/LAB-YIELD-ESCROW.md, including the
 * reasons not to ship it.
 */
export default function LabPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <span className="badge badge-pending">experiment</span>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          An escrow that lends while it waits
        </h1>
        <p className="mt-1.5 text-dim">
          The deposit goes into a lending pool in the same transaction that
          creates it. Whoever ends up with the money gets what it earned.
        </p>
      </header>

      <LabPanel />

      <div className="card p-5 text-sm text-dim">
        <h2 className="font-semibold text-text">What this is not</h2>
        <p className="mt-2">
          It is not the escrow Paytag uses. That one holds the money still, pays
          out only against a verifier signature proving the claimant owns the
          handle, and can prove it is solvent by looking at one balance. This
          contract does none of those three things: it lends, it believes
          whatever address you hand it, and knowing whether it can pay means
          asking somebody else&rsquo;s pool what a position is worth.
        </p>
        <p className="mt-2">
          The first two are because the experiment was about the money. The
          third is not a shortcut — it is the actual cost of the idea, and it
          is the reason this page exists separately instead of as a switch on
          the real one.
        </p>
        <p className="mt-3">
          <Link className="link" href="/claim">
            Back to the product
          </Link>
        </p>
      </div>
    </div>
  );
}
