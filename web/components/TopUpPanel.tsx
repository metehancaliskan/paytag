"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWallet } from "./WalletProvider";
import CopyButton from "./CopyButton";
import { sign as signWithWallet, networkMismatch } from "@/lib/freighter";
import { shortAddr } from "@/lib/format";
import {
  isKindSlug,
  kindUrlPrefix,
  KIND_SLUG,
  normalizeHandle,
  type IdentityKind,
  type KindSlug,
} from "@/lib/identity";
import { explorerTx } from "@/lib/config";
import {
  ANCHOR_ENABLED,
  ANCHOR_HOME_DOMAIN,
  FIAT_CODE,
} from "@/lib/anchor/config";
import { loadAnchor, type AnchorInfo } from "@/lib/anchor/toml";
import { tokenSource, type TokenGetter } from "@/lib/anchor/auth";
import { priceFor, trimAmount, type Quote } from "@/lib/anchor/sep38";
import {
  depositLimits,
  describeStatus,
  getTransaction,
  pollTransaction,
  simulateBankTransfer,
  startDeposit,
  type AnchorTransaction,
  type DepositInstructions,
  type Sep6Limits,
} from "@/lib/anchor/sep6";
import { hasTrustline, openTrustline } from "@/lib/anchor/trustline";

/**
 * Adding money with a bank transfer.
 *
 * This is the half of Paytag that has nothing to do with Stellar as far as the
 * person is concerned: they type an amount in lira, they get told where to send
 * it, and some minutes later they have a balance. Everything the chain does in
 * between — an anchor, an issued asset, a trustline — is machinery, and the
 * screen's job is to keep it that way while never actually lying about it.
 *
 * The flow is four states and they are named after what the PERSON is doing,
 * not after the protocol: choosing an amount, sending the transfer, waiting,
 * done. SEP-10 authentication is not a state at all — it is one wallet prompt
 * inside "start", because "prove you own this wallet to a company you have not
 * heard of" is not a step anybody asked for.
 */

type Stage = "amount" | "transfer" | "done";

