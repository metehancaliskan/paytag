// Talking to XOXNO's lending controller.
//
// The shape is different from Blend's and the difference is worth stating
// once, because it explains every function in this file:
//
//   Blend  — positions belong to an ADDRESS. Supply, read, withdraw.
//   XOXNO  — positions belong to an ACCOUNT, and an account is an NFT. The
//            first supply mints one and returns its id; everything after that
//            names the id. So reading somebody's position starts with finding
//            out which token they hold.
//
// What is verified against the live testnet contracts, and what is not:
// supplying works, reading works, and withdrawing the WHOLE position works
// (`amount = 0` means "all of it"). A partial withdrawal of a smaller amount
// was rejected on chain in testing and is therefore not offered — see
// `buildWithdrawAll`. Offering a control that fails is worse than offering
// one less control.

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
import {
  XOXNO_CONTROLLER,
  XOXNO_HUB_ID,
  XOXNO_POSITION_NFT,
  XOXNO_SPOKE_ID,
} from "./config";
import { networkPassphrase, readOnlySource, server } from "../stellar";

const FEE = "10000000"; // see the note on `build`

// ------------------------------------------------------------------ encoding

/**
 * `HubAssetKey { hub_id: u32, asset: Address }` — how XOXNO names a market.
 *
 * The same asset can be listed on more than one hub with different risk
 * settings, so an address alone does not identify a market. Every call that
 * mentions an asset takes this pair.
 */
export function hubAsset(asset: string, hubId = XOXNO_HUB_ID): xdr.ScVal {
  return nativeToScVal(
    { hub_id: hubId, asset: new Address(asset) },
    { type: { hub_id: ["symbol", "u32"], asset: ["symbol", "address"] } },
  );
}

/** One `(HubAssetKey, i128)` pair, as the contract's tuples are encoded. */
function entry(asset: string, amount: bigint): xdr.ScVal {
  return xdr.ScVal.scvVec([
    hubAsset(asset),
    nativeToScVal(amount, { type: "i128" }),
  ]);
}

const u64 = (n: bigint) => nativeToScVal(n, { type: "u64" });
const u32 = (n: number) => nativeToScVal(n, { type: "u32" });

// ------------------------------------------------------------------- reading

async function read(
  contractId: string,
  method: string,
  ...args: xdr.ScVal[]
): Promise<unknown> {
  const tx = new TransactionBuilder(readOnlySource(), {
    fee: FEE,
    networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!sim.result) throw new Error(`${method}: the contract returned nothing`);
  return scValToNative(sim.result.retval);
}

/**
 * The account this person holds, or null if they have never supplied.
 *
 * Only the first one. The protocol allows several accounts per address —
 * different spokes, different strategies — and a claim screen is the wrong
 * place to introduce that idea. Somebody who has built more than one position
 * elsewhere will see the first; the link to XOXNO's own app is there for the
 * rest.
 */
export async function findAccountId(owner: string): Promise<bigint | null> {
  const addr = new Address(owner).toScVal();
  const held = Number(await read(XOXNO_POSITION_NFT, "balance", addr));
  if (!held) return null;
  const id = await read(
    XOXNO_POSITION_NFT,
    "get_owner_token_id",
    addr,
    u32(0),
  );
  return BigInt(id as number | bigint);
}

/**
 * What the account has supplied of one asset, in the asset's own units.
 *
 * `get_collateral_amount` rather than `get_account_positions`: the latter
 * answers with a map keyed by a struct and with balances in the protocol's
 * internal RAY scaling, and every one of those is a place to get the
 * arithmetic subtly wrong. This one returns the number a person would
 * recognise.
 */
export async function collateralOf(
  accountId: bigint,
  asset: string,
): Promise<bigint> {
  const raw = await read(
    XOXNO_CONTROLLER,
    "get_collateral_amount",
    u64(accountId),
    hubAsset(asset),
  );
  return BigInt(raw as bigint);
}

// ------------------------------------------------------------------- writing

/**
 * Builds a controller call with room to actually run.
 *
 * Soroban transactions declare what they will cost before they run, and the
 * declaration comes from a simulation. For most contracts the simulation is
 * exact. It is not exact here: XOXNO's controller walks a spoke's whole asset
 * list, refreshes market indexes and prices, and touches the position NFT —
 * and a withdrawal simulated at the estimate came back
 * `RESOURCE_LIMIT_EXCEEDED` on chain, every time, while the same call with
 * headroom succeeded.
 *
 * So the estimate is treated as a floor: double the instruction budget, triple
 * the resource fee. The unspent part is refunded — Soroban charges what is
 * used, not what is declared — so the cost of being generous is nothing, and
 * the cost of being exact was a button that did not work.
 */
async function build(
  from: string,
  method: string,
  ...args: xdr.ScVal[]
): Promise<Transaction> {
  const account = await server().getAccount(from);
  const tx = new TransactionBuilder(account, { fee: FEE, networkPassphrase })
    .addOperation(new Contract(XOXNO_CONTROLLER).call(method, ...args))
    .setTimeout(180)
    .build();

  const sim = await server().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!("transactionData" in sim)) {
    throw new Error("The controller returned no execution plan for that call.");
  }

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

/**
 * Supplies an asset, creating the account if there is not one yet.
 *
 * Account id `0` is not an account — it is the protocol's way of saying "make
 * me one", and the call returns the id it minted. Which is why a caller that
 * has never supplied passes 0 and then has to go and find out what it got.
 */
export function buildSupply(
  from: string,
  accountId: bigint | null,
  asset: string,
  amount: bigint,
): Promise<Transaction> {
  return build(
    from,
    "supply",
    new Address(from).toScVal(),
    u64(accountId ?? 0n),
    u32(XOXNO_SPOKE_ID),
    xdr.ScVal.scvVec([entry(asset, amount)]),
  );
}

/**
 * Takes the whole position in one asset back out.
 *
 * `amount = 0` means "all of it", which is the protocol's own convention and
 * the only withdrawal this app offers. A partial withdrawal — a positive
 * amount smaller than the position — was rejected on chain every time it was
 * tried during this integration, while the full withdrawal succeeded every
 * time. Rather than ship a button that fails, the panel offers the one that
 * works and says so. Nothing is trapped either way: everything that goes in
 * can come out.
 */
export function buildWithdrawAll(
  from: string,
  accountId: bigint,
  asset: string,
): Promise<Transaction> {
  return build(
    from,
    "withdraw",
    new Address(from).toScVal(),
    u64(accountId),
    xdr.ScVal.scvVec([entry(asset, 0n)]),
    // `Some(from)`: pay it back to the person who asked. `None` failed on
    // chain in testing; naming the destination explicitly is clearer anyway.
    new Address(from).toScVal(),
  );
}
