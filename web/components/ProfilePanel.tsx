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
import { groupByAsset, named, unnamed } from "@/lib/assets";
import { DEFAULT_TOKEN } from "@/lib/config";

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
  // One headline figure, and it is one asset's — adding XLM to USDC would
  // produce a number that is not any amount of anything. The rest of the assets
  // get their own line under it rather than a count ("2 in another asset"),
  // which named no amount and so could not be read as money.
  const assets = named(groupByAsset(pending));
  const strangers = unnamed(groupByAsset(pending));
  const lead = assets[0] ?? null;
  const rest = assets.slice(1);
  const headlineAsset = lead?.token ?? DEFAULT_TOKEN;
  const total = lead?.units ?? 0n;

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
            title={
              loadError
                ? undefined
                : `${fromUnits(total, headlineAsset.decimals)} ${headlineAsset.symbol}`
            }
          >
            {loadError ? (
              <span className="text-mute">?</span>
            ) : (
              displayUnits(total, headlineAsset.decimals)
            )}{" "}
            <span className="text-lg font-semibold text-dim">
              {headlineAsset.symbol}
            </span>
          </p>
        )}

        {/* Every other asset waiting on this handle, as an amount rather than
            a tally. The escrow holds whatever it was sent; a screen that counts
            those payments without naming them tells the sender that something
            is there and refuses to say what. */}
        {rest.length > 0 && !loadError && (
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {rest.map((a) => (
              <span
                key={a.contractId}
                className="num text-sm font-semibold text-dim"
                title={`${fromUnits(a.units, a.token.decimals)} ${a.token.symbol}`}
              >
                {displayUnits(a.units, a.token.decimals)}{" "}
                <span className="text-xs font-semibold text-mute">
                  {a.token.symbol}
                </span>
              </span>
            ))}
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
              {strangers.length > 0 && (
                <>
                  {" "}
                  · {strangers.reduce((n, a) => n + a.ids.length, 0)} in an
                  asset this app cannot name
                </>
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
