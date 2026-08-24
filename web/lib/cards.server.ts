import "server-only";

import { serverSupabase } from "./supabase/server";
import { CARD_COLUMNS, toPersonCard, type PersonCard } from "./cards";
import { isRoleKey, type RoleKey } from "./roles";
import type { IdentityKind } from "./identity";

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
  role?: RoleKey | null,
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

  if (isRoleKey(role)) q = q.eq("role", role);

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

/** How many people are listed, per role. Drives the filter's counts. */
export async function countByRole(): Promise<Record<RoleKey, number>> {
  const sb = await serverSupabase();
  const zero = { shiller: 0, dev: 0 } as Record<RoleKey, number>;
  if (!sb) return zero;

  const { data, error } = await sb
    .from("public_cards")
    .select("role")
    .eq("has_card", true);

  if (error || !data) return zero;
  for (const row of data) {
    const r = (row as { role?: unknown }).role;
    if (isRoleKey(r)) zero[r] += 1;
  }
  return zero;
}
