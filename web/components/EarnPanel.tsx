"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Image from "next/image";
import { useWallet } from "./WalletProvider";
import { useLiveRewards } from "./useLiveRewards";
import { useLiveLent } from "./useLiveLent";
import LiveAmount from "./LiveAmount";
import { AssetMark } from "./icons";
import { sign, networkMismatch } from "@/lib/freighter";
import { submitSigned, tokenBalance } from "@/lib/contract";
import { describeEscrowError } from "@/lib/stellar";
import { displayUnits, fromUnits, toUnits } from "@/lib/format";
import {
  TOKENS,
  explorerContract,
  explorerTx,
  type TokenConfig,
} from "@/lib/config";
import {
  BLEND_ENABLED,
  BLEND_POOL_ID,
  BLEND_POOL_NAME,
} from "@/lib/blend/config";
import {
  buildClaim,
  buildSupply as blendSupply,
  buildWithdraw as blendWithdraw,
  loadPositions,
  loadReserve,
  reserveAssets,
  splitWithdraw,
  supplyEmissionId,
} from "@/lib/blend/pool";
import { XOXNO_APP_URL, XOXNO_ENABLED } from "@/lib/xoxno/config";
import {
  buildSupply as xoxnoSupply,
  buildWithdrawAll as xoxnoWithdrawAll,
  collateralOf,
  findAccountId,
} from "@/lib/xoxno/lending";

/**
 * What to do with the money after it has been claimed.
 *
 * A claim leaves somebody holding a balance on a network they did not ask to
 * be on. Two of the three answers already exist on this page — keep it in the
 * wallet, or turn it into lira at the bank. This is the third: lend it, and
 * take it back whenever.
 *
 * TWO VENUES IN ONE CARD, not two cards. They answer the same question and
 * take the same three inputs — which asset, how much, in or out — so stacking
 * two of everything made the screen twice as long to say one thing. The choice
 * between them belongs in a control; the reason to care about the choice
 * belongs in one line underneath it.
 *
 * And it is offered to the RECIPIENT, never to the escrow. Money waiting on a
 * handle has not been accepted by anybody yet; lending it would put a third
 * party's credit risk between an escrow and its promise, and both protocols
 * socialise bad debt across suppliers when a backstop cannot cover it. Once
 * claimed, the money is the claimant's and the risk is theirs to take.
 */

type Venue = "blend" | "xoxno";

type Position = { supply: bigint; collateral: bigint; total: bigint };

type Row = {
  token: TokenConfig;
  /** Reserve index, for Blend's emission ids. Unused by XOXNO. */
  index: number;
  wallet: bigint;
  lent: Position;
};

const VENUES: {
  key: Venue;
  enabled: boolean;
  href: string;
  label: string;
}[] = [
  {
    key: "blend",
    enabled: BLEND_ENABLED,
    href: explorerContract(BLEND_POOL_ID),
    label: BLEND_POOL_NAME,
  },
  {
    key: "xoxno",
    enabled: XOXNO_ENABLED,
    href: XOXNO_APP_URL,
    label: "xoxno.com",
  },
];

