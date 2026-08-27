import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { serverSupabase, adminSupabase } from "@/lib/supabase/server";
import { KIND } from "@/lib/identity";

export const runtime = "nodejs";

/**
 * Removes ONE verified handle from the reader's account.
 *
 * This replaced "delete my account", and the reason is that the account was
 * never the thing anybody wanted to remove. A person has one or two handles;
 * what they mean by leaving is "take my X handle off" or "take both off". A
 * single red button that did the second and could not do the first was the wrong
 * shape — and it forced somebody who only wanted to disconnect X to destroy
 * their GitHub card with it.
 *
 * So: per handle, and the last one takes the account with it, because an account
 * with no verified handle is not an account. That way nothing is orphaned and
 * there is still exactly one way to be gone completely.
 *
 * Why this needs the service role at all: row level security gives users NO
 * write access to `identities` (db/schema.sql). That is deliberate — if a user
 * could write their own identity row, verification would mean nothing — so the
 * only way to remove one is server side, after `getUser()` has said who is
 * asking.
 *
 * What goes with the handle, by the cascades in db/schema.sql: its card and its
 * payout address (both keyed on `identity_id`, ON DELETE CASCADE).
 *
 * What deliberately stays:
 *
 *   - Money in escrow. It is bound to sha256(kind ‖ handle) on chain, not to
 *     this account, and no database write can touch it. Verify the same handle
 *     again and the same escrow is claimable again. This is the property that
 *     makes disconnecting safe to offer at all.
 *   - The rows in `claim_nonces`. `profile_id` becomes NULL rather than the row
 *     disappearing: that table is what guarantees the verifier signs a nonce at
 *     most once, and it is the only trace an incident could be reconstructed
 *     from. What is left in it — an identity key and a public wallet address —
 *     is in the claim transaction on chain anyway.
 *   - The provider's own record that you once authorized this app. GitHub and X
 *     keep that on their side; the next sign-in may skip the consent screen, and
 *     the interface should not imply otherwise.
 *
 * The confirmation is a typed handle ONLY when this is the last one, because
 * that is the case that ends the account. Removing one of two is two clicks: the
 * money is provably untouched and the other handle is untouched, so the typed
 * confirmation would be ceremony rather than care.
 */
export async function POST(request: NextRequest) {
  let body: { kind?: unknown; confirm?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad(400, "Malformed JSON body.");
  }

  const kind = body.kind;
  if (kind !== KIND.GithubUser && kind !== KIND.XUser) {
    return bad(400, "Which handle? Only GitHub and X can be disconnected.");
  }

  const supabase = await serverSupabase();
  const admin = adminSupabase();
  if (!supabase) return bad(503, "This deployment has no accounts.");
  // Without the service role there is no way to remove an identity row, and
  // half-removing (the card but not the identity) would leave a verified handle
  // with nothing behind it. Refuse rather than do part of it.
  if (!admin) return bad(503, "This deployment cannot disconnect handles.");

  // Revalidated with Supabase instead of trusting the cookie, which is the
  // difference that matters before an irreversible write.
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return bad(401, "Sign in first.");

  const { data: rows, error: readError } = await admin
    .from("identities")
    .select("id, kind, handle")
    .eq("profile_id", user.id);
  if (readError) return bad(500, "Could not read the account. Nothing removed.");

  const mine = rows ?? [];
  const target = mine.find((r) => Number((r as { kind: unknown }).kind) === kind);
  if (!target) return bad(404, "That handle is not connected here.");

  const handle = String((target as { handle: unknown }).handle);
  const identityId = String((target as { id: unknown }).id);
  const isLast = mine.length <= 1;

  // The typed handle, for the one case that ends the account.
  if (isLast) {
    const typed = String(body.confirm ?? "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (typed !== handle) {
      return bad(400, `Type @${handle} to confirm.`);
    }
  }

  const removed = await admin.from("identities").delete().eq("id", identityId);
  if (removed.error) {
    return bad(500, "Could not disconnect that handle. Nothing was removed.");
  }

  if (!isLast) {
    return NextResponse.json({ disconnected: handle, accountDeleted: false });
  }

  // Last handle: the account goes too. Deleting the auth user cascades the
  // profile away with it. If that fails, remove the profile row and try once
  // more rather than leaving an account that can sign in and rebuild itself.
  let failure = (await admin.auth.admin.deleteUser(user.id)).error;
  if (failure) {
    const cleanup = await admin.from("profiles").delete().eq("id", user.id);
    if (cleanup.error) {
      return bad(
        500,
        `@${handle} was disconnected, but the sign-in account could not be removed. Try again.`,
      );
    }
    failure = (await admin.auth.admin.deleteUser(user.id)).error;
  }
  if (failure) {
    return bad(
      500,
      `@${handle} was disconnected, but the sign-in account could not be removed. Try again.`,
    );
  }

  // The session belongs to a user that no longer exists. signOut() is the polite
  // path; the cookies are then removed by hand because a request whose user is
  // gone can fail there and leave the browser holding a token that makes the app
  // look signed in.
  try {
    await supabase.auth.signOut();
  } catch {
    // Expected when the user is already gone.
  }
  const store = await cookies();
  for (const c of store.getAll()) {
    if (c.name.startsWith("sb-")) store.delete(c.name);
  }

  return NextResponse.json({ disconnected: handle, accountDeleted: true });
}

function bad(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
