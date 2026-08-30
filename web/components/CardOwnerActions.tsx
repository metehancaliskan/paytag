"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import DeleteCardConfirm from "./DeleteCardConfirm";
import { identityList, useIdentity } from "./useIdentity";
import { slugOf, type IdentityKind } from "@/lib/identity";

/**
 * Edit and Delete, on the card's own page, and only for the person whose card
 * it is.
 *
 * Settings had the only way in, which made a round trip out of a typo: you are
 * looking at the sentence you want to change, and the way to change it is on
 * another screen. The controls belong where the thing they act on is.
 *
 * OWNERSHIP IS DECIDED IN THE BROWSER, and it has to be: /p/<kind>/<handle> is
 * a public page rendered on the server for everyone alike, and who is reading
 * it is a fact about the session, not about the URL. So this renders nothing at
 * all until `useIdentity` says one of the reader's verified handles is this
 * one.
 *
 * That check is a convenience, not a protection, and the distinction matters.
 * Anyone can make these buttons appear with a devtools console; what stops the
 * delete is `cards_delete_own` in the database, which answers to the session's
 * `auth.uid()` and not to what the page decided to draw.
 */
export default function CardOwnerActions({
  kind,
  handle,
  /** With no card yet, the only thing to offer is the way to write one. */
  variant = "card",
}: {
  kind: IdentityKind;
  handle: string;
  variant?: "card" | "empty";
}) {
  const router = useRouter();
  const { identity } = useIdentity();
  const [confirming, setConfirming] = useState(false);

  const mine =
    identityList(identity).find(
      (v) => v.kind === kind && v.handle === handle,
    ) ?? null;

  if (!mine) return null;

  const editHref = `/app/submit?for=${slugOf(kind)}`;

  if (variant === "empty") {
    return (
      <Link className="btn btn-ghost btn-sm mt-3" href={editHref}>
        Write one
      </Link>
    );
  }

  return (
    <>
      <div className="ml-auto flex items-center gap-2">
        <Link className="btn btn-ghost btn-sm" href={editHref}>
          Edit
        </Link>
        <button
          type="button"
          className="btn btn-danger-quiet btn-sm"
          aria-expanded={confirming}
          onClick={() => setConfirming((v) => !v)}
        >
          Delete
        </button>
      </div>

      {/* A sibling rather than a child, and `w-full` inside the header's
          flex-wrap row: the confirmation needs the card's whole width to say
          what survives, and squeezing it beside two buttons would cost it the
          sentence that does the reassuring. */}
      {confirming && (
        <DeleteCardConfirm
          identityId={mine.id}
          kind={kind}
          handle={handle}
          onCancel={() => setConfirming(false)}
          onDeleted={() => {
            setConfirming(false);
            // The page is server-rendered, so the card only goes away when the
            // server draws it again. Without this the reader deletes a card and
            // keeps looking at it.
            router.refresh();
          }}
        />
      )}
    </>
  );
}
