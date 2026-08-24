import { NextResponse, type NextRequest } from "next/server";
import { serverSupabase, adminSupabase } from "@/lib/supabase/server";
import { KIND, normalizeHandle, type IdentityKind } from "@/lib/identity";
import {
  claimPreimage,
  identityKeyBytes,
  newNonce,
  signClaim,
  verifierPublicKeyHex,
} from "@/lib/verifier";
import { latestLedger } from "@/lib/contract";
import { CLAIM_AUTH_LEDGERS, ESCROW_ID } from "@/lib/config";

export const runtime = "nodejs";

/**
 * Mints a claim authorization: the ed25519 signature the contract checks
 * before it releases money. SPEC.md §4.
 *
 * This endpoint is the single most attackable surface in the product. It is
 * the off-chain half of the trust assumption written down in the README, and
 * every check below exists because skipping it would let somebody take money
 * that is not theirs:
 *
 *   1. There has to be a signed-in Supabase session, or there is no claim to
 *      who anyone is.
 *   2. The identity row has to exist and belong to that session's user. The
 *      row can only have been written by the OAuth callback with the service
 *      role, so its presence *is* the proof of ownership.
 *   3. The handle in the request must equal the verified handle exactly, after
 *      normalization. Otherwise a verified user could ask for a signature over
 *      somebody else's tag.
 *   4. The recipient address goes into the preimage, so an intercepted
 *      signature cannot be redirected to a different wallet.
 *   5. The nonce is recorded before the signature is produced. Reversing that
 *      order would let a crash hand out a signature with no record of it.
 *   6. The window is short (CLAIM_AUTH_LEDGERS), so a leaked authorization is
 *      stale by the time anyone finds it.
 */
export async function POST(request: NextRequest) {
  let body: {
    kind?: number;
    handle?: string;
    recipient?: string;
    paymentIds?: number[];
  };
  try {
    body = await request.json();
  } catch {
    return bad(400, "Malformed JSON body.");
  }

  const kind = body.kind;
  const handleInput = body.handle;
  const recipient = body.recipient;

  if (kind !== KIND.GithubUser) {
    // X verification is not wired up: SPEC §7.4 — whether "Sign in with X"
    // works on the free tier is still unresolved. Signing for an identity we
    // cannot verify would be the same as signing for anyone.
    return bad(400, "Only GitHub identities can be verified right now.");
  }
  if (typeof handleInput !== "string" || typeof recipient !== "string") {
    return bad(400, "handle and recipient are required.");
  }

  let handle: string;
  try {
    handle = normalizeHandle(handleInput, kind as IdentityKind);
  } catch (e) {
    return bad(400, e instanceof Error ? e.message : "Invalid handle.");
  }

  const supabase = await serverSupabase();
  const admin = adminSupabase();
  if (!supabase || !admin) {
    return bad(503, "This deployment has no verifier configured.");
  }

  // getUser() revalidates the token with Supabase rather than trusting the
  // cookie's contents, which is the difference that matters here.
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return bad(401, "Sign in with GitHub first.");

  const { data: identity, error: identityError } = await admin
    .from("identities")
    .select("handle, external_id, identity_key")
    .eq("profile_id", user.id)
    .eq("kind", kind)
    .maybeSingle();

  if (identityError) return bad(500, "Could not read the identity record.");
  if (!identity) return bad(403, "This account has no verified GitHub identity.");

  if (identity.handle !== handle) {
    return bad(
      403,
      `You are signed in as @${identity.handle}, so you cannot claim @${handle}.`,
    );
  }

  // Recompute rather than trust the stored column: the stored key is a
  // convenience for querying, the bytes we sign have to come from the rule.
  const identityKey = identityKeyBytes(handle, kind);
  if (identityKey.toString("hex") !== identity.identity_key) {
    return bad(500, "Stored identity key does not match the handle. Not signing.");
  }

  let expiresAt: number;
  try {
    expiresAt = (await latestLedger()) + CLAIM_AUTH_LEDGERS;
  } catch {
    return bad(502, "Could not reach the Soroban RPC endpoint to read the ledger.");
  }

  const nonce = newNonce();

  // Recorded before signing, and unique in the table: the verifier will never
  // sign the same nonce twice, even if the same request arrives twice at once.
  // This is a separate guarantee from the contract's own replay check, which
  // can only refuse a nonce that actually reached the chain.
  const inserted = await admin.from("claim_nonces").insert({
    nonce: nonce.toString("hex"),
    profile_id: user.id,
    identity_key: identity.identity_key,
    recipient,
    expires_at_ledger: expiresAt,
  });
  if (inserted.error) {
    // 23505 is the unique violation on `nonce`: the same authorization is
    // already on record, so this is a conflict rather than a failure.
    return inserted.error.code === "23505"
      ? bad(409, "That authorization was already issued. Try again.")
      : bad(500, "Could not record the nonce, so nothing was signed.");
  }

  let signature: string;
  let verifierKey: string;
  try {
    const preimage = claimPreimage({
      contractId: ESCROW_ID,
      identityKey,
      recipient,
      expiresAt,
      nonce,
    });
    signature = signClaim(preimage).toString("hex");
    verifierKey = verifierPublicKeyHex();
  } catch (e) {
    return bad(500, e instanceof Error ? e.message : "Signing failed.");
  }

  return NextResponse.json({
    nonce: nonce.toString("hex"),
    expiresAt,
    signature,
    // Returned so the UI can tell a key mismatch (signature valid, wrong
    // verifier) apart from an expired or already-used authorization.
    verifierPublicKey: verifierKey,
    identityKey: identityKey.toString("hex"),
  });
}

function bad(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
