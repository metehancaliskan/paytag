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
 * THEY LIVE IN A STRIP AT THE FOOT OF THE CARD, which is where the directory
 * row already puts its tip buttons: a hairline, then the actions, safe one on
 * the left and destructive one pushed to the far right. They were beside the
 * badges first and it was wrong twice over. The card sits in a 20rem column, so
 * the pair wrapped onto a line of its own and floated between the badges and
 * the headline with nothing to belong to; and controls above a card's title
 * read as a toolbar for the page rather than for the card. Underneath, after
 * the text they act on, they are unmistakably about this card.
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
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <Link className="btn btn-ghost btn-sm" href={editHref}>
        Edit
      </Link>
      {/* Pushed to the far end, away from Edit. The two are one slip apart
          otherwise, and only one of them can be undone. */}
      <button
        type="button"
        className="btn btn-danger-quiet btn-sm ml-auto"
        aria-expanded={confirming}
        onClick={() => setConfirming((v) => !v)}
      >
        Delete
      </button>

      {/* `w-full` in this flex-wrap row drops the confirmation onto its own
          line: it needs the card's whole width to say what survives, and
          squeezing it beside two buttons would cost it the sentence that does
          the reassuring. */}
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
    </div>
  );
}
