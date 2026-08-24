"use client";

import Link from "next/link";
import { useIdentity } from "./useIdentity";
import { CheckMark, GithubMark, XMark } from "./icons";
import { describeAuthError } from "@/lib/auth-errors";
import { KIND, kindUrlPrefix, slugOf, type IdentityKind } from "@/lib/identity";
import { X_ENABLED } from "@/lib/config";

/**
 * Where "Connect GitHub" in the account menu leads.
 *
 * One job: bind an account to this browser session. It does not show escrow
 * balances or a claim button — /claim does that, and a page that tries to be
 * both ends up explaining itself twice.
 *
 * Two providers, one row each, because they are independent: a person can hold
 * a verified GitHub handle and a verified X handle, and each one has its own
 * escrow. Signing out is one button because the session is one session.
 */
export default function ConnectPanel({ authError }: { authError?: string }) {
  const { identity, error, signIn, signOut } = useIdentity();
  const message = error ?? describeAuthError(authError);

  const off = identity.status === "off";
  const loading = identity.status === "loading";
  const github = identity.status === "verified" ? identity.github : null;
  const x = identity.status === "verified" ? identity.x : null;
  const anySigned = github !== null || x !== null;

  if (off) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-bold">Not configured here</h2>
        <p className="mt-1 text-sm text-mute">
          This deployment has no Supabase project, so no account can be
          verified. See <span className="mono">docs/SETUP-AUTH.md</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card divide-y divide-line">
        <Row
          icon={<GithubMark size={20} />}
          name="GitHub"
          kind={KIND.GithubUser}
          verified={github}
          loading={loading}
          available
          onConnect={() => void signIn("github", "/profile")}
        />
        <Row
          icon={<XMark size={18} />}
          name="X"
          kind={KIND.XUser}
          verified={x}
          loading={loading}
          available={X_ENABLED}
          unavailableNote="Not enabled on this deployment yet — SPEC §7.4."
          onConnect={() => void signIn("x", "/profile")}
        />

        {anySigned && (
          <div className="flex flex-wrap items-center gap-3 p-4">
            <Link className="btn btn-primary" href="/app/submit">
              Submit yourself
            </Link>
            <Link className="btn btn-ghost" href="/claim">
              Claim your escrow
            </Link>
            <button
              className="btn btn-quiet ml-auto"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        )}

        {message && (
          <p role="alert" className="p-4 text-sm text-danger">
            {message}
          </p>
        )}
      </div>

      {!anySigned && !loading && (
        <ul className="grid gap-3 text-sm text-mute sm:grid-cols-3">
          <li className="card p-4">
            <span className="badge">reads</span>
            <p className="mt-2">Your username and account id. Nothing else.</p>
          </li>
          <li className="card p-4">
            <span className="badge">never</span>
            <p className="mt-2">Your code, your posts, your wallet keys.</p>
          </li>
          <li className="card p-4">
            <span className="badge">then</span>
            <p className="mt-2">
              You pick the wallet. Signing out undoes the link.
            </p>
          </li>
        </ul>
      )}

      {anySigned && (
        <p className="text-xs leading-relaxed text-mute">
          Each identity holds its own escrow, and each one can carry its own
          card. Verifying both links them on your pages; it does not merge the
          money.
        </p>
      )}
    </div>
  );
}

function Row({
  icon,
  name,
  kind,
  verified,
  loading,
  available,
  unavailableNote,
  onConnect,
}: {
  icon: React.ReactNode;
  name: string;
  kind: IdentityKind;
  verified: { handle: string } | null;
  loading: boolean;
  available: boolean;
  unavailableNote?: string;
  onConnect: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-raised"
      >
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        {loading ? (
          <div className="skeleton h-5 w-40" />
        ) : verified ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">@{verified.handle}</span>
              <span className="badge badge-claimed">
                <CheckMark />
                verified
              </span>
            </div>
            <Link
              className="text-xs text-mute hover:text-text"
              href={`/p/${slugOf(kind)}/${verified.handle}`}
            >
              {kindUrlPrefix(kind)}
              {verified.handle} →
            </Link>
          </>
        ) : (
          <>
            <p className="font-semibold">{name}</p>
            <p className="text-xs text-mute">
              {available
                ? "Proves the handle is yours, so escrow can pay out to your wallet."
                : unavailableNote}
            </p>
          </>
        )}
      </div>

      {!loading && !verified && (
        <button
          className="btn btn-ghost"
          onClick={onConnect}
          disabled={!available}
        >
          Connect
        </button>
      )}
    </div>
  );
}
