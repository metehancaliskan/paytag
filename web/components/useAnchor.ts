"use client";

import { useEffect, useState } from "react";
import { ANCHOR_ENABLED } from "@/lib/anchor/config";
import { loadAnchor, type AnchorInfo } from "@/lib/anchor/toml";

/**
 * The anchor, discovered once and shared.
 *
 * SEP-1 discovery is a network round trip that answers the same thing every
 * time within a session, and two screens need it now — the send form, to offer
 * paying with lira, and the top-up panel, to do it. The promise is cached
 * rather than the result, so two components mounting in the same tick make one
 * request between them instead of two.
 *
 * A failure is not thrown at the caller: no anchor simply means no fiat door,
 * and every screen here has something else to be getting on with. `anchor` is
 * null until it loads and stays null if it never does.
 */
let pending: Promise<AnchorInfo> | null = null;

function discover(): Promise<AnchorInfo> {
  if (!pending) {
    pending = loadAnchor().catch((e) => {
      // A failed discovery must not be cached as a permanent no: the anchor
      // could be briefly unreachable, and a reader who opens the page again
      // deserves a fresh attempt.
      pending = null;
      throw e;
    });
  }
  return pending;
}

export type AnchorState = {
  anchor: AnchorInfo | null;
  /** Why there is no anchor, when the reason is worth showing. */
  error: string | null;
  loading: boolean;
};

export function useAnchor(): AnchorState {
  const [state, setState] = useState<AnchorState>({
    anchor: null,
    error: null,
    loading: ANCHOR_ENABLED,
  });

  useEffect(() => {
    if (!ANCHOR_ENABLED) return;
    let alive = true;

    void (async () => {
      try {
        const anchor = await discover();
        if (alive) setState({ anchor, error: null, loading: false });
      } catch (e) {
        if (alive) {
          setState({
            anchor: null,
            error: e instanceof Error ? e.message : String(e),
            loading: false,
          });
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return state;
}
