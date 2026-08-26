import { beforeAll, describe, expect, it } from "vitest";
import { mintMergeIntent, readMergeIntent, MERGE_TTL_SECONDS } from "./merge-intent";

const A = "11111111-2222-3333-4444-555555555555";
const NOW = 1_800_000_000;

beforeAll(() => {
  process.env.VERIFIER_SECRET = "11".repeat(32);
});

describe("the merge intent token", () => {
  it("round-trips the profile that asked", () => {
    expect(readMergeIntent(mintMergeIntent(A, NOW), NOW + 5)).toBe(A);
  });

  it("expires", () => {
    const t = mintMergeIntent(A, NOW);
    expect(readMergeIntent(t, NOW + MERGE_TTL_SECONDS - 1)).toBe(A);
    expect(readMergeIntent(t, NOW + MERGE_TTL_SECONDS)).toBeNull();
    expect(readMergeIntent(t, NOW + MERGE_TTL_SECONDS + 1)).toBeNull();
  });

  // The one that matters: the profile id is what decides whose rows move, so it
  // may not be editable by whoever holds the cookie.
  it("refuses a token whose profile was swapped", () => {
    const t = mintMergeIntent(A, NOW);
    const [, expiry, mac] = t.split(".");
    const forged = `99999999-9999-9999-9999-999999999999.${expiry}.${mac}`;
    expect(readMergeIntent(forged, NOW + 5)).toBeNull();
  });

  it("refuses a token whose expiry was extended", () => {
    const t = mintMergeIntent(A, NOW);
    const [id, , mac] = t.split(".");
    expect(readMergeIntent(`${id}.${NOW + 99999}.${mac}`, NOW + 5)).toBeNull();
  });

  it("refuses a token signed with another key", () => {
    const t = mintMergeIntent(A, NOW);
    process.env.VERIFIER_SECRET = "22".repeat(32);
    expect(readMergeIntent(t, NOW + 5)).toBeNull();
    process.env.VERIFIER_SECRET = "11".repeat(32);
  });

  it("refuses nonsense", () => {
    for (const bad of [undefined, "", "a.b", "a.b.c", `${A}.${NOW}.zz`]) {
      expect(readMergeIntent(bad, NOW)).toBeNull();
    }
  });
});
