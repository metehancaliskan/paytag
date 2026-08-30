import type { Metadata } from "next";
import SentPanel from "@/components/SentPanel";

export const metadata: Metadata = {
  title: "Sent by me · Paytag",
  description:
    "Payments you sent, and the ones you can take back because nobody claimed them.",
};

/**
 * The way back to money nobody claimed.
 *
 * `refund` was reachable from exactly one place before this page: the
 * recipient's own profile, in the payment list, on the row you sent. That works
 * only if you remember who you sent it to. The contract indexes payments by
 * neither sender nor recipient, so a sender who forgot the handle had no route
 * to their own money anywhere in the product, and nothing anywhere told them a
 * window had closed.
 *
 * NO SIGN-IN, and that is not a shortcut. `refund(payment_id)` asks the chain
 * for one thing, the original sender's signature; a Paytag account has nothing
 * to do with it. Requiring one would put an account between somebody and money
 * that is already theirs. Claiming is the opposite and needs the account,
 * because proving a handle is the whole job there.
 */
export default function SentPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Sent by me</h1>
        <p className="mt-1.5 text-dim">
          Payments you sent. When a claim window closes, you can take the money
          back here.
        </p>
      </header>

      <SentPanel />
    </div>
  );
}
