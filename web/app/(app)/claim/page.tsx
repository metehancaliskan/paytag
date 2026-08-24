import type { Metadata } from "next";
import ClaimPanel from "@/components/ClaimPanel";

export const metadata: Metadata = {
  title: "Claim — Paytag",
  description:
    "Someone paid your GitHub handle. Verify the account, name a wallet, withdraw it.",
};

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ handle?: string; auth_error?: string }>;
}) {
  const { handle, auth_error: authError } = await searchParams;

  return (
    <div className="space-y-6">
      <header className="max-w-xl">
        <h1 className="text-3xl font-bold tracking-tight">Claim your escrow</h1>
        <p className="mt-2 text-dim">
          Verify the handle, name a wallet, withdraw. The money is already on
          chain waiting.
        </p>
      </header>

      <ClaimPanel hintHandle={handle} authError={authError} />
    </div>
  );
}
