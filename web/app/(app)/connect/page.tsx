import type { Metadata } from "next";
import ConnectPanel from "@/components/ConnectPanel";

export const metadata: Metadata = {
  title: "Connect GitHub — Paytag",
  description:
    "Prove a GitHub handle is yours, so escrow paid to it can be withdrawn to a wallet you name.",
};

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const { auth_error: authError } = await searchParams;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Your identity</h1>
      <ConnectPanel authError={authError} />
    </div>
  );
}
