import { describe, expect, it } from "vitest";
import {
  centsToUnits,
  centsToUsd,
  unitsToCents,
  usdToCents,
} from "./price";
import { fromUnits, toUnits } from "./format";

/**
 * Dollar → XLM conversion.
 *
 * The dollar amount is typed by a person, the XLM amount is what actually
 * leaves their wallet, and the rate in between arrives as a float from a price
 * API. That float is the only float allowed anywhere near this: it is turned
 * into an integer once and every step after it is exact. These tests exist to
 * keep it that way.
 */

describe("usdToCents", () => {
  it("reads dollars as cents", () => {
    expect(usdToCents("25")).toBe(2500n);
    expect(usdToCents("25.40")).toBe(2540n);
    expect(usdToCents("0.01")).toBe(1n);
    expect(usdToCents("1234.56")).toBe(123456n);
  });

  it("accepts a comma, like most of Europe types it", () => {
    expect(usdToCents("25,40")).toBe(2540n);
  });

  it("refuses more precision than a dollar has", () => {
    expect(() => usdToCents("1.234")).toThrow(/two decimal places/);
  });

  it("refuses anything that is not a number", () => {
    for (const bad of ["", ".", "abc", "-5", "1e3", "1.2.3"]) {
      expect(() => usdToCents(bad), bad).toThrow();
    }
  });

  it("round-trips through centsToUsd", () => {
    for (const s of ["0.01", "1.00", "25.40", "1234.56"]) {
      expect(centsToUsd(usdToCents(s))).toBe(s);
    }
  });
});

describe("centsToUnits — the conversion that moves money", () => {
  it("converts at a round rate exactly", () => {
    // $25 at $0.25/XLM is 100 XLM, to the stroop.
    expect(centsToUnits(2500n, 0.25)).toBe(toUnits("100"));
    // $1 at $0.50/XLM is 2 XLM.
    expect(centsToUnits(100n, 0.5)).toBe(toUnits("2"));
  });

  it("handles an awkward real-world rate without drifting", () => {
    const units = centsToUnits(2500n, 0.2734);
    // 25 / 0.2734 = 91.4411119... XLM
    expect(fromUnits(units).startsWith("91.44111")).toBe(true);
  });

  it("rounds toward zero, never up", () => {
    // Rounding up could ask for more than the wallet holds, turning a valid
    // "send my whole balance" into a failed transaction.
    const rate = 0.3;
    const units = centsToUnits(1n, rate); // one cent
    const exact = (1n * 10n ** 7n * 100_000_000n) / (100n * 30_000_000n);
    expect(units).toBe(exact);
  });

  it("scales linearly, up to the truncation it promises", () => {
    // Not exactly linear, and it should not be: each conversion truncates
    // toward zero, so ten dollars converted at once lands up to 9 stroops
    // above ten separate conversions. A stroop is 0.0000001 XLM — the drift is
    // bounded and always in the direction of sending slightly less.
    const rate = 0.2734;
    const once = centsToUnits(10_000n, rate);
    const tenTimes = centsToUnits(1_000n, rate) * 10n;
    expect(once >= tenTimes).toBe(true);
    expect(once - tenTimes).toBeLessThan(10n);
  });

  it("refuses a rate it cannot use", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => centsToUnits(2500n, bad), String(bad)).toThrow();
    }
  });
});

describe("unitsToCents — what an existing escrow is worth today", () => {
  it("is the inverse of centsToUnits at a round rate", () => {
    expect(unitsToCents(toUnits("100"), 0.25)).toBe(2500n);
  });

  it("returns zero rather than throwing when there is no rate", () => {
    // This one runs on every payment row. A missing price should blank the
    // dollar column, not take the page down.
    expect(unitsToCents(toUnits("100"), 0)).toBe(0n);
    expect(unitsToCents(toUnits("100"), Number.NaN)).toBe(0n);
  });
});
