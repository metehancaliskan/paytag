// Watching a lending position grow.
//
// Blend's reward is a separate token, so "how much have I earned" is a number
// the pool will hand over on request. XOXNO has no such token: the position
// itself is worth more each ledger, because the market's supply index climbs.
// Nothing is credited, nothing accumulates on the side — the same holding is
// simply worth more.
//
// Which makes the figure harder to watch and easier to trust. Harder, because
// the interest on a small position is a fraction of a stroop a second and a
// balance read in the asset's own units barely moves. Easier, because the
// index it comes from is RAY scaled — twenty-seven decimal places — and moves
// by billions in the same few seconds. So the position is drawn from the
// index: measure how fast the index climbs, and carry the position forward
// with it.

/** One reading of the market's supply index. */
export type IndexSample = { value: bigint; at: number };

/** Twenty-seven decimal places, which is how the protocol scales its rates. */
export const RAY = 10n ** 27n;

/** Milliseconds in a year, for turning a rate into something annual. */
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * How fast the index is climbing, in RAY per millisecond.
 *
 * Zero when it cannot be told — one reading, two readings at the same instant,
 * or an index that went backwards, which should never happen and is treated as
 * "do not project" rather than as a number to extrapolate from.
 */
export function indexRatePerMs(
  previous: IndexSample | null,
  next: IndexSample,
): number {
  if (!previous) return 0;
  const ms = next.at - previous.at;
  if (ms <= 0) return 0;
  const gained = next.value - previous.value;
  if (gained <= 0n) return 0;
  return Number(gained) / ms;
}

/** The index as it should stand right now, capped so a stalled poll stops. */
export function projectIndex(
  sample: IndexSample | null,
  rate: number,
  now: number,
  maxAheadMs = 60_000,
): bigint {
  if (!sample) return 0n;
  const ahead = Math.min(Math.max(now - sample.at, 0), maxAheadMs);
  const gained = BigInt(Math.floor(rate * ahead));
  return sample.value + (gained > 0n ? gained : 0n);
}

/**
 * What a position read at one index is worth at another, to nine decimals.
 *
 * Nine rather than the asset's seven, and the extra two are the point: at a
 * few percent a year on a handful of dollars, the seventh decimal turns over
 * about once a minute, which on screen is a number that has stopped. The ninth
 * moves a couple of times a second.
 *
 * It is not invented precision — the index really does carry it, and this is
 * the value the position has between one stroop and the next. What the
 * protocol will actually pay out is this figure floored to the asset's own
 * decimals, which is what every other number on the screen shows.
 */
export function positionValue(
  collateral: bigint,
  indexWhenRead: bigint,
  indexNow: bigint,
  assetDecimals = 7,
  showDecimals = 9,
): bigint {
  if (indexWhenRead <= 0n || collateral <= 0n) return 0n;
  const scale = 10n ** BigInt(showDecimals - assetDecimals);
  return (collateral * scale * indexNow) / indexWhenRead;
}

/**
 * The rate as a yearly percentage, for saying out loud what is happening.
 *
 * Derived from two readings of the index rather than from the protocol's rate
 * model: the model is the protocol's business and would have to be kept in
 * step with it, while the index is the answer it already computed.
 */
export function annualPercent(rate: number, index: bigint): number {
  if (index <= 0n || rate <= 0) return 0;
  return (rate * YEAR_MS * 100) / Number(index);
}
