import { describe, expect, it } from "vitest";
import { assertSameAsset, sep38Asset } from "./toml";
import { expiryOf } from "./auth";
import { tokenByKey } from "../config";

/**
 * The check that keeps an on-ramp from being a one-way door.
 *
 * An asset on Stellar is its code AND its issuer. "USDC" from the anchor and
 * "USDC" from anybody else are unrelated assets that cannot be exchanged for
 * each other — so if the anchor ramps one the escrow does not know, money could
 * be on-ramped, paid to a handle, claimed, and then have nowhere to go: the
 * anchor would not take back what it never issued.
 *
 * The check is arithmetic rather than a name comparison, because the Stellar
 * Asset Contract's address is derived from code, issuer and network. Two
 * strings matching proves nothing; two contract ids matching proves the asset.
 */

const ANCHOR_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
/** The USDC we issued ourselves, before an anchor was in the picture. */
const OUR_OLD_ISSUER = "GARBYOHXSSS76ZOV2FUUZOZHQER7BAA3XNBJCMXNWJYS5M3W3XTBG3LZ";

describe("assertSameAsset", () => {
  it("resolves the anchor's USDC to the token this app ramps", () => {
    const token = assertSameAsset("USDC", ANCHOR_ISSUER);
    expect(token.key).toBe("USDC");
    expect(token.contractId).toBe(tokenByKey("USDC").contractId);
  });

  it("recognises the retired issuer as the retired token, not as the new one", () => {
    // Same code, different issuer, genuinely different asset — and this is the
    // one case where getting it wrong would be invisible until somebody tried
    // to cash out.
    const token = assertSameAsset("USDC", OUR_OLD_ISSUER);
    expect(token.key).toBe("USDC_LEGACY");
    expect(token.contractId).not.toBe(tokenByKey("USDC").contractId);
  });

  it("refuses an issuer this deployment has never heard of", () => {
    expect(() =>
      assertSameAsset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"),
    ).toThrow(/does not know/i);
  });

  it("refuses a different asset code from the right issuer", () => {
    expect(() => assertSameAsset("EURC", ANCHOR_ISSUER)).toThrow(/does not know/i);
  });
});

describe("sep38Asset", () => {
  it("writes a Stellar asset the way SEP-38 names it", () => {
    expect(sep38Asset("USDC", ANCHOR_ISSUER)).toBe(
      `stellar:USDC:${ANCHOR_ISSUER}`,
    );
  });
});

describe("expiryOf", () => {
  function jwt(payload: object): string {
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `header.${b64}.signature`;
  }

  it("reads the expiry the anchor set", () => {
    expect(expiryOf(jwt({ sub: "G…", exp: 1789927168 }))).toBe(1789927168);
  });

  it("treats anything unreadable as already expired", () => {
    // Not validation — only the anchor can judge its own token. The point is
    // to never present one we can already see is spent, and a token we cannot
    // parse is one we know nothing about, so we ask for a new one.
    expect(expiryOf("not a jwt")).toBe(0);
    expect(expiryOf(jwt({ sub: "G…" }))).toBe(0);
    expect(expiryOf("")).toBe(0);
  });
});
