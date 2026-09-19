// The off-ramp's Stellar leg: one classic payment, with a memo that matters.
//
// Every customer of an anchor withdraws to the SAME account. The memo the
// anchor hands out is the only thing that says which withdrawal a payment
// belongs to, so a payment sent without it — or with the wrong type of memo —
// is money that arrives correctly on chain and is attributable to nobody.
// That is the single most common way an off-ramp integration loses funds, and
// it is why the memo is built from the anchor's own answer rather than from an
// assumption about what kind it will be.
//
// Classic, not Soroban: a Soroban token transfer carries no memo at all, so
// the escrow contract could not do this even if it wanted to. The money has to
// pass through a wallet on its way out.

import {
  Asset,
  BASE_FEE,
  Memo,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { networkPassphrase } from "../stellar";
import { horizon, type SignXdr } from "./trustline";

export type AnchorPayment = {
  from: string;
  /** The anchor's account, from its withdraw response. */
  destination: string;
  code: string;
  issuer: string;
  /** In the asset's own units, as a decimal string: "12.5". */
  amount: string;
  memo: string;
  memoType: string;
};

/**
 * Sends the asset to the anchor and returns the transaction hash.
 *
 * The hash is worth keeping: it is the reader's own proof that they paid, and
 * the thing to quote at an anchor that says it never received anything.
 */
export async function payAnchor(
  p: AnchorPayment,
  sign: SignXdr,
): Promise<string> {
  const source = await horizon().loadAccount(p.from);

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: p.destination,
        asset: new Asset(p.code, p.issuer),
        amount: p.amount,
      }),
    )
    .addMemo(buildMemo(p.memo, p.memoType))
    .setTimeout(180)
    .build();

  const signed = await sign(tx.toXdr());
  const sent = await horizon().submitTransaction(
    TransactionBuilder.fromXdr(signed, networkPassphrase),
  );
  return sent.hash;
}

/**
 * The memo, in whatever type the anchor asked for.
 *
 * It refuses rather than guesses. A `text` memo where the anchor expects an
 * `id` is not a near miss — the anchor matches on both value and type, so the
 * payment lands unattributed and the lira never arrives. Better to stop before
 * the money moves than to send it somewhere it cannot be traced from.
 */
export function buildMemo(value: string, type: string): Memo {
  switch (type.toLowerCase()) {
    case "id":
      return Memo.id(value);
    case "text":
      return Memo.text(value);
    case "hash":
      return Memo.hash(value);
    default:
      throw new Error(
        `The anchor asked for a "${type}" memo, which this app cannot build. Nothing was sent.`,
      );
  }
}
