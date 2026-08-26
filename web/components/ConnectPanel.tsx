"use client";

import Link from "next/link";
import { useState } from "react";
import { useIdentity } from "./useIdentity";
import { PROVIDERS } from "./providers";
import Modal from "./Modal";
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
 */
export default function ConnectPanel({
  authError,
  merged = false,
}: {
  authError?: string;
  /** `?merged=1` — two accounts were just joined into this one. */
  merged?: boolean;
}) {
  const { identity, error, signIn } = useIdentity();
  const [joining, setJoining] = useState<null | "asking" | "arming">(null);
  const message = error ?? describeAuthError(authError);

  /**
   * Arm the merge, then start the other account's sign-in.
   *
   * The order matters: the cookie has to exist before the browser leaves, and it
   * can only be minted while THIS account's session is live — that token is the
   * proof for the half of the merge that OAuth cannot prove
   * (lib/merge-intent.ts).
   */
  async function join(provider: "github" | "x") {
    setJoining("arming");
    try {
      const res = await fetch("/api/account/merge", { method: "POST" });
      if (!res.ok) throw new Error("could not arm");
      // `true`: sign in AS that account, do not try to link it. Linking is
      // exactly what cannot work here — its provider identity belongs to the
      // other auth user, which is why there are two accounts in the first place.
      await signIn(provider, "/profile", true);
    } catch {
      setJoining(null);
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
                </>
              ) : (
                <>
                  {/* The domain, not the brand name: the row then reads the
                      same shape before and after — `x.com` → `x.com/you`. */}
                  <span className="mono text-mute">{p.domain}</span>
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
                </>
              )}
            </li>
          );
        })}
      </ul>

      {merged && (
        <p aria-live="polite" className="text-sm text-accent-text">
          Joined. Both handles are on this account now.
        </p>
      )}

      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}

      {/* Two accounts, one person. It happens when a second handle was verified
          before the two could be linked, and the way out cannot be automatic:
          moving a handle between accounts takes proof from both sides. This is
          the side the interface can ask for. */}
      {mine && (
        <>
          <button
            className="btn btn-quiet btn-sm"
            onClick={() => setJoining("asking")}
          >
            My other handle is on a separate account
          </button>

          <Modal
            open={joining !== null}
            onClose={() => setJoining(null)}
            labelledBy="join-title"
          >
            <div className="p-5">
              <h2 id="join-title" className="font-bold">
                Join that account into this one
              </h2>
              <p className="mt-1 text-sm text-mute">
                Sign in as it. Its handle, card and payout address move here.
              </p>
            </div>

            <ul className="divide-y divide-line border-t border-line text-sm">
              <li className="p-5 text-dim">
                Escrow is untouched — it belongs to the handle, not to the
                account.
              </li>
              <li className="p-5 text-dim">
                That account&rsquo;s login is removed. Supabase cannot merge two
                logins, so afterwards you sign in here with{" "}
                <span className="mono">
                  {kindUrlPrefix(mine.kind)}
                  {mine.handle}
                </span>
                .
              </li>
              <li className="p-5 text-dim">
                If both accounts have a handle on the same platform, nothing
                moves — there is only one slot per platform.
              </li>
            </ul>

            <div className="flex flex-wrap items-center gap-2 border-t border-line p-5">
              {PROVIDERS.filter((p) => (mine ? mine[p.key] === null : true)).map(
                (p) => (
                  <button
                    key={p.key}
                    className="btn btn-primary btn-sm"
                    disabled={joining === "arming" || (p.key === "x" && !X_ENABLED)}
                    onClick={() => void join(p.key)}
                  >
                    {joining === "arming" && (
                      <span className="spinner" aria-hidden />
                    )}
                    {p.mark}
                    Sign in as {p.label}
                  </button>
                ),
              )}
              <button
                className="btn btn-quiet btn-sm ml-auto"
                onClick={() => setJoining(null)}
                disabled={joining === "arming"}
              >
                Cancel
              </button>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
