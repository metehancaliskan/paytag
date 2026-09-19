import { describe, expect, it } from "vitest";
import { anyUnits, groupByAsset, named, unnamed, type Escrowed } from "./assets";
import { SENDABLE_TOKENS, TOKENS, tokenByKey } from "./config";

/**
 * The asset breakdown.
 *
 * The bug this file is here to prevent is a quiet one: an escrow holding two
 * assets that reports one number. Before the send form offered a choice, the
 * claim screen filtered to the default asset and everything else vanished from
 * the page — the money was still on chain, but nothing in the interface said
 * so. These tests pin the two properties that stop that happening again: every
 * payment lands in exactly one bucket, and no bucket is dropped for having an
 * unfamiliar token.
 */

const XLM = tokenByKey("XLM").contractId;
const USDC = tokenByKey("USDC").contractId;
/** A token this deployment was never told about. Valid on chain all the same. */
const STRANGER = "CSTRANGERTOKENIDTHATNOBUILDKNOWSABOUT0000000000000000000";

function pay(id: number, token: string, amount: bigint): Escrowed {
  return { id, token, amount };
}

describe("groupByAsset", () => {
  it("sums each asset on its own", () => {
    const out = groupByAsset([
      pay(1, XLM, 100n),
      pay(2, USDC, 30n),
      pay(3, XLM, 5n),
    ]);

    expect(out).toHaveLength(2);
    expect(out[0].units).toBe(105n);
    expect(out[1].units).toBe(30n);
  });

  it("keeps the ids that make up each total", () => {
    // The claim call takes payment ids, so a total that has lost track of which
    // payments it came from cannot be claimed.
    const out = groupByAsset([
      pay(7, XLM, 1n),
      pay(9, USDC, 1n),
      pay(8, XLM, 1n),
    ]);

    expect(out[0].ids).toEqual([7, 8]);
    expect(out[1].ids).toEqual([9]);
  });

  it("never mixes two assets into one figure", () => {
    // The whole point. 100 XLM + 30 USDC is not 130 of anything.
    const out = groupByAsset([pay(1, XLM, 100n), pay(2, USDC, 30n)]);
    const summed = out.reduce((acc, a) => acc + a.units, 0n);

    expect(summed).toBe(130n); // the arithmetic exists…
    expect(out.map((a) => a.units)).toEqual([100n, 30n]); // …but is never shown as one
  });

  it("orders by the configured asset order, not by amount", () => {
    // A row that moves between two reads is a row people misread. USDC is
    // larger here and still sorts second, because that is where it lives in
    // TOKENS.
    const out = groupByAsset([pay(1, USDC, 9_000n), pay(2, XLM, 1n)]);

    expect(out.map((a) => a.token?.key)).toEqual(["XLM", "USDC"]);
    expect(TOKENS[0].key).toBe("XLM"); // the assumption above, stated
  });

  it("carries an unknown token through instead of dropping it", () => {
    const out = groupByAsset([pay(1, XLM, 10n), pay(2, STRANGER, 42n)]);

    expect(out).toHaveLength(2);
    const odd = out.find((a) => a.contractId === STRANGER);
    expect(odd?.token).toBeNull();
    expect(odd?.units).toBe(42n);
  });

  it("sorts unknown assets after every known one", () => {
    const out = groupByAsset([pay(1, STRANGER, 1n), pay(2, XLM, 1n)]);
    expect(out.map((a) => a.contractId)).toEqual([XLM, STRANGER]);
  });

  it("answers an empty list with an empty list", () => {
    expect(groupByAsset([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [pay(1, XLM, 1n)];
    const copy = structuredClone(input);
    groupByAsset(input);
    expect(input).toEqual(copy);
  });
});

describe("named / unnamed", () => {
  const out = groupByAsset([
    pay(1, XLM, 1n),
    pay(2, STRANGER, 1n),
    pay(3, USDC, 1n),
  ]);

  it("splits on whether this build can print a unit", () => {
    expect(named(out).map((a) => a.token?.symbol)).toEqual(["XLM", "USDC"]);
    expect(unnamed(out).map((a) => a.contractId)).toEqual([STRANGER]);
  });

  it("loses nothing in the split", () => {
    // Every asset is in exactly one of the two halves. An asset that fell out
    // of both would be money the screen never mentions.
    expect(named(out).length + unnamed(out).length).toBe(out.length);
  });
});

describe("anyUnits", () => {
  it("is false for nothing and for nothing but zeroes", () => {
    expect(anyUnits([])).toBe(false);
    expect(anyUnits(groupByAsset([pay(1, XLM, 0n)]))).toBe(false);
  });

  it("is true as soon as one asset holds something", () => {
    expect(anyUnits(groupByAsset([pay(1, XLM, 0n), pay(2, USDC, 1n)]))).toBe(
      true,
    );
  });
});

describe("what a deployment names vs what it offers", () => {
  it("keeps the retired USDC readable without offering it to a sender", () => {
    // The escrow holds payments in a USDC we issued before an anchor existed.
    // No ramp takes it, so it must not be sendable — but it must still have a
    // name, or the screens that show those payments print a bare number.
    expect(TOKENS.map((t) => t.key)).toContain("USDC_LEGACY");
    expect(SENDABLE_TOKENS.map((t) => t.key)).not.toContain("USDC_LEGACY");
  });

  it("tells the two USDCs apart on screen", () => {
    // Same code, different issuer, genuinely different assets. Two lines both
    // reading "USDC" would look like an arithmetic bug rather than two holdings.
    const legacy = groupByAsset([pay(1, tokenByKey("USDC_LEGACY").contractId, 5n)]);
    expect(legacy[0].token?.symbol).toBe("USDC (old)");
    expect(tokenByKey("USDC").contractId).not.toBe(
      tokenByKey("USDC_LEGACY").contractId,
    );
  });
});
