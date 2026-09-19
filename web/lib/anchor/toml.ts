// SEP-1 — the anchor describes itself.
//
// One file at a fixed path, `/.well-known/stellar.toml`, and everything else
// follows from it: where to authenticate, where to deposit and withdraw, which
// key signs its challenges, which asset it issues. Nothing here is configured
// by us except the domain, which is the whole point of the standard — the same
// code reaches a different anchor by being pointed at a different name.

import { Asset, StellarToml } from "@stellar/stellar-sdk";
import { networkPassphrase } from "../stellar";
import { tokenByContractId, type TokenConfig } from "../config";
import { ANCHOR_ASSET_CODE, ANCHOR_HOME_DOMAIN } from "./config";

export type AnchorInfo = {
  domain: string;
  /** SEP-10: where challenges are issued and signed challenges returned. */
  webAuth: string;
  /** SEP-6: deposit, withdraw, transaction history. */
  transferServer: string;
  /** SEP-38: firm quotes between the fiat and the asset. Optional. */
  quoteServer: string | null;
  /** SEP-12: KYC. Simulated on the mock anchor. Optional. */
  kycServer: string | null;
  /** The key whose signature proves a challenge came from this anchor. */
  signingKey: string;
  assetCode: string;
  assetIssuer: string;
  /**
   * The same asset as this app's own token entry.
   *
   * Resolved rather than assumed: an asset is its code AND its issuer, so an
   * anchor advertising "USDC" from an issuer we do not hold would ramp money
   * the escrow cannot pay out. See `assertSameAsset`.
   */
  token: TokenConfig;
};

/** SEP-38 names a Stellar asset like `stellar:USDC:GBBD…`. */
export function sep38Asset(code: string, issuer: string): string {
  return `stellar:${code}:${issuer}`;
}

/**
 * Reads the anchor's stellar.toml and pins down the four things we need.
 *
 * Throws rather than returning a half-filled object. Every field below is
 * load-bearing: a missing transfer server means there is no ramp, a missing
 * web auth endpoint means we cannot prove who is asking, and carrying on with
 * `undefined` would surface as a fetch to the string "undefined" three screens
 * later.
 */
export async function loadAnchor(
  domain = ANCHOR_HOME_DOMAIN,
  assetCode = ANCHOR_ASSET_CODE,
): Promise<AnchorInfo> {
  if (!domain) throw new Error("No anchor is configured for this deployment.");

  const toml = await StellarToml.Resolver.resolve(domain);

  const webAuth = toml.WEB_AUTH_ENDPOINT;
  const transferServer = toml.TRANSFER_SERVER;
  const signingKey = toml.SIGNING_KEY;

  if (!webAuth || !transferServer || !signingKey) {
    throw new Error(
      `${domain} does not look like a SEP-6 anchor: its stellar.toml is missing ` +
        `${[
          !webAuth && "WEB_AUTH_ENDPOINT",
          !transferServer && "TRANSFER_SERVER",
          !signingKey && "SIGNING_KEY",
        ]
          .filter(Boolean)
          .join(", ")}.`,
    );
  }

  const currency = (toml.CURRENCIES ?? []).find((c) => c.code === assetCode);
  if (!currency?.issuer) {
    throw new Error(
      `${domain} does not issue ${assetCode}, so it cannot ramp it.`,
    );
  }

  const token = assertSameAsset(assetCode, currency.issuer);

  return {
    domain,
    webAuth,
    transferServer: trimSlash(transferServer),
    quoteServer: toml.ANCHOR_QUOTE_SERVER
      ? trimSlash(toml.ANCHOR_QUOTE_SERVER)
      : null,
    kycServer: toml.KYC_SERVER ? trimSlash(toml.KYC_SERVER) : null,
    signingKey,
    assetCode,
    assetIssuer: currency.issuer,
    token,
  };
}

/**
 * The anchor's asset has to be the one the escrow already holds.
 *
 * A classic asset reaches Soroban through its Stellar Asset Contract, and that
 * contract's address is derived from the code, the issuer and the network — so
 * this is not a name comparison, it is arithmetic. If the anchor ramps a USDC
 * whose SAC is not in `TOKENS`, then money on-ramped here could be sent to a
 * handle and never off-ramped again, because the anchor would not recognise
 * what came back. Better to refuse at the first screen than to discover it
 * after a payment.
 */
export function assertSameAsset(code: string, issuer: string): TokenConfig {
  const contractId = new Asset(code, issuer).contractId(networkPassphrase);
  const token = tokenByContractId(contractId);

  if (!token) {
    throw new Error(
      `The anchor ramps ${code}:${issuer.slice(0, 8)}… (contract ${contractId.slice(
        0,
        8,
      )}…), which this deployment does not know. Point NEXT_PUBLIC_USDC_SAC_ID at that contract.`,
    );
  }
  return token;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
