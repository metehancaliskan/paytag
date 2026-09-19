// XOXNO Lending: the other place a claimed balance can earn.
//
// A second venue rather than a replacement, because the two pay in different
// things and the difference matters to this product specifically. Blend pays
// BLND, a separate token with no route to a bank account. XOXNO pays interest
// in the asset itself — so a USDC position earns more USDC, and more USDC is
// something the anchor will turn into lira. For somebody whose whole reason
// for being here is getting paid in money they can spend, that is not a
// preference between protocols, it is the difference between a reward they
// can use and one they cannot.
//
// Everything below is read from the protocol's own deployment config
// (configs/networks.json and configs/testnet/*.json in XOXNO/rs-lending-xlm)
// and verified against the live contracts.

/** The controller: the contract a person actually talks to. */
export const XOXNO_CONTROLLER = (
  process.env.NEXT_PUBLIC_XOXNO_CONTROLLER ?? ""
).trim();

/**
 * The position NFT.
 *
 * XOXNO does not key positions by address the way Blend does. Supplying mints
 * an NFT, and that token's id IS the account id; every later call names the
 * account rather than the person. So finding somebody's position means asking
 * this contract which token they hold — one extra read, and the reason this
 * integration has a "find the account" step that the Blend one does not.
 */
export const XOXNO_POSITION_NFT = (
  process.env.NEXT_PUBLIC_XOXNO_POSITION_NFT ?? ""
).trim();

export const XOXNO_ENABLED =
  XOXNO_CONTROLLER !== "" && XOXNO_POSITION_NFT !== "";

/**
 * Which spoke and hub to supply into.
 *
 * A spoke is a risk configuration — which assets it lists, at what
 * loan-to-value, with what liquidation terms — and a hub is the pool of
 * liquidity underneath it. Spoke 1 on testnet is "Main (USDC/EURC/XLM/BTC)"
 * and lists both assets Paytag pays out, on hub 1. Supplying is the same
 * whichever spoke you use; the numbers only start to differ once you borrow,
 * which nothing here does.
 */
export const XOXNO_SPOKE_ID = Number(
  (process.env.NEXT_PUBLIC_XOXNO_SPOKE_ID ?? "1").trim(),
);

export const XOXNO_HUB_ID = Number(
  (process.env.NEXT_PUBLIC_XOXNO_HUB_ID ?? "1").trim(),
);

/** Where to send somebody to see the position outside this app. */
export const XOXNO_APP_URL = "https://xoxno.com";
