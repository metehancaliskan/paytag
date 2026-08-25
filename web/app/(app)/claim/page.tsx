import type { Metadata } from "next";
import ClaimPanel from "@/components/ClaimPanel";
import { KIND_SLUG, isKindSlug } from "@/lib/identity";

export const metadata: Metadata = {
  title: "Claim — Paytag",
  description:
    "Someone paid your GitHub or X handle. Verify the account, name a wallet, withdraw it.",
};

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ handle?: string; on?: string; auth_error?: string }>;
}) {
  const { handle, on, auth_error: authError } = await searchParams;
  // A handle without its kind is ambiguous: `torvalds` on GitHub and `torvalds`
  // on X are two different tags that may belong to two different people. The
  // link that sent the reader here carries both.
  const hintKind = on !== undefined && isKindSlug(on) ? KIND_SLUG[on] : null;

  return (
    <div className="space-y-6">
      <header className="max-w-xl">
        <h1 className="text-3xl font-bold tracking-tight">Claim your escrow</h1>
        <p className="mt-2 text-dim">
          Each handle holds its own escrow.
        </p>
      </header>

      <ClaimPanel
        hintHandle={handle}
        hintKind={hintKind}
        authError={authError}
      />
    </div>
  );
}
