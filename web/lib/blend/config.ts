// Blend: where a claimed balance can go on earning.
//
// Blend is a lending protocol. Supplying an asset to one of its pools lends it
// to borrowers, who pay interest, and — if the pool is in the reward zone —
// the protocol also emits BLND to suppliers. Both accrue to whoever holds the
// position.
//
// The position here is always the RECIPIENT'S, never the escrow's. Money
// waiting on a handle is somebody else's money that has not been accepted yet,
// and lending it out would put a third party's credit risk between an escrow
// and its promise. Once it has been claimed it belongs to the person who
// claimed it, and what they do with it is their decision — this file only
// makes one of the options one click away.

/**
 * The pool to offer. Empty means this deployment does not offer earning at all.
 *
 * A single pool rather than a list: pools differ in which assets they take,
 * what they charge, who backstops them and whether they emit BLND at all, and
 * "choose a pool" is not a question to put in front of somebody who came here
 * to collect a tip. One pool, named, with a link to it.
 */
export const BLEND_POOL_ID = (
  process.env.NEXT_PUBLIC_BLEND_POOL_ID ?? ""
).trim();

export const BLEND_ENABLED = BLEND_POOL_ID !== "";

/** What the pool calls itself, for the line that says where the money went. */
export const BLEND_POOL_NAME = (
  process.env.NEXT_PUBLIC_BLEND_POOL_NAME ?? "a Blend pool"
).trim();

/**
 * Blend's rates are fixed-point with twelve decimal places.
 *
 * `b_rate` starts at 1.0 and climbs as interest accrues, so the same number of
 * bTokens is worth more underlying as time passes. That is the entire
 * mechanism: nothing is ever credited to a position, the position's value just
 * grows.
 */
export const RATE_SCALAR = 1_000_000_000_000n;
