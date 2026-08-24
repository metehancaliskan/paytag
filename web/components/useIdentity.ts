"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { KIND, identityKey, toHex } from "@/lib/identity";
import { AUTH_ENABLED } from "@/lib/config";

/**
 * Who is signed in, in one place.
 *
 * Two very different parts of the app need this answer — the account menu in
 * the header and the claim flow — and both must agree. Duplicating the OAuth
 * call in each was the alternative, which is how one of them ends up asking
 * for a scope the other does not.
 *
 * "verified" means a row exists in `identities`. That table is writable only by
 * the service role, in the OAuth callback, after GitHub itself answered who the
 * token belongs to — so the row's existence is the proof. Nothing here trusts
 * the JWT's own metadata, which the user can rewrite.
 */
export type Identity =
  /** No Supabase project on this deployment; nobody can verify anything. */
  | { status: "off" }
  | { status: "loading" }
  /** Not signed in — or signed in with no verified handle yet, which for every
   *  purpose in the interface is the same thing: there is nothing to claim as. */
  | { status: "anon" }
  | { status: "verified"; handle: string; identityHex: string };

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
          const { data: row } = await supabase
            .from("identities")
            .select("handle")
            .eq("profile_id", data.user.id)
            .eq("kind", KIND.GithubUser)
            .maybeSingle();

          if (row?.handle) {
            next = {
              status: "verified",
              handle: row.handle,
              identityHex: toHex(await identityKey(row.handle, KIND.GithubUser)),
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

  /** Start GitHub OAuth and come back to `next` (a same-origin path). */
  const signIn = useCallback(
    async (next = "/claim") => {
      if (!supabase) return;
      setError(null);
      const { error: e } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          // read:user is all the check needs: the username and the numeric id.
          // No repo scope, no email — asking for more than you use is how a
          // permission prompt teaches people to stop reading it.
          scopes: "read:user",
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
