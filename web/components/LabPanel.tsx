"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useWallet } from "./WalletProvider";
import LiveAmount from "./LiveAmount";
import { AssetMark } from "./icons";
import { sign, networkMismatch } from "@/lib/freighter";
import { latestLedger, submitSigned, tokenBalance } from "@/lib/contract";
import { describeEscrowError } from "@/lib/stellar";
import { displayUnits, fromUnits, toUnits } from "@/lib/format";
import { DEFAULT_TOKEN, explorerContract, explorerTx } from "@/lib/config";
import { loadReserve, reserveAssets } from "@/lib/blend/pool";
import { BLEND_POOL_NAME } from "@/lib/blend/config";
import {
  indexRatePerMs,
  positionValue,
  projectIndex,
  type IndexSample,
} from "@/lib/xoxno/earning";
import {
  LAB_ENABLED,
  LAB_ESCROW_ID,
  STATUS,
  buildClaim,
  buildDeposit,
  buildRefund,
  listPayments,
  type LabPayment,
} from "@/lib/lab/escrow";

/**
 * The experiment: an escrow that lends from the moment it is funded.
 *
 * Everything on this page talks to a different contract from the rest of the
 * product. Deposits made here do not appear anywhere else, claims here need no
 * verified handle, and nothing in the app links to it except the address bar.
 * It exists to answer one question with real money on a real pool rather than
 * with an argument: what happens if the waiting itself pays?
 *
 * The figures move because the pool's rate does. The rate is read every few
 * seconds and carried forward in between, the same way the other two earning
 * screens do it, and shown to nine decimals because at these amounts the
 * seventh barely moves.
 */

const POLL_MS = 5_000;
const DRAW_MS = 400;
const WEEK_LEDGERS = 120_960;

