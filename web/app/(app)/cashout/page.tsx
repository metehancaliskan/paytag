import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import CashOutPanel from "@/components/CashOutPanel";
import { FIAT_CODE } from "@/lib/anchor/config";

export const metadata: Metadata = {
  title: "Cash out · Paytag",
  description:
    "Turn the balance somebody paid your GitHub or X handle into Turkish lira in your bank account.",
};

/**
 * The off-ramp.
 *
 * The end of the sentence the product started: you were paid by name, you
 * proved the name was yours, and this is where the money stops being a balance
 * on a network and becomes lira in a bank account. It sits beside /claim
 * rather than inside it because the two answer to different clocks — a claim
 * is one signature, and this one waits on a bank.
 */
export default function CashOutPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Cash out</h1>
        <p className="mt-1.5 text-dim">
          What was paid to your handle, as {FIAT_CODE} in your bank account.
        </p>
      </header>

      {/* `?amount=` comes from the claim receipt, and a client component that
          reads the query cannot be prerendered without a boundary. */}
      <Suspense fallback={<div className="skeleton h-48 w-full" />}>
        <CashOutPanel />
      </Suspense>

      <p className="px-1 text-xs text-mute">
        Money still waiting on a handle?{" "}
        <Link className="link" href="/claim">
          Claim it first
        </Link>
        .
      </p>
    </div>
  );
}
