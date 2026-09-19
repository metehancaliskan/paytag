"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWallet } from "./WalletProvider";
import { useAnchor } from "./useAnchor";
import { AssetMark } from "./icons";
import { sign as signWithWallet, networkMismatch } from "@/lib/freighter";
import { explorerTx } from "@/lib/config";
import { ANCHOR_ENABLED, ANCHOR_HOME_DOMAIN, FIAT_CODE } from "@/lib/anchor/config";
import { authenticate } from "@/lib/anchor/auth";
import { priceForAsset, trimAmount, type Quote } from "@/lib/anchor/sep38";
import {
  describeStatus,
  pollTransaction,
  startWithdraw,
  withdrawLimits,
  type AnchorTransaction,
  type Sep6Limits,
} from "@/lib/anchor/sep6";
import { payAnchor } from "@/lib/anchor/payment";
import { assetBalance } from "@/lib/anchor/trustline";

/**
 * Taking the money out, into a bank account.
 *
 * The other half of the sentence Paytag could not finish before: somebody paid
 * a GitHub handle, the owner of that handle claimed it, and now it is a dollar
 * balance on a network they did not ask to be on. This turns it into lira.
 *
 * Three steps, and only the middle one is ours: the anchor says where to send
 * the asset and with which memo, the wallet signs one payment, and the anchor
 * pays the bank when it sees it arrive. The memo is the load-bearing part —
 * every customer pays into the same account, so a payment without it is money
 * the anchor cannot attribute to anyone. `lib/anchor/payment.ts` refuses to
 * build a memo type it does not understand rather than sending one that will
 * not match.
 */

type Stage = "amount" | "sent" | "done";

