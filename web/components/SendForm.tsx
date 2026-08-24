"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "./WalletProvider";
import CopyButton from "./CopyButton";
import { usePrice } from "./usePrice";
import {
  buildDeposit,
  latestLedger,
  submitSigned,
  tokenBalance,
} from "@/lib/contract";
import { describeEscrowError } from "@/lib/stellar";
import { sign, networkMismatch } from "@/lib/freighter";
import { fromHex } from "@/lib/identity";
import {
  formatDate,
  fromUnits,
  ledgerToApproxDate,
  toUnits,
} from "@/lib/format";
import { centsToUnits, formatRate, unitsToCents, usdToCents } from "@/lib/price";
import {
  DEFAULT_TOKEN,
  EXPIRY_CHOICES,
  TOKENS,
  explorerTx,
  tokenByKey,
  type TokenKey,
} from "@/lib/config";

/**
 * The send form.
 *
 * The amount is typed in dollars and sent in XLM. That is a deliberate choice
 * with a cost, and the cost is stated on screen rather than buried: the escrow
 * holds XLM, so the dollar figure is today's rate and nothing more. Whoever
 * claims it receives the XLM amount, worth whatever it is worth by then.
 *
 * For a dollar-pegged asset like USDC the two are the same number, so the
 * conversion line disappears and no rate is needed at all.
 */
