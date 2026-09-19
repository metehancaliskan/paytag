// Escrow, broken down by asset.
//
// The contract takes the token address as a `deposit` argument and never looks
// at it again, so one identity's escrow can hold several assets at once — and
// from the day the send form offers more than one, it usually will.
//
// Everything that reads an escrow used to answer with a single number, which
// forced a choice nobody should have to make: sum across assets (a figure that
// is not any amount of anything) or show one asset and quietly drop the rest.
// Both were wrong in the same direction — they hid money. This file exists so
// the answer can be a list.

import { TOKENS, tokenByContractId, type TokenConfig } from "./config";

/**
 * The shape this file needs from a payment, and nothing more.
 *
 * Structural rather than an import of `Payment`: grouping is arithmetic over
 * three fields, it has no business knowing about escrow status or expiry, and
 * a test should not have to build a whole payment record to check a sum.
 */
export type Escrowed = {
  id: number;
  /** The token's contract id, exactly as the chain stores it. */
  token: string;
  amount: bigint;
};

export type AssetTotal = {
  /**
   * What this deployment calls the asset, or `null` when it has no name for
   * it.
   *
   * Null is not a failure: the contract accepts any SEP-41 token, so a payment
   * can perfectly well arrive in something this build has never been told
   * about. What it does mean is that the interface cannot print a unit next to
   * the number, which is why the two cases are kept apart rather than papered
   * over with a fallback symbol.
   */
  token: TokenConfig | null;
  contractId: string;
  units: bigint;
  /** The payment ids that make up this total, for the claim call. */
  ids: number[];
};

/**
 * Groups payments by their asset, largest concern first.
 *
 * The order is the deployment's own `TOKENS` order — XLM, then USDC — rather
 * than by amount. A list whose rows move around between two reads is a list
 * people misread; the assets a deployment offers are few and fixed, so the
 * stable order is free. Assets this build cannot name go last, in a stable
 * order of their own.
 */
export function groupByAsset(payments: readonly Escrowed[]): AssetTotal[] {
  const totals = new Map<string, AssetTotal>();

  for (const p of payments) {
    const found = totals.get(p.token);
    if (found) {
      found.units += p.amount;
      found.ids.push(p.id);
      continue;
    }
    totals.set(p.token, {
      token: tokenByContractId(p.token),
      contractId: p.token,
      units: p.amount,
      ids: [p.id],
    });
  }

  return [...totals.values()].sort((a, b) => rank(a) - rank(b));
}

/** Position in the configured order; unnamed assets sort after every named one. */
function rank(a: AssetTotal): number {
  const i = TOKENS.findIndex((t) => t.contractId === a.contractId);
  return i === -1 ? TOKENS.length : i;
}

/**
 * An asset this build has a name for.
 *
 * A separate type rather than a runtime check at every use: a component that
 * has filtered for the named ones should not have to keep proving it with a
 * `!` on every line that prints a symbol.
 */
export type NamedAsset = AssetTotal & { token: TokenConfig };

/** The assets this build can name — the only ones it offers to claim. */
export function named(assets: readonly AssetTotal[]): NamedAsset[] {
  return assets.filter((a): a is NamedAsset => a.token !== null);
}

/** The rest. Counted and mentioned, never silently dropped. */
export function unnamed(assets: readonly AssetTotal[]): AssetTotal[] {
  return assets.filter((a) => a.token === null);
}

/** Is there anything at all here? */
export function anyUnits(assets: readonly AssetTotal[]): boolean {
  return assets.some((a) => a.units > 0n);
}
