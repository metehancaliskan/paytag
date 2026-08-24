"use client";

import Link from "next/link";
import { useIdentity } from "./useIdentity";
import { CheckMark, GithubMark } from "./icons";
import { describeAuthError } from "@/lib/auth-errors";

/**
 * Where "Connect GitHub" in the account menu leads.
 *
 * One job: bind a GitHub account to this browser session. It does not show
 * escrow balances or a claim button — /claim does that, and a page that tries
 * to be both ends up explaining itself twice.
 */
export default function ConnectPanel({ authError }: { authError?: string }) {
  const { identity, error, signIn, signOut } = useIdentity();
  const message = error ?? describeAuthError(authError);

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex items-start gap-4">
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-raised"
          >
            <GithubMark size={22} />
          </span>

          <div className="min-w-0 flex-1">
            {identity.status === "verified" ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold">@{identity.handle}</h2>
                  <span className="badge badge-claimed">
                    <CheckMark />
                    verified
                  </span>
                </div>
                <p className="mt-1 text-sm text-mute">
                  Anything paid to this handle is yours to withdraw.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Link className="btn btn-primary" href="/claim">
                    Go to claim
                  </Link>
                  <Link
                    className="btn btn-ghost"
                    href={`/p/gh/${identity.handle}`}
                  >
                    View the page
                  </Link>
                  <button className="btn btn-quiet ml-auto" onClick={signOut}>
                    Sign out
                  </button>
                </div>
              </>
            ) : identity.status === "loading" ? (
              <div className="space-y-2">
                <div className="skeleton h-5 w-40" />
                <div className="skeleton h-9 w-52" />
              </div>
            ) : identity.status === "off" ? (
              <>
                <h2 className="text-lg font-bold">Not configured here</h2>
                <p className="mt-1 text-sm text-mute">
                  This deployment has no Supabase project, so no account can be
                  verified. See <span className="mono">docs/SETUP-AUTH.md</span>.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold">Connect your GitHub</h2>
                <p className="mt-1 text-sm text-mute">
                  Proves the handle is yours, so the escrow can pay out to a
                  wallet you name.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    className="btn btn-primary"
                    onClick={() => void signIn("/connect")}
                  >
                    <GithubMark size={16} />
                    Continue with GitHub
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled
                    title="Waiting on X API access — SPEC §7.4"
                  >
                    Continue with X
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {message && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {message}
          </p>
        )}
      </div>

      {identity.status === "anon" && (
        <ul className="grid gap-3 text-sm text-mute sm:grid-cols-3">
          <li className="card p-4">
            <span className="badge">reads</span>
            <p className="mt-2">Your username and account id. Nothing else.</p>
          </li>
          <li className="card p-4">
            <span className="badge">never</span>
            <p className="mt-2">Your code, your email, your wallet keys.</p>
          </li>
          <li className="card p-4">
            <span className="badge">then</span>
            <p className="mt-2">
              You pick the wallet. Signing out undoes the link.
            </p>
          </li>
        </ul>
      )}
    </div>
  );
}