export default function TopUpPanel() {
  const { address, connect, connecting, installed } = useWallet();
  const params = useSearchParams();

  /**
   * Who this money is for, when the reader arrived from a send form.
   *
   * `?to=gh/torvalds` — the handle the send form was pointed at, carried
   * through so that adding money does not lose the reason for adding it. The
   * page works without it: opened on its own, it is simply a top-up.
   *
   * Parsed rather than trusted. The value reaches a link at the end of the
   * flow, and a malformed handle there would send somebody to a page for an
   * identity that does not exist — or, worse, a different one.
   */
  const payee = useMemo(() => parsePayee(params.get("to")), [params]);

  const [anchor, setAnchor] = useState<AnchorInfo | null>(null);
  const [limits, setLimits] = useState<Sep6Limits | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Prefilled from the send form when it sent the reader here, so the amount
  // is not typed twice.
  const [amount, setAmount] = useState(() => {
    const raw = (params.get("amount") ?? "").trim().replace(",", ".");
    return /^\d{1,9}(\.\d{1,2})?$/.test(raw) ? raw : "";
  });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);

  const [stage, setStage] = useState<Stage>("amount");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [instructions, setInstructions] = useState<DepositInstructions | null>(
    null,
  );
  const [tx, setTx] = useState<AnchorTransaction | null>(null);
  const [trusted, setTrusted] = useState<boolean | null>(null);

  const amountId = useId();
  // Polling outlives a render; this is how the loop learns the panel is gone.
  const stopped = useRef(false);
  useEffect(() => () => void (stopped.current = true), []);

  // ------------------------------------------------------------- discovery

  // SEP-1 first, and everything else hangs off it. A failure here is the one
  // failure worth showing instead of the form: there is no ramp to offer.
  useEffect(() => {
    if (!ANCHOR_ENABLED) return;
    let alive = true;

    void (async () => {
      try {
        const info = await loadAnchor();
        if (!alive) return;
        setAnchor(info);
        setLimits(await depositLimits(info).catch(() => null));
      } catch (e) {
        if (alive) setSetupError(message(e));
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // Can this wallet even hold the asset? Asked early, because the answer
  // decides whether the money lands or sits at the anchor waiting.
  const checkTrustline = useCallback(async () => {
    if (!anchor || !address) return;
    setTrusted(await hasTrustline(address, anchor.assetCode, anchor.assetIssuer));
  }, [anchor, address]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!anchor || !address) return;
      const answer = await hasTrustline(
        address,
        anchor.assetCode,
        anchor.assetIssuer,
      );
      if (alive) setTrusted(answer);
    })();
    return () => {
      alive = false;
    };
  }, [anchor, address]);

  // The estimate, debounced.
  //
  // It is decoration and the flow never waits on it: the anchor settles the
  // real figure when the money lands. A stale quote is not cleared from state
  // when the field changes — it is simply not rendered, because the quote
  // carries the amount it was asked about and `shownQuote` below compares the
  // two. Clearing it here would be a setState in an effect body for no gain.
  useEffect(() => {
    if (!anchor?.quoteServer) return;
    const typed = normalizeAmount(amount);
    if (!isAmount(typed)) return;

    let alive = true;
    const t = setTimeout(() => {
      void (async () => {
        setQuoting(true);
        try {
          const q = await priceFor(anchor, typed);
          if (alive) setQuote(q);
        } catch {
          // A missing estimate costs the reader a preview and nothing else.
        } finally {
          if (alive) setQuoting(false);
        }
      })();
    }, 350);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [amount, anchor]);

  const typedAmount = normalizeAmount(amount);
  /**
   * The quote, only if it is a quote for what is in the field right now.
   *
   * Compared as numbers, not as strings: the anchor echoes the amount in its
   * own formatting — "1000" goes out and "1000.00" comes back — so a string
   * comparison here hid every estimate the endpoint returned.
   */
  const shownQuote =
    quote &&
    isAmount(typedAmount) &&
    Number(quote.sellAmount) === Number(typedAmount)
      ? quote
      : null;

  // ---------------------------------------------------------------- actions

  const sign = useCallback(
    (xdr: string) => {
      if (!address) throw new Error("Connect a wallet first.");
      return signWithWallet(xdr, address);
    },
    [address],
  );

  async function addTrustline() {
    if (!anchor || !address) return;
    setError(null);
    try {
      setBusy("Waiting for your wallet…");
      await openTrustline(address, anchor.assetCode, anchor.assetIssuer, sign);
      setBusy("Confirming…");
      await checkTrustline();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    if (!anchor || !address) return;
    setError(null);

    try {
      setBusy("Checking the network…");
      const mismatch = await networkMismatch();
      if (mismatch) throw new Error(mismatch);

      // One signature, and it never reaches the network: SEP-10 challenges are
      // built with sequence number 0 precisely so they cannot be submitted.
      //
      // Signed here rather than lazily, so the wallet prompt belongs to the
      // step that announced it. What is passed on is the getter, not the
      // token: a bank transfer can outlast a JWT, and the later calls should
      // ask again rather than carry a spent one.
      setBusy("Proving the wallet is yours…");
      const token = tokenSource(anchor, address, sign);
      await token();

      setBusy("Asking the anchor for bank details…");
      const started = await startDeposit(anchor, token, address, typedAmount);
      setInstructions(started);
      setStage("transfer");

      // The anchor may already have something to say; from here the status
      // line is the source of truth rather than our own optimism.
      setTx(await getTransaction(anchor, token, started.id).catch(() => null));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  /** SANDBOX. On a real anchor this is the person opening their bank app. */
  async function simulate() {
    if (!anchor || !address || !instructions) return;
    setError(null);
    try {
      setBusy("Pretending the bank paid…");
      const token = tokenSource(anchor, address, sign);
      await simulateBankTransfer(anchor, token, instructions.id, typedAmount);
      await watch(token);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function watch(token: TokenGetter) {
    if (!anchor || !instructions) return;
    const final = await pollTransaction(
      anchor,
      token,
      instructions.id,
      setTx,
      () => stopped.current,
    );
    if (final.status === "completed") {
      setStage("done");
      void checkTrustline();
    }
  }

  async function refresh() {
    if (!anchor || !address || !instructions) return;
    setError(null);
    try {
      setBusy("Asking the anchor…");
      const token = tokenSource(anchor, address, sign);
      await watch(token);
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
        bank transfer into a balance here. Set{" "}
        <span className="mono">NEXT_PUBLIC_ANCHOR_HOME_DOMAIN</span>.
      </p>
    );
  }

  if (setupError) {
    return (
      <div className="card p-5">
        <p role="alert" className="text-sm text-danger">
          {setupError}
        </p>
        <p className="mt-2 text-xs text-mute">
          Anchor: <span className="mono">{ANCHOR_HOME_DOMAIN}</span>
        </p>
      </div>
    );
  }

  if (!anchor) return <div className="skeleton h-48 w-full" />;

  const symbol = anchor.token.symbol;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">
            {stage === "done" ? `${symbol} added` : `Add ${symbol} with ${FIAT_CODE}`}
          </h2>
          <span className="text-xs text-mute">
            via <span className="mono">{anchor.domain}</span>
          </span>
        </div>

        {/* ------------------------------------------------------- amount */}

        {stage === "amount" && (
          <>
            <p className="mt-1 text-sm text-dim">
              {payee ? (
                <>
                  Send Turkish lira from your bank. It arrives as {symbol} in
                  your wallet, and the last step puts it aside for{" "}
                  <span className="mono">
                    {kindUrlPrefix(payee.kind)}
                    {payee.handle}
                  </span>
                  .
                </>
              ) : (
                <>
                  Send Turkish lira from your bank and get {symbol} in your
                  wallet. The {symbol} is what you can then pay a handle with.
                </>
              )}
            </p>

            <div className="mt-4">
              <label className="label" htmlFor={amountId}>
                Amount in {FIAT_CODE}
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
                <span className="input-suffix">{FIAT_CODE}</span>
              </div>

              {/* The estimate, and it is labelled as one: the anchor settles
                  the real number when the money lands, and it will differ by
                  whatever the rate did in between. */}
              <p className="mt-2 text-xs text-mute">
                {quoting && "…"}
                {!quoting && shownQuote && (
                  <>
                    About{" "}
                    <span className="num font-semibold text-dim">
                      {trimAmount(shownQuote.buyAmount)} {symbol}
                    </span>
                    {shownQuote.fee && (
                      <>
                        {" "}
                        · fee {trimAmount(shownQuote.fee)} {FIAT_CODE}
                      </>
                    )}
                  </>
                )}
                {!quoting && !shownQuote && limits?.min !== null && limits?.max !== null && (
                  <>
                    Between {limits?.min} and {limits?.max} {symbol} per transfer.
                  </>
                )}
              </p>
            </div>
          </>
        )}

        {/* ----------------------------------------------------- transfer */}

        {stage === "transfer" && instructions && (
          <>
            <p className="mt-1 text-sm text-dim">
              Send exactly{" "}
              <span className="num font-semibold text-text">
                {amount} {FIAT_CODE}
              </span>{" "}
              to this account. The reference is what tells the anchor the money
              is yours.
            </p>

            <dl className="mt-4 divide-y divide-line rounded-xl border border-line">
              {instructions.fields.map((f) => (
                <div key={f.label} className="flex items-start gap-3 p-3">
                  <dt className="w-40 shrink-0 text-xs text-mute">
                    {f.label}
                    {f.description && (
                      <span className="mt-0.5 block text-[11px] text-dim">
                        {f.description}
                      </span>
                    )}
                  </dt>
                  <dd className="mono min-w-0 flex-1 break-all text-sm">
                    {f.value}
                  </dd>
                  <CopyButton
                    value={f.value}
                    label="Copy"
                    className="btn btn-quiet btn-sm shrink-0"
                  />
                </div>
              ))}
            </dl>

            {instructions.fields.length === 0 && instructions.how && (
              <p className="mt-3 text-sm text-dim">{instructions.how}</p>
            )}
          </>
        )}

        {/* --------------------------------------------------------- done */}

        {stage === "done" && tx && (
          <p className="mt-1 text-sm text-dim">
            <span className="num font-semibold text-accent-text">
              {trimAmount(tx.amountOut ?? "")} {symbol}
            </span>{" "}
            is in <span className="mono">{shortAddr(address ?? "")}</span>.
            {payee
              ? ` One signature left to put it aside for ${kindUrlPrefix(payee.kind)}${payee.handle}.`
              : " You can pay a handle with it now."}
          </p>
        )}

        {/* ------------------------------------------------- status line */}

        {tx && stage !== "amount" && (
          <p className="mt-3 text-sm text-mute">
            {/* The anchor's own words first. It knows why it is waiting and we
                only know the status name. */}
            {tx.message ?? describeStatus(tx.status)}
            {tx.stellarTransactionId && (
              <>
                {" · "}
                <a
                  className="link"
                  href={explorerTx(tx.stellarTransactionId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  the payment
                </a>
              </>
            )}
          </p>
        )}

        {/* ----------------------------------------------------- trustline */}

        {/* Only when we KNOW it is missing. `null` means we could not read the
            account, and telling somebody to sign a transaction they may not
            need is worse than staying quiet. */}
        {trusted === false && stage !== "done" && (
          <div className="mt-4 rounded-xl border border-line p-3">
            <p className="text-sm">
              Your wallet cannot hold {symbol} yet.
            </p>
            <p className="mt-1 text-xs text-mute">
              Issued assets have to be let in first — one transaction, which
              locks 0.5 XLM of reserve in your account. Native XLM never needs
              this, which is why Paytag defaults to it.
            </p>
            <button
              className="btn btn-ghost btn-sm mt-3"
              onClick={() => void addTrustline()}
              disabled={busy !== null || !address}
            >
              {busy !== null && <span className="spinner" aria-hidden />}
              Allow {symbol}
            </button>
          </div>
        )}

        {/* -------------------------------------------------------- action */}

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
              onClick={() => void start()}
              disabled={busy !== null || !isAmount(typedAmount)}
            >
              {busy !== null && <span className="spinner" aria-hidden />}
              {busy ?? "Get the bank details"}
            </button>
          ) : stage === "transfer" ? (
            <>
              {/* The sandbox button, labelled as the sandbox. On a real anchor
                  this is where the person leaves for their banking app, and
                  this button is the one line that gets deleted. */}
              <button
                className="btn btn-primary"
                onClick={() => void simulate()}
                disabled={busy !== null}
              >
                {busy !== null && <span className="spinner" aria-hidden />}
                {busy ?? "Simulate the bank transfer"}
              </button>
              <button
                className="btn btn-quiet"
                onClick={() => void refresh()}
                disabled={busy !== null}
              >
                Check again
              </button>
            </>
          ) : payee && tx?.amountOut ? (
            // Back to the form that sent us here, with the amount that actually
            // arrived — not the one that was asked for. The anchor's fee comes
            // off in between, and a prefilled figure the wallet cannot cover is
            // a failed transaction waiting to happen.
            <Link
              className="btn btn-primary"
              href={`/p/${payee.slug}/${payee.handle}?amount=${encodeURIComponent(
                trimAmount(tx.amountOut, 7),
              )}&asset=${anchor.token.key}`}
            >
              Send it to {kindUrlPrefix(payee.kind)}
              {payee.handle}
            </Link>
          ) : (
            <Link className="btn btn-primary" href="/send">
              Pay a handle
            </Link>
          )}

          {instructions?.moreInfoUrl && stage === "transfer" && (
            <a
              className="link text-xs"
              href={instructions.moreInfoUrl}
              target="_blank"
              rel="noreferrer"
            >
              The anchor&rsquo;s own page for this transfer
            </a>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      {stage === "transfer" && (
        <p className="px-1 text-xs text-mute">
          This is a sandbox anchor: the bank is simulated and no real lira moves.
          The {symbol} it pays out is real testnet {symbol}.
        </p>
      )}
    </div>
  );
}

/**
 * `gh/torvalds` — the slug and handle a send form carried over.
 *
 * Both halves are validated: the slug against the kinds that exist, the handle
 * through the same normalisation the rest of the product uses. Anything else
 * answers null and the page falls back to being an ordinary top-up, which is
 * the right failure — a mangled handle in a link is how money goes to the
 * wrong tag.
 */
function parsePayee(
  raw: string | null,
): { slug: KindSlug; handle: string; kind: IdentityKind } | null {
  if (!raw) return null;
  const [slug, ...rest] = raw.split("/");
  const handle = rest.join("/");
  if (!isKindSlug(slug) || !handle) return null;
  try {
    const kind = KIND_SLUG[slug];
    return { slug, handle: normalizeHandle(handle, kind), kind };
  } catch {
    return null;
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A typed amount as the anchor wants it: a dot, and no stray spaces. */
function normalizeAmount(raw: string): string {
  return raw.trim().replace(",", ".");
}

function isAmount(s: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0;
}
