"use client";

import { useCallback, useEffect, useState } from "react";
import SendForm from "./SendForm";
import PaymentList from "./PaymentList";
import {
  latestLedger,
  listPaymentsForIdentity,
  STATUS,
  type Payment,
} from "@/lib/contract";
import { describeEscrowError } from "@/lib/stellar";
import { type IdentityKind } from "@/lib/identity";
import { displayUnits, fromUnits } from "@/lib/format";
import { DEFAULT_TOKEN, tokenByContractId } from "@/lib/config";

type Props = { handle: string; identityHex: string; kind: IdentityKind };

export default function ProfilePanel({ handle, identityHex, kind }: Props) {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [ledger, setLedger] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Reload trigger. Fetching inside the effect, together with the `alive`
  // flag, keeps a late response from a previous identity from overwriting the
  // state of the one now on screen.
  const [tick, setTick] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // Derived rather than a separate flag set on the way into the effect: a read
  // is in flight exactly while the generation we have loaded trails the one
  // being asked for. Keyed by identity as well as by tick, so navigating from
  // one profile to another also reads as loading.
  const wantKey = `${identityHex}:${tick}`;
  const reloading = loadedKey !== wantKey;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, seq] = await Promise.all([
          listPaymentsForIdentity(identityHex),
          latestLedger(),
        ]);
        if (!alive) return;
        setPayments(list);
        setLedger(seq);
        setLoadError(null);
      } catch (e) {
        if (!alive) return;
        setLoadError(describeEscrowError(e));
        setPayments([]);
      } finally {
        if (alive) setLoadedKey(wantKey);
      }
    })();
    return () => {
      alive = false;
    };
  }, [identityHex, tick, wantKey]);

  const pending = (payments ?? []).filter((p) => p.status === STATUS.Pending);
  // The headline number sums one asset only — adding XLM to USDC would produce
  // a figure that means nothing. The default asset leads; anything else is
  // counted separately below it.
  const headlineAsset = DEFAULT_TOKEN;
  const inHeadline = pending.filter(
    (p) => tokenByContractId(p.token)?.key === headlineAsset.key,
  );
  const otherAssets = pending.filter(
    (p) => tokenByContractId(p.token)?.key !== headlineAsset.key,
  );
  const total = inHeadline.reduce((acc, p) => acc + p.amount, 0n);

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------- balance */}
      <div className="card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-mute">Waiting to be claimed</span>
          <button
            className="btn btn-quiet"
            onClick={refresh}
            disabled={reloading}
          >
            {reloading && <span className="spinner" aria-hidden />}
            {reloading ? "Reading…" : "Refresh"}
          </button>
        </div>

        {payments === null ? (
          <div className="mt-2 skeleton h-9 w-40" />
        ) : (
          // A failed read must not render as a confident zero — "0 USDC in
          // escrow" and "we could not ask" are very different facts.
          <p
            className="num mt-1 text-3xl font-bold tracking-tight text-accent-text"
            title={loadError ? undefined : `${fromUnits(total)} ${headlineAsset.symbol}`}
          >
            {loadError ? (
              <span className="text-mute">?</span>
            ) : (
              displayUnits(total)
            )}{" "}
            <span className="text-lg font-semibold text-dim">
              {headlineAsset.symbol}
            </span>
          </p>
        )}

        <p className="mt-1 text-sm text-mute">
          {payments === null ? (
            "reading from the chain"
          ) : loadError ? (
            "the chain could not be read"
          ) : (
            // No "GitHub · @handle" here: the whole page is about them, and
            // the identity card says it once already.
            <>
              {pending.length} waiting
              {payments.length > pending.length && (
                <> · {payments.length - pending.length} settled</>
              )}
              {otherAssets.length > 0 && (
                <> · {otherAssets.length} in another asset</>
              )}
            </>
          )}
        </p>

        {loadError && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {loadError}
          </p>
        )}
      </div>

      {/* ---------------------------------------------------------- send */}
      <SendForm
        handle={handle}
        kind={kind}
        identityHex={identityHex}
        ledger={ledger}
        onSent={refresh}
      />

      {/* ------------------------------------------------------ payments */}
      <PaymentList
        payments={payments}
        ledger={ledger}
        failed={loadError !== null}
        onRefunded={refresh}
      />
    </div>
  );
}
