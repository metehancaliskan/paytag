import { NextResponse, type NextRequest } from "next/server";
import { serverSupabase, adminSupabase } from "@/lib/supabase/server";
import { KIND, normalizeHandle, toHex } from "@/lib/identity";
import { identityKeyBytes } from "@/lib/verifier";

// node:crypto and the service role key both live here.
export const runtime = "nodejs";

/**
 * Where GitHub sends the reader back after they approve.
 *
 * The chain of trust this route establishes, and why each link is where it is:
 *
 *   GitHub  --provider_token-->  this route  --GET /user-->  GitHub
 *                                     |
 *                                     v  (service role, RLS bypassed)
 *                            public.identities row
 *
 * The handle is taken from GitHub's own answer to `GET /user`, made with the
 * token we just received. It is NOT taken from the Supabase JWT's
 * `user_metadata`: that field is writable by the user through
 * `auth.updateUser({ data })`, so trusting it would let anyone sign in with
 * their own account, rename themselves `torvalds`, and claim his escrow.
 * `identity_data` is closer to safe, but asking GitHub directly needs no
 * argument about which fields a provider or a client can rewrite.
 *
 * The row is written with the service role because row level security gives
 * users no INSERT on `identities` at all. If a user could write their own
 * identity row, verification would be decoration.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // Only same-origin paths, so a crafted link cannot bounce a freshly
  // authenticated reader off to another site.
  const rawNext = url.searchParams.get("next") ?? "/claim";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//")
    ? rawNext
    : "/claim";

  // Failures go back to whichever page started the flow — /connect and /claim
  // both render `auth_error` — so nobody is bounced to a page they never asked
  // for and told something went wrong there.
  const fail = (reason: string) => {
    const to = new URL(next, url.origin);
    to.searchParams.set("auth_error", reason);
    return NextResponse.redirect(to);
  };

  if (url.searchParams.get("error")) {
    // The reader pressed cancel on GitHub's consent screen. Not an error.
    return NextResponse.redirect(new URL(next, url.origin));
  }
  if (!code) return fail("no_code");

  const supabase = await serverSupabase();
  const admin = adminSupabase();
  if (!supabase) return fail("auth_not_configured");
  if (!admin) return fail("service_role_missing");

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session?.user) return fail("exchange_failed");

  const { session } = data;
  const providerToken = session.provider_token;
  if (!providerToken) return fail("no_provider_token");

  // Ask GitHub who this token belongs to. This is the actual verification —
  // everything before it only proves that someone completed an OAuth flow.
  const ghResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${providerToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "paytag",
    },
    cache: "no-store",
  });
  if (!ghResponse.ok) return fail("github_unreachable");

  const gh = (await ghResponse.json()) as { login?: string; id?: number };
  if (!gh.login || typeof gh.id !== "number") return fail("github_no_login");

  let handle: string;
  try {
    handle = normalizeHandle(gh.login, KIND.GithubUser);
  } catch {
    // A GitHub login that our own normalization rejects would produce an
    // identity key nobody can pay to. Better to stop than to store it.
    return fail("handle_not_normalizable");
  }

  const identityKey = toHex(
    new Uint8Array(identityKeyBytes(handle, KIND.GithubUser)),
  );

  const profile = await admin.from("profiles").upsert(
    { id: session.user.id, display_name: gh.login },
    { onConflict: "id" },
  );
  if (profile.error) return fail("profile_write_failed");

  const identity = await admin.from("identities").upsert(
    {
      profile_id: session.user.id,
      kind: KIND.GithubUser,
      handle,
      external_id: String(gh.id),
      external_login: gh.login,
      identity_key: identityKey,
    },
    { onConflict: "profile_id,kind" },
  );

  if (identity.error) {
    // 23505 on (kind, handle) means another Paytag account already verified
    // this handle. That is a real conflict, not a glitch: the same GitHub
    // account signed in under two different Paytag profiles, and only one row
    // can own the handle.
    return fail(
      identity.error.code === "23505" ? "handle_already_linked" : "identity_write_failed",
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
