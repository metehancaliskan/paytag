"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useWallet } from "./WalletProvider";
import { useLiveRewards } from "./useLiveRewards";
import { AssetMark } from "./icons";
import { sign, networkMismatch } from "@/lib/freighter";
import { submitSigned, tokenBalance } from "@/lib/contract";
import { describeEscrowError } from "@/lib/stellar";
import { displayUnits, fromUnits, toUnits } from "@/lib/format";
import { TOKENS, explorerContract, explorerTx, type TokenConfig } from "@/lib/config";
import { BLEND_ENABLED, BLEND_POOL_ID, BLEND_POOL_NAME } from "@/lib/blend/config";
import {
  buildClaim,
  buildSupply,
  buildWithdraw,
  loadPositions,
  loadReserve,
  reserveAssets,
  splitWithdraw,
  supplyEmissionId,
  type BlendPosition,
  type Reserve,
} from "@/lib/blend/pool";

/**
 * What to do with the money after it has been claimed.
 *
 * A claim leaves somebody holding a balance on a network they did not ask to
 * be on. Two of the three answers already exist on this page — keep it in the
 * wallet, or turn it into lira at the bank. This is the third: lend it on
 * Blend, where borrowers pay interest for it and the protocol pays BLND on
 * top.
 *
 * It is offered here and NOT on the escrow, and the difference is the whole
 * design. Money waiting on a handle has not been accepted by anybody yet;
 * lending it would put a third party's credit risk between an escrow and its
 * promise, and Blend is explicit that bad debt, if the backstop cannot cover
 * it, is socialised across every supplier of that asset. Once claimed, the
 * money is the claimant's, the risk is theirs to take, and the only thing this
 * panel does is make it one click instead of a tab.
 */

type Row = {
  token: TokenConfig;
  reserve: Reserve;
  /** In the wallet, spendable. */
  wallet: bigint;
  /**
   * Lent to the pool, with whatever interest has accrued — both kinds.
   *
   * `supply` is what this panel creates; `collateral` is what Blend's own
   * interface creates. Somebody who used both has money in both, and a screen
   * that counted one of them would be telling them money was missing.
   */
  earning: { supply: bigint; collateral: bigint; total: bigint };
};

