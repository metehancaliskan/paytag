"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useIdentity, type ProviderKey } from "./useIdentity";
import { PROVIDERS } from "./providers";
import { CheckMark } from "./icons";
import { describeAuthError } from "@/lib/auth-errors";
import { kindUrlPrefix, slugOf } from "@/lib/identity";
import { X_ENABLED } from "@/lib/config";

/**
 * The accounts section of Settings: one row per provider, connected or not.
 *
 * It renders rows and nothing else — no card, no heading, no buttons for
 * things that live elsewhere. The settings page supplies the label and the
 * frame; this used to carry its own title, its own "Submit yourself" and
 * "Claim" buttons and a sign-out, which is how a section about *accounts* ended
 * up being the busiest thing on the page.
 *
 * Both providers are always listed. A person can hold one GitHub handle and one
 * X handle, each with its own escrow, and a row that only appears once you are
 * already verified cannot tell you the other one exists.
 *
 * ONE BUTTON PER ROW, always. When Connect comes back with "that handle has its
 * own account", the same row's button becomes **Bring it here** and does the
 * whole join. It used to be a second button below the list that opened a dialog
 * with three bullet points of consequences — which is a lot of ceremony for
 * somebody who pressed Connect and expected it to connect. The consequences are
 * true and they are still stated, but one line under the row is the right size
 * for them.
 *
 * There is still a click, and there has to be: the join removes one of the two
 * logins and signs the reader out. Doing that as a silent consequence of Connect
 * would be the wrong kind of smooth.
 *
 * LEAVING LIVES HERE TOO, per handle. There is no "delete my account" any more:
 * the account was never the thing anybody wanted to remove — a person has one or
 * two handles, and what they mean is "take my X handle off". One red button that
 * could only do both, and forced somebody who wanted to disconnect X to destroy
 * their GitHub card with it, was the wrong shape. So each verified row can be
 * disconnected on its own, and the LAST one takes the account with it, because an
 * account with no verified handle is not an account.
 *
 * The confirmation scales with what is at stake: two clicks to remove one of two
 * handles (the money is provably untouched, the other handle is untouched), a
 * typed handle when it is the last one and the account goes too.
 */
