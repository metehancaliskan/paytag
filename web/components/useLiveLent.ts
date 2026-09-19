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

/**
 * The first gap is short on purpose — a rate needs two readings, and until
 * there is one the figure cannot move. Five seconds of stillness the moment
 * the panel opens is five seconds of somebody watching a number that looks
 * broken.
 */
const FIRST_GAP_MS = 1_200;
const POLL_MS = 5_000;
const DRAW_MS = 400;

export type Lent = { value: bigint; apy: number; live: boolean };

/** One position being watched: an asset, and what was last read of it. */
export type Held = { asset: string; collateral: bigint };

type Reading = {
  sample: IndexSample;
  /** RAY per millisecond, from the last two readings of this market. */
  rate: number;
  /** The index when this position was first read; growth is measured from it. */
  base: bigint;
  apy: number;
  /** The position this belongs to, so a stale one is never drawn. */
  of: bigint;
};

/**
 * XOXNO positions, redrawn as they grow.
 *
 * Every position at once rather than only the selected one: somebody with USDC
 * lent should see it earning while they are looking at their XLM row. The
 * assets share one hook because hooks cannot be called in a loop, and one hook
 * over a list is simpler than a component per row anyway.
 *
 * The market's supply index is polled every few seconds and carried forward in
 * between at the rate the last two readings imply — the same bargain as the
 * BLND counter. Polling pauses while the tab is hidden: nobody is watching,
 * and it is somebody else's RPC.
 */
export function useLiveLent(
  held: readonly Held[],
  /** Bumped by the panel after a transaction, so new positions are picked up. */
  tick: number,
): Record<string, Lent> {
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [drawn, setDrawn] = useState<Record<string, { value: bigint; of: bigint }>>(
    {},
  );

  // A stable description of what is being watched, so the effect does not
  // restart on every render just because the array is new.
  const watching = held
    .filter((h) => h.collateral > 0n)
    .map((h) => `${h.asset}:${h.collateral}`)
    .join("|");

  useEffect(() => {
    if (watching === "") return;
    const entries = watching.split("|").map((s) => {
      const [asset, amount] = s.split(":");
      return { asset, collateral: BigInt(amount) };
    });

    let alive = true;
    let count = 0;
    let timer: ReturnType<typeof setTimeout>;
    const previous = new Map<string, IndexSample>();
    const base = new Map<string, bigint>();

    const ask = async () => {
      if (typeof document === "undefined" || !document.hidden) {
        await Promise.all(
          entries.map(async ({ asset, collateral }) => {
            try {
              const index = await supplyIndex(asset);
              if (!alive) return;
              const sample = { value: index, at: Date.now() };
              if (!base.has(asset)) base.set(asset, index);
              const rate = indexRatePerMs(previous.get(asset) ?? null, sample);
              previous.set(asset, sample);
              setReadings((was) => ({
                ...was,
                [asset]: {
                  sample,
                  rate,
                  base: base.get(asset)!,
                  apy: annualPercent(rate, index),
                  of: collateral,
                },
              }));
            } catch {
              // The last reading stays on screen and the projection carries
              // it; the next one corrects both.
            }
          }),
        );
        count += 1;
      }
      if (alive) {
        timer = setTimeout(() => void ask(), count < 2 ? FIRST_GAP_MS : POLL_MS);
      }
    };

    void ask();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [watching, tick]);

  useEffect(() => {
    if (Object.keys(readings).length === 0) return;
    const draw = setInterval(() => {
      const now = Date.now();
      setDrawn((was) => {
        const next = { ...was };
        for (const [asset, r] of Object.entries(readings)) {
          next[asset] = {
            value: positionValue(
              r.of,
              r.base,
              projectIndex(r.sample, r.rate, now),
            ),
            of: r.of,
          };
        }
        return next;
      });
    }, DRAW_MS);
    return () => clearInterval(draw);
  }, [readings]);

  // Until a reading lands, a position is worth exactly what was read — no
  // projection, nothing invented. A drawing for a different amount is not a
  // drawing for this one.
  const out: Record<string, Lent> = {};
  for (const { asset, collateral } of held) {
    if (collateral <= 0n) continue;
    const floor = positionValue(collateral, 1n, 1n);
    const d = drawn[asset];
    const r = readings[asset];
    const fresh = d && d.of === collateral ? d.value : 0n;
    const current = r && r.of === collateral ? r : null;
    out[asset] = {
      value: fresh > floor ? fresh : floor,
      apy: current?.apy ?? 0,
      live: (current?.rate ?? 0) > 0,
    };
  }
  return out;
}
