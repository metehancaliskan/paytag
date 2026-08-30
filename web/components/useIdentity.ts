"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { KIND, identityKey, toHex, type IdentityKind } from "@/lib/identity";
import { AUTH_ENABLED, X_ENABLED } from "@/lib/config";

/**
 * Who is signed in — asked once for the whole page.
 *
 * Eight components need this answer, and every one of them used to fetch it
 * itself: the header, the claim rows, the card editor, the payout section, the
 * cards list, the connect rows, the sign-out button, the delete panel. On
 * Settings that was five copies of the same two requests, five independent
 * loading states, and — the part that actually breaks — five answers that could
 * disagree for a moment. A header saying "verified" beside a panel saying
 * "connect an account" is not a rendering glitch, it is two truths.
 *
 * So there is one fetch, in `IdentityProvider`, and `useIdentity()` reads it.
 * The provider sits in the app layout, above every page that has an account.
 *
 * A person can verify one GitHub handle and one X handle on the same account
 * (the schema allows exactly one identity per kind per profile), and the two
 * hold separate escrows. So this answers with a map, not a single value:
 * anything that needs "the one identity" picks one deliberately.
 *
 * "verified" means a row exists in `identities`. That table is writable only by
 * the service role, in the OAuth callback, after the provider itself answered
 * who the token belongs to — so the row's existence is the proof. Nothing here
 * trusts the JWT's own metadata, which the user can rewrite.
 */
