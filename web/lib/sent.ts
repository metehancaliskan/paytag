import { browserSupabase } from "./supabase/client";
import { KIND, type IdentityKind } from "./identity";
import type { Payment } from "./contract";

/**
 * Naming the recipient of a payment, as far as it can honestly be named.
 *
 * A payment carries `sha256(kind ‖ handle)` and nothing else. That is a
 * one-way function, so the chain alone can never say who the money is for. The
 * only way back is a table that already holds the answer, and we have exactly
 * one: `identities` stores `identity_key` beside the handle for everybody who
 * has verified, and it is world readable (`identities_select_public`).
 *
 * So the list divides in two, and the division is the point:
 *
 *   verified     the tag matches a row, and the row names the handle
 *   not verified nobody has proved that handle here, so nobody can tell us what
 *                it was. The row says so.
 *
 * The second case is not a gap to paper over. The whole product exists to let
 * money be sent to people who have not turned up yet, so a sender's own list
 * will be full of them, and a guess at the name would be a guess about where
 * their money went. The app does not invent one.
 *
 * None of this affects getting the money back: `refund` takes a payment id, so
 * a row we cannot name refunds exactly like one we can. The handle is a label.
 */

export type Recipient = { kind: IdentityKind; handle: string } | null;

/** identity_key (hex) → who holds it, for the tags we can resolve. */
export type RecipientMap = Record<string, Recipient>;

function asKind(v: unknown): IdentityKind | null {
  return v === KIND.GithubUser || v === KIND.XUser ? v : null;
}

/**
 * One query for the whole list, not one per row: a wallet with thirty payments
 * would otherwise open thirty round trips to draw one screen.
 *
 * Degrades to an empty map rather than throwing. Without Supabase, or with it
 * unreachable, every row simply reads as unnamed — which is the honest answer
 * anyway, and far better than a page that will not load because a label is
 * missing.
 */
export async function resolveRecipients(
  payments: Payment[],
): Promise<RecipientMap> {
  const out: RecipientMap = {};
  const keys = [...new Set(payments.map((p) => p.identityHex.toLowerCase()))];
  for (const k of keys) out[k] = null;
  if (keys.length === 0) return out;

  const sb = browserSupabase();
  if (!sb) return out;

  const { data, error } = await sb
    .from("identities")
    .select("kind, handle, identity_key")
    .in("identity_key", keys);

  if (error || !data) return out;

  for (const row of data) {
    const r = row as { kind?: unknown; handle?: unknown; identity_key?: unknown };
    const kind = asKind(r.kind);
    if (kind === null) continue;
    if (typeof r.handle !== "string" || typeof r.identity_key !== "string") continue;
    out[r.identity_key.toLowerCase()] = { kind, handle: r.handle };
  }
  return out;
}
