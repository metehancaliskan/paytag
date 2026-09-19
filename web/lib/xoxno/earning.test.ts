import { describe, expect, it } from "vitest";
import {
  annualPercent,
  indexRatePerMs,
  positionValue,
  projectIndex,
  RAY,
  type IndexSample,
} from "./earning";

/**
 * Drawing a position that grows by itself.
 *
 * The same credibility rules as the BLND counter — never below the last real
 * reading, never running away when readings stop — plus one of its own: the
 * value has to be measured from the index as it stood when the POSITION was
 * read. Measuring it from any other index inflates the figure by however much
 * interest the market had already accrued before this person arrived, which
 * would be a very flattering bug.
 */

const at = (value: bigint, ms: number): IndexSample => ({ value, at: ms });

describe("indexRatePerMs", () => {
  it("is the climb over the time it took", () => {
    expect(indexRatePerMs(at(RAY, 0), at(RAY + 1_000n, 1_000))).toBe(1);
  });

  it("is zero without a previous reading, or if the index stood still", () => {
    expect(indexRatePerMs(null, at(RAY, 0))).toBe(0);
    expect(indexRatePerMs(at(RAY, 0), at(RAY, 1_000))).toBe(0);
  });

  it("is zero if the index went backwards", () => {
    // It should not be able to. If it does, the answer is to stop projecting,
    // not to animate a position shrinking.
    expect(indexRatePerMs(at(RAY + 5n, 0), at(RAY, 1_000))).toBe(0);
  });
});

describe("projectIndex", () => {
  const sample = at(RAY, 10_000);

  it("carries the index forward at the observed rate", () => {
    expect(projectIndex(sample, 2, 10_500)).toBe(RAY + 1_000n);
  });

  it("never draws below the last reading", () => {
    expect(projectIndex(sample, 5, 9_000)).toBe(RAY);
  });

  it("stops rather than running away when readings stop", () => {
    expect(projectIndex(sample, 2, 10_000 + 600_000, 60_000)).toBe(
      RAY + 120_000n,
    );
  });
});

describe("positionValue", () => {
  it("is the position itself when the index has not moved", () => {
    // 5 USDC at seven decimals, shown at nine: the same amount, two digits
    // further on.
    expect(positionValue(50_000_000n, RAY, RAY)).toBe(5_000_000_000n);
  });

  it("grows in proportion to the index", () => {
    const grown = (RAY * 101n) / 100n; // the index up one percent
    expect(positionValue(50_000_000n, RAY, grown)).toBe(5_050_000_000n);
  });

  it("measures growth from the index when the position was read", () => {
    // The market had already accrued before this person arrived. Measuring
    // from 1.0 rather than from where they came in would hand them all of it.
    const joined = (RAY * 15n) / 10n; // index at 1.5 when they supplied
    const later = (RAY * 165n) / 100n; // now 1.65, i.e. ten percent on
    expect(positionValue(10_000_000n, joined, later)).toBe(1_100_000_000n);
  });

  it("answers nothing for nothing", () => {
    expect(positionValue(0n, RAY, RAY)).toBe(0n);
    expect(positionValue(50_000_000n, 0n, RAY)).toBe(0n);
  });
});

describe("annualPercent", () => {
  it("turns a per-millisecond climb into a yearly figure", () => {
    // One percent a year: the index gains RAY/100 over a year of milliseconds.
    const perMs = Number(RAY / 100n) / (365 * 24 * 60 * 60 * 1000);
    expect(annualPercent(perMs, RAY)).toBeCloseTo(1, 6);
  });

  it("is zero when there is nothing to annualise", () => {
    expect(annualPercent(0, RAY)).toBe(0);
    expect(annualPercent(5, 0n)).toBe(0);
  });
});
