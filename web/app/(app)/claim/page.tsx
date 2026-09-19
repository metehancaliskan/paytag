import type { Metadata } from "next";
import Link from "next/link";
import ClaimPanel from "@/components/ClaimPanel";
import EarnPanel from "@/components/EarnPanel";
import { AssetMark, ChevronRight } from "@/components/icons";
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

      {/* The third answer to "now what", under the two that already exist on
          this page. It renders nothing at all without a connected wallet or a
          configured pool, so a reader who has not claimed anything never sees
          it. */}
      <EarnPanel />

      {/* The step after this one, and the whole point of the product for the
          person on this page: claiming leaves a balance on a network they did
          not ask to be on, and this is where it stops being that.

          A card rather than the grey sentence it was. That sentence was the
          last line on the busiest screen in the app, in the quietest colour
          available — which is where you put something you do not want read. */}
      {ANCHOR_ENABLED && (
        <Link
          href="/cashout"
          className="card group flex items-center gap-3.5 p-4 transition-colors hover:border-accent"
        >
          <AssetMark asset="TRY" size={34} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Cash out to your bank</span>
              <span className="badge badge-claimed">new</span>
            </span>
            <span className="mt-0.5 block text-xs text-mute">
              What you claimed, as {FIAT_CODE} in a Turkish bank account. No
              exchange in between.
            </span>
          </span>
          <ChevronRight className="shrink-0 text-mute transition-colors group-hover:text-accent-text" />
        </Link>
      )}
    </div>
  );
}
