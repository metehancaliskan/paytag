import "server-only";

import { serverSupabase } from "./supabase/server";
import { CARD_COLUMNS, toPersonCard, type PersonCard } from "./cards";
import { isRoleKey, type RoleKey } from "./roles";
import { KIND, type IdentityKind } from "./identity";

/**
 * Reads of the public directory.
 *
 * These go through the cookie-bound client, not the service role: the
 * `public_cards` view runs with `security_invoker`, so row level security is
 * what decides what comes back. An unpublished card is therefore invisible to
 * everyone except its owner, and that rule lives in the database rather than in
 * a `where` clause somebody can forget.
 *
 * Every function degrades to empty rather than throwing. A directory that
 * cannot be read should show "nothing here yet" — the send and claim flows do
 * not depend on it, and taking the whole page down for a database hiccup would
 * be worse than a thin page.
 */

export async function listCards(
  filter: { role?: RoleKey | null; kind?: IdentityKind | null } = {},
  limit = 60,
): Promise<PersonCard[]> {
  const sb = await serverSupabase();
  if (!sb) return [];

  let q = sb
    .from("public_cards")
    .select(CARD_COLUMNS)
    .eq("has_card", true)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (isRoleKey(filter.role)) q = q.eq("role", filter.role);
  if (filter.kind === KIND.GithubUser || filter.kind === KIND.XUser) {
    q = q.eq("kind", filter.kind);
  }

  const { data, error } = await q;
  if (error || !data) return [];
  return data.map(toPersonCard).filter((c): c is PersonCard => c !== null);
}

/** The card for one identity, or null when that handle has none. */
export async function getCard(
  kind: IdentityKind,
  handle: string,
): Promise<PersonCard | null> {
  const sb = await serverSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("public_cards")
    .select(CARD_COLUMNS)
    .eq("kind", kind)
    .eq("handle", handle)
    .maybeSingle();

  if (error || !data) return null;
  return toPersonCard(data);
}

/**
 * How many people are listed, split both ways.
 *
 * One query rather than four: the filter needs every count at once, and asking
 * the database five times to draw one row of chips is how a directory starts
 * feeling slow. The rows are tiny — two columns, one per listed card.
 */
export type DirectoryCounts = {
  total: number;
  role: Record<RoleKey, number>;
  kind: Record<"github" | "x", number>;
};

export async function countCards(): Promise<DirectoryCounts> {
  const zero: DirectoryCounts = {
    total: 0,
    role: { shiller: 0, dev: 0 },
    kind: { github: 0, x: 0 },
  };
  const sb = await serverSupabase();
  if (!sb) return zero;

  const { data, error } = await sb
    .from("public_cards")
    .select("role, kind")
    .eq("has_card", true);

  if (error || !data) return zero;

  for (const row of data) {
    const r = (row as { role?: unknown }).role;
    const k = (row as { kind?: unknown }).kind;
    zero.total += 1;
    if (isRoleKey(r)) zero.role[r] += 1;
    if (k === KIND.GithubUser) zero.kind.github += 1;
    if (k === KIND.XUser) zero.kind.x += 1;
  }
  return zero;
}