export default function EarnPanel() {
  const { address } = useWallet();

  const available = VENUES.filter((v) => v.enabled);
  const [venue, setVenue] = useState<Venue>(available[0]?.key ?? "blend");
  const active = available.find((v) => v.key === venue) ?? available[0];

  const [rows, setRows] = useState<Row[] | null>(null);
  const [accountId, setAccountId] = useState<bigint | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: string; what: string } | null>(null);
  const [tick, setTick] = useState(0);

  const amountId = useId();
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const venues = available.length;

  useEffect(() => {
    if (!address || venues === 0) return;
    let alive = true;

    void (async () => {
      try {
        const wallet = (t: TokenConfig) =>
          tokenBalance(address, t.contractId).catch(() => 0n);

        if (venue === "blend") {
          // The pool decides which assets it takes; a token we offer that it
          // has never heard of simply has no row.
          const assets = await reserveAssets();
          const mine = TOKENS.filter((t) => assets.includes(t.contractId));
          const reserves = await Promise.all(
            mine.map((t) =>
              loadReserve(t.contractId, assets.indexOf(t.contractId)),
            ),
          );
          const [positions, balances] = await Promise.all([
            loadPositions(address, reserves),
            Promise.all(mine.map(wallet)),
          ]);
          if (!alive) return;

          setAccountId(null);
          setRows(
            mine.map((token, i) => {
              const p = positions.find((x) => x.asset === token.contractId);
              return {
                token,
                index: reserves[i].index,
                wallet: balances[i],
                lent: {
                  supply: p?.supply ?? 0n,
                  collateral: p?.collateral ?? 0n,
                  total: p?.underlying ?? 0n,
                },
              };
            }),
          );
        } else {
          // XOXNO keys positions by an NFT rather than by address, so the
          // account has to be found before anything can be read.
          const mine = TOKENS.filter(
            (t) => t.key === "XLM" || t.key === "USDC",
          );
          const id = await findAccountId(address);
          const [balances, lent] = await Promise.all([
            Promise.all(mine.map(wallet)),
            Promise.all(
              mine.map((t) =>
                id === null
                  ? Promise.resolve(0n)
                  : collateralOf(id, t.contractId).catch(() => 0n),
              ),
            ),
          ]);
          if (!alive) return;

          setAccountId(id);
          setRows(
            mine.map((token, i) => ({
              token,
              index: i,
              wallet: balances[i],
              lent: { supply: lent[i], collateral: 0n, total: lent[i] },
            })),
          );
        }
        setError(null);
      } catch (e) {
        if (alive) setError(describeEscrowError(e));
      }
    })();

    return () => {
      alive = false;
    };
  }, [address, venue, tick, venues]);

  const row = rows?.find((r) => r.token.key === picked) ?? rows?.[0] ?? null;

  /**
   * The XOXNO positions, redrawn as they grow.
   *
   * Blend's yield arrives as a token and gets one figure for the lot; XOXNO's
   * is each position being worth more, so each one moves on its own — and all
   * of them are shown, not only the row that happens to be selected. Somebody
   * with USDC lent should see it earning while they are looking at their XLM.
   * Empty on the other venue, and the hook goes quiet.
   */
  const lent = useLiveLent(
    venue === "xoxno"
      ? (rows ?? []).map((r) => ({
          asset: r.token.contractId,
          collateral: r.lent.total,
        }))
      : [],
    tick,
  );

  /**
   * And Blend's reward, which is a token rather than a position. Empty ids on
   * the other venue, so the hook goes quiet there.
   */
  const { shown: rewards, measured: claimable } = useLiveRewards(
    address,
    venue === "blend" ? (rows ?? []).map((r) => supplyEmissionId(r.index)) : [],
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

  if (venues === 0 || !address || !active) return null;

  const units = (() => {
    if (!row || amount.trim() === "") return null;
    try {
      const u = toUnits(amount, row.token.decimals);
      return u > 0n ? u : null;
    } catch {
      return null;
    }
  })();

  const anyLent = (rows ?? []).some((r) => r.lent.total > 0n);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="font-semibold">Put it to work</h2>
        <a
          className="link text-xs"
          href={active.href}
          target="_blank"
          rel="noreferrer"
        >
          {active.label}
        </a>
      </div>

      {/* The venues as their own marks rather than as our words for them.
          Published assets, unaltered: Blend's green wordmark as it ships, and
          XOXNO's screened against the card so the black plate it ships on
          disappears without the mark itself being touched. */}
      {venues > 1 && (
        <div className="segmented mt-3" role="group" aria-label="Where to lend">
          {available.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={venue === v.key}
              aria-label={v.key === "blend" ? "Blend" : "XOXNO"}
              onClick={() => {
                setVenue(v.key);
                setAmount("");
                setPicked(null);
                setRows(null);
              }}
              disabled={busy !== null}
              className="flex items-center"
            >
              {v.key === "blend" ? (
                <Image
                  src="/brand/blend-wordmark.png"
                  alt="Blend"
                  width={1200}
                  height={360}
                  className="h-[17px] w-auto"
                  unoptimized
                />
              ) : (
                <Image
                  src="/brand/xoxno-wordmark.jpg"
                  alt="XOXNO"
                  width={306}
                  height={66}
                  className="h-[13px] w-auto mix-blend-screen"
                  unoptimized
                />
              )}
            </button>
          ))}
        </div>
      )}

      {rows === null ? (
        <div className="mt-4 skeleton h-24 w-full" />
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-mute">
          This one does not take any of the assets Paytag pays out.
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
                    {/* Zero is shown as nothing rather than as "0": a row with
                        no position has nothing to say about earnings. */}
                    {r.lent.total > 0n && (
                      <span
                        className="num shrink-0 text-right text-sm font-bold text-accent-text"
                        title={`${fromUnits(r.lent.total, r.token.decimals)} ${r.token.symbol}`}
                      >
                        {displayUnits(r.lent.total, r.token.decimals)}
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
                      venue === "blend"
                        ? blendSupply(address, row.token.contractId, units!)
                        : xoxnoSupply(
                            address,
                            accountId,
                            row.token.contractId,
                            units!,
                          ),
                    )
                  }
                >
                  {busy !== null && <span className="spinner" aria-hidden />}
                  {busy ?? "Lend it"}
                </button>

                {row.lent.total > 0n && (
                  <>
                    {/* Partial withdrawal is Blend's alone. XOXNO refused every
                        partial amount tried against the live contract while the
                        full one always worked, so that venue offers only the
                        button that does what it says. */}
                    {venue === "blend" && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy !== null || units === null}
                        onClick={() =>
                          void run(`Took back ${amount} ${row.token.symbol}`, () =>
                            blendWithdraw(
                              address,
                              row.token.contractId,
                              splitWithdraw(units!, row.lent),
                            ),
                          )
                        }
                      >
                        Take back
                      </button>
                    )}

                    <button
                      className="btn btn-quiet btn-sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(`Took back all your ${row.token.symbol}`, () =>
                          venue === "blend"
                            ? blendWithdraw(address, row.token.contractId, {
                                // Over-asking is safe: the pool settles it down
                                // to whatever the position is worth at that
                                // ledger, which is the only way to empty one
                                // that grows between the read and the click.
                                supply: row.lent.supply * 2n + 1_000_000n,
                                collateral:
                                  row.lent.collateral * 2n + 1_000_000n,
                              })
                            : xoxnoWithdrawAll(
                                address,
                                accountId!,
                                row.token.contractId,
                              ),
                        )
                      }
                    >
                      Take it all back
                    </button>
                  </>
                )}
              </div>

              {venue === "xoxno" && accountId === null && (
                <p className="mt-3 text-xs text-mute">
                  Lending here opens an account for you, held as an NFT in your
                  own wallet. Nobody else can move what is in it.
                </p>
              )}
            </div>
          )}

          {/* XOXNO pays no second token: what grows is the holding. So the
              holding is what ticks — drawn from the market's supply index,
              which moves in billions of RAY while the balance itself is still
              a fraction of a stroop away from changing.

              One line per position, whichever row is selected. A balance that
              is earning should say so even when the reader is looking
              somewhere else on the card. */}
          {venue === "xoxno" && anyLent && (
            <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line">
              {rows
                .filter((r) => r.lent.total > 0n)
                .map((r) => {
                  const live = lent[r.token.contractId];
                  return (
                    <li key={r.token.contractId} className="p-3 text-sm">
                      <LiveAmount
                        value={fromUnits(live?.value ?? r.lent.total * 100n, 9)}
                        className="num text-base font-bold tabular-nums text-accent-text"
                      />{" "}
                      <span className="text-xs font-semibold text-dim">
                        {r.token.symbol}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-mute">
                        {live?.live && (
                          <span
                            aria-hidden
                            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
                          />
                        )}
                        growing right now
                        {(live?.apy ?? 0) > 0 &&
                          ` · about ${live!.apy.toFixed(2)}% a year`}
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}

          {/* Blend's reward is a separate token on a separate clock, so it gets
              a separate line. XOXNO has none: there, the position itself grows. */}
          {venue === "blend" && (claimable > 0n || anyLent) && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
              <span className="text-sm">
                <LiveAmount
                  value={fromUnits(rewards, 7)}
                  className="num text-base font-bold tabular-nums text-accent-text"
                />{" "}
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
                        (rows ?? []).map((r) => supplyEmissionId(r.index)),
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
