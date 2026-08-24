"use client";

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
import { fromUnits, ledgersToHuman, shortAddr } from "@/lib/format";
import { explorerAccount, explorerTx, tokenByContractId } from "@/lib/config";

const STATUS_LABEL: Record<number, { text: string; cls: string }> = {
  [STATUS.Pending]: { text: "In escrow", cls: "badge badge-pending" },
  [STATUS.Claimed]: { text: "Claimed", cls: "badge badge-claimed" },
  [STATUS.Refunded]: { text: "Refunded", cls: "badge badge-refunded" },
};

export default function PaymentList({
  payments,
  ledger,
  failed = false,
  onRefunded,
}: {
  payments: Payment[] | null;
  ledger: number | null;
  /** The read failed — an empty list here means "unknown", not "none". */
  failed?: boolean;
  onRefunded: () => void;
}) {
  if (failed) {
    return (
      <div className="card p-6 text-center text-sm text-mute">
        Blank because the chain could not be read — not because it is empty.
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
        <p className="font-medium">Nothing in escrow yet</p>
        <p className="mt-1 text-sm text-mute">
          Be the first — they need no wallet for it to be waiting.
        </p>
      </div>
    );
  }

  const newestFirst = [...payments].sort((a, b) => b.id - a.id);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-5 py-3.5 divider border-t-0">
        <h2 className="text-sm font-semibold">Payments</h2>
        <span className="text-xs text-mute">
          {payments.length} total · newest first
        </span>
      </div>

      <ul>
        {newestFirst.map((p) => (
          <PaymentRow
            key={p.id}
            payment={p}
            ledger={ledger}
            onRefunded={onRefunded}
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
}: {
  payment: Payment;
  ledger: number | null;
  onRefunded: () => void;
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

        <span className="num text-sm font-semibold">
          {fromUnits(p.amount, asset?.decimals)}{" "}
          <span className="text-mute">{asset?.symbol ?? "tokens"}</span>
        </span>

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
          <span className="text-xs text-mute">
            Window closed unclaimed. Only you can pull it back.
          </span>
        </div>
      )}

      {p.status === STATUS.Pending && expired && !isSender && (
        <p className="mt-2 text-xs text-mute">
          Past its window — waiting for the sender to refund it.
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
