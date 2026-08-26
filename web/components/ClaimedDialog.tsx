"use client";

import Modal from "./Modal";
import CopyButton from "./CopyButton";
import { kindUrlPrefix, type IdentityKind } from "@/lib/identity";
import { displayUnits, fromUnits, shortAddr } from "@/lib/format";
import { DEFAULT_TOKEN, explorerTx } from "@/lib/config";

export type Claimed = {
  hash: string;
  units: bigint;
  to: string;
  /** WHICH handle this claim emptied. The page has two, and they are separate
   *  escrows — a result that does not name one is a result about neither. */
  kind: IdentityKind;
  handle: string;
};

/**
 * The end of a claim.
 *
 * It used to replace the whole page, which had one real cost: a person with two
 * handles lost sight of the other one at exactly the moment they had proved they
 * could withdraw. Now the list stays on screen underneath and this says, in one
 * line, which of the two just moved and where it went.
 */
export default function ClaimedDialog({
  claimed,
  onClose,
}: {
  claimed: Claimed | null;
  onClose: () => void;
}) {
  return (
    <Modal open={claimed !== null} onClose={onClose} labelledBy="claimed-title">
      {claimed && (
        <>
          <div className="p-5">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-black text-accent-fg"
              >
                ✓
              </span>
              <div className="min-w-0">
                <h2 id="claimed-title" className="font-bold">
                  <span
                    className="num"
                    title={`${fromUnits(claimed.units)} ${DEFAULT_TOKEN.symbol}`}
                  >
                    {displayUnits(claimed.units)}
                  </span>{" "}
                  {DEFAULT_TOKEN.symbol} is yours.
                </h2>
                <p className="mt-1 text-sm text-mute">
                  From{" "}
                  <span className="mono">
                    {kindUrlPrefix(claimed.kind)}
                    {claimed.handle}
                  </span>{" "}
                  to <span className="mono">{shortAddr(claimed.to)}</span>.
                </p>
              </div>
            </div>
          </div>

          {/* The hash, because this is the one screen in the product where a
              person may want to prove to somebody else what happened. */}
          <div className="border-t border-line p-5">
            <p className="menu-label">Transaction</p>
            <p className="mono mt-1.5 break-all text-xs text-dim">
              {claimed.hash}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                className="btn btn-ghost btn-sm"
                href={explorerTx(claimed.hash)}
                target="_blank"
                rel="noreferrer"
              >
                Open the explorer
              </a>
              <CopyButton
                value={claimed.hash}
                label="Copy hash"
                className="btn btn-quiet btn-sm"
              />
              <button
                type="button"
                className="btn btn-primary btn-sm ml-auto"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
