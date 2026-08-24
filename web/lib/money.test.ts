import { describe, expect, it } from "vitest";
import {
  DEFAULT_DECIMALS,
  amountProblem,
  fromUnits,
  ledgersToHuman,
  shortAddr,
  toUnits,
} from "./format";

/**
 * Money arithmetic.
 *
 * Every function here is BigInt-only on purpose. A float would be the classic
 * way to lose a cent per transaction and never notice: `0.1 + 0.2` is
 * `0.30000000000000004`, and Stellar's 7 decimals put that error well inside
 * the range that reaches the chain. These tests exist to keep a well-meaning
 * refactor from reintroducing `parseFloat`.
 */

describe("toUnits — human amount to chain units", () => {
  it("scales by 7 decimals", () => {
    expect(DEFAULT_DECIMALS).toBe(7);
    expect(toUnits("1")).toBe(10_000_000n);
    expect(toUnits("250")).toBe(2_500_000_000n);
    expect(toUnits("0.0000001")).toBe(1n); // one stroop
  });

  it("survives the amounts a float would ruin", () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in stroops it is exact.
    expect(toUnits("0.1") + toUnits("0.2")).toBe(toUnits("0.3"));
    expect(toUnits("1.1") * 3n).toBe(toUnits("3.3"));
  });

  it("accepts a comma as the decimal separator", () => {
    // Turkish and most of Europe type 12,5 — refusing it would read as a bug.
    expect(toUnits("12,5")).toBe(toUnits("12.5"));
  });

  it("refuses more precision than the chain has", () => {
    expect(() => toUnits("0.00000001")).toThrow(/decimal places/);
  });

  it("refuses anything that is not a number", () => {
    for (const bad of ["", ".", "abc", "1.2.3", "-5", "1e5", " "]) {
      expect(() => toUnits(bad), bad).toThrow();
    }
  });
});

describe("fromUnits — chain units back to a readable amount", () => {
  it("drops trailing zeros but keeps significant ones", () => {
    expect(fromUnits(10_000_000n)).toBe("1");
    expect(fromUnits(12_500_000n)).toBe("1.25");
    expect(fromUnits(1n)).toBe("0.0000001");
    expect(fromUnits(0n)).toBe("0");
  });

  it("round-trips every amount it is given", () => {
    for (const s of ["0.0000001", "1", "1.25", "250", "999999.9999999"]) {
      expect(fromUnits(toUnits(s))).toBe(s);
    }
  });

  it("handles negatives, in case a balance is ever read as one", () => {
    expect(fromUnits(-12_500_000n)).toBe("-1.25");
  });
});

describe("amountProblem — what the send form says while you type", () => {
  const BALANCE = toUnits("100");

  it("says nothing about an empty field", () => {
    // An empty input is not an error, it is just not ready yet. Complaining
    // before the first keystroke trains people to ignore the message.
    expect(amountProblem("", BALANCE)).toBeNull();
  });

  it("accepts an amount within the balance", () => {
    expect(amountProblem("99.9", BALANCE)).toBeNull();
    expect(amountProblem("100", BALANCE)).toBeNull();
  });

  it("catches an amount over the balance", () => {
    expect(amountProblem("100.0000001", BALANCE)).toMatch(/more than your balance/);
  });

  it("catches zero", () => {
    expect(amountProblem("0", BALANCE)).toMatch(/greater than zero/);
    expect(amountProblem("0.0", BALANCE)).toMatch(/greater than zero/);
  });

  it("still validates the format when no balance is known", () => {
    // The balance read can fail (no trustline, RPC down). That must not turn
    // the amount field into a free-for-all.
    expect(amountProblem("abc", null)).toBeTruthy();
    expect(amountProblem("5", null)).toBeNull();
  });
});

describe("ledgersToHuman — ledgers as time", () => {
  it("converts at five seconds a ledger", () => {
    expect(ledgersToHuman(17_280)).toBe("~1 day");
    expect(ledgersToHuman(120_960)).toBe("~7 days");
    expect(ledgersToHuman(720)).toBe("~1 hour");
    expect(ledgersToHuman(12)).toBe("~1 minute");
  });

  it("never says 'in 0 minutes'", () => {
    // A payment one ledger from expiry reads as a minute, not as nothing.
    expect(ledgersToHuman(1)).toBe("~1 minute");
  });

  it("calls the past what it is", () => {
    expect(ledgersToHuman(0)).toBe("expired");
    expect(ledgersToHuman(-5)).toBe("expired");
  });
});

describe("shortAddr", () => {
  it("keeps both ends, which is what people compare", () => {
    expect(shortAddr("GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG"))
      .toBe("GAD3LM…CKWG");
  });

  it("leaves a short string alone", () => {
    expect(shortAddr("GABC")).toBe("GABC");
  });
});
