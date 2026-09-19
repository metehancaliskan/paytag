import { describe, expect, it } from "vitest";
import {
  borrowEmissionId,
  splitWithdraw,
  supplyEmissionId,
  toBTokens,
  toUnderlying,
} from "./pool";
import { RATE_SCALAR } from "./config";

/**
 * The two pieces of Blend arithmetic this app does for itself.
 *
 * Everything else is a call and a response. These two are ours, and both are
 * the kind of thing that is wrong quietly: a rate applied in the wrong
 * direction still produces a plausible number, and an emission id off by one
 * still returns an answer — zero — instead of an error.
 */

describe("bTokens and the asset they stand for", () => {
  it("is one to one while no interest has accrued", () => {
    // A pool's rate starts at exactly 1.0 and only ever climbs.
    expect(toUnderlying(1_000_000n, RATE_SCALAR)).toBe(1_000_000n);
    expect(toBTokens(1_000_000n, RATE_SCALAR)).toBe(1_000_000n);
  });

  it("makes the same position worth more as the rate climbs", () => {
    // Nothing is ever credited to a Blend position; the position's value grows.
    const rate = (RATE_SCALAR * 105n) / 100n; // 1.05
    expect(toUnderlying(1_000_000n, rate)).toBe(1_050_000n);
  });

  it("buys fewer bTokens for the same money once the rate has climbed", () => {
    const rate = (RATE_SCALAR * 2n) / 1n; // 2.0
    expect(toBTokens(1_000_000n, rate)).toBe(500_000n);
  });

  it("round-trips within a stroop", () => {
    // Floored twice, so the answer can be one unit short and never one over.
    const rate = 1_000_361_571_910n; // a real testnet XLM rate
    const back = toUnderlying(toBTokens(50_000_000n, rate), rate);
    expect(back).toBeLessThanOrEqual(50_000_000n);
    expect(50_000_000n - back).toBeLessThanOrEqual(1n);
  });

  it("floors rather than rounding up", () => {
    // Shown higher than it is, a position invites a withdrawal of money that
    // is not there.
    const rate = RATE_SCALAR + 1n;
    expect(toUnderlying(1n, rate)).toBe(1n);
    expect(toUnderlying(0n, rate)).toBe(0n);
  });

  it("treats a missing rate as worthless rather than dividing by zero", () => {
    expect(toBTokens(1_000n, 0n)).toBe(0n);
  });
});

describe("emission ids", () => {
  it("puts supply on the odd id and debt on the even one", () => {
    // Claiming with the debt id asks about a position nobody here holds, and
    // answers zero — a wrong answer that looks like "no rewards yet".
    expect(supplyEmissionId(0)).toBe(1);
    expect(borrowEmissionId(0)).toBe(0);
    expect(supplyEmissionId(1)).toBe(3);
    expect(borrowEmissionId(1)).toBe(2);
  });

  it("never collides between reserves", () => {
    const ids = [0, 1, 2, 3].flatMap((i) => [
      supplyEmissionId(i),
      borrowEmissionId(i),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("splitWithdraw", () => {
  const position = { supply: 100n, collateral: 400n };

  it("takes from plain supply first", () => {
    // The weaker position, and the one this app made. Collateral may be
    // holding up a loan somebody took out in Blend's own interface.
    expect(splitWithdraw(60n, position)).toEqual({ supply: 60n, collateral: 0n });
  });

  it("spills into collateral once supply runs out", () => {
    expect(splitWithdraw(250n, position)).toEqual({
      supply: 100n,
      collateral: 150n,
    });
  });

  it("never asks for more than each side holds", () => {
    // Over-asking is safe at the pool — it settles down to the position — but
    // the split itself should still be arithmetic somebody can check.
    expect(splitWithdraw(10_000n, position)).toEqual({
      supply: 100n,
      collateral: 400n,
    });
  });

  it("asks for nothing when there is nothing", () => {
    expect(splitWithdraw(50n, { supply: 0n, collateral: 0n })).toEqual({
      supply: 0n,
      collateral: 0n,
    });
    expect(splitWithdraw(0n, position)).toEqual({ supply: 0n, collateral: 0n });
  });
});
