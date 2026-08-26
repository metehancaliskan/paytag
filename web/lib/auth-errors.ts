/**
 * The `auth_error` codes the OAuth callback can redirect with, in words a
 * reader can act on. The codes themselves live in app/auth/callback/route.ts;
 * this table is shared so the claim page and the connect page never disagree
 * about what one of them means.
 */
export const AUTH_ERRORS: Record<string, string> = {
  no_code: "The provider sent us back without an authorization code.",
  auth_not_configured: "Sign-in is not configured on this deployment.",
  service_role_missing: "The server is missing its Supabase service role key.",
  exchange_failed: "That sign-in link expired. Try again.",
  no_provider_token: "The provider did not return an access token.",
  github_unreachable: "GitHub would not answer. Try again in a moment.",
  github_no_login: "GitHub did not tell us which account you are.",
  // X charges per profile read, so "would not answer" here usually means the
  // deployment's X app has no API access rather than an outage — SPEC §7.4.
  x_unreachable:
    "X would not confirm the account. The X app may have no API access.",
  handle_not_normalizable: "That username is one Paytag cannot tag.",
  // Kept for links already in the wild; the callback no longer emits it.
  handle_already_linked:
    "That account is already linked to another Paytag profile.",
  // A DIFFERENT provider account holds that username — a recycled handle. Not
  // something the product can resolve on its own, and it must not try.
  handle_taken_by_another_account:
    "Another account already verified that username here. If it used to be yours and was renamed, tell us — it cannot be moved automatically.",
  // Trying to add a second GitHub (or second X) to one Paytag account.
  kind_already_verified_here:
    "This account already has a verified handle on that platform. Sign out to use a different one.",
  // Supabase refused the link before it started: the provider account is
  // attached to another Supabase user. Used to be swallowed as a cancel.
  link_identity_taken:
    "That account is signed in as its own Paytag account elsewhere. Sign in as it, delete that account under Settings, then add it here.",
  provider_refused: "The provider stopped the sign-in. Nothing was changed.",
  // The provider account is verified on a different Paytag account. Not moved
  // automatically — the fix is the merge, which needs both accounts to say so.
  identity_on_another_account:
    "That handle is verified on another Paytag account. Use “Join another account” below to bring the two together.",
  // Both accounts hold a handle on the same platform. One slot, two cards.
  merge_kind_clash:
    "Both accounts have a handle on the same platform, so they cannot be joined. Delete the one you do not want first.",
  merge_incomplete:
    "The accounts were not fully joined, so nothing was moved. Try again.",
  // The one that used to happen silently: a second provider signed in as a
  // NEW user instead of being added to the account that started the flow.
  link_made_new_account:
    "That account could not be added to the one you were signed in as, so nothing was changed. Sign in again with the handle you had — this project needs Manual Linking turned on in Supabase to hold both.",
  profile_write_failed: "Could not save your profile.",
  identity_write_failed: "Could not save your verified identity.",
};

export function describeAuthError(code: string | undefined): string | null {
  if (!code) return null;
  return AUTH_ERRORS[code] ?? "Sign-in failed.";
}
