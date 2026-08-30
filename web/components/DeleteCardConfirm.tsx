"use client";

import { useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { kindUrlPrefix, type IdentityKind } from "@/lib/identity";

/**
 * "Delete this card?" — the panel, and the delete itself.
 *
 * One component for both places a card can be deleted from: the list in
 * Settings and the card's own page. The panel is what carries the promise that
 * escrow is untouched, and that sentence is the whole reason this is not two
 * copies: a reassurance that drifts between two screens is worse than no
 * reassurance, because the reader cannot tell which one is out of date.
 *
 * The delete goes straight from the browser, unlike disconnecting a handle, and
 * the difference is not convenience: `cards_delete_own` in db/schema.sql allows
 * a delete only where `profile_id = auth.uid()`, so the rule that decides this
 * lives in the database and a request forged from another session removes
 * nothing. Disconnecting needs a server route because row level security gives
 * users no write access to `identities` at all; cards are deliberately not like
 * that, because the person who wrote the words owns them.
 */
export default function DeleteCardConfirm({
  identityId,
  kind,
  handle,
  onDeleted,
  onCancel,
}: {
  identityId: string;
  kind: IdentityKind;
  handle: string;
  /** Called once the database has agreed. Never optimistically. */
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const supabase = useMemo(() => browserSupabase(), []);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function remove() {
    if (!supabase) return;
    setBusy(true);
    setFailed(null);
    try {
      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("identity_id", identityId);
      if (error) throw new Error(error.message);
      onDeleted();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Could not delete that card.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full rounded-lg border border-danger/40 p-3 text-sm">
      <p className="font-semibold">
        Delete the{" "}
        <span className="mono">
          {kindUrlPrefix(kind)}
          {handle}
        </span>{" "}
        card?
      </p>
      <p className="mt-1 text-mute">
        The text goes, for good. Your handle stays verified, your payout address
        stays set, and escrow is untouched: money is bound to the handle on
        chain, not to this card. You can write a new one whenever you like.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={busy}
          onClick={() => void remove()}
        >
          {busy && <span className="spinner" aria-hidden />}
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={busy}
          onClick={onCancel}
        >
          Keep it
        </button>
      </div>
      {failed && (
        <p role="alert" className="mt-3 text-danger">
          {failed}
        </p>
      )}
    </div>
  );
}
