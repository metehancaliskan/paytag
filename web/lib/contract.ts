import {
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import { DEFAULT_TOKEN, ESCROW_ID } from "./config";
import {
  networkPassphrase,
  readOnlySource,
  server,
  contractErrorCode,
} from "./stellar";

/** A Soroban fee = inclusion fee + resource fee. This is the inclusion part. */
const INCLUSION_FEE = "100000"; // 0.01 XLM — enough to land even when busy

export const STATUS = { Pending: 0, Claimed: 1, Refunded: 2 } as const;

export type Payment = {
  id: number;
  from: string;
  identityHex: string;
  token: string;
  amount: bigint;
  expiryLedger: number;
  status: number;
};

// ----------------------------------------------------------------- reading

async function simulate(
  contractId: string,
  method: string,
  ...args: xdr.ScVal[]
) {
  const tx = new TransactionBuilder(readOnlySource(), {
    fee: INCLUSION_FEE,
    networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error);
  }
  if (!sim.result) {
    throw new Error(`${method}: simulation returned no result`);
  }
  return scValToNative(sim.result.retval);
}

function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export type EscrowConfig = {
  admin: string;
  verifier: string;
  defaultExpiryLedgers: number;
};

export async function getConfig(): Promise<EscrowConfig> {
  const raw = await simulate(ESCROW_ID, "get_config");
  return {
    admin: String(raw.admin),
    verifier: toHex(new Uint8Array(raw.verifier)),
    defaultExpiryLedgers: Number(raw.default_expiry_ledgers),
  };
}

export async function getPayment(id: number): Promise<Payment | null> {
  try {
    const raw = await simulate(
      ESCROW_ID,
      "get_payment",
      nativeToScVal(BigInt(id), { type: "u64" }),
    );
    return {
      id,
      from: String(raw.from),
      identityHex: toHex(new Uint8Array(raw.identity)),
      token: String(raw.token),
      amount: BigInt(raw.amount),
      expiryLedger: Number(raw.expiry_ledger),
      status: Number(raw.status),
    };
  } catch (err) {
    // #6 = PaymentNotFound. The counter increases monotonically, so this means
    // the end of the list. Any other error is a real problem — don't swallow it.
    if (contractErrorCode(err) === 6) return null;
    throw err;
  }
}

/**
 * Finds the payments belonging to one identity.
 *
 * The contract keeps no index by identity; payment ids start at 1 and increase
 * monotonically. So we walk the ids and stop at the first gap. The RPC
 * `getEvents` endpoint would be faster, but testnet only retains events for
 * about 24 hours, and a walk sees old payments too.
 *
 * Good enough at MVP scale. Once the payment count grows this moves behind an
 * index fed from Supabase (Phase 4).
 */
export async function listPaymentsForIdentity(
  identityHex: string,
  maxScan = 300,
): Promise<Payment[]> {
  const target = identityHex.toLowerCase();
  const found: Payment[] = [];
  const CHUNK = 8;

  for (let start = 1; start <= maxScan; start += CHUNK) {
    const ids = Array.from({ length: CHUNK }, (_, i) => start + i);
    const batch = await Promise.all(ids.map((id) => getPayment(id)));
    for (const p of batch) {
      if (p && p.identityHex === target) found.push(p);
    }
    // A gap in this batch means the counter ended there.
    if (batch.some((p) => p === null)) break;
  }
  return found;
}

export async function tokenDecimals(
  tokenId = DEFAULT_TOKEN.contractId,
): Promise<number> {
  return Number(await simulate(tokenId, "decimals"));
}

export async function tokenSymbol(
  tokenId = DEFAULT_TOKEN.contractId,
): Promise<string> {
  return String(await simulate(tokenId, "symbol"));
}

export async function tokenBalance(
  owner: string,
  tokenId = DEFAULT_TOKEN.contractId,
): Promise<bigint> {
  const raw = await simulate(tokenId, "balance", new Address(owner).toScVal());
  return BigInt(raw);
}

export async function latestLedger(): Promise<number> {
  const { sequence } = await server().getLatestLedger();
  return sequence;
}

// ----------------------------------------------------------------- writing

/**
 * Builds and simulates a `deposit` — IT DOES NOT SIGN YET.
 *
 * Signing is a separate step so the user can see what they are approving in
 * the wallet, and so we can surface the fee and any contract error in the UI
 * before a signature exists.
 */
export async function buildDeposit(params: {
  from: string;
  identity: Uint8Array;
  amount: bigint;
  expiryLedger: number;
  tokenId?: string;
}): Promise<Transaction> {
  const {
    from,
    identity,
    amount,
    expiryLedger,
    tokenId = DEFAULT_TOKEN.contractId,
  } = params;

  const account = await server().getAccount(from);
  const tx = new TransactionBuilder(account, {
    fee: INCLUSION_FEE,
    networkPassphrase,
  })
    .addOperation(
      new Contract(ESCROW_ID).call(
        "deposit",
        new Address(from).toScVal(),
        xdr.ScVal.scvBytes(identity),
        new Address(tokenId).toScVal(),
        nativeToScVal(amount, { type: "i128" }),
        nativeToScVal(expiryLedger, { type: "u32" }),
      ),
    )
    .setTimeout(180)
    .build();

  // prepareTransaction runs the simulation and writes the footprint and
  // resource fee into the transaction. A contract error blows up here —
  // before any money has moved.
  return await server().prepareTransaction(tx);
}

/**
 * Builds and simulates a `claim`.
 *
 * Worth knowing: the contract does NOT call `recipient.require_auth()`. The
 * verifier signature already names the recipient, so the transaction itself
 * can be submitted — and paid for — by any funded account. That is the opening
 * for answering SPEC §7.5 ("who pays the claim fee?"): Paytag could submit
 * this transaction on the recipient's behalf and cover the fee, so somebody
 * with no XLM can still get their money out. Today the recipient's own wallet
 * submits it, which is the simpler path and the one that needs no server key.
 */
export async function buildClaim(params: {
  /** Account that submits and pays for the transaction. */
  source: string;
  paymentIds: number[];
  identity: Uint8Array;
  recipient: string;
  nonce: Uint8Array;
  expiresAt: number;
  signature: Uint8Array;
}): Promise<Transaction> {
  const {
    source,
    paymentIds,
    identity,
    recipient,
    nonce,
    expiresAt,
    signature,
  } = params;

  if (paymentIds.length === 0) throw new Error("No payments to claim.");

  const account = await server().getAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: INCLUSION_FEE,
    networkPassphrase,
  })
    .addOperation(
      new Contract(ESCROW_ID).call(
        "claim",
        nativeToScVal(
          paymentIds.map((id) => nativeToScVal(BigInt(id), { type: "u64" })),
        ),
        xdr.ScVal.scvBytes(identity),
        new Address(recipient).toScVal(),
        xdr.ScVal.scvBytes(nonce),
        nativeToScVal(expiresAt, { type: "u32" }),
        xdr.ScVal.scvBytes(signature),
      ),
    )
    .setTimeout(180)
    .build();

  return await server().prepareTransaction(tx);
}

