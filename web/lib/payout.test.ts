import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import {
  PAYOUT_SHAPE,
  claimDestination,
  describePayoutProblem,
  isPayoutAddress,
  normalizePayout,
} from "./payout";

/**
 * The payout address.
 *
 * These tests guard the one place where a bad string costs money: the address
 * goes inside the signed claim preimage, so an address that looks fine and is
 * not produces a signature over a destination that cannot receive anything —
 * discovered only after the reader has signed a transaction in their wallet.
 *
 * `HOT` and `COLD` are deterministic keys (all-1 and all-2 bytes) rather than
 * random ones: a test that fails should fail the same way twice.
 */
const HOT = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const COLD = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));

describe("normalizePayout", () => {
  it("uppercases, because strkey is uppercase base32", () => {
    expect(normalizePayout(HOT.toLowerCase())).toBe(HOT);
  });

  it("drops the whitespace a copy-paste brings with it", () => {
    expect(normalizePayout(`  ${HOT}\n`)).toBe(HOT);
    expect(normalizePayout(HOT.slice(0, 20) + " " + HOT.slice(20))).toBe(HOT);
  });
});

describe("isPayoutAddress", () => {
  it("accepts a real account address", () => {
    expect(isPayoutAddress(HOT)).toBe(true);
  });

  it("refuses a lowercase one rather than guessing", () => {
    // normalizePayout is the place that fixes case. The validator does not,
    // because the value it is asked about is the value that gets signed.
    expect(isPayoutAddress(HOT.toLowerCase())).toBe(false);
  });

  it("refuses a single mistyped character", () => {
    // The shape still matches; only the checksum catches this, which is the
    // whole reason the checksum is checked at all.
    const typo = HOT.slice(0, 30) + (HOT[30] === "A" ? "B" : "A") + HOT.slice(31);
    expect(PAYOUT_SHAPE.test(typo)).toBe(true);
    expect(isPayoutAddress(typo)).toBe(false);
  });

  it("refuses a contract address and a muxed one", () => {
    expect(isPayoutAddress(StrKey.encodeContract(Buffer.alloc(32, 3)))).toBe(
      false,
    );
    expect(
      isPayoutAddress(StrKey.encodeMed25519PublicKey(Buffer.alloc(40, 4))),
    ).toBe(false);
  });

  it("refuses anything that is not a string", () => {
    for (const v of [null, undefined, 0, {}, [HOT]]) {
      expect(isPayoutAddress(v)).toBe(false);
    }
  });
});

describe("describePayoutProblem", () => {
  it("says nothing about a valid address", () => {
    expect(describePayoutProblem(HOT)).toBeNull();
    expect(describePayoutProblem(` ${HOT.toLowerCase()} `)).toBeNull();
  });

  it("names the specific mistake", () => {
    expect(describePayoutProblem("")).toMatch(/paste/i);
    expect(describePayoutProblem("SDIPFNUND")).toMatch(/starts with G/i);
    expect(describePayoutProblem(HOT.slice(0, 55))).toMatch(/56 characters/);
    expect(
      describePayoutProblem(StrKey.encodeMed25519PublicKey(Buffer.alloc(40, 4))),
    ).toMatch(/muxed/i);
    expect(
      describePayoutProblem(StrKey.encodeContract(Buffer.alloc(32, 3))),
    ).toMatch(/contract/i);
    expect(describePayoutProblem("G" + "1".repeat(55))).toMatch(/cannot/i);
    expect(
      describePayoutProblem(
        HOT.slice(0, 30) + (HOT[30] === "A" ? "B" : "A") + HOT.slice(31),
      ),
    ).toMatch(/checksum/i);
  });
});

describe("claimDestination", () => {
  it("prefers the saved address and says it is locked", () => {
    expect(claimDestination(COLD, HOT)).toEqual({
      address: COLD,
      locked: true,
    });
  });

  it("falls back to the connected wallet, unlocked", () => {
    expect(claimDestination(null, HOT)).toEqual({ address: HOT, locked: false });
  });

  it("has no destination when there is neither", () => {
    expect(claimDestination(null, null)).toEqual({
      address: null,
      locked: false,
    });
  });

  it("keeps the saved address even with no wallet connected", () => {
    // The claim screen shows the destination before a wallet is connected, and
    // it must show the one that will actually be paid.
    expect(claimDestination(COLD, null)).toEqual({
      address: COLD,
      locked: true,
    });
  });
});

describe("parity with the database", () => {
  it("uses the same shape as the CHECK constraint on payout_prefs.address", () => {
    // Two copies of one rule is one copy too many, and the copy in SQL cannot
    // import this one. So the test reads the schema and compares: a change to
    // either side without the other fails here rather than in production.
    const schema = readFileSync(
      fileURLToPath(new URL("../../db/schema.sql", import.meta.url)),
      "utf8",
    );
    const constraint = /address\s+text not null check \(address ~ '([^']+)'\)/.exec(
      schema,
    );
    expect(constraint).not.toBeNull();
    expect(constraint![1]).toBe(PAYOUT_SHAPE.source);
  });
});
