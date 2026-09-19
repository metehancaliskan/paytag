import { describe, expect, it } from "vitest";
import { changedFrom, project, ratePerMs, type Sample } from "./rewards";

/**
 * Drawing a number between the moments it can be measured.
 *
 * The risk here is not arithmetic, it is credibility: a figure that runs ahead
 * of the chain, or that jumps backwards, teaches the reader not to believe any
 * number on the page. These tests pin the three rules that stop that — never
 * below the last real reading, never running away when readings stop, and a
 * reset (a claim) never projected forward from.
 */

const at = (value: bigint, ms: number): Sample => ({ value, at: ms });

describe("ratePerMs", () => {
  it("is the gain over the time it took", () => {
    expect(ratePerMs(at(1_000n, 0), at(2_000n, 1_000))).toBe(1);
  });

  it("is zero without a previous reading", () => {
    expect(ratePerMs(null, at(1_000n, 0))).toBe(0);
  });

  it("is zero when the figure went backwards", () => {
    // Which is what a claim looks like: the counter resets to nothing.
    // Projecting a negative rate forward would draw a balance falling towards
    // zero that is already at zero.
    expect(ratePerMs(at(5_000n, 0), at(0n, 1_000))).toBe(0);
  });

  it("is zero for two readings at the same instant", () => {
    expect(ratePerMs(at(1n, 500), at(2n, 500))).toBe(0);
    expect(ratePerMs(at(1n, 900), at(2n, 500))).toBe(0);
  });
});

describe("project", () => {
  const sample = at(1_000n, 10_000);

  it("carries the last reading forward at the observed rate", () => {
    expect(project(sample, 2, 10_500)).toBe(2_000n); // 1000 + 2/ms * 500ms
  });

  it("never draws less than the last real reading", () => {
    expect(project(sample, 2, 9_000)).toBe(1_000n);
    expect(project(sample, 0, 99_999)).toBe(1_000n);
  });

  it("stops rather than inventing a fortune when readings stop", () => {
    // A tab left open with a stalled poll should show a number that has
    // stopped, not one that has quietly accrued for an hour.
    const capped = project(sample, 2, 10_000 + 10 * 60_000, 60_000);
    expect(capped).toBe(1_000n + 120_000n);
  });

  it("answers nothing before the first reading", () => {
    expect(project(null, 5, 1_000)).toBe(0n);
  });

  it("floors, so it never rounds up into money that is not there", () => {
    expect(project(at(0n, 0), 0.4, 1)).toBe(0n);
  });
});

describe("changedFrom", () => {
  it("finds the digit that turned over", () => {
    expect(changedFrom("0.0001381", "0.0001384")).toBe(8);
    expect(changedFrom("0.0001389", "0.0001390")).toBe(7);
  });

  it("says nothing changed when nothing did", () => {
    expect(changedFrom("0.0001381", "0.0001381")).toBe(9);
  });

  it("treats a number that grew a digit as changed throughout", () => {
    // 0.9999999 -> 1.0000001 is not one digit moving, it is a new shape.
    expect(changedFrom("0.9999999", "1.0000001")).toBe(0);
    expect(changedFrom("", "0.1")).toBe(0);
  });
});