export default function ConnectPanel({
  authError,
  merged = false,
}: {
  authError?: string;
  /** `?merged=1` — two accounts were just joined into this one. */
  merged?: boolean;
}) {
  const { identity, error, signIn, refresh } = useIdentity();
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  /** Which row is asking to be disconnected, and what has been typed for it. */
  const [leaving, setLeaving] = useState<ProviderKey | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const message = error ?? describeAuthError(authError);

  /**
   * The handle we just tried to add turned out to have its own account. Only
   * these two codes mean that, and only then is a join the right offer — the
   * rest are ordinary failures where Connect should stay Connect.
   */
  const taken =
    authError === "link_identity_taken" ||
    authError === "identity_on_another_account";

  /**
   * Arm the merge, then start the other account's sign-in.
   *
   * The order matters: the cookie has to exist before the browser leaves, and it
   * can only be minted while THIS account's session is live — that token is the
   * proof for the half of the merge that OAuth cannot prove
   * (lib/merge-intent.ts).
   */
  async function join(provider: "github" | "x") {
    setJoining(true);
    try {
      const res = await fetch("/api/account/merge", { method: "POST" });
      if (!res.ok) throw new Error("could not arm");
      // `true`: sign in AS that account, do not try to link it. Linking is
      // exactly what cannot work here — its provider identity belongs to the
      // other auth user, which is why there are two accounts in the first place.
      await signIn(provider, "/profile", true);
    } catch {
      setJoining(false);
    }
  }

  async function disconnect(key: ProviderKey, kind: number, last: boolean) {
    setBusy(true);
    setFailed(null);
    try {
      const res = await fetch("/api/account/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, confirm: last ? typed : undefined }),
      });
      const body = (await res.json()) as {
        accountDeleted?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Could not disconnect.");

      if (body.accountDeleted) {
        // The session belongs to an account that no longer exists. A full
        // document load is the only way to be sure nothing on screen is still
        // holding its data.
        window.location.replace("/app");
        return;
      }
      setLeaving(null);
      setTyped("");
      // Two refreshes, and both are needed: the identity state for every panel
      // on this page, and the router for the server-rendered pages that listed
      // the card which just went with it.
      refresh();
      router.refresh();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  }

  if (identity.status === "off") {
    return (
      <p className="text-sm text-mute">
        This deployment has no Supabase project, so no account can be verified.
        See <span className="mono">docs/SETUP-AUTH.md</span>.
      </p>
    );
  }

  const loading = identity.status === "loading";
  const mine = identity.status === "verified" ? identity : null;

  return (
    <div className="space-y-3">
      <ul className="card divide-y divide-line">
        {PROVIDERS.map((p) => {
          const verified = mine ? mine[p.key] : null;
          const usable = p.key !== "x" || X_ENABLED;

          return (
            <li
              key={p.key}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4"
            >
              {p.icon}

              {loading ? (
                <div className="skeleton h-5 w-40" />
              ) : verified ? (
                <>
                  <Link
                    className="mono min-w-0 font-semibold hover:underline"
                    href={`/p/${slugOf(verified.kind)}/${verified.handle}`}
                  >
                    {kindUrlPrefix(verified.kind)}
                    {verified.handle}
                  </Link>
                  <span className="badge badge-claimed ml-auto shrink-0">
                    <CheckMark />
                    verified
                  </span>
                  {/* Quiet, and last in the row. It is the one destructive thing
                      in this section, so it does not get to look like the
                      subject of it. */}
                  <button
                    className="btn btn-danger-quiet btn-sm shrink-0"
                    onClick={() => {
                      setLeaving(p.key);
                      setTyped("");
                      setFailed(null);
                    }}
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <>
                  {/* The domain, not the brand name: the row then reads the
                      same shape before and after — `x.com` → `x.com/you`. */}
                  <span className="mono text-mute">{p.domain}</span>
                  {/* The same slot, a different job, when Connect has already
                      told us this handle is on its own account. */}
                  {taken && mine ? (
                    <button
                      className="btn btn-primary btn-sm ml-auto"
                      onClick={() => void join(p.key)}
                      disabled={joining || !usable}
                    >
                      {joining && <span className="spinner" aria-hidden />}
                      {joining ? "Opening…" : "Bring it here"}
                    </button>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm ml-auto"
                      onClick={() => void signIn(p.key, "/profile")}
                      disabled={!usable}
                      title={
                        usable ? undefined : "Not enabled on this deployment yet"
                      }
                    >
                      Connect
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {/* Landing here signed OUT is the normal end of a merge, not a failure:
          the session belonged to the account that was absorbed, and Supabase
          cannot mint one for the account you kept. Saying "both handles are on
          this account" beside two Connect buttons would read as a lie. */}
      {merged && (
        <p aria-live="polite" className="text-sm text-accent-text">
          {mine
            ? "Joined. Both handles are on this account now."
            : "Joined. Sign in with the handle you kept. Both are on it now."}
        </p>
      )}

      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}

      {/* The confirm, in place. What goes is spelled out before the button that
          does it, and the last handle needs its name typed because that is the
          case that ends the account. */}
      {leaving !== null && mine && (
        <div className="card border-danger/40 p-4 text-sm">
          {(() => {
            const v = mine[leaving];
            if (!v) return null;
            const last = (mine.github ? 1 : 0) + (mine.x ? 1 : 0) <= 1;
            return (
              <>
                <p className="font-semibold">
                  Disconnect{" "}
                  <span className="mono">
                    {kindUrlPrefix(v.kind)}
                    {v.handle}
                  </span>
                  ?
                </p>
                <p className="mt-1 text-mute">
                  Its card and payout address go with it, for good. The money
                  is untouched: it belongs to the handle, so verifying it again
                  makes it claimable again.
                  {last && " This is your only handle, so the account goes too."}
                </p>

                {last && (
                  <label className="mt-3 block">
                    <span className="text-xs text-mute">
                      Type <span className="mono">@{v.handle}</span> to confirm
                    </span>
                    <input
                      className="field mono mt-1"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      placeholder={`@${v.handle}`}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={
                      busy ||
                      (last &&
                        typed.trim().replace(/^@/, "").toLowerCase() !== v.handle)
                    }
                    onClick={() => void disconnect(leaving, v.kind, last)}
                  >
                    {busy && <span className="spinner" aria-hidden />}
                    {busy ? "Disconnecting…" : "Disconnect"}
                  </button>
                  <button
                    className="btn btn-quiet btn-sm"
                    disabled={busy}
                    onClick={() => {
                      setLeaving(null);
                      setTyped("");
                      setFailed(null);
                    }}
                  >
                    Keep it
                  </button>
                </div>

                {failed && (
                  <p role="alert" className="mt-3 text-danger">
                    {failed}
                  </p>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* What "Bring it here" will do, in one line, next to the button that
          does it. Everything irreversible about it is in the second sentence. */}
      {taken && mine && (
        <p className="text-xs text-mute">
          Its card and payout address come too, and the money is untouched: it
          belongs to the handle. That account&rsquo;s login is removed, so
          afterwards you sign in with{" "}
          <span className="mono">
            {kindUrlPrefix(mine.kind)}
            {mine.handle}
          </span>
          .
        </p>
      )}

    </div>
  );
}
