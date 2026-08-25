import type { Metadata } from "next";
import Link from "next/link";
import CardEditor from "@/components/CardEditor";
import { KIND_SLUG, isKindSlug } from "@/lib/identity";

export const metadata: Metadata = {
  title: "Submit yourself — Paytag",
  description:
    "Say what you contribute to the Stellar ecosystem, and let people pay your handle for it.",
};

export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string; auth_error?: string }>;
}) {
  // `?for=gh|x` — which handle the card is being written for. It is how the
  // OAuth round trip comes back to the question it left on: the sign-in this
  // page starts sets `next=/app/submit?for=x`, so the reader returns with X
  // already selected instead of having to pick it again.
  const { for: on, auth_error: authError } = await searchParams;
  const hintKind = on !== undefined && isKindSlug(on) ? KIND_SLUG[on] : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/app"
          className="inline-block text-sm text-mute hover:text-text"
        >
          ← Back to everyone
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Submit yourself
        </h1>
        {/* Two fields, not three: the role is not typed any more, it comes with
            the handle. A subtitle that still promised "a role" was counting a
            question the form no longer asks. */}
        <p className="mt-2 max-w-xl text-dim">
          Pick a handle, fill two fields. It puts you in the list, where people
          pay that handle.
        </p>
      </div>

      <CardEditor hintKind={hintKind} authError={authError} />
    </div>
  );
}