export type VerifiedIdentity = {
  /**
   * The `identities` row id. Carried here so that nothing else has to query the
   * table for it: the payout section, the cards list and the card editor all
   * need it to write, and each one used to fetch its own copy.
   */
  id: string;
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
  /**
   * No verified handle. For most of the interface that is the same as signed
   * out — there is nothing to claim as — but `signedIn` keeps the difference,
   * because a session with a profile and no identities is a real state and it
   * used to be a dead end: nothing offered a way to delete it.
   */
  | { status: "anon"; signedIn: boolean }
  | {
      status: "verified";
      /** `auth.uid()`, revalidated with Supabase rather than read off a cookie.
       *  Every write that needs a `profile_id` takes it from here. */
      profileId: string;
      /** Whichever identity leads: GitHub if there is one, else X. */
      handle: string;
      identityHex: string;
      kind: IdentityKind;
      github: VerifiedIdentity | null;
      x: VerifiedIdentity | null;
    };

export type IdentityApi = {
  identity: Identity;
  error: string | null;
  /**
   * Verify a provider and come back to `next`. Adds to this account by default;
   * `asOtherAccount` signs in AS that provider instead, replacing the session,
   * which is what a merge needs (`lib/merge-intent.ts`).
   */
  signIn: (
    provider?: ProviderKey,
    next?: string,
    asOtherAccount?: boolean,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Read it again. Needed by anything that changes the answer without changing
   * the session — disconnecting a handle is a server-side delete, so no auth
   * event fires and nothing would otherwise notice.
   */
  refresh: () => void;
};

/** The identities of a verified reader, as a list — GitHub first. */
export function identityList(identity: Identity): VerifiedIdentity[] {
  if (identity.status !== "verified") return [];
  return [identity.github, identity.x].filter(
    (v): v is VerifiedIdentity => v !== null,
  );
}

export const IdentityContext = createContext<IdentityApi | null>(null);

/**
 * Read the one answer. Throws outside the provider on purpose: the alternative
 * is a component that quietly starts its own fetch and then disagrees with the
 * header, which is the bug this whole file exists to remove.
 */
export function useIdentity(): IdentityApi {
  const api = useContext(IdentityContext);
  if (!api) {
    throw new Error(
      "useIdentity() needs <IdentityProvider> above it. It is in app/(app)/layout.tsx.",
    );
  }
  return api;
}

/**
 * The actual work, called once by the provider. Not exported for general use;
 * calling this in a component is exactly the duplication described above.
 */
export function useIdentityState(): IdentityApi {
  const supabase = useMemo(() => browserSupabase(), []);
  const [identity, setIdentity] = useState<Identity>(
    AUTH_ENABLED ? { status: "loading" } : { status: "off" },
  );
  const [error, setError] = useState<string | null>(null);
  // A generation counter rather than an exported `load`: the effect keeps its
  // `alive` guard, so a late response from the previous read cannot overwrite
  // the newer one.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    const load = async () => {
      let next: Identity = { status: "anon", signedIn: false };
      try {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          next = { status: "anon", signedIn: true };
          // One query for both kinds: a person may have verified either, both,
          // or neither, and two round trips would only make the page flicker.
          const { data: rows } = await supabase
            .from("identities")
            .select("id, kind, handle")
            .eq("profile_id", data.user.id);

          const of = async (kind: IdentityKind) => {
            const row = (rows ?? []).find(
              (r) => (r as { kind?: unknown }).kind === kind,
            ) as { id?: unknown; handle?: unknown } | undefined;
            const handle = typeof row?.handle === "string" ? row.handle : null;
            const id = typeof row?.id === "string" ? row.id : null;
            if (!handle || !id) return null;
            return {
              id,
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
              profileId: data.user.id,
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
    };

    void load();

    // And again whenever the session changes. Without this the answer was
    // fetched once per document and never revisited, so a token refresh that
    // failed left every screen showing a verified handle for a session that had
    // expired — the next write failed with "could not save" and nothing said
    // why. Signing out in another tab had the same shape.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // INITIAL_SESSION arrives immediately and would double every page's
      // identity fetch — `load()` above is that one. TOKEN_REFRESHED changes
      // nothing about who is signed in. What is left is the three events that
      // do: signing in, signing out (including a refresh that failed), and a
      // user record being updated.
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      void load();
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, tick]);

  /**
   * Verify one provider and come back to `next` (a same-origin path).
   *
   * The provider is named in the callback URL as well. Our own route needs to
   * know which API to ask "who is this token", and a hint in a URL is safe to
   * take: the token itself is the proof, so pointing at the wrong verifier only
   * fails the check — it cannot pass it.
   *
   * THE IMPORTANT PART: adding a second provider to an account that already has
   * one is `linkIdentity`, not `signInWithOAuth`.
   *
   * `signInWithOAuth` starts a *sign-in*. Supabase attaches it to the existing
   * user only when the provider returns a verified email that matches — and X's
   * `users.read` scope returns no email at all. So a signed-in GitHub reader who
   * pressed "Verify" on the X row was silently moved into a SECOND Supabase
   * user with none of their identities: their GitHub verification appeared to
   * have been forgotten, and the app asked them to verify GitHub again. That is
   * the bug this call fixes.
   *
   * `linkIdentity` needs Manual Linking enabled in the project (Supabase >
   * Authentication > Advanced). When it is off, the error says so instead of
   * quietly starting the sign-in that causes the problem.
   */
  const signIn = useCallback(
    async (
      provider: ProviderKey = "github",
      next = "/claim",
      /**
       * "Sign in AS this provider" rather than "add it to this account".
       *
       * Only the merge uses it, and it has to: a merge works by arriving as the
       * other account, and `linkIdentity` would refuse that outright — the
       * provider identity is attached to that other auth user, which is the
       * whole reason the two accounts are separate. Asking to link there gets
       * `identity_already_exists` and the merge never starts.
       */
      asOtherAccount = false,
    ) => {
      if (!supabase) return;
      if (provider === "x" && !X_ENABLED) {
        setError("X sign-in is not configured on this deployment.");
        return;
      }
      setError(null);

      // Asked here rather than read off `identity`: this is a decision about
      // the session, and the session is the thing that knows.
      const { data: current } = await supabase.auth.getUser();
      const linking = current.user !== null && !asOtherAccount;

      const redirectTo =
        `${window.location.origin}/auth/callback` +
        `?next=${encodeURIComponent(next)}&provider=${provider}` +
        // The callback checks this: if a link ended up creating a new user
        // anyway, it refuses to write anything and says why.
        (linking ? "&link=1" : "");

      const options = {
        redirectTo,
        // The smallest scope that answers "which account is this".
        // Asking for more than you use is how a permission prompt teaches
        // people to stop reading it. X needs users.read, and tweet.read
        // alongside it because X refuses users.read on its own.
        scopes: provider === "github" ? "read:user" : "users.read tweet.read",
      };

      const { error: e } = linking
        ? await supabase.auth.linkIdentity({ provider, options })
        : await supabase.auth.signInWithOAuth({ provider, options });

      if (e) {
        setError(
          linking && /manual linking|not enabled|disabled/i.test(e.message)
            ? "This project cannot add a second account yet: turn on Manual Linking in Supabase > Authentication > Advanced."
            : e.message,
        );
      }
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    // No manual `setIdentity` here: the auth listener above re-reads and lands
    // on "anon" by itself. Patching the state by hand was how the two could
    // disagree in the first place.
  }, [supabase]);

  return { identity, error, signIn, signOut, refresh };
}
