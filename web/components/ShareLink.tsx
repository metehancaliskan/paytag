"use client";

import { useSyncExternalStore } from "react";
import CopyButton from "./CopyButton";

// The page origin, read without an effect and without a hydration mismatch:
// React uses the server snapshot ("") while rendering on the server and during
// hydration, then swaps in the client value. Nothing to subscribe to — the
// origin never changes for the life of the document.
const NO_SUBSCRIBE = () => () => {};
const clientOrigin = () => window.location.origin;
const serverOrigin = () => "";

/**
 * The shareable pay link for an identity.
 *
 * The origin is read from the browser rather than baked in at build time, so
 * the same page yields a working link on localhost, on a preview deployment
 * and in production without a NEXT_PUBLIC_SITE_URL to keep in sync.
 */
export default function ShareLink({ path }: { path: string }) {
  const origin = useSyncExternalStore(
    NO_SUBSCRIBE,
    clientOrigin,
    serverOrigin,
  );
  const url = origin ? `${origin}${path}` : path;

  return (
    <div className="card p-4">
      <p className="text-xs text-mute">Shareable pay link</p>
      <p className="mono mt-1 truncate text-dim" title={url}>
        {url}
      </p>
      <div className="mt-2">
        <CopyButton
          value={url}
          label="Copy link"
          className="btn btn-ghost btn-sm"
        />
      </div>
    </div>
  );
}
