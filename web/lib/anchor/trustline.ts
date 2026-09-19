// The trustline — the one thing standing between a wallet and an issued asset.
//
// Native XLM can land in any account. Everything else has to be let in first:
// the holder signs a `changeTrust` operation saying "I am willing to hold this
// asset from this issuer", and until they do, a payment to them simply fails.
// Paytag avoided this for a year by only offering XLM, and the anchor is the
// reason it is worth crossing now — the asset on the other side of the
// trustline is the one that turns back into lira.
//
// It is classic Stellar, not Soroban, so it goes through Horizon.

import {
  Asset,
  BASE_FEE,
  Horizon,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { networkPassphrase } from "../stellar";
import { HORIZON_URL } from "./config";

let _horizon: Horizon.Server | null = null;

export function horizon(): Horizon.Server {
  if (!_horizon) _horizon = new Horizon.Server(HORIZON_URL);
  return _horizon;
}

/**
 * Three answers, not two.
 *
 * `null` means we could not tell — an unfunded account, or Horizon being
 * unreachable — and a caller must not read that as "no trustline". The
 * difference decides whether the interface tells somebody to sign a
 * transaction they may not need.
 */
export async function hasTrustline(
  account: string,
  code: string,
  issuer: string,
): Promise<boolean | null> {
  try {
    const acc = await horizon().loadAccount(account);
    return acc.balances.some(
      (b) =>
        "asset_code" in b &&
        b.asset_code === code &&
        "asset_issuer" in b &&
        b.asset_issuer === issuer,
    );
  } catch {
    return null;
  }
}

/**
 * How much of the asset this account holds, as a decimal string.
 *
 * `null` for "no trustline, no account, or could not ask" — the three are not
 * worth telling apart at the call site, because all three mean the same thing
 * to a screen offering to cash out: there is nothing to offer yet.
 */
export async function assetBalance(
  account: string,
  code: string,
  issuer: string,
): Promise<string | null> {
  try {
    const acc = await horizon().loadAccount(account);
    const line = acc.balances.find(
      (b) =>
        "asset_code" in b &&
        b.asset_code === code &&
        "asset_issuer" in b &&
        b.asset_issuer === issuer,
    );
    return line?.balance ?? null;
  } catch {
    return null;
  }
}

export type SignXdr = (xdr: string) => Promise<string>;

/**
 * Opens the trustline, and waits for it.
 *
 * One operation, signed by the account itself. It costs a base fee and locks
 * 0.5 XLM of reserve — worth saying out loud in the interface, because "this
 * is free" is not quite true and finding out afterwards is worse than being
 * told.
 */
export async function openTrustline(
  account: string,
  code: string,
  issuer: string,
  sign: SignXdr,
): Promise<string> {
  const source = await horizon().loadAccount(account);

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: new Asset(code, issuer) }))
    .setTimeout(120)
    .build();

  const signed = await sign(tx.toXdr());
  const sent = await horizon().submitTransaction(
    TransactionBuilder.fromXdr(signed, networkPassphrase),
  );
  return sent.hash;
}
