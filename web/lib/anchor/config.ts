// The anchor: what this deployment ramps fiat through.
//
// An anchor is the piece Stellar cannot have on chain — a company with a bank
// account, that takes Turkish lira in and pays USDC out, and the reverse. The
// protocol standardises the CONVERSATION (SEP-1, 10, 6, 12, 38), not the
// company, which is why the whole handoff below is a home domain and an asset
// code: everything else is discovered from the domain's stellar.toml at run
// time. Moving from this sandbox to a production anchor changes these two
// values and nothing else in the code.

import { IS_TESTNET } from "../config";

/**
 * The anchor's home domain, e.g. `tr-mock-anchor.fly.dev`.
 *
 * Empty means this deployment has no fiat ramp, and the interface says so
 * rather than offering a button that cannot work. Same pattern as Supabase:
 * the product's core — money to a handle — never depends on it.
 */
export const ANCHOR_HOME_DOMAIN = (
  process.env.NEXT_PUBLIC_ANCHOR_HOME_DOMAIN ?? ""
).trim();

export const ANCHOR_ENABLED = ANCHOR_HOME_DOMAIN !== "";

/** The Stellar asset the anchor ramps. Must be one this app already knows. */
export const ANCHOR_ASSET_CODE = (
  process.env.NEXT_PUBLIC_ANCHOR_ASSET_CODE ?? "USDC"
).trim();

/** The currency on the bank side, as a person writes it and as SEP-38 names it. */
export const FIAT_CODE = "TRY";
export const FIAT_SEP38 = "iso4217:TRY";

/**
 * Horizon, not the Soroban RPC.
 *
 * The ramp's Stellar leg is classic: a trustline is a `changeTrust`
 * operation and an off-ramp payment is a classic `payment` with a memo, and
 * neither is a contract call. Horizon is the endpoint that speaks that half of
 * the network.
 */
export const HORIZON_URL = (
  process.env.NEXT_PUBLIC_HORIZON_URL ??
  (IS_TESTNET
    ? "https://horizon-testnet.stellar.org"
    : "https://horizon.stellar.org")
).trim();

/** How long we keep asking the anchor what happened, and how often. */
export const POLL_INTERVAL_MS = 3_000;
export const POLL_ATTEMPTS = 60; // ~3 minutes

/** `https://<domain>`, with no trailing slash. */
export function anchorOrigin(domain = ANCHOR_HOME_DOMAIN): string {
  return `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
}
