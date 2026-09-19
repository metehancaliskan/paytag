// The laboratory escrow — the one that lends while it waits.
//
// Separate contract, separate id, separate page. Nothing in the product calls
// this and nothing here calls the product: the only shared code is the RPC
// plumbing every screen uses to read a chain.
//
// Read docs/LAB-YIELD-ESCROW.md before wiring any of this into anything. The
// short version: it works, and what it costs is not obvious from the fact
// that it works.

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
import { networkPassphrase, readOnlySource, server } from "../stellar";

const FEE = "2000000";

/** Empty means this deployment has no laboratory, and the page says so. */
export const LAB_ESCROW_ID = (
  process.env.NEXT_PUBLIC_LAB_ESCROW_ID ?? ""
).trim();

export const LAB_ENABLED = LAB_ESCROW_ID !== "";

export const STATUS = { Pending: 0, Claimed: 1, Refunded: 2 } as const;

export type LabPayment = {
  id: number;
  from: string;
  token: string;
  /**
   * What the escrow owes, which is what the POSITION was worth when it was
   * bought — not what was handed over. Buying a position rounds down, and the
   * contract records the smaller figure so it never promises more than it
   * holds. See the contract's own comment on it.
   */
  principal: bigint;
  /** The position. Worth more than the principal, later. */
  bTokens: bigint;
  expiryLedger: number;
  status: number;
};

async function read(method: string, ...args: xdr.ScVal[]): Promise<unknown> {
  const tx = new TransactionBuilder(readOnlySource(), {
    fee: FEE,
    networkPassphrase,
  })
    .addOperation(new Contract(LAB_ESCROW_ID).call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!sim.result) throw new Error(`${method}: the contract returned nothing`);
  return scValToNative(sim.result.retval);
}

export async function getPayment(id: number): Promise<LabPayment | null> {
  try {
    const raw = (await read(
      "get_payment",
      nativeToScVal(BigInt(id), { type: "u64" }),
    )) as {
      from: string;
      token: string;
      principal: bigint;
      b_tokens: bigint;
      expiry_ledger: number;
      status: number;
    };
    return {
      id,
      from: String(raw.from),
      token: String(raw.token),
      principal: BigInt(raw.principal),
      bTokens: BigInt(raw.b_tokens),
      expiryLedger: Number(raw.expiry_ledger),
      status: Number(raw.status),
    };
  } catch {
    // #6 is PaymentNotFound, which is how the end of the list announces
    // itself. Anything else is also "no payment here" as far as a laboratory
    // page is concerned.
    return null;
  }
}

/**
 * Every payment, by walking the ids.
 *
 * The same scan the production escrow does, and for the same reason: nothing
 * indexes by anything, ids start at one and increase, so the end of the list
 * is the first gap. Fine at laboratory scale; it is the first thing that would
 * have to change if this were ever more than an experiment.
 */
export async function listPayments(max = 40): Promise<LabPayment[]> {
  const found: LabPayment[] = [];
  for (let id = 1; id <= max; id++) {
    const p = await getPayment(id);
    if (!p) break;
    found.push(p);
  }
  return found;
}

export async function getPool(): Promise<string> {
  const cfg = (await read("get_config")) as { pool: string };
  return String(cfg.pool);
}

// ------------------------------------------------------------------ writing

async function build(
  from: string,
  method: string,
  ...args: xdr.ScVal[]
): Promise<Transaction> {
  const account = await server().getAccount(from);
  const tx = new TransactionBuilder(account, { fee: FEE, networkPassphrase })
    .addOperation(new Contract(LAB_ESCROW_ID).call(method, ...args))
    .setTimeout(180)
    .build();

  const sim = await server().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!("transactionData" in sim)) {
    throw new Error("The contract returned no execution plan for that call.");
  }

  // A deposit here is three contracts deep — escrow, pool, token — and the
  // simulation's estimate has been tight enough to fail on the way through
  // that chain. Headroom is refunded; a reverted deposit is not.
  const resources = sim.transactionData.build().resources;
  sim.transactionData
    .setResources(
      Number(resources.instructions) * 2,
      Number(resources.diskReadBytes),
      Number(resources.writeBytes),
    )
    .setResourceFee(BigInt(sim.minResourceFee) * 3n);

  return rpc.assembleTransaction(tx, sim).build();
}

export function buildDeposit(params: {
  from: string;
  identity: Uint8Array;
  token: string;
  amount: bigint;
  expiryLedger: number;
}): Promise<Transaction> {
  return build(
    params.from,
    "deposit",
    new Address(params.from).toScVal(),
    xdr.ScVal.scvBytes(params.identity),
    new Address(params.token).toScVal(),
    nativeToScVal(params.amount, { type: "i128" }),
    nativeToScVal(params.expiryLedger, { type: "u32" }),
  );
}

/**
 * Pays an escrow out. NO IDENTITY CHECK — see the contract.
 *
 * The production escrow will not move money without a verifier signature
 * naming the recipient. This one takes an address and believes it, because the
 * experiment is about whether the money mechanics hold, and a second unproven
 * thing would make a failure impossible to attribute.
 */
export function buildClaim(
  from: string,
  paymentId: number,
  to: string,
): Promise<Transaction> {
  return build(
    from,
    "claim",
    nativeToScVal(BigInt(paymentId), { type: "u64" }),
    new Address(to).toScVal(),
  );
}

export function buildRefund(
  from: string,
  paymentId: number,
): Promise<Transaction> {
  return build(
    from,
    "refund",
    nativeToScVal(BigInt(paymentId), { type: "u64" }),
  );
}
