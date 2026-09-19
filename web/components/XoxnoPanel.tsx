"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Image from "next/image";
import { useWallet } from "./WalletProvider";
import { AssetMark } from "./icons";
import { sign, networkMismatch } from "@/lib/freighter";
import { submitSigned, tokenBalance } from "@/lib/contract";
import { describeEscrowError } from "@/lib/stellar";
import { displayUnits, fromUnits, toUnits } from "@/lib/format";
import { TOKENS, explorerTx, type TokenConfig } from "@/lib/config";
import { XOXNO_APP_URL, XOXNO_ENABLED } from "@/lib/xoxno/config";
import {
  buildSupply,
  buildWithdrawAll,
  collateralOf,
  findAccountId,
} from "@/lib/xoxno/lending";

/**
 * The second place a claimed balance can earn, and the reason there are two.
 *
 * Blend pays BLND. XOXNO pays interest in the asset itself. For most products
 * that is a preference; for this one it decides something: BLND has no route
 * to a Turkish bank account, and more USDC does — the anchor two cards up will
 * turn it into lira. Somebody who came here because they were paid by name,
 * and wants that pay in money they can spend, should be able to earn in money
 * they can spend.
 *
 * Only what has been verified against the live contracts is offered. Supplying
 * works and taking the whole position back works; a partial withdrawal was
 * refused on chain every time it was tried, so it is not a button here.
 * Nothing is trapped by that — everything that goes in comes out — and a
 * control that fails is worse than one that does not exist.
 */

type Row = {
  token: TokenConfig;
  wallet: bigint;
  lent: bigint;
};

/** The assets XOXNO's main spoke lists that this app also pays out. */
const MARKETS = ["XLM", "USDC"];

export default function XoxnoPanel() {
  const { address } = useWallet();

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

  useEffect(() => {
    if (!XOXNO_ENABLED || !address) return;
    let alive = true;

    void (async () => {
      try {
        const mine = TOKENS.filter((t) => MARKETS.includes(t.key));
        // The account has to be found before anything can be read: XOXNO keys
        // positions by an NFT, not by the address holding it.
        const id = await findAccountId(address);

        const [balances, lent] = await Promise.all([
          Promise.all(
            mine.map((t) => tokenBalance(address, t.contractId).catch(() => 0n)),
          ),
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
            wallet: balances[i],
            lent: lent[i],
          })),
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

  if (!XOXNO_ENABLED || !address) return null;

  const units = (() => {
    if (!row || amount.trim() === "") return null;
    try {
      const u = toUnits(amount, row.token.decimals);
      return u > 0n ? u : null;
    } catch {
      return null;
    }
  })();

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-2.5 font-semibold">
          Or lend it on
          {/* XOXNO's published wordmark, on the black plate it ships on. */}
          <Image
            src="/brand/xoxno-wordmark.jpg"
            alt="XOXNO"
            width={460}
            height={150}
            className="h-[22px] w-auto rounded-[3px]"
            unoptimized
          />
        </h2>
        <a
          className="link text-xs"
          href={XOXNO_APP_URL}
          target="_blank"
          rel="noreferrer"
        >
          xoxno.com
        </a>
      </div>
      <p className="mt-1.5 text-sm text-dim">
        The interest is paid in the asset itself, so USDC earns more USDC — and
        more USDC is something the anchor will turn into lira. BLND cannot make
        that trip.
      </p>

      {rows === null ? (
        <div className="mt-4 skeleton h-24 w-full" />
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
                    {r.lent > 0n && (
                      <span
                        className="num shrink-0 text-right text-sm font-bold text-accent-text"
                        title={`${fromUnits(r.lent, r.token.decimals)} ${r.token.symbol}`}
                      >
                        {displayUnits(r.lent, r.token.decimals)}
                        <span className="block text-[11px] font-medium text-mute">
                          lent
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
                      buildSupply(
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

                {/* One way out, and it is the whole position. Said on the
                    button rather than discovered afterwards. */}
                {row.lent > 0n && accountId !== null && (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`Took back your ${row.token.symbol}`, () =>
                        buildWithdrawAll(
                          address,
                          accountId,
                          row.token.contractId,
                        ),
                      )
                    }
                  >
                    Take it all back
                  </button>
                )}
              </div>

              {accountId === null && (
                <p className="mt-3 text-xs text-mute">
                  Lending here opens an account for you, held as an NFT in your
                  own wallet. Nobody else can move what is in it.
                </p>
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
