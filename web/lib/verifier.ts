import "server-only";

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as edSign,
} from "node:crypto";

/**
 * The verifier's signing side. SPEC.md §4.
 *
 * This file must produce byte-identical output to `scripts/paytag.mjs` and to
 * `claim_preimage` in the contract. It is checked from three directions: the
 * Rust test `preimage_matches_the_spec_golden_vector`, the cross-language
 * tests in `test_crosslang.rs`, and `node scripts/paytag.mjs selftest`.
 *
 * `server-only`: the private key is read here. If this module ever reaches a
 * client bundle, the escrow is over.
 */

const CLAIM_DOMAIN = Buffer.from("paytag.claim.v1", "ascii"); // 15 bytes
const STRKEY_LEN = 56;
const PREIMAGE_LEN = 195;

/** SPEC §4.1 — the fixed 195-byte layout. */
export function claimPreimage(input: {
  contractId: string;
  identityKey: Buffer;
  recipient: string;
  expiresAt: number;
  nonce: Buffer;
}): Buffer {
  const { contractId, identityKey, recipient, expiresAt, nonce } = input;

  assertStrkey(contractId, "contract");
  assertStrkey(recipient, "recipient");
  if (identityKey.length !== 32) throw new Error("identity_key must be 32 bytes");
  if (nonce.length !== 32) throw new Error("nonce must be 32 bytes");
  if (!Number.isInteger(expiresAt) || expiresAt < 0 || expiresAt > 0xffffffff) {
    throw new Error("expires_at must be an integer in 0..2^32-1");
  }

  const exp = Buffer.alloc(4);
  exp.writeUInt32BE(expiresAt);

  const buf = Buffer.concat([
    CLAIM_DOMAIN,
    Buffer.from(contractId, "ascii"),
    identityKey,
    Buffer.from(recipient, "ascii"),
    exp,
    nonce,
  ]);
  if (buf.length !== PREIMAGE_LEN) {
    throw new Error(`preimage is ${buf.length} bytes, must be ${PREIMAGE_LEN}`);
  }
  return buf;
}

/**
 * Muxed addresses (M…, 69 characters) are rejected here as well as in the
 * contract: the preimage has a fixed width, so a longer address would shift
 * every field after it.
 */
function assertStrkey(s: string, name: string): void {
  if (typeof s !== "string" || s.length !== STRKEY_LEN) {
    throw new Error(
      `${name} must be a 56-character strkey (muxed M… is not supported)`,
    );
  }
  if (!/^[GC][A-Z2-7]{55}$/.test(s)) {
    throw new Error(`${name} is not a valid account (G…) or contract (C…) address`);
  }
}

/** identity_key = sha256(kind_byte ‖ utf8(normalized_handle)) */
export function identityKeyBytes(normalizedHandle: string, kind: number): Buffer {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from([kind]), Buffer.from(normalizedHandle, "utf8")]))
    .digest();
}

export function newNonce(): Buffer {
  return randomBytes(32);
}

/** Reads the seed from the environment only — never from an argument. */
function verifierSeed(): Buffer {
  const hex = process.env.VERIFIER_SECRET?.trim();
  if (!hex) {
    throw new Error(
      "VERIFIER_SECRET is not set. Generate one with `node scripts/paytag.mjs keygen`.",
    );
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error("VERIFIER_SECRET must be 64 hex digits (32 bytes).");
  }
  return buf;
}

function privateKeyFromSeed(seed32: Buffer) {
  // PKCS#8 wrapper: fixed prefix + the 32-byte seed.
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed32,
  ]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

export function signClaim(preimage: Buffer): Buffer {
  return edSign(null, preimage, privateKeyFromSeed(verifierSeed()));
}

/**
 * The public key the contract must have been initialized with. Used to fail
 * fast when the configured secret does not match the deployed contract —
 * otherwise every claim fails inside `ed25519_verify` with nothing to explain
 * why.
 */
export function verifierPublicKeyHex(): string {
  const pub = createPublicKey(privateKeyFromSeed(verifierSeed()));
  return Buffer.from(pub.export({ type: "spki", format: "der" }))
    .subarray(-32)
    .toString("hex");
}
