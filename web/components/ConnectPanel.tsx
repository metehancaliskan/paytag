"use client";

import Link from "next/link";
import { useIdentity } from "./useIdentity";
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
 */
export default function ConnectPanel({ authError }: { authError?: string }) {
  const { identity, error, signIn } = useIdentity();
  const message = error ?? describeAuthError(authError);

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

      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
    </div>
  );
}
