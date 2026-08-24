/**
 * The `auth_error` codes the OAuth callback can redirect with, in words a
 * reader can act on. The codes themselves live in app/auth/callback/route.ts;
 * this table is shared so the claim page and the connect page never disagree
 * about what one of them means.
 */
export const AUTH_ERRORS: Record<string, string> = {
  no_code: "GitHub sent us back without an authorization code.",
  auth_not_configured: "Sign-in is not configured on this deployment.",
  service_role_missing: "The server is missing its Supabase service role key.",
  exchange_failed: "That sign-in link expired. Try again.",
  no_provider_token: "GitHub did not return an access token.",
  github_unreachable: "GitHub would not answer. Try again in a moment.",
  github_no_login: "GitHub did not tell us which account you are.",
  handle_not_normalizable: "Your GitHub username is one Paytag cannot tag.",
  handle_already_linked:
    "This GitHub account is already linked to another Paytag profile.",
  profile_write_failed: "Could not save your profile.",
  identity_write_failed: "Could not save your verified identity.",
};

export function describeAuthError(code: string | undefined): string | null {
  if (!code) return null;
  return AUTH_ERRORS[code] ?? "Sign-in failed.";
}
