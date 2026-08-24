import { beforeAll, describe, expect, it } from "vitest";

/**
 * Phase 3.5 — the verifier signs what the contract verifies.
 *
 * The chain being closed here has three independent implementations of the
 * same 195 bytes: the contract's `claim_preimage` (Rust), `scripts/paytag.mjs`
 * (Node CLI), and `web/lib/verifier.ts` (the endpoint that will actually run
 * in production). The Rust side is already pinned to this vector by
 * `test_crosslang::node_signature_verifies_in_the_contract`, so if the values
 * below match, all three agree.
 *
 * The signature is checked byte for byte rather than round-tripped through a
 * verify() call. A round trip would pass even if both sides drifted together;
 * a fixed expected signature cannot.
 */

// docs/SPEC.md §4.2 — the golden vector, seed = 32 bytes of 0x03.
const SEED_HEX = "03".repeat(32);
const NODE_PUB =
  "ed4928c628d1c2c6eae90338905995612959273a5c63f93636c14614ac8737d1";
const NODE_SIG =
  "c73892370f1a383a7965a1d1b164e7e9b9068aa4e4dd533ecfc09be805b2f95d" +
  "d25a60306f8979b6f6e24891d4eb85bfc4347c610cf61346924514847032b40d";

const SPEC_CONTRACT = "CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU";
const SPEC_RECIPIENT = "GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG";
const TORVALDS_KEY =
  "9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b";
const EXPIRES_AT = 1_000_000;

/** The spec's nonce: bytes 0x01 through 0x20. */
const NONCE = Buffer.from(
  Array.from({ length: 32 }, (_, i) => i + 1),
);

type Verifier = typeof import("./verifier");
let v: Verifier;

beforeAll(async () => {
  // The signing key is read from the environment and nowhere else, so the test
  // sets the environment rather than passing a key in.
  process.env.VERIFIER_SECRET = SEED_HEX;
  v = await import("./verifier");
});

describe("SPEC §4.1 — the preimage layout", () => {
  it("is exactly 195 bytes", () => {
    const pre = v.claimPreimage({
      contractId: SPEC_CONTRACT,
      identityKey: Buffer.from(TORVALDS_KEY, "hex"),
      recipient: SPEC_RECIPIENT,
      expiresAt: EXPIRES_AT,
      nonce: NONCE,
    });
    // 15 (domain) + 56 (contract) + 32 (identity) + 56 (recipient) + 4 + 32
    expect(pre.length).toBe(195);
  });

  it("starts with the domain separator", () => {
    const pre = v.claimPreimage({
      contractId: SPEC_CONTRACT,
      identityKey: Buffer.from(TORVALDS_KEY, "hex"),
      recipient: SPEC_RECIPIENT,
      expiresAt: EXPIRES_AT,
      nonce: NONCE,
    });
    // Domain separation is what stops a signature from one protocol version,
    // or one contract, being replayed into another.
    expect(pre.subarray(0, 15).toString("ascii")).toBe("paytag.claim.v1");
  });

  it("writes expires_at as big-endian u32", () => {
    const pre = v.claimPreimage({
      contractId: SPEC_CONTRACT,
      identityKey: Buffer.from(TORVALDS_KEY, "hex"),
      recipient: SPEC_RECIPIENT,
      expiresAt: EXPIRES_AT,
      nonce: NONCE,
    });
    expect(pre.readUInt32BE(15 + 56 + 32 + 56)).toBe(EXPIRES_AT);
  });

  it("rejects a muxed address", () => {
    // A muxed M… address is 69 characters. The layout is fixed width, so a
    // longer address would shift every field after it — the contract rejects
    // these too (Error #14).
    expect(() =>
      v.claimPreimage({
        contractId: SPEC_CONTRACT,
        identityKey: Buffer.from(TORVALDS_KEY, "hex"),
        recipient: `M${SPEC_RECIPIENT.slice(1)}${"AAAAAAAAAAAAA"}`,
        expiresAt: EXPIRES_AT,
        nonce: NONCE,
      }),
    ).toThrow(/56-character strkey/);
  });

  it("rejects a nonce that is not 32 bytes", () => {
    expect(() =>
      v.claimPreimage({
        contractId: SPEC_CONTRACT,
        identityKey: Buffer.from(TORVALDS_KEY, "hex"),
        recipient: SPEC_RECIPIENT,
        expiresAt: EXPIRES_AT,
        nonce: Buffer.alloc(31),
      }),
    ).toThrow(/32 bytes/);
  });
});

describe("SPEC §4.2 — the golden signature", () => {
  it("derives the public key the contract was initialized with", () => {
    expect(v.verifierPublicKeyHex()).toBe(NODE_PUB);
  });

  it("produces the exact signature paytag.mjs and the Rust test agree on", () => {
    const pre = v.claimPreimage({
      contractId: SPEC_CONTRACT,
      identityKey: Buffer.from(TORVALDS_KEY, "hex"),
      recipient: SPEC_RECIPIENT,
      expiresAt: EXPIRES_AT,
      nonce: NONCE,
    });
    expect(v.signClaim(pre).toString("hex")).toBe(NODE_SIG);
  });

  it("signs a different recipient differently", () => {
    // The recipient is inside the preimage, which is what stops an intercepted
    // authorization from being pointed at another wallet.
    const base = {
      contractId: SPEC_CONTRACT,
      identityKey: Buffer.from(TORVALDS_KEY, "hex"),
      expiresAt: EXPIRES_AT,
      nonce: NONCE,
    };
    const other = "GDMQNCTLGOAZ7SJYBF7WYKMVW5WZ2BNLM3U654M7YMMCPQMMYBIA6WUA";
    const a = v.signClaim(
      v.claimPreimage({ ...base, recipient: SPEC_RECIPIENT }),
    );
    const b = v.signClaim(v.claimPreimage({ ...base, recipient: other }));
    expect(a.toString("hex")).not.toBe(b.toString("hex"));
  });
});

describe("identity keys, computed server side", () => {
  it("matches the browser implementation and the spec vector", () => {
    // Same function, second implementation: the endpoint recomputes the key
    // with node:crypto rather than trusting the column stored in the database.
    expect(v.identityKeyBytes("torvalds", 0x00).toString("hex")).toBe(
      TORVALDS_KEY,
    );
    expect(v.identityKeyBytes("torvalds", 0x02).toString("hex")).toBe(
      "cb254de12f5a5a76717d0db39922eb02cbe081c4977bd82e7d492bba5a7e3d96",
    );
  });
});

describe("nonces", () => {
  it("are 32 bytes and do not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const n = v.newNonce();
      expect(n.length).toBe(32);
      seen.add(n.toString("hex"));
    }
    expect(seen.size).toBe(500);
  });
});
