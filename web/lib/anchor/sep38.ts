// SEP-38 — what the bank side is worth in the asset, before anyone commits.
//
// An indicative price, not a promise. The anchor quotes TRY against USDC from
// an oracle plus its own spread, and the figure moves; what the person is
// actually charged is settled by the deposit itself and reported on the
// transaction record. So this is shown as an estimate and the flow never
// depends on it — a price endpoint that is down costs the reader a preview,
// not the ability to add money.

import { FIAT_SEP38 } from "./config";
import { sep38Asset, type AnchorInfo } from "./toml";

export type Quote = {
  /** What the person types, echoed back by the anchor. */
  sellAmount: string;
  /** What they would receive, in the Stellar asset. */
  buyAmount: string;
  /** Fiat per unit of the asset, fee included. */
  totalPrice: string;
  /** The anchor's cut, in fiat. */
  fee: string | null;
};

/**
 * An anchor amount, shortened for a glance.
 *
 * Amounts come back at the asset's full precision — "20.3960908 USDC" — and
 * seven decimal places on an estimate are six characters of noise on a figure
 * that is an estimate anyway. It TRUNCATES rather than rounds, for the same
 * reason balances are floored across this app: a number shown higher than it is
 * invites a decision that does not hold.
 */
export function trimAmount(amount: string, decimals = 2): string {
  const dot = amount.indexOf(".");
  if (dot < 0) return amount;
  if (decimals === 0) return amount.slice(0, dot);
  const cut = amount.slice(0, dot + 1 + decimals);
  // Never leave a trailing dot behind ("20." is not a number anyone wrote).
  return cut.endsWith(".") ? cut.slice(0, -1) : cut;
}

/**
 * Asks what `tryAmount` lira would buy.
 *
 * `context: "sep6"` is required by the standard: a quote for a deposit and a
 * quote for a swap can differ, and the anchor is entitled to know which it is
 * being asked about.
 */
export async function priceFor(
  anchor: AnchorInfo,
  tryAmount: string,
): Promise<Quote> {
  if (!anchor.quoteServer) {
    throw new Error("This anchor does not publish quotes.");
  }

  const url =
    `${anchor.quoteServer}/price?` +
    new URLSearchParams({
      sell_asset: FIAT_SEP38,
      buy_asset: sep38Asset(anchor.assetCode, anchor.assetIssuer),
      sell_amount: tryAmount,
      context: "sep6",
    });

  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as {
    sell_amount?: string;
    buy_amount?: string;
    total_price?: string;
    fee?: { total?: string };
    error?: string;
  };

  if (!res.ok || !body.buy_amount) {
    throw new Error(body.error ?? `The anchor would not quote a price.`);
  }

  return {
    sellAmount: body.sell_amount ?? tryAmount,
    buyAmount: body.buy_amount,
    totalPrice: body.total_price ?? "",
    fee: body.fee?.total ?? null,
  };
}
