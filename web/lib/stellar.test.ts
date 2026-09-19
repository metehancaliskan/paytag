import { describe, expect, it } from "vitest";
import { contractErrorCode, describeEscrowError } from "./stellar";
import { ESCROW_ID, tokenByKey } from "./config";

/**
 * Reading a contract error.
 *
 * Soroban error codes are numbered PER CONTRACT, and the escrow and the token
 * both use the low numbers. #13 is `PaymentExpired` in the escrow and
 * `TrustlineMissing` in the Stellar Asset Contract — the same digits, two
 * unrelated problems, and only one of them is something the reader can fix.
 *
 * A sender with no USDC trustline was told "this payment has expired and can
 * only be refunded now", on the screen where they were trying to create a
 * payment that did not exist yet. These tests pin the rule that stops that: a
 * code the escrow cannot produce for the call being made did not come from the
 * escrow.
 */

const USDC = tokenByKey("USDC").contractId;

/** What a failed simulation looks like: a code, and the invoked contract. */
function simFailure(code: number, contractId = ESCROW_ID): Error {
  return new Error(
    `host invocation failed: Error(Contract, #${code}), invoking ${contractId}`,
  );
}

describe("contractErrorCode", () => {
  it("finds the number", () => {
    expect(contractErrorCode(simFailure(13))).toBe(13);
    expect(contractErrorCode(new Error("nothing to see"))).toBeNull();
  });
});

describe("describeEscrowError — which contract was speaking", () => {
  it("reads #13 on a deposit as the token, not as an expired payment", () => {
    // The bug, in one assertion. `deposit` has four failure modes and none of
    // them is #13, so whatever the message names, the token threw this.
    const text = describeEscrowError(simFailure(13), "deposit");

    expect(text).toMatch(/trustline/i);
    expect(text).not.toMatch(/expired/i);
    expect(text).toMatch(/token contract error #13/);
  });

  it("still reads #13 on a claim as an expired payment", () => {
    // Same number, and here the escrow really can produce it: claim refuses a
    // payment whose window has closed.
    const text = describeEscrowError(simFailure(13), "claim");

    expect(text).toMatch(/expired/i);
    expect(text).toMatch(/payment contract error #13/);
  });

  it("keeps the escrow's own deposit errors with the escrow", () => {
    expect(describeEscrowError(simFailure(3), "deposit")).toMatch(
      /amount cannot be zero/i,
    );
    expect(describeEscrowError(simFailure(5), "deposit")).toMatch(
      /30 days/i,
    );
  });

  it("uses the contract id when the call is not known", () => {
    // The older path, still the fallback: whoever is named first threw.
    expect(describeEscrowError(simFailure(13, USDC))).toMatch(/trustline/i);
    expect(describeEscrowError(simFailure(13))).toMatch(/expired/i);
  });

  it("offers both readings when nothing identifies the source", () => {
    // Vague on purpose. A confidently wrong error costs more than an honest
    // "it is one of these two".
    const text = describeEscrowError(new Error("Error(Contract, #13)"));

    expect(text).toMatch(/payment contract that means/i);
    expect(text).toMatch(/token contract it means/i);
  });

  it("passes through the failures no contract caused", () => {
    expect(describeEscrowError(new Error("User declined the request"))).toMatch(
      /dismissed the request/i,
    );
    expect(describeEscrowError(new Error("fetch failed"))).toMatch(
      /Could not reach the Soroban RPC/i,
    );
  });
});
