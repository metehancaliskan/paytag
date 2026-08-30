"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Deliberately imports nothing from lib/: the most likely reason we are here
 * is that `lib/config.ts` threw because an environment variable is missing,
 * and an error page that re-triggers the same error is not an error page.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[paytag]", error);
  }, [error]);

  const missingEnv = error.message.includes("Missing environment variable");

  return (
    <div className="mx-auto max-w-xl py-10">
      <p className="badge badge-pending">error</p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">
        {missingEnv ? "This app is not configured yet" : "Something broke"}
      </h1>

      <p className="mt-3 leading-relaxed text-dim">
        {missingEnv ? (
          <>
            The page cannot render because a required environment variable is
            missing. Copy <span className="mono">.env.example</span> to{" "}
            <span className="mono">web/.env.local</span>, fill in the contract
            addresses and the RPC endpoint, and restart the dev server.
          </>
        ) : (
          <>
            The failure is below. Nothing was signed and nothing was sent.
            This app never moves money without a wallet confirmation.
          </>
        )}
      </p>

      <pre className="card mt-5 overflow-x-auto p-4 text-xs leading-relaxed text-dim">
        {error.message}
      </pre>

      <div className="mt-5 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <Link className="btn btn-ghost" href="/">
          Back to the start
        </Link>
      </div>

      {error.digest && (
        <p className="mono mt-4 text-mute">digest {error.digest}</p>
      )}
    </div>
  );
}
