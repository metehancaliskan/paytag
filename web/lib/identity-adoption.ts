/**
 * Who gets to hold a verified handle when two Paytag accounts disagree.
 *
 * This is the one rule in the product that MOVES data between accounts, so it
 * lives on its own and is tested on its own rather than sitting inline in the
 * OAuth callback next to five awaits.
 *
 * The situation it exists for: the old "add a second provider" flow used
 * `signInWithOAuth`, which for X (no email in scope) created a second Supabase
 * user instead of linking. Real people ended up with their GitHub under one
 * profile and their X under another, and `unique (kind, handle)` then made each
 * account permanently unable to verify the other's handle. There was no way out
 * through the interface.
 *
 * The key that makes a decision possible at all is `external_id` — the
 * provider's permanent numeric id, unique per kind in the schema. If the row on
 * record carries the same `external_id` the provider just gave us, it is
 * literally the same provider account, and the person who completed OAuth is
 * its owner. Ownership is not in question; only which profile holds it.
 *
 * SPEC §4.4c.
 */

export type AdoptionInput = {
  /** The profile the browser is signed in as, right now. */
  sessionProfileId: string;
  /**
   * The row already stored for this (kind, external_id), if any. Looked up by
   * the id and NEVER by the handle: a handle that changed hands is a different
   * account with the same name.
   */
  onRecord: { id: string; profileId: string } | null;
  /**
   * Does the signed-in profile already hold an identity of this kind? A profile
   * may hold at most one per kind (`unique (profile_id, kind)`).
   */
  sessionAlreadyHasKind: boolean;
  /**
   * The profile that armed a merge for this round trip, or null
   * (`lib/merge-intent.ts`). A row may be taken from another profile ONLY when
   * that profile is this one — that is, when somebody signed in as it minutes
   * ago and asked for the two to be joined.
   *
   * Without this, "same provider account, other profile" would have to be
   * resolved silently, and both silent answers are wrong: move it every time and
   * an ordinary sign-in drags a card and a payout address between two accounts
   * in whichever direction the person happened to log in; refuse every time and
   * a real split is permanent.
   */
  mergeFromProfileId: string | null;
};

export type AdoptionDecision =
  /** Nothing on record: write the row normally. */
  | { action: "insert" }
  /** On record and already ours: an ordinary re-verification, or a rename. */
  | { action: "update"; identityId: string }
  /** On record under another profile, same provider account, and that profile
   *  asked for the merge: move it here. */
  | { action: "adopt"; identityId: string }
  /**
   * On record under another profile, and this profile already has a handle of
   * that kind. Moving it would collide on `(profile_id, kind)`, and there is no
   * defensible way to pick which of two cards survives — so nothing moves.
   */
  | {
      action: "refuse";
      reason: "kind_already_verified_here" | "identity_on_another_account";
    };

export function decideAdoption(input: AdoptionInput): AdoptionDecision {
  const {
    sessionProfileId,
    onRecord,
    sessionAlreadyHasKind,
    mergeFromProfileId,
  } = input;

  if (!onRecord) return { action: "insert" };
  if (onRecord.profileId === sessionProfileId) {
    return { action: "update", identityId: onRecord.id };
  }
  // Somebody else's profile holds it. Only an armed merge from THAT profile can
  // move it, and nothing else can.
  if (onRecord.profileId !== mergeFromProfileId) {
    return { action: "refuse", reason: "identity_on_another_account" };
  }
  if (sessionAlreadyHasKind) {
    return { action: "refuse", reason: "kind_already_verified_here" };
  }
  return { action: "adopt", identityId: onRecord.id };
}

/**
 * The rows that must follow an adopted identity, in this order.
 *
 * `cards.profile_id` and `payout_prefs.profile_id` are denormalized copies of
 * the identity's owner, guarded by triggers that fire on writes to THOSE tables
 * only (`cards_profile_matches_identity`, `payout_profile_matches_identity` in
 * db/schema.sql). An identity moving between profiles does not fire either one,
 * so the copies have to be corrected explicitly — and only after the identity
 * itself has moved, or the triggers reject the update.
 *
 * The payout address moves rather than being cleared: `/api/verify/claim-auth`
 * reads it by `identity_id` with the service role and refuses every other
 * recipient, while a reader can only see their own rows under RLS. Left behind,
 * it would lock the escrow to an address its owner can neither read nor change.
 *
 * `claim_nonces` is NEVER touched — it is the record that a nonce was signed at
 * most once, and it is allowed to outlive the account it belonged to.
 */
export const ADOPTION_FOLLOWS = ["cards", "payout_prefs"] as const;
