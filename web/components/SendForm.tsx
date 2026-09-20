"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { sign, networkMismatch } from "@/lib/wallet";
import { fromHex, kindUrlPrefix, slugOf, type IdentityKind } from "@/lib/identity";
import {
  formatDate,
  displayUnits,
  fromUnits,
  ledgerToApproxDate,
  toUnits,
  usdGlance,
} from "@/lib/format";
import { unitsToCents } from "@/lib/price";
import { FIAT_CODE } from "@/lib/anchor/config";
import { priceFor, trimAmount } from "@/lib/anchor/sep38";
import { useAnchor } from "./useAnchor";
import { AssetMark, CheckMark } from "./icons";
import {
  DEFAULT_TOKEN,
  EXPIRY_CHOICES,
  SENDABLE_TOKENS,
  explorerTx,
  tokenByKey,
  type TokenKey,
} from "@/lib/config";

/**
 * The send form.
 *
 * THE AMOUNT IS TYPED IN XLM, and the dollars are the estimate underneath. It
 * was the other way round, and the reason for the swap is that the two figures
 * are not equally true. XLM is what leaves the wallet, what the contract holds,
 * and what the recipient claims; the dollar figure is one API's opinion of what
 * that is worth this minute, and nothing on chain reads it. Typing the estimate
 * and having the real number derived from it put the reader's hands on the
 * softer of the two numbers, and made "$25" look like the promise, when the
 * promise the chain actually keeps is the XLM.
 *
 * It also removes a failure mode rather than describing one: with no rate, the
 * old form fell back to XLM entry and had to say so. Now there is nothing to
 * fall back to. The estimate disappears and the field keeps working, because
 * the field never needed the rate.
 */
/** An asset the wallet holds, or the bank route that ends in one. */
type Method = TokenKey | "TRY";

