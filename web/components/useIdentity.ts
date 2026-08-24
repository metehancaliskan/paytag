"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { KIND, identityKey, toHex, type IdentityKind } from "@/lib/identity";
import { AUTH_ENABLED, X_ENABLED } from "@/lib/config";

/**
 * Who is signed in, in one place.
 *
 * Two very different parts of the app need this answer — the account menu in
 * the header and the claim flow — and both must agree. Duplicating the OAuth
 * call in each was the alternative, which is how one of them ends up asking
 * for a scope the other does not.
 *
 * A person can verify one GitHub handle and one X handle on the same account
 * (the schema allows exactly one identity per kind per profile), and the two
 * hold separate escrows. So this hook answers with a map, not a single value:
 * anything that needs "the one identity" picks one deliberately.
 *
 * "verified" means a row exists in `identities`. That table is writable only by
 * the service role, in the OAuth callback, after the provider itself answered
 * who the token belongs to — so the row's existence is the proof. Nothing here
 * trusts the JWT's own metadata, which the user can rewrite.
 */
export type VerifiedIdentity = {
  kind: IdentityKind;
  handle: string;
  identityHex: string;
};

/**
 * Supabase's own name for each provider.
 *
 * "x" is the OAuth 2.0 provider; "twitter" is the legacy OAuth 1.0a one, which
 * Supabase is deprecating and which is a separate switch in the dashboard.
 * Sending the wrong one is answered with "provider is not enabled", and that
 * message names neither of them — hence this comment.
 */
export type ProviderKey = "github" | "x";

export const PROVIDER_KIND: Record<ProviderKey, IdentityKind> = {
  github: KIND.GithubUser,
  x: KIND.XUser,
};

export type Identity =
  /** No Supabase project on this deployment; nobody can verify anything. */
  | { status: "off" }
  | { status: "loading" }
  /** Signed in or not, with no verified handle — for the interface the same
   *  thing: there is nothing to claim as. */
  | { status: "anon" }
  | {
      status: "verified";
      /** Whichever identity leads: GitHub if there is one, else X. */
      handle: string;
      identityHex: string;
      kind: IdentityKind;
      github: VerifiedIdentity | null;
      x: VerifiedIdentity | null;
    };

/** The identities of a verified reader, as a list — GitHub first. */
export function identityList(identity: Identity): VerifiedIdentity[] {
  if (identity.status !== "verified") return [];
  return [identity.github, identity.x].filter(
    (v): v is VerifiedIdentity => v !== null,
  );
}

export function useIdentity() {
  const supabase = useMemo(() => browserSupabase(), []);
  const [identity, setIdentity] = useState<Identity>(
    AUTH_ENABLED ? { status: "loading" } : { status: "off" },
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    void (async () => {
      let next: Identity = { status: "anon" };
      try {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          // One query for both kinds: a person may have verified either, both,
          // or neither, and two round trips would only make the page flicker.
          const { data: rows } = await supabase
            .from("identities")
            .select("kind, handle")
            .eq("profile_id", data.user.id);

          const of = async (kind: IdentityKind) => {
            const row = (rows ?? []).find(
              (r) => (r as { kind?: unknown }).kind === kind,
            ) as { handle?: unknown } | undefined;
            const handle = typeof row?.handle === "string" ? row.handle : null;
            if (!handle) return null;
            return {
              kind,
              handle,
              identityHex: toHex(await identityKey(handle, kind)),
            } satisfies VerifiedIdentity;
          };

          const [github, x] = await Promise.all([
            of(KIND.GithubUser),
            of(KIND.XUser),
          ]);
          const lead = github ?? x;

          if (lead) {
            next = {
              status: "verified",
              handle: lead.handle,
              identityHex: lead.identityHex,
              kind: lead.kind,
              github,
              x,
            };
          }
        }
      } catch {
        // A session that cannot be read is not a signed-in session. Say anon
        // and leave a note, rather than spinning forever.
        if (alive) setError("Could not reach the sign-in service.");
      }
      if (alive) setIdentity(next);
    })();

    return () => {
      alive = false;
    };
  }, [supabase]);

  /**
   * Start OAuth with one provider and come back to `next` (a same-origin path).
   *
   * The provider is named in the callback URL as well. Our own route needs to
   * know which API to ask "who is this token", and a hint in a URL is safe to
   * take: the token itself is the proof, so pointing at the wrong verifier only
   * fails the check — it cannot pass it.
   */
  const signIn = useCallback(
    async (provider: ProviderKey = "github", next = "/claim") => {
      if (!supabase) return;
      if (provider === "x" && !X_ENABLED) {
        setError("X sign-in is not configured on this deployment.");
        return;
      }
      setError(null);
      const redirectTo =
        `${window.location.origin}/auth/callback` +
        `?next=${encodeURIComponent(next)}&provider=${provider}`;

      const { error: e } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          // The smallest scope that answers "which account is this".
          // Asking for more than you use is how a permission prompt teaches
          // people to stop reading it. X needs users.read, and tweet.read
          // alongside it because X refuses users.read on its own.
          scopes:
            provider === "github" ? "read:user" : "users.read tweet.read",
        },
      });
      if (e) setError(e.message);
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setIdentity({ status: "anon" });
  }, [supabase]);

  return { identity, error, signIn, signOut };
}
