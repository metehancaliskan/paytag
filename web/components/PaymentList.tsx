"use client";

import Link from "next/link";
import { useState } from "react";
import { useWallet } from "./WalletProvider";
import CopyButton from "./CopyButton";
import {
  buildRefund,
  submitSigned,
  STATUS,
  type Payment,
} from "@/lib/contract";
import { describeEscrowError } from "@/lib/stellar";
import { sign, networkMismatch } from "@/lib/freighter";
import { displayUnits, fromUnits, ledgersToHuman, shortAddr } from "@/lib/format";
import { explorerAccount, explorerTx, tokenByContractId } from "@/lib/config";
import { kindUrlPrefix, slugOf } from "@/lib/identity";
import type { RecipientMap } from "@/lib/sent";

const STATUS_LABEL: Record<number, { text: string; cls: string }> = {
  [STATUS.Pending]: { text: "Waiting", cls: "badge badge-pending" },
  [STATUS.Claimed]: { text: "Claimed", cls: "badge badge-claimed" },
  [STATUS.Refunded]: { text: "Refunded", cls: "badge badge-refunded" },
};

/**
 * WHICH END OF THE PAYMENT THE READER IS STANDING AT.
 *
 * "in"  — a handle's own page. Every row arrived from somewhere, so the
 *         interesting half is who sent it.
 * "out" — the sender's own list. Every row came from the same wallet, theirs,
 *         so saying so on each one is a column of identical text. What they
 *         cannot see without being told is where each one went.
 *
 * One component with a switch rather than two lists, because everything else on
 * the row is the same and the refund button especially so: it appears under
 * exactly the same three conditions in both places, and two copies of that rule
 * is how they end up disagreeing.
 */
export type Direction = "in" | "out";

