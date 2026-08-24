"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { identityList, useIdentity } from "./useIdentity";
import { KIND, type IdentityKind } from "@/lib/identity";
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
  // on every render, and using it as a dependency would re-query forever.
  const signature = mine.map((v) => `${v.kind}:${v.handle}`).join(",");

  const [rows, setRows] = useState<PayoutRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase || signature === "") return;
    let alive = true;

    void (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) throw new Error("no session");

        // One pass for both identities: a screen that shows them side by side
        // would otherwise flicker on every switch.
        const [ids, prefs] = await Promise.all([
          supabase
            .from("identities")
            .select("id, kind, handle")
            .eq("profile_id", auth.user.id),
          supabase.from("payout_prefs").select("identity_id, address"),
        ]);
        if (ids.error) throw ids.error;
        if (!alive) return;

        const address = new Map(
          (prefs.data ?? []).map((p) => {
            const row = p as { identity_id?: unknown; address?: unknown };
            return [String(row.identity_id), row.address];
          }),
        );

        const next: PayoutRow[] = [];
        for (const r of ids.data ?? []) {
          const row = r as { id?: unknown; kind?: unknown; handle?: unknown };
          const kind: IdentityKind | null =
            row.kind === KIND.GithubUser || row.kind === KIND.XUser
              ? row.kind
              : null;
          if (typeof row.id !== "string" || kind === null) continue;
          const saved = address.get(row.id);
          next.push({
            identityId: row.id,
            kind,
            handle: typeof row.handle === "string" ? row.handle : "",
            // A row that fails validation counts as absent rather than shown:
            // an address we would refuse to sign for must not be displayed as
            // the one that will be paid.
            saved: isPayoutAddress(saved) ? saved : null,
          });
        }
        next.sort((a, b) => a.kind - b.kind);
        setRows(next);
      } catch {
        if (alive) setFailed(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [supabase, signature]);

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
