"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { identityList, useIdentity } from "./useIdentity";
import { type IdentityKind } from "@/lib/identity";
import { isPayoutAddress } from "@/lib/payout";

/**
 * The reader's saved payout addresses, one per identity.
 *
 * Two screens need this answer and must agree on it: the profile page, where it
 * is set, and the claim screen, where the money actually goes. If they read it
 * differently, the destination shown is not the destination signed for — and
 * /api/verify/claim-auth would refuse the claim with a message about an address
 * the reader was never shown.
 *
 * `payout_prefs` is readable only by its owner (RLS), so this returns rows for
 * the signed-in reader and nothing else. An empty address is not a missing
 * setting: it means "pay whatever wallet is connected", which is the default.
 *
 * The identities come from `useIdentity`, which fetched them once for the whole
 * page. This used to re-read `identities` (and the session) itself, which is two
 * requests for an answer already on screen — and two answers that could differ.
 */
export type PayoutRow = {
  identityId: string;
  kind: IdentityKind;
  handle: string;
  /** The locked destination, or null for "the connected wallet". */
  saved: string | null;
};

export function usePayout() {
  const supabase = useMemo(() => browserSupabase(), []);
  const { identity } = useIdentity();

  const mine = identityList(identity);
  // A stable key for the identities we are looking up: `mine` is a fresh array
  // on every render, and using it as a dependency would re-query forever. The
  // ids, not the names — the writes are all by id, and a re-verified handle
  // keeps its name and changes its id.
  const signature = mine.map((v) => v.id).join(",");

  const [rows, setRows] = useState<PayoutRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    void (async () => {
      try {
        // No identity, nothing to look up — and `rows` must become an empty
        // list rather than staying null. A caller that renders a skeleton while
        // this is null would otherwise show it forever to a signed-out reader,
        // which is exactly how a settings page ends up looking broken.
        if (identity.status === "loading") return;
        if (identity.status !== "verified") {
          if (alive) setRows([]);
          return;
        }

        // One request, for the one thing this hook actually owns.
        const prefs = await supabase
          .from("payout_prefs")
          .select("identity_id, address");
        if (prefs.error) throw prefs.error;
        if (!alive) return;

        const address = new Map(
          (prefs.data ?? []).map((p) => {
            const row = p as { identity_id?: unknown; address?: unknown };
            return [String(row.identity_id), row.address];
          }),
        );

        const next: PayoutRow[] = mine.map((v) => {
          const saved = address.get(v.id);
          return {
            identityId: v.id,
            kind: v.kind,
            handle: v.handle,
            // A row that fails validation counts as absent rather than shown:
            // an address we would refuse to sign for must not be displayed as
            // the one that will be paid.
            saved: isPayoutAddress(saved) ? saved : null,
          };
        });
        next.sort((a, b) => a.kind - b.kind);
        setRows(next);
      } catch {
        if (alive) setFailed(true);
      }
    })();

    return () => {
      alive = false;
    };
    // `mine` is deliberately not a dependency: it is a fresh array on every
    // render, and `signature` is the value of it that can actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, signature, identity.status]);

  /** Reflect a write locally, so a save does not need a round trip to show. */
  const setSaved = useCallback((identityId: string, saved: string | null) => {
    setRows((current) =>
      (current ?? []).map((r) =>
        r.identityId === identityId ? { ...r, saved } : r,
      ),
    );
  }, []);

  const savedFor = useCallback(
    (kind: IdentityKind | null | undefined): string | null =>
      (rows ?? []).find((r) => r.kind === kind)?.saved ?? null,
    [rows],
  );

  return { rows, failed, loading: rows === null && !failed, setSaved, savedFor };
}
