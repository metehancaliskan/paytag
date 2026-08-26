import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * "I am about to sign in as my other account, and I want the two joined."
 *
 * Merging two Paytag accounts moves identities — and with them cards, payout
 * addresses and the escrow those tags hold — from one profile to another. That
 * needs proof from BOTH sides, and OAuth can only ever prove one of them:
 *
 *   the incoming account  — proved by the provider's answer to a token we just
 *                           received (SPEC §4.4)
 *   the account you keep  — proved by THIS token
 *
 * The token is minted by `POST /api/account/merge` while that account's session
 * is live, so only somebody who was signed in as it can obtain one. It is an
 * HMAC over `profileId.expiry`, in an HttpOnly cookie, valid for ten minutes —
 * long enough for one OAuth round trip and no longer.
 *
 * Why this exists at all: without an explicit intent, "the same provider
 * account is on another profile" would have to be resolved silently, and every
 * silent answer is wrong. Move the row automatically and an ordinary sign-in
 * quietly drags a card and a payout address from one account to the other, in
 * whichever direction the person happened to log in — data ping-ponging between
 * two accounts with nobody asking. Refuse always, and a real person with a real
 * split is stuck forever. So: never automatically, and never without a token
 * that says which account asked.
 *
 * The key is derived from the verifier seed rather than being the seed —
 * `sha256(domain ‖ seed)`. One secret, two purposes, and a signature from one
 * can never be replayed as the other.
 */

const DOMAIN = "paytag.merge-intent.v1";
export const MERGE_COOKIE = "paytag_merge";
export const MERGE_TTL_SECONDS = 600;

function key(): Buffer {
  const hex = process.env.VERIFIER_SECRET?.trim();
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("VERIFIER_SECRET is not set, so a merge cannot be signed.");
  }
  return createHash("sha256")
    .update(DOMAIN)
    .update(Buffer.from(hex, "hex"))
    .digest();
}

/** `<profileId>.<expiryEpochSeconds>.<hmac>` */
export function mintMergeIntent(profileId: string, nowSeconds: number): string {
  const body = `${profileId}.${nowSeconds + MERGE_TTL_SECONDS}`;
  return `${body}.${createHmac("sha256", key()).update(body).digest("hex")}`;
}

/**
 * The profile that asked for the merge, or null.
 *
 * Null for anything at all wrong — shape, signature, expiry. A merge is not a
 * place to be forgiving about a token that does not parse.
 */
export function readMergeIntent(
  token: string | undefined,
  nowSeconds: number,
): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [profileId, expiry, mac] = parts;
  if (!/^[0-9a-f]{64}$/.test(mac)) return null;

  const expected = createHmac("sha256", key())
    .update(`${profileId}.${expiry}`)
    .digest();
  const given = Buffer.from(mac, "hex");
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;

  const deadline = Number(expiry);
  if (!Number.isFinite(deadline) || deadline <= nowSeconds) return null;
  return profileId;
}
