import type { Metadata } from "next";
import ConnectPanel from "@/components/ConnectPanel";
import PayoutPanel from "@/components/PayoutPanel";
import MyCards from "@/components/MyCards";
import DeleteAccount from "@/components/DeleteAccount";

export const metadata: Metadata = {
  title: "Profile — Paytag",
  description:
    "Your verified handles, where your escrow pays out, and your cards.",
};

/**
 * Everything that is about *you*, on one page: which accounts you proved are
 * yours, where their money lands, the cards hanging off them, and the way out.
 *
 * Read as settings rather than as a landing page — labels and rows, no
 * paragraphs. The order is the order of dependency: the identities come first
 * because nothing else here works until one is verified, the payout address
 * next because it decides where a claim can pay, then the cards, and leaving
 * last.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const { auth_error: authError } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">Profile</h1>

      <ConnectPanel authError={authError} />

      <PayoutPanel />

      <MyCards />

      <DeleteAccount />
    </div>
  );
}