export default function LabPanel() {
  const { address, connect, connecting, installed } = useWallet();

  const [payments, setPayments] = useState<LabPayment[] | null>(null);
  const [wallet, setWallet] = useState<bigint>(0n);
  const [ledger, setLedger] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: string; what: string } | null>(null);
  const [tick, setTick] = useState(0);

  // The pool's rate, and what it is doing. One reading is a value; two are a
  // rate; everything between them is drawn from the second.
  const [sample, setSample] = useState<IndexSample | null>(null);
  const [rate, setRate] = useState(0);
  const [now, setNow] = useState<bigint>(0n);

  const amountId = useId();
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const token = DEFAULT_TOKEN;

  useEffect(() => {
    if (!LAB_ENABLED) return;
    let alive = true;

    void (async () => {
      try {
        const [list, seq] = await Promise.all([listPayments(), latestLedger()]);
        if (!alive) return;
        setPayments(list);
        setLedger(seq);
        if (address) setWallet(await tokenBalance(address, token.contractId));
        setError(null);
      } catch (e) {
        if (alive) setError(describeEscrowError(e));
      }
    })();

    return () => {
      alive = false;
    };
  }, [address, tick, token.contractId]);

  // The rate, polled. Reading the pool directly rather than asking the escrow
  // for each payment's value: one call answers for all of them, and it is the
  // number that actually moves.
  useEffect(() => {
    if (!LAB_ENABLED) return;
    let alive = true;
    let previous: IndexSample | null = null;
    let count = 0;
    let timer: ReturnType<typeof setTimeout>;

    const ask = async () => {
      if (typeof document === "undefined" || !document.hidden) {
        try {
          const assets = await reserveAssets();
          const reserve = await loadReserve(
            token.contractId,
            assets.indexOf(token.contractId),
          );
          if (!alive) return;
          const next = { value: reserve.bRate, at: Date.now() };
          setRate(indexRatePerMs(previous, next));
          previous = next;
          count += 1;
          setSample(next);
        } catch {
          // The last reading stays, the projection carries it.
        }
      }
      if (alive) timer = setTimeout(() => void ask(), count < 2 ? 1_200 : POLL_MS);
    };

    void ask();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token.contractId, tick]);

  useEffect(() => {
    if (!sample) return;
    const draw = setInterval(
      () => setNow(projectIndex(sample, rate, Date.now())),
      DRAW_MS,
    );
    return () => clearInterval(draw);
  }, [sample, rate]);

  const bRate = now > 0n ? now : (sample?.value ?? 0n);

  /** A position's worth right now, to nine decimals. */
  const valueOf = (p: LabPayment) =>
    bRate > 0n
      ? positionValue(p.bTokens, 1_000_000_000_000n, bRate)
      : p.principal * 100n;

  async function run(
    what: string,
    build: () => Promise<{ toXdr: () => string }>,
  ) {
    if (!address) return;
    setError(null);
    setDone(null);
    try {
      setBusy("Checking the network…");
      const mismatch = await networkMismatch();
      if (mismatch) throw new Error(mismatch);
      setBusy("Preparing…");
      const tx = await build();
      setBusy("Waiting for your wallet…");
      const signed = await sign(tx.toXdr(), address);
      setBusy("Submitting…");
      const out = await submitSigned(signed);
      setDone({ hash: out.hash, what });
      setAmount("");
      refresh();
    } catch (e) {
      setError(describeEscrowError(e));
    } finally {
      setBusy(null);
    }
  }

  if (!LAB_ENABLED) {
    return (
      <p className="card p-5 text-sm text-mute">
        No laboratory contract is configured here. Set{" "}
        <span className="mono">NEXT_PUBLIC_LAB_ESCROW_ID</span>.
      </p>
    );
  }

  const units = (() => {
    if (amount.trim() === "") return null;
    try {
      const u = toUnits(amount, token.decimals);
      return u > 0n ? u : null;
    } catch {
      return null;
    }
  })();

  const pending = (payments ?? []).filter((p) => p.status === STATUS.Pending);
  const owed = pending.reduce((sum, p) => sum + p.principal, 0n);
  const held = pending.reduce((sum, p) => sum + valueOf(p), 0n);

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Put money aside, lending</h2>
          <a
            className="link text-xs"
            href={explorerContract(LAB_ESCROW_ID)}
            target="_blank"
            rel="noreferrer"
          >
            the lab contract
          </a>
        </div>
        <p className="mt-1 text-sm text-dim">
          The deposit goes straight into {BLEND_POOL_NAME} in the same
          transaction. Whoever ends up with it — the recipient on a claim, the
          sender on a refund — gets what it earned while it waited.
        </p>

        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-2">
            <label className="label" htmlFor={amountId}>
              Amount in {token.symbol}
            </label>
            {address && (
              <span className="num text-xs text-mute">
                {displayUnits(wallet, token.decimals)} {token.symbol} in your
                wallet
              </span>
            )}
          </div>
          <div className="input-group">
            <input
              id={amountId}
              className="input-bare num"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy !== null}
            />
            <span className="input-suffix">{token.symbol}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {installed === false ? (
            <a
              className="btn btn-ghost"
              href="https://www.freighter.app/"
              target="_blank"
              rel="noreferrer"
            >
              Install the Freighter wallet first
            </a>
          ) : !address ? (
            <button
              className="btn btn-primary"
              onClick={connect}
              disabled={connecting}
            >
              {connecting && <span className="spinner" aria-hidden />}
              {connecting ? "Connecting…" : "Connect a wallet"}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={busy !== null || units === null || ledger === null}
              onClick={() =>
                void run(`Put ${amount} ${token.symbol} to work`, () =>
                  buildDeposit({
                    from: address,
                    // A fixed tag: this page is not about identities, and one
                    // tag keeps every experiment in the same list.
                    identity: new Uint8Array(32).fill(1),
                    token: token.contractId,
                    amount: units!,
                    expiryLedger: (ledger ?? 0) + WEEK_LEDGERS,
                  }),
                )
              }
            >
              {busy !== null && <span className="spinner" aria-hidden />}
              {busy ?? "Deposit and lend"}
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        {done && (
          <p className="mt-3 text-sm text-mute">
            {done.what}.{" "}
            <a
              className="link"
              href={explorerTx(done.hash)}
              target="_blank"
              rel="noreferrer"
            >
              The transaction
            </a>
          </p>
        )}
      </div>

      {/* The invariant, on screen. The production escrow can prove it holds
          what it owes by looking at one balance; this one has to value a
          position to know, and that is the whole difference. */}
      {pending.length > 0 && (
        <div className="card flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
          <span>
            <span className="label">Owed to claimants</span>
            <span className="num block text-xl font-bold">
              {fromUnits(owed, 7)} {token.symbol}
            </span>
          </span>
          <span>
            <span className="label">Held in the pool</span>
            <LiveAmount
              value={fromUnits(held, 9)}
              className="num block text-xl font-bold tabular-nums text-accent-text"
            />
          </span>
          <span className="ml-auto text-xs text-mute">
            {held >= owed * 100n
              ? "covered"
              : "NOT covered — the position is worth less than the debt"}
          </span>
        </div>
      )}

      <div className="card divide-y divide-line">
        {payments === null ? (
          <div className="p-5">
            <div className="skeleton h-12 w-full" />
          </div>
        ) : payments.length === 0 ? (
          <p className="p-5 text-sm text-mute">
            Nothing deposited yet. The first one starts earning in the same
            transaction that creates it.
          </p>
        ) : (
          payments.map((p) => {
            const value = valueOf(p);
            const earned = value - p.principal * 100n;
            const settled = p.status !== STATUS.Pending;
            const expired = ledger !== null && ledger > p.expiryLedger;

            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 p-4">
                <AssetMark asset="XLM" size={24} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {settled ? (
                      <span className="num font-semibold text-mute line-through">
                        {fromUnits(p.principal, 7)}
                      </span>
                    ) : (
                      <LiveAmount
                        value={fromUnits(value, 9)}
                        className="num font-bold tabular-nums text-accent-text"
                      />
                    )}
                    <span className="text-xs font-semibold text-dim">
                      {token.symbol}
                    </span>
                    {p.status === STATUS.Claimed && (
                      <span className="badge">claimed</span>
                    )}
                    {p.status === STATUS.Refunded && (
                      <span className="badge">refunded</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-mute">
                    #{p.id} · put in{" "}
                    <span className="num">{fromUnits(p.principal, 7)}</span>
                    {!settled && earned > 0n && (
                      <>
                        {" "}
                        · earned{" "}
                        <span className="num text-accent-text">
                          {fromUnits(earned, 9)}
                        </span>
                      </>
                    )}
                  </span>
                </span>

                {!settled && address && (
                  <span className="flex shrink-0 gap-2">
                    {!expired && (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(`Claimed #${p.id}`, () =>
                            buildClaim(address, p.id, address),
                          )
                        }
                      >
                        Claim it
                      </button>
                    )}
                    {expired && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(`Refunded #${p.id}`, () =>
                            buildRefund(address, p.id),
                          )
                        }
                      >
                        Refund it
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
