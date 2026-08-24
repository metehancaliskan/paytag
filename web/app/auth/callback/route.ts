import { NextResponse, type NextRequest } from "next/server";
import { serverSupabase, adminSupabase } from "@/lib/supabase/server";
import { KIND, normalizeHandle, toHex, type IdentityKind } from "@/lib/identity";
import { identityKeyBytes } from "@/lib/verifier";

// node:crypto and the service role key both live here.
export const runtime = "nodejs";

/**
 * Where the provider sends the reader back after they approve.
 *
 * The chain of trust this route establishes, and why each link is where it is:
 *
 *   provider  --provider_token-->  this route  --GET /me-->  provider
 *                                       |
 *                                       v  (service role, RLS bypassed)
 *                              public.identities row
 *
 * The handle is taken from the provider's own answer to a request made with the
 * token we just received. It is NOT taken from the Supabase JWT's
 * `user_metadata`: that field is writable by the user through
 * `auth.updateUser({ data })`, so trusting it would let anyone sign in with
 * their own account, rename themselves `torvalds`, and claim his escrow.
 *
 * The row is written with the service role because row level security gives
 * users no INSERT on `identities` at all. If a user could write their own
 * identity row, verification would be decoration.
 */

/** What we need from a provider, and how to get it from that provider. */
type Verified = { handle: string; externalId: string; login: string };

type Provider = {
  /** Supabase's name for it, as it appears in `app_metadata.provider`. */
  key: "github" | "twitter";
  kind: IdentityKind;
  /** Ask the provider who this token belongs to. */
  whoAmI: (token: string) => Promise<Verified | null>;
};

const GITHUB: Provider = {
  key: "github",
  kind: KIND.GithubUser,
  async whoAmI(token) {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "paytag",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const gh = (await res.json()) as { login?: string; id?: number };
    if (!gh.login || typeof gh.id !== "number") return null;
    return { handle: gh.login, externalId: String(gh.id), login: gh.login };
  },
};

const X: Provider = {
  key: "twitter",
  kind: KIND.XUser,
  async whoAmI(token) {
    // The paid-tier problem is real (SPEC §7.4): on an X account with no API
    // access this call fails, and the flow stops rather than falling back to
    // something weaker. See TRUST_PROVIDER_IDENTITY below for the deliberate,
    // documented exception.
    const res = await fetch("https://api.x.com/2/users/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { id?: string; username?: string };
    };
    const id = body.data?.id;
    const username = body.data?.username;
    if (!id || !username) return null;
    return { handle: username, externalId: String(id), login: username };
  },
};

const PROVIDERS: Provider[] = [GITHUB, X];

/**
 * Escape hatch for X only: take the handle from the identity row Supabase
 * wrote at sign-in instead of asking X ourselves.
 *
 * Weaker than the default and off unless explicitly set. `identity_data` is
 * filled by the provider through Supabase and is NOT writable with
 * `auth.updateUser` (that only touches `user_metadata`), so this is not
 * "trust the user" — it is "trust Supabase's own fetch instead of ours". The
 * reason it exists at all: X charges per profile read, and a deployment that
 * cannot pay should be able to run X verification at a stated, lower
 * guarantee rather than not at all.
 */
const TRUST_PROVIDER_IDENTITY =
  (process.env.X_TRUST_PROVIDER_IDENTITY ?? "").trim() === "1";

type SupabaseIdentity = {
  provider?: string;
  identity_data?: Record<string, unknown> | null;
};

function handleFromSupabaseIdentity(
  identities: SupabaseIdentity[] | undefined,
  provider: string,
): Verified | null {
  const row = identities?.find((i) => i.provider === provider);
  const data = row?.identity_data ?? null;
  if (!data) return null;

  // Supabase does not promise one field name across provider versions, so read
  // the candidates in order rather than guessing one.
  const name = ["user_name", "preferred_username", "screen_name", "nickname"]
    .map((k) => data[k])
    .find((v): v is string => typeof v === "string" && v.trim() !== "");
  const sub = ["provider_id", "sub", "id"]
    .map((k) => data[k])
    .find((v): v is string | number => typeof v === "string" || typeof v === "number");

  if (!name || sub === undefined) return null;
  return { handle: name, externalId: String(sub), login: name };
}

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
    // The reader pressed cancel on the provider's consent screen. Not an error.
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

  // Which provider just signed in. The hint in the URL comes from our own
  // `redirectTo`, so a crafted one can only pick the wrong verifier — and the
  // wrong verifier rejects the token, because the token itself is what proves
  // the account. `app_metadata.provider` is the fallback.
  const hint =
    url.searchParams.get("provider") ??
    (session.user.app_metadata as { provider?: string } | null)?.provider ??
    "github";
  const provider = PROVIDERS.find((p) => p.key === hint) ?? GITHUB;

  // This is the actual verification — everything before it only proves that
  // someone completed an OAuth flow.
  let who = await provider.whoAmI(providerToken);

  if (!who && provider.key === "twitter" && TRUST_PROVIDER_IDENTITY) {
    who = handleFromSupabaseIdentity(
      session.user.identities as SupabaseIdentity[] | undefined,
      "twitter",
    );
  }

  if (!who) {
    return fail(
      provider.key === "twitter" ? "x_unreachable" : "github_unreachable",
    );
  }

  let handle: string;
  try {
    handle = normalizeHandle(who.handle, provider.kind);
  } catch {
    // A login that our own normalization rejects would produce an identity key
    // nobody can pay to. Better to stop than to store it.
    return fail("handle_not_normalizable");
  }

  const identityKey = toHex(
    new Uint8Array(identityKeyBytes(handle, provider.kind)),
  );

  const profile = await admin.from("profiles").upsert(
    { id: session.user.id, display_name: who.login },
    { onConflict: "id" },
  );
  if (profile.error) return fail("profile_write_failed");

  const identity = await admin.from("identities").upsert(
    {
      profile_id: session.user.id,
      kind: provider.kind,
      handle,
      external_id: who.externalId,
      external_login: who.login,
      identity_key: identityKey,
    },
    { onConflict: "profile_id,kind" },
  );

  if (identity.error) {
    // 23505 on (kind, handle) means another Paytag account already verified
    // this handle. That is a real conflict, not a glitch: the same provider
    // account signed in under two different Paytag profiles, and only one row
    // can own the handle.
    return fail(
      identity.error.code === "23505" ? "handle_already_linked" : "identity_write_failed",
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