export default function SendForm({
  handle,
  kind,
  identityHex,
  ledger,
  onSent,
}: {
  handle: string;
  /** Which platform the handle is on. Two people can hold the same name. */
  kind: IdentityKind;
  identityHex: string;
  /** Current ledger, for the "refundable after" preview. */
  ledger: number | null;
  onSent: () => void;
}) {
  const { address, connect, connecting, installed, mismatch } = useWallet();
  const priceState = usePrice();

  const router = useRouter();
  const initialParams = useSearchParams();
  const { anchor } = useAnchor();

  /**
   * How the money gets there, which is one question and not two.
   *
   * An asset picker and a separate "no balance? add some" line underneath were
   * two different kinds of answer to the same question, and the second one only
   * appeared once the reader had already failed. Lira is a way of paying this
   * handle, exactly like the other two, so it is offered in the same list at
   * the same moment — the difference is that it takes a detour through a bank
   * before the escrow, and the row says so.
   */
  const [method, setMethod] = useState<Method>(() => {
    // `?asset=USDC` — how the top-up screen hands the reader back after a bank
    // transfer. Read once, as the initial value: after that the choice belongs
    // to the person making it.
    const asked = (initialParams.get("asset") ?? "").trim().toUpperCase();
    const known = SENDABLE_TOKENS.find((t) => t.key === asked);
    return known ? known.key : DEFAULT_TOKEN.key;
  });
  const fiat = method === "TRY";
  // The lira route ends in the anchor's asset, so that is the token it means.
  const token = fiat ? (anchor?.token ?? DEFAULT_TOKEN) : tokenByKey(method);

  /**
   * The rows of the picker, in the order they are offered.
   *
   * Built from what this deployment can actually do: the wallet assets it
   * offers, plus the bank route only once the anchor has answered. A row that
   * cannot work is not shown greyed out — it is not shown.
   */
  const methods: {
    key: Method;
    mark: "XLM" | "USDC" | "TRY";
    title: string;
    subtitle: string;
    isNew?: boolean;
  }[] = [
    ...SENDABLE_TOKENS.map((t) => ({
      key: t.key as Method,
      mark: (t.key === "XLM" ? "XLM" : "USDC") as "XLM" | "USDC",
      title: t.symbol,
      subtitle: t.needsTrustline
        ? "From your wallet. Dollar-pegged, and it cashes out to a bank."
        : "From your wallet. Nothing to set up on either side.",
    })),
    ...(anchor
      ? [
          {
            key: "TRY" as Method,
            mark: "TRY" as const,
            title: `${FIAT_CODE} bank transfer`,
            // Not "no crypto at all", which this row said until somebody read
            // it next to a button asking them to install a wallet. The lira
            // route still ends in one — what it removes is having to own the
            // asset beforehand, and that is what the sentence now claims.
            subtitle: `From your bank. It arrives as ${anchor.token.symbol}, then goes to @${handle}.`,
            isNew: true,
          },
        ]
      : []),
  ];

  // A directory card can link here with ?amount=10 — the quick-tip buttons do.
  // Read once, as the initial value: after that the field belongs to the person
  // typing in it, and a re-render must not overwrite what they wrote.
  const [amountInput, setAmountInput] = useState(() => {
    const raw = (initialParams.get("amount") ?? "").trim();
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
  const [fiatQuote, setFiatQuote] = useState<{
    sell: string;
    buy: string;
  } | null>(null);
  const [sent, setSent] = useState<{
    hash: string;
    units: bigint;
    symbol: string;
    decimals: number;
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

  // ---------------------------------------------------------- input to units

  // One path, and no rate in it. What the reader types is the asset's own unit,
  // so the number that reaches `deposit` is a straight parse of the field: no
  // conversion to get wrong, and nothing to do differently when the price
  // endpoint is down.
  const rate =
    priceState.status === "ready" ? priceState.price.usdPerXlm : null;

  let units: bigint | null = null;
  let problem: string | null = null;

  if (!fiat && amountInput.trim() !== "") {
    try {
      units = toUnits(amountInput, token.decimals);
      if (units <= 0n) {
        problem = "The amount has to be greater than zero.";
      } else if (balance !== null && units > balance) {
        problem = `That is more than your balance of ${displayUnits(
          balance,
          token.decimals,
        )} ${token.symbol}.`;
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  // The lira amount is not chain units and never becomes any: it is what the
  // bank moves, and the anchor decides what that buys. So it is validated on
  // its own terms — two decimal places, like a bank statement.
  const fiatAmount = amountInput.trim().replace(",", ".");
  const fiatOk = /^\d+(\.\d{1,2})?$/.test(fiatAmount) && Number(fiatAmount) > 0;

  const ready = fiat ? fiatOk : units !== null && problem === null;

  /** What the typed amount is worth today. Decoration, and it says so below. */
  const worth =
    rate !== null && units !== null && problem === null
      ? usdGlance(unitsToCents(units, rate, token.decimals))
      : null;

  // What the lira would buy, as an estimate and labelled as one. Debounced,
  // and never blocking: a quote that fails costs a preview and nothing else.
  useEffect(() => {
    if (!fiat || !anchor?.quoteServer || !fiatOk) return;
    let alive = true;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const q = await priceFor(anchor, fiatAmount);
          if (alive) setFiatQuote({ sell: q.sellAmount, buy: q.buyAmount });
        } catch {
          // Leave the last estimate alone; `shownFiatQuote` hides a stale one.
        }
      })();
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [fiat, anchor, fiatAmount, fiatOk]);

  /** Only shown when it is a quote for what is in the field right now. */
  const shownFiatQuote =
    fiatQuote && fiatOk && Number(fiatQuote.sell) === Number(fiatAmount)
      ? fiatQuote
      : null;

  const expiry = EXPIRY_CHOICES[choice];
  const refundableOn =
    ledger === null
      ? null
      : formatDate(ledgerToApproxDate(ledger + expiry.ledgers, ledger));

  // The balance, exactly. It used to go out through the rate and back, which
  // meant Max could not be the balance — only the nearest cent below it.
  function setMax() {
    if (balance === null) return;
    setAmountInput(fromUnits(balance, token.decimals));
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
        // The units, not a formatted string: the receipt shows the rounded
        // figure and carries the exact one on hover, and it can only do both if
        // it still has the number.
        units,
        symbol: token.symbol,
        decimals: token.decimals,
      });
      setAmountInput("");
      void loadBalance();
      onSent();
    } catch (e) {
      setError(describeEscrowError(e, "deposit"));
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
              <span
                className="num"
                title={`${fromUnits(sent.units, sent.decimals)} ${sent.symbol}`}
              >
                {displayUnits(sent.units, sent.decimals)}
              </span>{" "}
              {sent.symbol} is waiting for{" "}
              <span className="mono">
                {kindUrlPrefix(kind)}
                {handle}
              </span>
            </h2>
            <p className="mt-1 text-sm text-dim">
              Only the verified owner can move it
              {refundableOn ? <>, or you from around {refundableOn}</> : null}.
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
        <h2 className="font-semibold">Put money aside</h2>
        {!fiat && address && balance !== null && (
          <span
            className="num text-xs text-mute"
            title={`${fromUnits(balance, token.decimals)} ${token.symbol}`}
          >
            balance {displayUnits(balance, token.decimals)} {token.symbol}
          </span>
        )}
      </div>

      {/* Three ways to pay the same handle, in one list and with one shape
          each: a mark, what it is, and what it costs you to use it. The lira
          row is the only one that leaves this page, and its subtitle is where
          that is said — not in a footnote after the reader has committed. */}
      {methods.length > 1 && (
        <div className="mt-4">
          <span className="label">How to pay</span>
          <ul
            className="mt-1.5 divide-y divide-line overflow-hidden rounded-xl border border-line"
            role="radiogroup"
            aria-label="How to pay"
          >
            {methods.map((m) => (
              <li key={m.key}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={method === m.key}
                  onClick={() => {
                    setMethod(m.key);
                    setAmountInput("");
                  }}
                  disabled={busy !== null}
                  className={`flex w-full items-center gap-3 p-3 text-left transition-colors ${
                    method === m.key ? "bg-raised" : "hover:bg-raised"
                  }`}
                >
                  <AssetMark asset={m.mark} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{m.title}</span>
                      {m.isNew && <span className="badge badge-claimed">new</span>}
                    </span>
                    <span className="mt-0.5 block text-xs text-mute">
                      {m.subtitle}
                    </span>
                  </span>
                  {method === m.key && (
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
                      <CheckMark size={10} />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
        <div>
          <label className="label" htmlFor={amountId}>
            Amount in {fiat ? FIAT_CODE : token.symbol}
          </label>
          <div
            className="input-group"
            aria-invalid={problem ? "true" : undefined}
          >
            <input
              id={amountId}
              className="input-bare num"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              disabled={busy !== null}
              aria-invalid={problem ? "true" : undefined}
              aria-describedby={problem ? problemId : undefined}
            />
            <span className="input-suffix">
              {fiat ? FIAT_CODE : token.symbol}
            </span>
            {!fiat && balance !== null && balance > 0n && (
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

        {/* Not shown on the lira route: the escrow does not exist yet, and the
            window is chosen in the step that creates it. Asking here would be
            asking about something two screens away. */}
        <div className={fiat ? "hidden" : undefined}>
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
          {/* Said next to the control that sets it, not in a paragraph at the
              top of the form where it is read before it can mean anything. */}
          {refundableOn && (
            <p className="mt-1 text-xs text-mute">
              Unclaimed: back to you {refundableOn}
            </p>
          )}
        </div>
      </div>

      {/* What the typed amount is worth, and never the other way round. The
          approximately sign is doing real work: this number is an estimate, it
          is not what gets sent, and it will not be what the recipient claims.

          Nothing at all when there is no rate. The old form owed the reader a
          sentence there, because losing the rate changed what the field meant;
          now it changes nothing, and a line explaining that a decoration is
          missing is worse than the missing decoration. */}
      {!fiat && !token.isDollarPegged && worth !== null && (
        <p className="mt-2 text-xs text-mute">
          Worth about{" "}
          <span className="num font-semibold text-dim">{worth}</span> today
        </p>
      )}

      {/* The lira route's own estimate, in the same place and the same voice as
          the dollar figure above it. The anchor settles the real number when
          the transfer lands, which is why this says "about". */}
      {fiat && (
        <p className="mt-2 text-xs text-mute">
          {shownFiatQuote ? (
            <>
              About{" "}
              <span className="num font-semibold text-dim">
                {trimAmount(shownFiatQuote.buy)} {token.symbol}
              </span>{" "}
              for @{handle}, after the anchor&rsquo;s fee
            </>
          ) : (
            <>
              Your bank sends {FIAT_CODE}; @{handle} is paid in {token.symbol}.
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
        ) : fiat ? (
          // The lira route hands off rather than signing: the bank has to move
          // first. The handle and the amount travel in the link, so the top-up
          // screen knows who this is for and comes back to finish it.
          <button
            className="btn btn-primary"
            onClick={() =>
              router.push(
                `/topup?to=${slugOf(kind)}/${handle}&amount=${encodeURIComponent(fiatAmount)}`,
              )
            }
            disabled={!ready}
          >
            Pay with {FIAT_CODE}
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

      {!fiat && token.needsTrustline && (
        <p className="mt-3 text-xs text-mute">
          {address && balance === null
            ? // Said BEFORE the signature, not after. A wallet with no trustline
              // for this asset cannot send it, and the only way the old form
              // found out was a transaction that reverted once it had already
              // been approved. We cannot prove the trustline is missing from
              // here — an unreadable balance is also what an RPC hiccup looks
              // like — so the sentence says what we know and no more.
              `We could not read a ${token.symbol} balance for this wallet. If it has no ${token.symbol} trustline the send will fail — add the asset in Freighter (Manage Assets) first.`
            : `${token.symbol} needs a trustline on both wallets. XLM needs none.`}
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