export default function PaymentList({
  payments,
  ledger,
  failed = false,
  onRefunded,
  direction = "in",
  recipients,
  empty,
  title = "Payments",
}: {
  payments: Payment[] | null;
  ledger: number | null;
  /** The read failed — an empty list here means "unknown", not "none". */
  failed?: boolean;
  onRefunded: () => void;
  direction?: Direction;
  /** Only for "out": identity_key → who holds it, where that is knowable. */
  recipients?: RecipientMap;
  /** Replaces the empty state, which reads differently from each end. */
  empty?: { title: string; line: string };
  /**
   * Names the section. The sent page cuts one list into three by what can be
   * done with each, so "Payments" three times over would be three headings
   * that say nothing and no heading that does.
   */
  title?: string;
}) {
  if (failed) {
    return (
      <div className="card p-6 text-center text-sm text-mute">
        Blank because the chain could not be read, not because it is empty.
      </div>
    );
  }

  if (payments === null) {
    return (
      <div className="card p-5">
        <div className="space-y-3" aria-busy="true" aria-label="Loading payments">
          <div className="skeleton h-4 w-1/3" />
          <div className="skeleton h-4 w-2/3" />
          <div className="skeleton h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div className="card p-6 text-center">
        <p className="font-medium">{empty?.title ?? "Nothing waiting yet"}</p>
        <p className="mt-1 text-sm text-mute">
          {empty?.line ?? "Be the first. They need no wallet for it to be waiting."}
        </p>
      </div>
    );
  }

  const newestFirst = [...payments].sort((a, b) => b.id - a.id);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-5 py-3.5 divider border-t-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-mute">
          {payments.length} {payments.length === 1 ? "payment" : "payments"}
        </span>
      </div>

      <ul>
        {newestFirst.map((p) => (
          <PaymentRow
            key={p.id}
            payment={p}
            ledger={ledger}
            onRefunded={onRefunded}
            direction={direction}
            recipient={recipients?.[p.identityHex.toLowerCase()] ?? null}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * One payment. A row on a wide screen, a stacked block on a narrow one —
 * a five-column money table on a phone is unreadable, and a horizontally
 * scrolling table hides the status column, which is the one that matters.
 */
function PaymentRow({
  payment: p,
  ledger,
  onRefunded,
  direction,
  recipient,
}: {
  payment: Payment;
  ledger: number | null;
  onRefunded: () => void;
  direction: Direction;
  recipient: RecipientMap[string];
}) {
  const { address } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const label = STATUS_LABEL[p.status] ?? STATUS_LABEL[STATUS.Pending];
  // Each payment carries its own token address. A list can hold XLM and USDC
  // side by side, so the row must read the asset off the payment rather than
  // assume one — printing the wrong symbol next to an amount is a lie about
  // how much money is there.
  const asset = tokenByContractId(p.token);
  const ledgersLeft = ledger === null ? null : p.expiryLedger - ledger;

  // The contract requires the current ledger to be strictly PAST expiry
  // (lib.rs: `if now <= p.expiry_ledger { NotYetExpired }`), so the button
  // must not appear on the expiry ledger itself.
  const expired = ledgersLeft !== null && ledgersLeft < 0;
  const isSender = address !== null && address === p.from;
  const canRefund = p.status === STATUS.Pending && expired && isSender;

  async function refund() {
    setError(null);
    if (!address) return;
    try {
      setBusy("Checking the network…");
      const mismatch = await networkMismatch();
      if (mismatch) throw new Error(mismatch);

      setBusy("Preparing…");
      const tx = await buildRefund({ from: address, paymentId: p.id });

      setBusy("Waiting for your wallet…");
      const signed = await sign(tx.toXdr(), address);

      setBusy("Submitting…");
      const res = await submitSigned(signed);
      setHash(res.hash);
      onRefunded();
    } catch (e) {
      setError(describeEscrowError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="border-t border-line px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="num text-xs text-mute">#{p.id}</span>

        <span
          className="num text-sm font-semibold"
          title={`${fromUnits(p.amount, asset?.decimals)} ${asset?.symbol ?? ""}`}
        >
          {displayUnits(p.amount, asset?.decimals)}{" "}
          <span className="text-mute">{asset?.symbol ?? "tokens"}</span>
        </span>

        {direction === "in" ? (
          <span className="text-xs text-mute">
            from{" "}
            <a
              className="mono link"
              href={explorerAccount(p.from)}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddr(p.from)}
            </a>
            {isSender && <span className="ml-1 text-accent-text">(you)</span>}
          </span>
        ) : (
          <span className="text-xs text-mute">
            to{" "}
            {recipient ? (
              <Link
                className="mono link"
                href={`/p/${slugOf(recipient.kind)}/${recipient.handle}`}
              >
                {kindUrlPrefix(recipient.kind)}
                {recipient.handle}
              </Link>
            ) : (
              /* Not a loading state and not a failure: the payment carries a
                 hash of the handle, and nobody has proved that handle here, so
                 there is no name to look up. Saying it plainly beats printing
                 32 bytes of hex at somebody trying to find their money. */
              <span>a handle nobody has verified yet</span>
            )}
          </span>
        )}

        <span className="ml-auto flex items-center gap-2">
          {p.status === STATUS.Pending && ledgersLeft !== null && (
            <span
              className="text-xs text-mute"
              title={`expiry ledger ${p.expiryLedger}`}
            >
              {expired
                ? "claim window closed"
                : `${ledgersToHuman(ledgersLeft)} left to claim`}
            </span>
          )}
          <span className={label.cls}>{label.text}</span>
        </span>
      </div>

      {canRefund && !hash && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="btn btn-warn btn-sm"
            onClick={refund}
            disabled={busy !== null}
          >
            {busy !== null && <span className="spinner" aria-hidden />}
            {busy ?? "Refund to me"}
          </button>
          <span className="text-xs text-mute">Only you can pull it back.</span>
        </div>
      )}

      {p.status === STATUS.Pending && expired && !isSender && (
        <p className="mt-2 text-xs text-mute">
          Past its window. The sender can take it back.
        </p>
      )}

      {hash && (
        <p className="mt-3 text-sm text-accent-text">
          Refunded.{" "}
          <a
            className="link"
            href={explorerTx(hash)}
            target="_blank"
            rel="noreferrer"
          >
            View the transaction
          </a>{" "}
          <CopyButton value={hash} label="copy hash" className="btn btn-quiet btn-sm" />
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
