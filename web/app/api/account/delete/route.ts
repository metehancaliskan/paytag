import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { serverSupabase, adminSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Deletes the reader's Paytag account, everywhere.
 *
 * What goes: the row in Supabase Auth, and with it — by the cascades in
 * db/schema.sql — the profile, both identities, both cards, and the payout
 * addresses. The next sign-in creates a new account from scratch, with a new
 * user id. Note what this does NOT do: GitHub and X keep their own record that
 * you once authorized this app, so the next sign-in may skip the consent screen
 * entirely. Revoking that is done on their side, not ours, and the interface
 * should not imply otherwise.
 *
 * What deliberately stays:
 *
 *   - Money in escrow. It is bound to sha256(kind ‖ handle) on chain, not to
 *     this account, and no database write can touch it. Verify the same handle
 *     again and the same escrow is claimable again. This is the property that
 *     makes deletion safe to offer at all.
 *   - The rows in `claim_nonces`. Their `profile_id` becomes NULL (migration
 *     002) rather than the row disappearing: that table is what guarantees the
 *     verifier signs a nonce at most once, and it is the only trace an incident
 *     could be reconstructed from. What is left in it — an identity key and a
 *     public wallet address — is in the claim transaction on chain anyway.
 *
 * The confirmation is a typed handle rather than a second button, because the
 * two irreversible things here are worth spelling out by hand: the handle is
 * released for anyone else to verify, and every card written under it is gone.
 */
export async function POST(request: NextRequest) {
  let body: { confirm?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad(400, "Malformed JSON body.");
  }

  const supabase = await serverSupabase();
  const admin = adminSupabase();
  if (!supabase) return bad(503, "This deployment has no accounts to delete.");
  // Without the service role there is no way to remove the auth user, and
  // deleting only the public rows would leave an account that can sign in and
  // silently rebuild itself. Refuse rather than half-delete.
  if (!admin) return bad(503, "This deployment cannot delete accounts.");

  // getUser() revalidates with Supabase instead of trusting the cookie, which
  // is the difference that matters before an irreversible write.
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return bad(401, "Sign in first.");

  const { data: identities, error: readError } = await admin
    .from("identities")
    .select("handle")
    .eq("profile_id", user.id);
  if (readError) return bad(500, "Could not read the account. Nothing deleted.");

  const handles = (identities ?? [])
    .map((r) => (r as { handle?: unknown }).handle)
    .filter((h): h is string => typeof h === "string");

  // An account with no verified identity has no handle to type, so the word
  // stands in for one. Everything else must match a handle this account really
  // holds — a generic "yes" is too easy to click by accident.
  const typed = String(body.confirm ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  const expected = handles.length > 0 ? handles : ["delete"];
  if (!expected.includes(typed)) {
    return bad(
      400,
      handles.length > 0
        ? `Type @${handles[0]} to confirm.`
        : 'Type "delete" to confirm.',
    );
  }

  // Deleting the auth user cascades the rest. If the cascade is missing on this
  // project the delete fails instead of half-completing, so clear the public
  // rows and try once more rather than leaving the account in two pieces.
  let failure = (await admin.auth.admin.deleteUser(user.id)).error;
  if (failure) {
    const cleanup = await admin.from("profiles").delete().eq("id", user.id);
    if (cleanup.error) {
      return bad(500, "Could not delete the account. Nothing was removed.");
    }
    failure = (await admin.auth.admin.deleteUser(user.id)).error;
  }
  if (failure) {
    // The public rows are gone but the auth user is not. Say so plainly: a
    // "deleted" that left an account able to sign in would be a lie, and the
    // next sign-in would rebuild the profile from the provider anyway.
    return bad(
      500,
      "Your cards and identities were removed, but the sign-in account could not be deleted. Try again.",
    );
  }

  // The session belongs to a user that no longer exists. signOut() is the
  // polite path; the cookies are then removed by hand because a request whose
  // user is gone can fail there and leave the browser holding a token that
  // makes the app look signed in.
  try {
    await supabase.auth.signOut();
  } catch {
    // Expected when the user is already gone.
  }
  const store = await cookies();
  for (const c of store.getAll()) {
    if (c.name.startsWith("sb-")) store.delete(c.name);
  }

  return NextResponse.json({ deleted: true, handles });
}

function bad(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
