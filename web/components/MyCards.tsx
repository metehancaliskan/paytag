"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { useIdentity, identityList } from "./useIdentity";
import { GithubMark, XMark } from "./icons";
import { parseLink, type PersonCard } from "@/lib/cards";
import { isRoleKey } from "@/lib/roles";
import { KIND, slugOf } from "@/lib/identity";

type Mine = { card: PersonCard; published: boolean };

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
 * handle, listed or draft, and the way in to edit it. The preview belongs where
 * the card is actually seen — the dashboard and /p/<kind>/<handle>.
 */
export default function MyCards() {
  const supabase = useMemo(() => browserSupabase(), []);
  const { identity } = useIdentity();
  const mine = identityList(identity);
  const [rows, setRows] = useState<Mine[] | null>(null);

  // A stable key, so the effect re-runs when the identity set actually changes
  // rather than on every render that produces a new array.
  const key = mine.map((v) => `${v.kind}:${v.handle}`).join(",");

  useEffect(() => {
    if (!supabase || mine.length === 0) return;
    let alive = true;

    void (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return;

        const { data: ids } = await supabase
          .from("identities")
          .select("id, kind, handle")
          .eq("profile_id", auth.user.id);
        if (!ids?.length) {
          if (alive) setRows([]);
          return;
        }

        const { data: cards } = await supabase
          .from("cards")
          .select("identity_id, role, headline, summary, ecosystems, links, published")
          .in(
            "identity_id",
            ids.map((i) => (i as { id: string }).id),
          );

        if (!alive) return;

        const out: Mine[] = [];
        for (const row of cards ?? []) {
          const c = row as Record<string, unknown>;
          const owner = ids.find(
            (i) => (i as { id: string }).id === c.identity_id,
          ) as { kind: number; handle: string } | undefined;
          const match = mine.find(
            (v) => v.kind === owner?.kind && v.handle === owner?.handle,
          );
          if (!match) continue;

          out.push({
            published: c.published !== false,
            card: {
              kind: match.kind,
              handle: match.handle,
              identityKey: match.identityHex,
              displayName: null,
              role: isRoleKey(c.role) ? c.role : null,
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

  if (identity.status !== "verified") return null;

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
          {rows.map(({ card, published }) => (
            <li
              key={`${card.kind}:${card.handle}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4"
            >
              {card.kind === KIND.XUser ? (
                <XMark size={14} className="shrink-0 text-dim" />
              ) : (
                <GithubMark size={16} className="shrink-0 text-dim" />
              )}
              <span className="font-semibold">@{card.handle}</span>
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
              <Link className="btn btn-ghost btn-sm" href="/app/submit">
                Edit
              </Link>
              <p className="w-full truncate text-sm text-mute">
                {card.headline}
              </p>
            </li>
          ))}
        </ul>
      )}

      {rows !== null && rows.length < mine.length && (
        <Link className="btn btn-ghost btn-sm" href="/app/submit">
          {rows.length === 0 ? "Write one" : "Write the other one"}
        </Link>
      )}
    </div>
  );
}
