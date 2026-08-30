"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { useIdentity, identityList } from "./useIdentity";
import { GithubMark, XMark } from "./icons";
import { parseLink, type PersonCard } from "@/lib/cards";
import { roleForKind } from "@/lib/roles";
import { KIND, kindUrlPrefix, slugOf } from "@/lib/identity";

type Mine = { identityId: string; card: PersonCard; published: boolean };

/**
 * Your own cards, in Settings — drafts included.
 *
 * The directory reads `public_cards`, which by design hides an unpublished card
 * from everyone. That makes it the wrong source here: the one reader who must
 * see a draft is its author. So this reads `cards` directly and lets row level
 * security answer — `cards_select_published` allows a row when it is published
 * *or* when it belongs to you.
 *
 * One row per card, not a rendered preview. In a settings column a card preview
 * is both too wide and beside the point: what a reader needs here is which
 * handle, listed or draft, the way in to edit it and the way to take it down.
 * The preview belongs where the card is actually seen — the dashboard and
 * /p/<kind>/<handle>.
 */
export default function MyCards({ empty }: { empty: string }) {
  const supabase = useMemo(() => browserSupabase(), []);
  const { identity } = useIdentity();
  const mine = identityList(identity);
  const [rows, setRows] = useState<Mine[] | null>(null);

  // Which row is asking to be deleted, by identity id — null is the resting
  // state. Keyed on the id rather than on kind:handle for the same reason the
  // fetch below is: it is the id that the delete statement carries.
  const [leaving, setLeaving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Keyed on the ROW IDS, not on kind:handle. Every write this feeds uses
  // `v.id`; a handle deleted and re-verified keeps the same kind:handle and gets
  // a new id, so a key built from the name would leave the dead id in place and
  // every upsert would be refused by row level security.
  const key = mine.map((v) => v.id).join(",");

  useEffect(() => {
    if (!supabase || mine.length === 0) return;
    let alive = true;

    void (async () => {
      try {
        // The identities are already in hand — `useIdentity` fetched them once
        // for the page, row ids included. This used to ask for the session and
        // the identity rows again, which is two requests for an answer that was
        // on screen before this component mounted.
        const { data: cards } = await supabase
          .from("cards")
          .select("identity_id, headline, summary, ecosystems, links, published")
          .in(
            "identity_id",
            mine.map((v) => v.id),
          );

        if (!alive) return;

        const out: Mine[] = [];
        for (const row of cards ?? []) {
          const c = row as Record<string, unknown>;
          const match = mine.find((v) => v.id === c.identity_id);
          if (!match) continue;

          out.push({
            identityId: match.id,
            published: c.published !== false,
            card: {
              kind: match.kind,
              handle: match.handle,
              identityKey: match.identityHex,
              displayName: null,
              // Derived from the platform (lib/roles.ts), like every other
              // place a role is shown.
              role: roleForKind(match.kind),
              headline: typeof c.headline === "string" ? c.headline : null,
              summary: typeof c.summary === "string" ? c.summary : null,
              ecosystems: Array.isArray(c.ecosystems)
                ? c.ecosystems.filter((e): e is string => typeof e === "string")
                : [],
              links: Array.isArray(c.links)
                ? c.links.map(parseLink).filter((l) => l !== null)
                : [],
              updatedAt: null,
              hasCard: true,
              linked: [],
            },
          });
        }
        setRows(out);
      } catch {
        if (alive) setRows([]);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, key]);

  /**
   * Deletes one card.
   *
   * Straight from the browser, unlike disconnecting a handle, and the
   * difference is not convenience: `cards_delete_own` in db/schema.sql allows a
   * delete only where `profile_id = auth.uid()`, so the rule that decides this
   * lives in the database. A request forged from another session removes
   * nothing, whatever this component does. Disconnecting needs a server route
   * because row level security gives users no write access to `identities` at
   * all; cards are deliberately not like that — the person who wrote the words
   * owns them.
   *
   * The card is the only thing that goes. The identity row, the payout address
   * and the escrow are all keyed elsewhere, which is why this needs no typed
   * confirmation the way disconnecting the last handle does.
   */
  async function remove(identityId: string) {
    if (!supabase) return;
    setBusy(true);
    setFailed(null);
    try {
      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("identity_id", identityId);
      if (error) throw new Error(error.message);

      // The row leaves the list only after the database has agreed. An
      // optimistic removal would show the card gone on a delete that was
      // refused, and the next reload would bring it back — the worst of both
      // answers on a screen whose whole job is telling you what is published.
      setRows((prev) => (prev ?? []).filter((r) => r.identityId !== identityId));
      setLeaving(null);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Could not delete that card.");
    } finally {
      setBusy(false);
    }
  }

  if (identity.status !== "verified") {
    return <p className="text-sm text-mute">{empty}</p>;
  }

  // The verified handle with no card yet, so "write the other one" opens that
  // one rather than whichever the editor would have led with.
  const missing =
    rows === null
      ? null
      : (mine.find(
          (v) => !rows.some((r) => r.card.kind === v.kind),
        ) ?? null);

  return (
    <div className="space-y-3">
      {rows === null ? (
        <div className="skeleton h-16 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-mute">
          No card yet. A role and two fields puts you in the directory — your
          handle is payable either way.
        </p>
      ) : (
        <ul className="card divide-y divide-line">
          {rows.map(({ identityId, card, published }) => (
            <li
              key={identityId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4"
            >
              {card.kind === KIND.XUser ? (
                <XMark size={14} className="shrink-0 text-dim" />
              ) : (
                <GithubMark size={16} className="shrink-0 text-dim" />
              )}
              {/* The platform, not just the name: someone else's X handle can
                  be spelled exactly like your GitHub one, and this list is
                  where you decide which card to edit. */}
              <span className="mono font-semibold">
                {kindUrlPrefix(card.kind)}
                {card.handle}
              </span>
              <span
                className={`badge ${published ? "badge-claimed" : "badge-pending"}`}
              >
                {published ? "listed" : "draft"}
              </span>
              <Link
                className="link ml-auto text-sm"
                href={`/p/${slugOf(card.kind)}/${card.handle}`}
              >
                View
              </Link>
              {/* The platform travels with the link. Without it, "Edit" beside
                  the X card opened the GitHub one — the editor leads with
                  whichever identity is first. */}
              <Link
                className="btn btn-ghost btn-sm"
                href={`/app/submit?for=${slugOf(card.kind)}`}
              >
                Edit
              </Link>
              {/* The same red-on-quiet as Disconnect in ConnectPanel, and the
                  same reasoning: destructive enough to be marked, not
                  destructive enough to be filled. The one filled red in the
                  product belongs to ending an account (globals.css), and
                  spending it here would teach the reader to stop reading it. */}
              <button
                type="button"
                className="btn btn-quiet btn-sm text-danger"
                aria-expanded={leaving === identityId}
                onClick={() => {
                  setLeaving(leaving === identityId ? null : identityId);
                  setFailed(null);
                }}
              >
                Delete
              </button>
              <p className="w-full truncate text-sm text-mute">
                {card.headline}
              </p>

              {/* The confirm, in place — beside the card it removes rather than
                  in a dialog over the page, so the handle you are about to
                  strip is still on screen while you decide. What survives is
                  spelled out before the button that does it, because the
                  reasonable fear here ("does this cost me my escrow?") has a
                  reassuring answer and saying it is cheaper than a typed
                  confirmation would be. */}
              {leaving === identityId && (
                <div className="w-full rounded-lg border border-danger/40 p-3 text-sm">
                  <p className="font-semibold">
                    Delete the{" "}
                    <span className="mono">
                      {kindUrlPrefix(card.kind)}
                      {card.handle}
                    </span>{" "}
                    card?
                  </p>
                  <p className="mt-1 text-mute">
                    The text goes, for good. Your handle stays verified, your
                    payout address stays set, and escrow is untouched — money is
                    bound to the handle on chain, not to this card. You can
                    write a new one whenever you like.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busy}
                      onClick={() => void remove(identityId)}
                    >
                      {busy && <span className="spinner" aria-hidden />}
                      {busy ? "Deleting…" : "Delete"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      disabled={busy}
                      onClick={() => {
                        setLeaving(null);
                        setFailed(null);
                      }}
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
              )}
            </li>
          ))}
        </ul>
      )}

      {rows !== null && rows.length < mine.length && (
        <Link
          className="btn btn-ghost btn-sm"
          href={`/app/submit${missing ? `?for=${slugOf(missing.kind)}` : ""}`}
        >
          {rows.length === 0 ? "Write one" : "Write the other one"}
        </Link>
      )}
    </div>
  );
}
