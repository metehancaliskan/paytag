import type { Metadata } from "next";
import Link from "next/link";
import ConnectPanel from "@/components/ConnectPanel";
import MyCards from "@/components/MyCards";

export const metadata: Metadata = {
  title: "Your profile — Paytag",
  description:
    "Verify a GitHub or X handle, write your card, and withdraw what people sent you.",
};

/**
 * Everything that is about *you*, on one page: which accounts you have proved
 * are yours, the cards hanging off them, and the two things you can do next.
 *
 * The identity rows come first on purpose. Nothing else on this page works
 * until at least one of them is verified — a card needs an identity to hang
 * off, and a claim needs one to pay out to.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const { auth_error: authError } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Your profile</h1>
        <p className="mt-2 text-dim">
          Prove an account is yours, say what you do, get paid for it.
        </p>
      </header>

      <ConnectPanel authError={authError} />

      <MyCards />

      <section className="card flex flex-wrap items-center gap-3 p-5">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Money waiting for you</h2>
          <p className="mt-0.5 text-sm text-mute">
            Escrow pays out to a wallet you name, one identity at a time.
          </p>
        </div>
        <Link className="btn btn-ghost" href="/claim">
          Go to claim
        </Link>
      </section>
    </div>
  );
}