export default function EarnPanel() {
  const { address } = useWallet();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: string; what: string } | null>(null);
  const [tick, setTick] = useState(0);

  const amountId = useId();
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!BLEND_ENABLED || !address) return;
    let alive = true;

    void (async () => {
      try {
        // Which of the assets this app knows does the pool actually take? The
        // answer is the pool's, not ours: a token we offer that it has never
        // heard of simply has no row.
        const assets = await reserveAssets();
        const mine = TOKENS.filter((t) => assets.includes(t.contractId));

        const reserves = await Promise.all(
          mine.map((t) => loadReserve(t.contractId, assets.indexOf(t.contractId))),
        );
        const [positions, balances] = await Promise.all([
          loadPositions(address, reserves),
          Promise.all(
            mine.map((t) =>
              tokenBalance(address, t.contractId).catch(() => 0n),
            ),
          ),
        ]);
        if (!alive) return;

        setRows(
          mine.map((token, i) => {
            const pos = positions.find(
              (p: BlendPosition) => p.asset === token.contractId,
            );
            return {
              token,
              reserve: reserves[i],
              wallet: balances[i],
              earning: {
                supply: pos?.supply ?? 0n,
                collateral: pos?.collateral ?? 0n,
                total: pos?.underlying ?? 0n,
              },
            };
          }),
        );
        setError(null);
      } catch (e) {
        if (alive) setError(describeEscrowError(e));
      }
    })();

    return () => {
      alive = false;
    };
  }, [address, tick]);

  const row = rows?.find((r) => r.token.key === picked) ?? rows?.[0] ?? null;

  /**
   * The reward, redrawn while you watch it.
   *
   * BLND accrues every ledger and the amounts here are small enough that the
   * seventh decimal place moves about once a second — which is exactly the
   * scale at which a static number looks broken and a moving one tells the
   * truth. `tick` is passed so that a claim, which resets the counter to zero,
   * is picked up immediately rather than up to five seconds later.
   */
  const { shown: rewards, measured: claimable } = useLiveRewards(
    address,
    (rows ?? []).map((r) => supplyEmissionId(r.reserve.index)),
    tick,
  );

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

  if (!BLEND_ENABLED || !address) return null;

  const units = (() => {
    if (!row || amount.trim() === "") return null;
    try {
      const u = toUnits(amount, row.token.decimals);
      return u > 0n ? u : null;
    } catch {
      return null;
    }
  })();

  const anyEarning = (rows ?? []).some((r) => r.earning.total > 0n);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Put it to work</h2>
        <span className="text-xs text-mute">
          via{" "}
          <a
            className="link"
            href={explorerContract(BLEND_POOL_ID)}
            target="_blank"
            rel="noreferrer"
          >
            {BLEND_POOL_NAME}
          </a>
        </span>
      </div>
      <p className="mt-1 text-sm text-dim">
        Lend what you claimed. Borrowers pay interest for it, the pool pays BLND
        on top, and you can take it back whenever you like.
      </p>

      {rows === null ? (
        <div className="mt-4 skeleton h-24 w-full" />
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-mute">
          This pool does not take any of the assets Paytag pays out.
        </p>
      ) : (
        <>
          <ul
            className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line"
            role="radiogroup"
            aria-label="Asset"
          >
            {rows.map((r) => {
              const on = r.token.key === row?.token.key;
              return (
                <li key={r.token.key}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setPicked(r.token.key);
                      setAmount("");
                    }}
                    disabled={busy !== null}
                    className={`flex w-full items-center gap-3 p-3 text-left transition-colors ${
                      on ? "bg-raised" : "hover:bg-raised"
                    }`}
                  >
                    <AssetMark
                      asset={r.token.key === "XLM" ? "XLM" : "USDC"}
                      size={24}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-semibold">
                        {r.token.symbol}
                      </span>
                      <span className="mt-0.5 block text-xs text-mute">
                        <span className="num">
                          {displayUnits(r.wallet, r.token.decimals)}
                        </span>{" "}
                        in your wallet
                      </span>
                    </span>
                    {/* The number this panel exists for, on the row it belongs
                        to. Zero is shown as nothing rather than as "0": a row
                        with no position has nothing to say about earnings. */}
                    {r.earning.total > 0n && (
                      <span
                        className="num shrink-0 text-right text-sm font-bold text-accent-text"
                        title={`${fromUnits(r.earning.total, r.token.decimals)} ${r.token.symbol}`}
                      >
                        {displayUnits(r.earning.total, r.token.decimals)}
                        <span className="block text-[11px] font-medium text-mute">
                          earning
                        </span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {row && (
            <div className="mt-4">
              <label className="label" htmlFor={amountId}>
                Amount in {row.token.symbol}
              </label>
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
                <span className="input-suffix">{row.token.symbol}</span>
                {row.wallet > 0n && (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() =>
                      setAmount(fromUnits(row.wallet, row.token.decimals))
                    }
                    disabled={busy !== null}
                  >
                    Max
                  </button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy !== null || units === null}
                  onClick={() =>
                    void run(`Lent ${amount} ${row.token.symbol}`, () =>
                      buildSupply(address, row.token.contractId, units!),
                    )
                  }
                >
                  {busy !== null && <span className="spinner" aria-hidden />}
                  {busy ?? "Lend it"}
                </button>

                {row.earning.total > 0n && (
                  <>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy !== null || units === null}
                      onClick={() =>
                        void run(`Took back ${amount} ${row.token.symbol}`, () =>
                          buildWithdraw(
                            address,
                            row.token.contractId,
                            splitWithdraw(units!, row.earning),
                          ),
                        )
                      }
                    >
                      Take back
                    </button>
                    {/* Asking for more than a position holds is not an error:
                        the pool settles it down to whatever that position is
                        worth at that ledger. It is the only way to empty a
                        position that grows between the read and the click. */}
                    <button
                      className="btn btn-quiet btn-sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(`Took back all your ${row.token.symbol}`, () =>
                          buildWithdraw(address, row.token.contractId, {
                            supply: row.earning.supply * 2n + 1_000_000n,
                            collateral:
                              row.earning.collateral * 2n + 1_000_000n,
                          }),
                        )
                      }
                    >
                      Take it all back
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Rewards are a separate token on a separate clock, so they get a
              separate line rather than being folded into a balance they are
              not part of. */}
          {(claimable > 0n || anyEarning) && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
              <span className="text-sm">
                {/* Tabular figures, so a digit changing does not shuffle the
                    ones beside it. Seven decimal places because that is where
                    the movement is at these amounts — rounding it to two would
                    show a number that never changes. */}
                <span className="num font-bold tabular-nums text-accent-text">
                  {fromUnits(rewards, 7)}
                </span>{" "}
                <span className="text-xs font-semibold text-dim">BLND</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-mute">
                  {claimable > 0n && (
                    <span
                      aria-hidden
                      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
                    />
                  )}
                  earning right now, on top of the interest
                </span>
              </span>
              {claimable > 0n && (
                <button
                  className="btn btn-ghost btn-sm ml-auto"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("Collected your BLND", () =>
                      buildClaim(
                        address,
                        (rows ?? []).map((r) => supplyEmissionId(r.reserve.index)),
                      ),
                    )
                  }
                >
                  Collect
                </button>
              )}
            </div>
          )}
        </>
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

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
