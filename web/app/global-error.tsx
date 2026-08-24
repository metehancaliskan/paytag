"use client";

import "./globals.css";

/**
 * The last net. `app/error.tsx` cannot catch a failure thrown while the root
 * layout itself renders — and the root layout reads the environment config, so
 * a missing variable lands exactly there. This file renders its own document
 * and imports nothing but the stylesheet.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const missingEnv = error.message.includes("Missing environment variable");

  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="mx-auto max-w-xl px-5 py-16">
          <span className="badge badge-pending">startup error</span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            {missingEnv ? "Paytag is not configured" : "Paytag failed to start"}
          </h1>

          <p className="mt-3 leading-relaxed text-dim">
            {missingEnv ? (
              <>
                A required environment variable is missing, so the app cannot
                tell which contract to talk to. Copy{" "}
                <span className="mono">.env.example</span> to{" "}
                <span className="mono">web/.env.local</span> and fill it in.
              </>
            ) : (
              "The error is below."
            )}
          </p>

          <pre className="card mt-5 overflow-x-auto p-4 text-xs leading-relaxed text-dim">
            {error.message}
          </pre>

          <button className="btn btn-primary mt-5" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
