import { StrKey } from "@stellar/stellar-sdk";

/**
 * The payout address: where a claim on an identity is allowed to pay.
 *
 * Two rules live here, and they are the reason this is a module and not four
 * lines inlined in a form:
 *
 *   1. What counts as an address (shape AND checksum). The database CHECK can
 *      only see the shape — base32 arithmetic does not belong in SQL — so the
 *      checksum is verified here, on both sides of the wire.
 *   2. Which address a claim pays. The saved one when there is one, the
 *      connected wallet otherwise. The verifier endpoint and the claim screen
 *      must answer that identically, or the signature covers a destination the
 *      reader was never shown.
 *
 * `payout_prefs` is a separate table from `identities` on purpose (see
 * db/schema.sql): row level security grants per row, not per column, so an
 * UPDATE policy on `identities` would have let a user rewrite their own handle.
 */

/** Mirrors the CHECK constraint on `payout_prefs.address`. */
export const PAYOUT_SHAPE = /^G[A-Z2-7]{55}$/;

/**
 * What we store, from what a person pasted.
 *
 * Strkey is uppercase base32; a lowercase paste is the same key written badly,
 * so it is corrected rather than rejected. Whitespace goes too — copying an
 * address out of a wallet often brings a newline with it.
 */
export function normalizePayout(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/**
 * A real Stellar account address.
 *
 * The checksum is the half that matters: `PAYOUT_SHAPE` accepts a typo, and a
 * claim signed for a mistyped address pays an account that does not exist,
 * which fails on chain after the reader has already signed a transaction.
 */
export function isPayoutAddress(value: unknown): value is string {
  return (
    typeof value === "string" &&
    PAYOUT_SHAPE.test(value) &&
    StrKey.isValidEd25519PublicKey(value)
  );
}

/**
 * Why this text is not an address, in the words a form should say — or null
 * when it is one. Validating before the click lets the button explain itself
 * instead of failing after it.
 */
export function describePayoutProblem(raw: string): string | null {
  const value = normalizePayout(raw);
  if (value === "") return "Paste an address.";
  if (value.startsWith("M")) {
    return "That is a muxed address (M…). Use the plain G… account it belongs to.";
  }
  if (value.startsWith("C")) {
    return "That is a contract address (C…), not an account.";
  }
  if (!value.startsWith("G")) return "A Stellar address starts with G.";
  if (value.length !== 56) {
    return `A Stellar address is 56 characters; this one is ${value.length}.`;
  }
  if (!PAYOUT_SHAPE.test(value)) {
    return "That contains characters a Stellar address cannot.";
  }
  if (!StrKey.isValidEd25519PublicKey(value)) {
    // The checksum is what catches a single mistyped character, which is the
    // realistic mistake — and the expensive one.
    return "That address fails its own checksum, so a character is wrong.";
  }
  return null;
}

/**
 * Where a claim pays: the address the reader saved, or the wallet in front of
 * them. Called by the claim screen to show it and by /api/verify/claim-auth to
 * enforce it, so the two cannot drift.
 *
 * `locked` is the difference that matters to a reader: when it is true, this
 * destination is the only one the verifier will sign for, whatever wallet is
 * connected. That is the point of saving one — a stolen session cannot redirect
 * the money.
 */
export function claimDestination(
  saved: string | null,
  connected: string | null,
): { address: string | null; locked: boolean } {
  return saved
    ? { address: saved, locked: true }
    : { address: connected, locked: false };
}
