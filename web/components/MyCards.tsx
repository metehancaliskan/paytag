"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { useIdentity, identityList } from "./useIdentity";
import PersonCardView from "./PersonCard";
import { parseLink, type PersonCard } from "@/lib/cards";
import { isRoleKey } from "@/lib/roles";
import { kindLabel } from "@/lib/identity";

type Mine = { card: PersonCard; published: boolean };

/**
 * Your own cards, on your own profile — drafts included.
 *
 * The directory reads `public_cards`, which by design hides an unpublished
 * card from everyone. That makes it the wrong source here: the one reader who
 * must see a draft is its author. So this reads `cards` directly and lets row
 * level security answer — `cards_select_published` allows a row when it is
 * published *or* when it belongs to you.
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
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight">Your cards</h2>
        <Link className="btn btn-ghost btn-sm" href="/app/submit">
          {rows && rows.length > 0 ? "Edit" : "Write one"}
        </Link>
      </div>

      {rows === null ? (
        <div className="skeleton h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="card p-5 text-sm text-mute">
          No card yet. One role and two fields puts you in the directory — your
          handle is payable either way.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {rows.map(({ card, published }) => (
            <li key={`${card.kind}:${card.handle}`} className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="menu-label">
                  {kindLabel(card.kind)} · @{card.handle}
                </span>
                <span
                  className={`badge ${published ? "badge-claimed" : "badge-pending"}`}
                >
                  {published ? "listed" : "draft"}
                </span>
              </div>
              <PersonCardView card={card} preview />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
