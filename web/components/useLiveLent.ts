"use client";

import { useEffect, useState } from "react";
import { supplyIndex } from "@/lib/xoxno/lending";
import {
  annualPercent,
  indexRatePerMs,
  positionValue,
  projectIndex,
  type IndexSample,
} from "@/lib/xoxno/earning";

const POLL_MS = 5_000;
const DRAW_MS = 400;

/**
 * Everything one reading establishes, kept together.
 *
 * `of` is the position it belongs to. Without it, switching assets would draw
 * the old asset's growth against the new asset's balance for a frame — a
 * number that was never true about anything.
 */
type Reading = {
  sample: IndexSample;
  /** RAY per millisecond, from the last two readings. */
  rate: number;
  /** The index when this position was first read; growth is measured from it. */
  base: bigint;
  apy: number;
  of: bigint;
};

/**
 * A XOXNO position, redrawn as it grows.
 *
 * The market's supply index is polled every few seconds and carried forward in
 * between at the rate the last two readings imply — the same bargain as the
 * BLND counter, and for the same reason: asking four times a second would be
 * absurd, and asking once a minute makes something that is moving look stuck.
 *
 * Polling pauses while the tab is hidden. Nobody is watching, and it is
 * somebody else's RPC.
 */
export function useLiveLent(
  asset: string | null,
  /** The position as last read from the chain, in the asset's own units. */
  collateral: bigint,
  /** Bumped by the panel after a transaction, so a new position is picked up. */
  tick: number,
): { value: bigint; apy: number; live: boolean } {
  const [reading, setReading] = useState<Reading | null>(null);
  const [drawn, setDrawn] = useState<{ value: bigint; of: bigint } | null>(null);

  useEffect(() => {
    if (!asset || collateral <= 0n) return;
    let alive = true;
    let previous: IndexSample | null = null;
    let base: bigint | null = null;

    const ask = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const index = await supplyIndex(asset);
        if (!alive) return;
        const sample = { value: index, at: Date.now() };
        base ??= index;
        const rate = indexRatePerMs(previous, sample);
        previous = sample;
        setReading({
          sample,
          rate,
          base,
          apy: annualPercent(rate, index),
          of: collateral,
        });
      } catch {
        // A missed reading leaves the last one on screen and the projection
        // carrying it; the next one corrects both.
      }
    };

    void ask();
    const poll = setInterval(() => void ask(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [asset, collateral, tick]);

  useEffect(() => {
    if (!reading || reading.of !== collateral) return;
    const draw = setInterval(() => {
      const now = projectIndex(reading.sample, reading.rate, Date.now());
      setDrawn({
        value: positionValue(collateral, reading.base, now),
        of: collateral,
      });
    }, DRAW_MS);
    return () => clearInterval(draw);
  }, [reading, collateral]);

  // Until a reading lands, the position is worth exactly what was read — no
  // projection, nothing invented. And a drawing for a different position is
  // not a drawing for this one.
  const floor = positionValue(collateral, 1n, 1n);
  const fresh = drawn?.of === collateral ? drawn.value : 0n;
  const current = reading?.of === collateral ? reading : null;

  return {
    value: fresh > floor ? fresh : floor,
    apy: current?.apy ?? 0,
    live: (current?.rate ?? 0) > 0,
  };
}
