import type { Metadata } from "next";
import Link from "next/link";
import ClaimPanel from "@/components/ClaimPanel";
import { ANCHOR_ENABLED, FIAT_CODE } from "@/lib/anchor/config";
import { KIND_SLUG, isKindSlug } from "@/lib/identity";

export const metadata: Metadata = {
  title: "Claim · Paytag",
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
    // A narrow column, like Settings. Two rows stretched across a 1900px
    // display put the handle at one edge and its amount at the other, with a
    // hand's width of nothing between them — the page read as a bar, not a
    // list. Nothing here needs more than a reading measure.
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Claim your money</h1>
        <p className="mt-1.5 text-dim">Each handle holds its own balance.</p>
      </header>

      <ClaimPanel
        hintHandle={handle}
        hintKind={hintKind}
        authError={authError}
      />

      {/* The step after this one, named before the reader has to go looking
          for it. Claiming leaves a balance on a network; this is where it
          stops being that. */}
      {ANCHOR_ENABLED && (
        <p className="px-1 text-xs text-mute">
          Already claimed?{" "}
          <Link className="link" href="/cashout">
            Cash out to {FIAT_CODE} in your bank
          </Link>
          .
        </p>
      )}
    </div>
  );
}