export default function SendForm({
  handle,
  identityHex,
  ledger,
  onSent,
}: {
  handle: string;
  identityHex: string;
  /** Current ledger, for the "refundable after" preview. */
  ledger: number | null;
  onSent: () => void;
}) {
  const { address, connect, connecting, installed, mismatch } = useWallet();
  const priceState = usePrice();

  const [tokenKey, setTokenKey] = useState<TokenKey>(DEFAULT_TOKEN.key);
  const token = tokenByKey(tokenKey);

  // A directory card can link here with ?amount=10 — the quick-tip buttons do.
  // Read once, as the initial value: after that the field belongs to the person
  // typing in it, and a re-render must not overwrite what they wrote.
  const params = useSearchParams();
  const [amountInput, setAmountInput] = useState(() => {
    const raw = (params.get("amount") ?? "").trim();
    return /^\d{1,9}(\.\d{1,7})?$/.test(raw) ? raw : "";
  });
  const [choice, setChoice] = useState(0);
  // Balance kept with the address it belongs to, so switching wallets can never
  // show the previous account's number next to the new address.
  const [balanceOf, setBalanceOf] = useState<{
    addr: string;
    tokenId: string;
    value: bigint;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{
    hash: string;
    amount: string;
    symbol: string;
  } | null>(null);

  const amountId = useId();
  const problemId = useId();

  const loadBalance = useCallback(async () => {
    if (!address) return;
    try {
      const value = await tokenBalance(address, token.contractId);
      setBalanceOf({ addr: address, tokenId: token.contractId, value });
    } catch {
      // No trustline, or the token contract is unreachable. The balance is a
      // convenience, not a precondition for sending.
      setBalanceOf(null);
    }
  }, [address, token.contractId]);

  useEffect(() => {
    void (async () => {
      await loadBalance();
    })();
  }, [loadBalance]);

  const balance =
    balanceOf?.addr === address && balanceOf?.tokenId === token.contractId
      ? balanceOf.value
      : null;

  // ------------------------------------------------------ dollars to units

  // A dollar-pegged asset needs no rate; XLM does. When the rate is missing the
  // field switches to the token's own unit — degraded, still usable, and the
  // label says which mode it is in rather than leaving the reader to guess.
  const dollarMode = token.isDollarPegged || priceState.status === "ready";
  const rate =
    priceState.status === "ready" ? priceState.price.usdPerXlm : null;

  let units: bigint | null = null;
  let problem: string | null = null;

  if (amountInput.trim() !== "") {
    try {
      if (token.isDollarPegged) {
        units = toUnits(amountInput, token.decimals);
      } else if (dollarMode && rate !== null) {
        units = centsToUnits(usdToCents(amountInput), rate, token.decimals);
      } else {
        units = toUnits(amountInput, token.decimals);
      }
      if (units <= 0n) {
        problem = "The amount has to be greater than zero.";
      } else if (balance !== null && units > balance) {
        problem = `That is more than your balance of ${fromUnits(
          balance,
          token.decimals,
        )} ${token.symbol}.`;
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  const ready = units !== null && problem === null;

  const expiry = EXPIRY_CHOICES[choice];
  const refundableOn =
    ledger === null
      ? null
      : formatDate(ledgerToApproxDate(ledger + expiry.ledgers, ledger));

  function setMax() {
    if (balance === null) return;
    if (token.isDollarPegged || rate === null) {
      setAmountInput(fromUnits(balance, token.decimals));
    } else {
      // Converted down to whole cents, so the round trip back to units can only
      // land at or below the balance — never a cent over it.
      const cents = unitsToCents(balance, rate, token.decimals);
      setAmountInput((Number(cents) / 100).toFixed(2));
    }
  }

  async function send() {
    setError(null);
    if (!address || units === null) return;

    try {
      setBusy("Checking the network…");
      const problemNow = await networkMismatch();
      if (problemNow) throw new Error(problemNow);

      setBusy("Preparing the transaction…");
      const now = await latestLedger();
      const tx = await buildDeposit({
        from: address,
        identity: fromHex(identityHex),
        amount: units,
        expiryLedger: now + expiry.ledgers,
        tokenId: token.contractId,
      });

      setBusy("Waiting for your wallet…");
      const signed = await sign(tx.toXdr(), address);

      setBusy("Submitting to the network…");
      const res = await submitSigned(signed);

      setSent({
        hash: res.hash,
        amount: fromUnits(units, token.decimals),
        symbol: token.symbol,
      });
      setAmountInput("");
      void loadBalance();
      onSent();
    } catch (e) {
      setError(describeEscrowError(e));
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------- confirmed

  if (sent) {
    return (
      <div className="card p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-black text-accent-fg"
          >
            ✓
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">
              <span className="num">{sent.amount}</span> {sent.symbol} is in
              escrow for @{handle}
            </h2>
            <p className="mt-1 text-sm text-dim">
              Only the verified owner can move it
              {refundableOn ? <> — or you, from around {refundableOn}</> : null}.
            </p>
            <p className="mt-3 mono text-mute">{sent.hash}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                className="btn btn-ghost btn-sm"
                href={explorerTx(sent.hash)}
                target="_blank"
                rel="noreferrer"
              >
                View the transaction
              </a>
              <CopyButton
                value={sent.hash}
                label="Copy hash"
                className="btn btn-ghost btn-sm"
              />
              <button
                className="btn btn-quiet btn-sm"
                onClick={() => setSent(null)}
              >
                Send more
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ form

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Put money in escrow for @{handle}</h2>
        {address && balance !== null && (
          <span className="num text-xs text-mute">
            balance {fromUnits(balance, token.decimals)} {token.symbol}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-mute">
        Refundable to you{" "}
        {refundableOn ? <>from around {refundableOn}</> : <>after expiry</>} if
        it goes unclaimed.
      </p>

      {TOKENS.length > 1 && (
        <div className="mt-4">
          <span className="label">Asset</span>
          <div className="segmented" role="group" aria-label="Asset">
            {TOKENS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tokenKey === t.key}
                onClick={() => {
                  setTokenKey(t.key);
                  setAmountInput("");
                }}
                disabled={busy !== null}
              >
                {t.symbol}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
        <div>
          <label className="label" htmlFor={amountId}>
            {dollarMode && !token.isDollarPegged
              ? "Amount in dollars"
              : `Amount in ${token.symbol}`}
          </label>
          <div
            className="input-group"
            aria-invalid={problem ? "true" : undefined}
          >
            {dollarMode && !token.isDollarPegged && (
              <span className="input-prefix">$</span>
            )}
            <input
              id={amountId}
              className="input-bare num"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              disabled={busy !== null}
              aria-invalid={problem ? "true" : undefined}
              aria-describedby={problem ? problemId : undefined}
            />
            {(!dollarMode || token.isDollarPegged) && (
              <span className="input-suffix">{token.symbol}</span>
            )}
            {balance !== null && balance > 0n && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={setMax}
                disabled={busy !== null}
              >
                Max
              </button>
            )}
          </div>
        </div>

        <div>
          <span className="label">Claim window</span>
          <div className="segmented" role="group" aria-label="Claim window">
            {EXPIRY_CHOICES.map((c, i) => (
              <button
                key={c.label}
                type="button"
                aria-pressed={choice === i}
                onClick={() => setChoice(i)}
                disabled={busy !== null}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* What will actually leave the wallet, and at what rate. */}
      {!token.isDollarPegged && (
        <p className="mt-2 text-xs text-mute">
          {priceState.status === "loading" && "Fetching the XLM rate…"}
          {priceState.status === "unavailable" && (
            <>
              No exchange rate available ({priceState.reason}), so the amount is
              in XLM.
            </>
          )}
          {priceState.status === "ready" && (
            <>
              {units !== null && !problem ? (
                <>
                  Sends{" "}
                  <span className="num font-semibold text-dim">
                    {fromUnits(units, token.decimals)} XLM
                  </span>{" "}
                  · {formatRate(priceState.price)} ·{" "}
                  {priceState.price.source}
                </>
              ) : (
                <>
                  {formatRate(priceState.price)} · {priceState.price.source}
                </>
              )}
            </>
          )}
        </p>
      )}

      {problem && (
        <p id={problemId} role="alert" className="mt-2 text-sm text-danger">
          {problem}
        </p>
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
            {connecting ? "Connecting…" : "Connect a wallet to send"}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={busy !== null || !ready}
          >
            {busy !== null && <span className="spinner" aria-hidden />}
            {busy ?? `Send to @${handle}`}
          </button>
        )}

        <span aria-live="polite" className="text-sm text-mute">
          {busy}
        </span>
      </div>

      {/* The honest caveat. A dollar figure implies a promise the chain never
          made, so it is said plainly rather than left to be discovered. */}
      {!token.isDollarPegged && priceState.status === "ready" && (
        <p className="mt-3 text-xs leading-relaxed text-mute">
          The escrow holds XLM, not dollars. The recipient claims the XLM
          amount, worth whatever it is worth then — the dollar figure is
          today&apos;s rate, for your reference only.
        </p>
      )}

      {token.needsTrustline && (
        <p className="mt-3 text-xs leading-relaxed text-mute">
          {token.symbol} is an issued asset, so both wallets need a trustline
          for it before they can hold it. XLM needs none — that is why it is the
          default.
        </p>
      )}

      {mismatch && (
        <p role="alert" className="mt-3 text-sm text-warn">
          {mismatch}
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
