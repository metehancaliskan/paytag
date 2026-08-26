import { NextResponse, type NextRequest } from "next/server";
import { serverSupabase, adminSupabase } from "@/lib/supabase/server";
import { KIND, normalizeHandle, toHex, type IdentityKind } from "@/lib/identity";
import { identityKeyBytes } from "@/lib/verifier";
import { decideAdoption } from "@/lib/identity-adoption";
import { MERGE_COOKIE, readMergeIntent } from "@/lib/merge-intent";
import { cookies } from "next/headers";

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
  /** Supabase's name for it. "x" is OAuth 2.0; "twitter" was OAuth 1.0a. */
  key: "github" | "x";
  /** Older names Supabase may still report for the same provider. */
  aliases?: string[];
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
  key: "x",
  aliases: ["twitter"],
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
  providers: string[],
): Verified | null {
  const row = identities?.find(
    (i) => i.provider !== undefined && providers.includes(i.provider),
  );
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

  // Failures go back to whichever page started the flow — /profile and /claim
  // both render `auth_error` — so nobody is bounced to a page they never asked
  // for and told something went wrong there.
  const fail = (reason: string) => {
    const to = new URL(next, url.origin);
    to.searchParams.set("auth_error", reason);
    return NextResponse.redirect(to);
  };

  // The provider (or Supabase's own callback) can come back with an error
  // instead of a code, and these are NOT the same thing:
  //
  //   access_denied            — the reader pressed cancel. Not an error.
  //   identity_already_exists  — this provider account is attached to a
  //                              DIFFERENT Supabase user, so the link was
  //                              refused before it began.
  //
  // Treating the second as a cancel is why pressing Verify, approving at X and
  // coming back to a byte-identical page was possible: the reader had no way to
  // tell the request from a no-op, so the only move left was pressing it again.
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const detail = `${url.searchParams.get("error_code") ?? ""} ${
      url.searchParams.get("error_description") ?? ""
    }`;
    if (oauthError === "access_denied" && !/identity/i.test(detail)) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    return fail(
      /identity_already_exists|already linked/i.test(detail)
        ? "link_identity_taken"
        : "provider_refused",
    );
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

  // A merge is a different flow and it is armed by a cookie, so the guard below
  // does not apply to it: during a merge the session legitimately belongs to the
  // OTHER account, identities and all.
  const jarHasMergeIntent = (await cookies()).get(MERGE_COOKIE) !== undefined;

  // `link=1` means the browser started this from an account that already had a
  // verified identity (useIdentity.signIn). If that is true and the session we
  // just exchanged belongs to a user with NO identities, the link did not
  // happen: Supabase made a second user instead, which is what a project with
  // Manual Linking switched off does. Writing an identity row now would give
  // that stray user a Paytag profile and leave the reader looking at an account
  // that has forgotten their other handle.
  //
  // So nothing is written, the stray session is dropped, and the message says
  // what to do. Their real identity row was never touched — signing in again
  // with the handle they had brings them back to it.
  if (url.searchParams.get("link") === "1" && !jarHasMergeIntent) {
    const { data: existing, error: existingError } = await admin
      .from("identities")
      .select("kind")
      .eq("profile_id", session.user.id)
      .limit(1);

    if (existingError) return fail("identity_write_failed");
    if (!existing || existing.length === 0) {
      await supabase.auth.signOut();
      return fail("link_made_new_account");
    }
  }

  // Which provider just signed in. The hint in the URL comes from our own
  // `redirectTo`, so a crafted one can only pick the wrong verifier — and the
  // wrong verifier rejects the token, because the token itself is what proves
  // the account. `app_metadata.provider` is the fallback.
  const hint =
    url.searchParams.get("provider") ??
    (session.user.app_metadata as { provider?: string } | null)?.provider ??
    "github";
  const provider =
    PROVIDERS.find((p) => p.key === hint || p.aliases?.includes(hint)) ??
    GITHUB;

  // This is the actual verification — everything before it only proves that
  // someone completed an OAuth flow.
  let who = await provider.whoAmI(providerToken);

  if (!who && provider.key === "x" && TRUST_PROVIDER_IDENTITY) {
    who = handleFromSupabaseIdentity(
      session.user.identities as SupabaseIdentity[] | undefined,
      ["x", "twitter"],
    );
  }

  if (!who) {
    return fail(provider.key === "x" ? "x_unreachable" : "github_unreachable");
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

  // ---------------------------------------------------------------- merging
  //
  // "Join whatever I sign in as next into THIS account." The token was minted by
  // /api/account/merge while that account's session was live, which is the proof
  // for the half of the merge OAuth cannot give us: this round trip proves the
  // arriving handle, the token proves the account that asked for it.
  //
  // Direction matters and it is deliberate: the account that survives is the one
  // that armed the merge — the one the reader was using when they pressed the
  // button — because "bring my other handle here" is what they asked for. The
  // account they are signed in as *right now* is the one being absorbed, and
  // Supabase cannot merge two auth users, so its login is removed. They sign in
  // again afterwards with the account they kept.
  const jar = await cookies();
  const mergeFrom = readMergeIntent(
    jar.get(MERGE_COOKIE)?.value,
    Math.floor(Date.now() / 1000),
  );
  const clearIntent = () => {
    if (jar.get(MERGE_COOKIE)) jar.delete(MERGE_COOKIE);
  };
  const merging = mergeFrom !== null && mergeFrom !== session.user.id;
  // Every write below lands on the profile that ends up holding everything.
  const target = merging ? mergeFrom! : session.user.id;

  let toMove: { id: string; kind: number }[] = [];

  if (merging) {
    // The keeper has to still exist — the token outlives a deleted account by
    // up to ten minutes.
    const [keeper, theirs, mine] = await Promise.all([
      admin.from("profiles").select("id").eq("id", target).maybeSingle(),
      admin
        .from("identities")
        .select("id, kind")
        .eq("profile_id", session.user.id),
      admin.from("identities").select("kind").eq("profile_id", target),
    ]);

    if (theirs.error || mine.error) {
      clearIntent();
      return fail("identity_write_failed");
    }
    if (!keeper.data) {
      clearIntent();
      return fail("merge_source_gone");
    }

    // Checked BEFORE anything is written: a half-merged pair is worse than a
    // refused one. The kind arriving on this round trip counts as taken too,
    // because it is about to be written for the keeper.
    const taken = new Set<number>(
      (mine.data ?? []).map((r) => Number((r as { kind: unknown }).kind)),
    );
    toMove = (theirs.data ?? []).map((r) => ({
      id: String((r as { id: unknown }).id),
      kind: Number((r as { kind: unknown }).kind),
    }));
    if (taken.has(provider.kind) || toMove.some((r) => taken.has(r.kind))) {
      clearIntent();
      return fail("merge_kind_clash");
    }
  }

  // The profile row has to exist before the identity that references it, so it
  // cannot move below. `ignoreDuplicates` is the part that changed: the upsert
  // used to rewrite `display_name` on every single sign-in, which meant even the
  // failures below left a mark on the account. Now it is written once, at
  // creation, and never again.
  const profile = await admin.from("profiles").upsert(
    { id: target, display_name: who.login },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (profile.error) {
    clearIntent();
    return fail("profile_write_failed");
  }

  const row = {
    profile_id: target,
    kind: provider.kind,
    handle,
    external_id: who.externalId,
    external_login: who.login,
    identity_key: identityKey,
  };

  // Is this provider account already on record? Looked up by `external_id`,
  // never by the handle: the id is the provider's permanent one, and it is the
  // only thing that answers "is this the same account" after a rename.
  const { data: onRecord, error: lookupError } = await admin
    .from("identities")
    .select("id, profile_id")
    .eq("kind", provider.kind)
    .eq("external_id", who.externalId)
    .maybeSingle();
  if (lookupError) {
    clearIntent();
    return fail("identity_write_failed");
  }

  // Does the keeper already hold a handle of this kind?
  let alreadyHave = false;
  if (onRecord && onRecord.profile_id !== target) {
    const { data } = await admin
      .from("identities")
      .select("id")
      .eq("profile_id", target)
      .eq("kind", provider.kind)
      .maybeSingle();
    alreadyHave = data !== null;
  }

  const decision = decideAdoption({
    sessionProfileId: target,
    onRecord: onRecord
      ? { id: onRecord.id as string, profileId: onRecord.profile_id as string }
      : null,
    sessionAlreadyHasKind: alreadyHave,
    // The one profile whose rows this round trip may take from: the account
    // being absorbed. Outside a merge there is none, which is what stops an
    // ordinary sign-in from moving anything.
    mergeFromProfileId: merging ? session.user.id : null,
  });

  let identityId = onRecord?.id ?? null;

  if (decision.action === "refuse") {
    clearIntent();
    return fail(decision.reason);
  }

  if (decision.action === "adopt") {
    // Safe because `(kind, external_id)` is unique: the row IS this provider
    // account, and the provider just told us the person holding this session
    // owns it. Ownership is never in question here — only which profile holds it.
    const moved = await admin
      .from("identities")
      .update({
        profile_id: target,
        handle,
        external_login: who.login,
        identity_key: identityKey,
      })
      .eq("id", decision.identityId);
    if (moved.error) {
      clearIntent();
      return fail("identity_write_failed");
    }
    identityId = decision.identityId;
  } else {
    const identity = await admin
      .from("identities")
      .upsert(row, { onConflict: "profile_id,kind" })
      .select("id")
      .maybeSingle();

    if (identity.error) {
      // 23505 here can only be `(kind, handle)` held by a DIFFERENT provider
      // account — a recycled username. That one must never be adopted: the
      // person completing OAuth is not its owner, and moving it would hand them
      // somebody else's card and payout address.
      clearIntent();
      return fail(
        identity.error.code === "23505"
          ? "handle_taken_by_another_account"
          : "identity_write_failed",
      );
    }
    identityId = identity.data?.id ?? identityId;
  }

  // `cards.profile_id` and `payout_prefs.profile_id` are denormalized copies of
  // the identity's owner, guarded by triggers that fire on writes to THOSE
  // tables only — an identity moving between profiles fires neither, so the
  // copies have to be corrected explicitly, and only after the identity itself
  // has moved. Idempotent, and run on every sign-in, so a half-finished move
  // cannot persist: the alternative is a card whose owner disagrees with its
  // identity's, and a card editor that refuses every save afterwards.
  //
  // The payout address moves rather than being cleared. `claim-auth` reads it by
  // `identity_id` with the service role and refuses every other recipient, while
  // the reader sees only their own rows under RLS — left behind, it would lock
  // the escrow to an address its owner can neither read nor change.
  const repair = async (id: string) => {
    await admin
      .from("cards")
      .update({ profile_id: target })
      .eq("identity_id", id)
      .neq("profile_id", target);
    await admin
      .from("payout_prefs")
      .update({ profile_id: target })
      .eq("identity_id", id)
      .neq("profile_id", target);
  };

  if (identityId) await repair(identityId);

  let merged = false;
  if (merging) {
    for (const r of toMove) {
      if (r.id === identityId) continue; // already handled above
      const moved = await admin
        .from("identities")
        .update({ profile_id: target })
        .eq("id", r.id);
      if (moved.error) {
        clearIntent();
        return fail("merge_incomplete");
      }
      await repair(r.id);
    }

    // Only once the absorbed profile holds nothing: deleting it cascades its
    // identities, cards and payout rows away. `claim_nonces.profile_id` is
    // ON DELETE SET NULL by design — that record outlives the account, because
    // it is what guarantees a nonce was signed at most once.
    const { data: left } = await admin
      .from("identities")
      .select("id")
      .eq("profile_id", session.user.id)
      .limit(1);

    if (!left || left.length === 0) {
      // The auth user goes with it, and that is also what frees its provider
      // identity at the Supabase level — so the handle that just moved can later
      // be added to the keeper as a second way to sign in.
      await admin.auth.admin.deleteUser(session.user.id);
      await admin.from("profiles").delete().eq("id", session.user.id);
    }

    // The session belonged to an account that no longer exists. Dropped by hand
    // as well: a request whose user is gone can fail inside signOut() and leave
    // the browser holding a token that makes the app look signed in.
    try {
      await supabase.auth.signOut();
    } catch {
      // Expected when the user is already gone.
    }
    for (const c of jar.getAll()) {
      if (c.name.startsWith("sb-")) jar.delete(c.name);
    }
    merged = true;
  }

  clearIntent();

  const to = new URL(next, url.origin);
  if (merged) to.searchParams.set("merged", "1");
  return NextResponse.redirect(to);
}