export default function CashOutPanel() {
  const { address, connect, connecting, installed } = useWallet();
  const { anchor, error: anchorError } = useAnchor();

  const params = useSearchParams();

  const [balance, setBalance] = useState<string | null>(null);
  const [limits, setLimits] = useState<Sep6Limits | null>(null);
  // Prefilled by the claim receipt — "you just took out 10 USDC, cash out?" —
  // so the amount is not typed again a second after it was read off a screen.
  const [amount, setAmount] = useState(() => {
    const raw = (params.get("amount") ?? "").trim().replace(",", ".");
    return /^\d{1,12}(\.\d{1,7})?$/.test(raw) ? raw : "";
  });
  const [quote, setQuote] = useState<Quote | null>(null);

  const [stage, setStage] = useState<Stage>("amount");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [tx, setTx] = useState<AnchorTransaction | null>(null);

  const amountId = useId();
  const stopped = useRef(false);
  useEffect(() => () => void (stopped.current = true), []);

  // What there is to cash out. Read from Horizon rather than the token
  // contract: this is the classic balance the anchor will be paid from, and
  // the classic side is where a missing trustline shows up as simply nothing.
  const readBalance = useCallback(async () => {
    if (!anchor || !address) return;
    setBalance(
      await assetBalance(address, anchor.assetCode, anchor.assetIssuer),
    );
  }, [anchor, address]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!anchor || !address) return;
      const [b, l] = await Promise.all([
        assetBalance(address, anchor.assetCode, anchor.assetIssuer),
        withdrawLimits(anchor).catch(() => null),
      ]);
      if (alive) {
        setBalance(b);
        setLimits(l);
      }
    })();
    return () => {
      alive = false;
    };
  }, [anchor, address]);

  const typed = amount.trim().replace(",", ".");
  const valid = /^\d+(\.\d{1,7})?$/.test(typed) && Number(typed) > 0;
  const overBalance =
    valid && balance !== null && Number(typed) > Number(balance);

  // The estimate. Same rules as the on-ramp's: debounced, never blocking, and
  // only shown when it answers the number currently in the field.
  useEffect(() => {
    if (!anchor?.quoteServer || !valid) return;
    let alive = true;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const q = await priceForAsset(anchor, typed);
          if (alive) setQuote(q);
        } catch {
          // An estimate is a courtesy; the anchor settles the real figure.
        }
      })();
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [anchor, typed, valid]);

  const shownQuote =
    quote && valid && Number(quote.sellAmount) === Number(typed) ? quote : null;

  const sign = useCallback(
    (xdr: string) => {
      if (!address) throw new Error("Connect a wallet first.");
      return signWithWallet(xdr, address);
    },
    [address],
  );

  async function cashOut() {
    if (!anchor || !address || !valid) return;
    setError(null);

    try {
      setBusy("Checking the network…");
      const mismatch = await networkMismatch();
      if (mismatch) throw new Error(mismatch);

      setBusy("Proving the wallet is yours…");
      const token = await authenticate(anchor, address, sign);

      setBusy("Asking the anchor where to send it…");
      const withdraw = await startWithdraw(anchor, token, typed);

      // The one irreversible step on this screen, and the wallet asks before
      // it happens. Everything above was questions; this is the money leaving.
      setBusy("Waiting for your wallet…");
      const sentHash = await payAnchor(
        {
          from: address,
          destination: withdraw.accountId,
          code: anchor.assetCode,
          issuer: anchor.assetIssuer,
          amount: typed,
          memo: withdraw.memo,
          memoType: withdraw.memoType,
        },
        sign,
      );
      setHash(sentHash);
      setStage("sent");
      setBusy(null);
      void readBalance();

      const final = await pollTransaction(
        anchor,
        token,
        withdraw.id,
        setTx,
        () => stopped.current,
      );
      if (final.status === "completed") setStage("done");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------------ views

  if (!ANCHOR_ENABLED) {
    return (
      <p className="card p-5 text-sm text-mute">
        No anchor is configured on this deployment, so there is no way to turn a
        balance into lira here. Set{" "}
        <span className="mono">NEXT_PUBLIC_ANCHOR_HOME_DOMAIN</span>.
      </p>
    );
  }

  if (anchorError) {
    return (
      <div className="card p-5">
        <p role="alert" className="text-sm text-danger">
          {anchorError}
        </p>
        <p className="mt-2 text-xs text-mute">
          Anchor: <span className="mono">{ANCHOR_HOME_DOMAIN}</span>
        </p>
      </div>
    );
  }

  if (!anchor) return <div className="skeleton h-48 w-full" />;

  const symbol = anchor.token.symbol;
  const nothing = balance !== null && Number(balance) === 0;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <AssetMark asset="TRY" size={22} />
            {stage === "done" ? `${FIAT_CODE} on its way` : `Cash out to a bank`}
          </h2>
          <span className="text-xs text-mute">
            via <span className="mono">{anchor.domain}</span>
          </span>
        </div>

        {stage === "amount" && (
          <>
            <p className="mt-1 text-sm text-dim">
              Send {symbol} back to the anchor and it pays {FIAT_CODE} to your
              bank account.
            </p>

            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <label className="label" htmlFor={amountId}>
                  Amount in {symbol}
                </label>
                {balance !== null && (
                  <span className="num text-xs text-mute">
                    you have {trimAmount(balance)} {symbol}
                  </span>
                )}
              </div>
              <div
                className="input-group"
                aria-invalid={overBalance ? "true" : undefined}
              >
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
                <span className="input-suffix">{symbol}</span>
                {balance !== null && Number(balance) > 0 && (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => setAmount(balance)}
                    disabled={busy !== null}
                  >
                    Max
                  </button>
                )}
              </div>

              <p className="mt-2 text-xs text-mute">
                {shownQuote ? (
                  <>
                    About{" "}
                    <span className="num font-semibold text-dim">
                      {trimAmount(shownQuote.buyAmount)} {FIAT_CODE}
                    </span>
                    {shownQuote.fee && (
                      <>
                        {" "}
                        · fee {trimAmount(shownQuote.fee)} {symbol}
                      </>
                    )}
                  </>
                ) : limits?.min !== null && limits?.min !== undefined ? (
                  <>
                    At least {limits.min} {symbol} per withdrawal.
                  </>
                ) : null}
              </p>

              {overBalance && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  That is more than the {trimAmount(balance ?? "0")} {symbol} in
                  this wallet.
                </p>
              )}

              {nothing && (
                <p className="mt-2 text-xs text-mute">
                  Nothing to cash out yet. Money paid to your handle shows up
                  here once you{" "}
                  <Link className="link" href="/claim">
                    claim it
                  </Link>
                  .
                </p>
              )}
            </div>
          </>
        )}

        {stage !== "amount" && (
          <>
            <p className="mt-1 text-sm text-dim">
              {stage === "done" && tx ? (
                <>
                  <span className="num font-semibold text-accent-text">
                    {trimAmount(tx.amountOut ?? "")} {FIAT_CODE}
                  </span>{" "}
                  is on its way to your bank account.
                </>
              ) : (
                <>
                  <span className="num font-semibold">
                    {typed} {symbol}
                  </span>{" "}
                  is on its way to the anchor. It pays out once the payment
                  settles.
                </>
              )}
            </p>

            <p className="mt-3 text-sm text-mute">
              {tx?.message ?? (tx ? describeStatus(tx.status) : "Sent.")}
              {hash && (
                <>
                  {" · "}
                  <a
                    className="link"
                    href={explorerTx(hash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    your payment
                  </a>
                </>
              )}
            </p>
          </>
        )}

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
          ) : stage === "amount" ? (
            <button
              className="btn btn-primary"
              onClick={() => void cashOut()}
              disabled={busy !== null || !valid || overBalance}
            >
              {busy !== null && <span className="spinner" aria-hidden />}
              {busy ?? `Cash out to ${FIAT_CODE}`}
            </button>
          ) : stage === "done" ? (
            <button
              className="btn btn-quiet"
              onClick={() => {
                setStage("amount");
                setAmount("");
                setTx(null);
                setHash(null);
              }}
            >
              Cash out more
            </button>
          ) : null}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <p className="px-1 text-xs text-mute">
        {/* Said plainly, because the sandbox's simulated bank is the one part
            of this that a real anchor replaces — and the part a reader would
            otherwise assume is real. The Stellar side already is. */}
        This is a sandbox anchor: the {FIAT_CODE} payout is simulated and no
        real money reaches a bank. The {symbol} that leaves your wallet is real
        testnet {symbol}.
      </p>
    </div>
  );
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
