// SEP-10 — proving who is asking, with the wallet key and nothing else.
//
// The anchor builds a transaction that can never be submitted (sequence number
// 0) and asks the wallet to sign it. A signature over that challenge proves
// control of the account, so the anchor issues a JWT and the rest of the
// conversation carries it. No password, no account, no API key: the key the
// person already has IS the identity.
//
// Which is why this file adds no secret to the deployment. The signing happens
// in the browser, in Freighter, and the token never leaves the tab.

import { TransactionBuilder } from "@stellar/stellar-sdk";
import { networkPassphrase } from "../stellar";
import type { AnchorInfo } from "./toml";

/**
 * Tokens live in memory, for the life of the tab.
 *
 * Not localStorage. A SEP-10 token is a bearer credential for somebody's money
 * at the anchor, and the only thing it buys by surviving a reload is one
 * wallet prompt. Keyed by anchor and account together, because one browser can
 * hold several wallets and must never present one account's token for another.
 */
const tokens = new Map<string, { token: string; expiresAt: number }>();

/** Seconds of remaining life below which we ask for a new token instead. */
const FRESH_ENOUGH_SECONDS = 60;

export type SignXdr = (xdr: string) => Promise<string>;

/**
 * Asks for a token, and can be asked again for a fresh one.
 *
 * SEP-10 does not fix a JWT lifetime, so anchors range from minutes to a day
 * and nothing on our side can know which. Passing a getter rather than a
 * string is what lets a long wait — a bank transfer taking ten minutes to
 * clear — outlive the token it started with.
 */
export type TokenGetter = (force?: boolean) => Promise<string>;

/**
 * Returns a bearer token for this account at this anchor, signing a fresh
 * challenge only when the cached one is missing or nearly expired.
 *
 * `force` skips the cache. It is for the case the expiry claim cannot catch:
 * an anchor that rejects a token we still believe in, because it revoked it,
 * restarted, or reads the clock differently than we do.
 */
export async function authenticate(
  anchor: AnchorInfo,
  account: string,
  sign: SignXdr,
  force = false,
): Promise<string> {
  const key = `${anchor.domain}|${account}`;
  const cached = tokens.get(key);
  if (cached && !force && !isStale(cached.expiresAt)) return cached.token;

  const challenge = await getChallenge(anchor, account);
  const signed = await sign(challenge);
  const token = await postChallenge(anchor, signed);

  tokens.set(key, { token, expiresAt: expiryOf(token) });
  return token;
}

/**
 * A getter bound to one anchor and one account.
 *
 * Hand this to anything that makes more than one call. Each call gets a token
 * that is valid at the moment it is made, and a rejected one is replaced by a
 * fresh signature instead of a failed flow.
 */
export function tokenSource(
  anchor: AnchorInfo,
  account: string,
  sign: SignXdr,
): TokenGetter {
  return (force = false) => authenticate(anchor, account, sign, force);
}

/** Drops a cached token — for signing out, or after the anchor rejects one. */
export function forgetToken(anchor: AnchorInfo, account: string): void {
  tokens.delete(`${anchor.domain}|${account}`);
}

async function getChallenge(
  anchor: AnchorInfo,
  account: string,
): Promise<string> {
  const url = `${anchor.webAuth}?account=${encodeURIComponent(account)}`;
  const body = await getJson(url, "challenge");

  const xdr = typeof body.transaction === "string" ? body.transaction : null;
  if (!xdr) throw new Error("The anchor returned no challenge transaction.");

  // The challenge says which network it is for, and signing it on the wrong
  // one produces a signature the anchor will reject with no useful message.
  const theirs = String(body.network_passphrase ?? networkPassphrase);
  if (theirs !== networkPassphrase) {
    throw new Error(
      `The anchor is on "${theirs}" and this app is on "${networkPassphrase}".`,
    );
  }

  // Parsed before it is handed to the wallet: a malformed challenge should
  // fail here, not as an unreadable error inside the extension.
  TransactionBuilder.fromXdr(xdr, theirs);
  return xdr;
}

async function postChallenge(
  anchor: AnchorInfo,
  signedXdr: string,
): Promise<string> {
  const res = await fetch(anchor.webAuth, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedXdr }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok || typeof body.token !== "string") {
    throw new Error(
      `The anchor refused the signature: ${describe(body) ?? res.status}`,
    );
  }
  return body.token;
}

async function getJson(
  url: string,
  what: string,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(`Could not reach the anchor to get a ${what}.`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `The anchor refused the ${what}: ${describe(body) ?? res.status}`,
    );
  }
  return body;
}

function describe(body: Record<string, unknown>): string | null {
  return typeof body.error === "string" ? body.error : null;
}

function isStale(expiresAt: number): boolean {
  return expiresAt - Date.now() / 1000 < FRESH_ENOUGH_SECONDS;
}

/**
 * The `exp` claim, read without verifying the signature.
 *
 * Deliberately not validation: this token is the ANCHOR'S statement to itself,
 * and only the anchor can judge it. All we want is to avoid presenting one we
 * can already see is spent. An unreadable token is treated as expiring now, so
 * the next call asks for a fresh one rather than trusting a value we could not
 * parse.
 */
export function expiryOf(jwt: string): number {
  try {
    const [, payload] = jwt.split(".");
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp : 0;
  } catch {
    return 0;
  }
}
