import type { Metadata } from "next";
import Link from "next/link";
import TopUpPanel from "@/components/TopUpPanel";
import { FIAT_CODE } from "@/lib/anchor/config";

export const metadata: Metadata = {
  title: "Add money · Paytag",
  description:
    "Turn a Turkish lira bank transfer into a balance you can pay a GitHub or X handle with.",
};

/**
 * The on-ramp.
 *
 * Its own page rather than a step inside the send form, because it is a
 * different length of time: sending is seconds and this waits on a bank. A
 * flow that might sit at "waiting for your transfer" for a while has no
 * business living inside the form somebody came to use right now — the send
 * form links here and gets on with its own job.
 */
export default function TopUpPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Add money</h1>
        <p className="mt-1.5 text-dim">
          A bank transfer in {FIAT_CODE}, a balance you can pay a handle with.
          No exchange, no wallet address.
        </p>
      </header>

      <TopUpPanel />

      <p className="px-1 text-xs text-mute">
        Already have a balance?{" "}
        <Link className="link" href="/send">
          Pay a handle
        </Link>
        .
      </p>
    </div>
  );
}
