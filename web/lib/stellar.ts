import { rpc, Networks, StrKey, Account } from "@stellar/stellar-sdk";
import { ESCROW_ID, NETWORK, RPC_URL, USDC_SAC_ID } from "./config";

export const networkPassphrase =
  NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

let _server: rpc.Server | null = null;

export function server(): rpc.Server {
  if (!_server) _server = new rpc.Server(RPC_URL);
  return _server;
}

/**
 * Source account for read-only simulations.
 *
 * Simulation never reaches the network, so signatures, balances and sequence
 * numbers are not checked — using an address that does not exist is safe, and
 * it lets us read data before the user has connected a wallet at all.
 * A fixed all-zero address rather than a random one: the same call should
 * always produce the same result, so debugging stays quiet.
 */
export function readOnlySource(): Account {
  return new Account(StrKey.encodeEd25519PublicKey(new Uint8Array(32)), "0");
}

/**
 * Pulls the number out of a Soroban `Error(Contract, #N)` message.
 * Error codes are defined PER CONTRACT — #13 is PaymentExpired in the escrow
 * and something entirely different in the token contract. So reading a code
 * means first knowing which contract was speaking.
 */
export function contractErrorCode(err: unknown): number | null {
  const m = /Error\(Contract,\s*#(\d+)\)/.exec(errorText(err));
  return m ? Number(m[1]) : null;
}

function errorText(err: unknown): string {
  return typeof err === "string"
    ? err
    : err instanceof Error
      ? err.message
      : JSON.stringify(err ?? "");
}

/** In the same order as `enum Error` in contracts/escrow/src/lib.rs. */
export const ESCROW_ERRORS: Record<number, string> = {
  1: "The contract is already initialized.",
  2: "The contract is not initialized yet (init has not been called).",
  3: "The amount cannot be zero or negative.",
  4: "That expiry ledger is already in the past.",
  5: "That claim window is longer than the contract allows (30 days maximum).",
  6: "No such payment.",
  7: "This payment has already been claimed or refunded.",
  8: "The claim window has not closed yet. No refund before expiry.",
  9: "The list of payments to claim is empty.",
  10: "The authorization has expired. Verify the account again.",
  11: "This authorization was already used (replay protection).",
  12: "That payment belongs to a different identity.",
  13: "This payment has expired and can only be refunded now.",
  14: "Unsupported address format (muxed addresses cannot be used).",
  15: "This authorization was issued with too long a lifetime. Ask for a new one.",
};

/**
 * The built-in Stellar Asset Contract's own error codes.
 *
 * These overlap numerically with the escrow's and mean completely different
 * things — #13 is `PaymentExpired` for us and `TrustlineMissingError` for the
 * token. A deposit calls `token.transfer` inside the escrow, so a failure can
 * come from either contract, and reading the number without knowing who threw
 * it sends you looking in exactly the wrong place. That already happened once
 * during Phase 2 (see docs/evidence/tx-hashes.md).
 */
export const TOKEN_ERRORS: Record<number, string> = {
  1: "The token contract hit an internal error.",
  2: "The token does not support that operation.",
  3: "The token contract is already initialized.",
  4: "The token contract refused the operation (unauthorized).",
  5: "The token contract could not authenticate the caller.",
  6: "That account does not exist on the network yet. Fund it first. On testnet, Friendbot does it for free.",
  7: "That address is not a classic Stellar account.",
  8: "The amount cannot be negative.",
  9: "The spending allowance is not enough.",
  10: "Not enough balance of this token.",
  11: "This trustline is deauthorized: the asset issuer has frozen it.",
  12: "The amount overflowed.",
  13: "This wallet has no trustline for this asset, so it cannot hold it. Add the asset in your wallet first (Freighter: Manage Assets), then get some sent to you.",
};

/**
 * Which contract actually threw. Soroban prints the innermost failure first,
 * so the contract id that appears earliest in the message is the one that
 * raised the error — the outer callers follow in the fn_call events after it.
 *
 * A heuristic, not a guarantee. When it cannot tell, it says so rather than
 * guessing, because a confidently wrong error message costs more than an
 * honest vague one.
 */
function whoThrew(text: string): "escrow" | "token" | "unknown" {
  const escrow = text.indexOf(ESCROW_ID);
  const token = text.indexOf(USDC_SAC_ID);
  if (escrow < 0 && token < 0) return "unknown";
  if (token < 0) return "escrow";
  if (escrow < 0) return "token";
  return token < escrow ? "token" : "escrow";
}

/**
 * Does this account exist on chain yet?
 *
 * Three answers, not two: `null` means "could not tell" — the RPC was
 * unreachable — and a caller must not treat that as "no". A payout address is
 * saved on `null` and refused only on a definite `false`, because an outage in
 * our own infrastructure is no reason to reject a wallet a person owns.
 *
 * It matters at all because a Stellar payment to an unfunded account fails: an
 * address saved today with nothing in it turns into a claim transaction that
 * reverts, after the reader has already signed it.
 */
export async function accountExists(
  address: string,
): Promise<boolean | null> {
  try {
    await server().getAccount(address);
    return true;
  } catch (e) {
    const text = errorText(e);
    return /not found|404|NotFound/i.test(text) ? false : null;
  }
}

/**
 * Turns anything thrown by a contract call into a sentence a person can act
 * on. Falls back to the raw message rather than swallowing it: an unknown
 * failure that prints nothing is worse than one that prints too much.
 */
export function describeEscrowError(err: unknown): string {
  const code = contractErrorCode(err);
  if (code !== null) {
    const source = whoThrew(errorText(err));
    const escrowSays = ESCROW_ERRORS[code];
    const tokenSays = TOKEN_ERRORS[code];

    if (source === "token" && tokenSays) {
      return `${tokenSays} (token contract error #${code})`;
    }
    if (source === "escrow" && escrowSays) {
      return `${escrowSays} (payment contract error #${code})`;
    }
    // Neither contract could be identified in the message. Both readings are
    // shown rather than one picked at random — the same number means two
    // different things, and the difference decides where to look.
    if (escrowSays && tokenSays) {
      return `Error #${code}. From the payment contract that means: ${escrowSays} From the token contract it means: ${tokenSays}`;
    }
    if (escrowSays) return `${escrowSays} (error #${code})`;
    if (tokenSays) return `${tokenSays} (error #${code})`;
  }

  const raw = err instanceof Error ? err.message : String(err);

  // The three failures that are not the contract's fault at all, and that a
  // raw XDR dump explains very badly.
  if (/User declined|denied|rejected|cancel/i.test(raw)) {
    return "You dismissed the request in your wallet. Nothing was sent.";
  }
  if (/Account not found|NotFound.*account/i.test(raw)) {
    return "This wallet does not exist on the network yet. Fund it first. On testnet, Friendbot does it for free.";
  }
  if (/fetch|network|Failed to load|ECONN|timeout/i.test(raw)) {
    return `Could not reach the Soroban RPC endpoint. Check your connection and try again. (${raw})`;
  }

  return raw;
}
