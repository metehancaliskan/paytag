"use client";

import { useEffect, useRef, useState } from "react";
import { accruedRewards } from "@/lib/blend/pool";
import { project, ratePerMs, type Sample } from "@/lib/blend/rewards";

/** How often the pool is actually asked, and how often the digits are redrawn. */
const POLL_MS = 5_000;
const DRAW_MS = 400;

/**
 * A reward figure that moves while you watch it.
 *
 * The pool is asked every few seconds — a simulated `claim`, which costs
 * nothing and settles nothing — and the display carries that figure forward in
 * between at the rate the last two readings imply. Every reading corrects the
 * drawing, so the number on screen is never more than a few seconds of
 * estimate away from the chain.
 *
 * It stops when the tab is hidden. A background tab polling an RPC endpoint
 * forever, to animate digits nobody is looking at, is rude to somebody else's
 * infrastructure.
 */
export function useLiveRewards(
  address: string | null,
  reserveTokenIds: readonly number[],
  /** Bumped by the panel after a claim, so the reset is picked up at once. */
  tick: number,
): { shown: bigint; measured: bigint } {
  const [sample, setSample] = useState<Sample | null>(null);
  const [shown, setShown] = useState<bigint>(0n);
  const rate = useRef(0);

  const ids = reserveTokenIds.join(",");

  useEffect(() => {
    if (!address || ids === "") return;
    let alive = true;
    let previous: Sample | null = null;

    const ask = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const value = await accruedRewards(address, ids.split(",").map(Number));
        if (!alive) return;
        const next = { value, at: Date.now() };
        rate.current = ratePerMs(previous, next);
        previous = next;
        setSample(next);
      } catch {
        // A missed reading is not worth a message: the last one stays on
        // screen, the projection keeps it moving, and the next one corrects it.
      }
    };

    void ask();
    const poll = setInterval(() => void ask(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [address, ids, tick]);

  useEffect(() => {
    if (!sample) return;
    const draw = setInterval(() => {
      setShown(project(sample, rate.current, Date.now()));
    }, DRAW_MS);
    return () => clearInterval(draw);
  }, [sample]);

  // Before the first draw, and whenever the rate is unknown, the measured
  // figure IS the figure — no projection, nothing invented. The display also
  // never goes below it: a projection may lag a reading, it must not undercut
  // one.
  const measured = sample?.value ?? 0n;
  return { shown: shown > measured ? shown : measured, measured };
}