/**
 * Builds and simulates a `refund`.
 *
 * Unlike `claim`, this needs no verifier signature: the contract only checks
 * that the caller is the original sender and that the expiry ledger has
 * passed. That is why refund works end to end today while claim is still
 * waiting on the Phase 3 verifier.
 */
export async function buildRefund(params: {
  from: string;
  paymentId: number;
}): Promise<Transaction> {
  const account = await server().getAccount(params.from);
  const tx = new TransactionBuilder(account, {
    fee: INCLUSION_FEE,
    networkPassphrase,
  })
    .addOperation(
      new Contract(ESCROW_ID).call(
        "refund",
        nativeToScVal(BigInt(params.paymentId), { type: "u64" }),
      ),
    )
    .setTimeout(180)
    .build();

  return await server().prepareTransaction(tx);
}

export type SubmitResult = { hash: string; returnValue: unknown };

/** Sends signed XDR to the network and waits for it to settle. */
export async function submitSigned(signedXdr: string): Promise<SubmitResult> {
  const tx = TransactionBuilder.fromXdr(signedXdr, networkPassphrase);
  const sent = await server().sendTransaction(tx);

  if (sent.status === "ERROR") {
    throw new Error(
      `The network rejected the transaction: ${JSON.stringify(
        sent.errorResult ?? sent,
      )}`,
    );
  }

  const final = await server().pollTransaction(sent.hash, {
    attempts: 30,
    sleepStrategy: () => 1000,
  });

  if (final.status !== "SUCCESS") {
    throw new Error(
      `Transaction failed (${final.status}). Hash: ${sent.hash}` +
        ("resultXdr" in final && final.resultXdr
          ? ` — ${final.resultXdr.toXdr("base64")}`
          : ""),
    );
  }

  return {
    hash: sent.hash,
    returnValue: final.returnValue ? scValToNative(final.returnValue) : null,
  };
}
