// Watching a reward accrue, between the moments we can actually ask.
//
// BLND accrues every ledger, which is about every five seconds, and the only
// way to know the real figure is to ask the pool. Asking four times a second
// would be absurd; asking once a minute makes a number that is genuinely
// moving look frozen. So: ask every few seconds, and fill the gap in between
// by carrying the last measured figure forward at the rate the last two
// measurements imply.
//
// That projection is an estimate and the code treats it as one. It is only
// ever used to draw the digits between two real readings, every reading snaps
// the display back to the truth, and the rate is derived from observation
// rather than from a formula we would have to keep in step with Blend's.

export type Sample = {
  /** What the pool said, in the reward token's own units. */
  value: bigint;
  /** When it said it — `Date.now()`, milliseconds. */
  at: number;
};

/**
 * Units per millisecond between two readings.
 *
 * Zero when it cannot be told: two readings at the same instant, a reading
 * that went backwards (a claim happened in between, which resets the counter),
 * or no previous reading at all. A zero rate freezes the display at the last
 * true figure, which is the right way to be wrong.
 */
export function ratePerMs(prev: Sample | null, next: Sample): number {
  if (!prev) return 0;
  const ms = next.at - prev.at;
  if (ms <= 0) return 0;
  const gained = next.value - prev.value;
  if (gained <= 0n) return 0;
  return Number(gained) / ms;
}

/**
 * The figure to draw right now: the last reading plus what has accrued since.
 *
 * Never goes backwards and never runs away: the projection is capped at what
 * the observed rate would produce over `maxAheadMs`, so a tab left open while
 * the polling stalls shows a number that stops rather than one that invents a
 * fortune.
 */
export function project(
  sample: Sample | null,
  rate: number,
  now: number,
  maxAheadMs = 60_000,
): bigint {
  if (!sample) return 0n;
  const ahead = Math.min(Math.max(now - sample.at, 0), maxAheadMs);
  const gained = BigInt(Math.floor(rate * ahead));
  return sample.value + (gained > 0n ? gained : 0n);
}
