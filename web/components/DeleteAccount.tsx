"use client";

import { useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { useIdentity, identityList } from "./useIdentity";
import { kindUrlPrefix } from "@/lib/identity";

/**
 * Deleting the account.
 *
 * It is here at the bottom of the profile, behind a disclosure, in the one
 * colour the interface reserves for damage — and it is genuinely available,
 * because an account you cannot leave is not an account, it is a trap.
 *
 * The honest part is the list. People expect "delete" to mean the money is
 * gone; here it means the opposite, and saying so is what makes the button
 * safe to press:
 *
 *   - the handle is released, and anyone can verify it next
 *   - the cards are gone, and the escrow is not
 *
 * Confirmation is the handle, typed. A second button gets clicked; a handle
 * has to be read first.
 *
 * On success the page is replaced rather than re-rendered: every other panel on
 * screen is holding data for an account that no longer exists, and a reload is
 * the only way to be sure none of it is still believed.
 */
export default function DeleteAccount({ empty }: { empty: string }) {
  const { identity } = useIdentity();
  const mine = identityList(identity);

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A signed-in account with no verified handle is a real account — the OAuth
  // callback writes the profile before the identity, so a verification that
  // failed halfway leaves one. It used to be undeletable: this panel asked for
  // a handle to type and there was none, so it rendered the empty line and the
  // person was stuck with an account they could not remove. The API already
  // accepts the word "delete" for exactly this case.
  const orphan = identity.status === "anon" && identity.signedIn;

  if (!orphan && (identity.status !== "verified" || mine.length === 0)) {
    return <p className="text-sm text-mute">{empty}</p>;
  }

  // Every verified handle, not just the first. With two of them, being asked to
  // type "one of your handles" and shown only one is a riddle.
  const target = orphan ? "delete" : mine[0].handle;
  const ready = typed.trim().replace(/^@/, "").toLowerCase() === target;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: typed }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not delete the account.");

      // The server cleared its cookies; this clears what the browser kept, so
      // no stale session survives in local storage.
      try {
        await browserSupabase()?.auth.signOut();
      } catch {
        // The user is already gone; nothing here is worth reporting.
      }
      window.location.replace("/app?deleted=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the account.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        className="btn btn-ghost btn-sm text-danger"
        onClick={() => setOpen(true)}
      >
        Delete my account
      </button>
    );
  }

  return (
    <section className="card border-danger/40 p-5">
      <ul className="space-y-1.5 text-sm text-dim">
        {orphan ? (
          <li>
            This account has no verified handle, so there is nothing to release
            and no card to lose.
          </li>
        ) : (
          <>
            <li>
              {/* Both handles, named. With two verified and only one shown, the
                  list reads as though the other one survives. */}
              {mine.map((v, i) => (
                <span key={v.id}>
                  {i > 0 && " and "}
                  <span className="font-semibold text-text">
                    {kindUrlPrefix(v.kind)}
                    {v.handle}
                  </span>
                </span>
              ))}{" "}
              {mine.length > 1 ? "are" : "is"} released — anyone can verify{" "}
              {mine.length > 1 ? "them" : "it"} after you.
            </li>
            <li>Your cards, both of them if you have two, are gone for good.</li>
            <li>
              Escrow is untouched. It belongs to the handle, so verifying again
              makes it claimable again.
            </li>
          </>
        )}
      </ul>

      <label className="mt-4 block">
        <span className="text-xs text-mute">
          Type <span className="mono">{orphan ? target : `@${target}`}</span> to
          confirm
        </span>
        <input
          className="field mono mt-1"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={orphan ? target : `@${target}`}
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          className="btn btn-danger btn-sm"
          onClick={() => void remove()}
          disabled={busy || !ready}
        >
          {busy && <span className="spinner" aria-hidden />}
          {busy ? "Deleting…" : "Delete it"}
        </button>
        <button
          className="btn btn-quiet btn-sm"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
          disabled={busy}
        >
          Keep my account
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
