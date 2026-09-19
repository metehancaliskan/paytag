// Talking to a Blend pool.
//
// Four calls do everything this product needs: `get_reserve_list` to learn
// which assets the pool takes and in what order, `get_reserve` for the rate
// that turns a position into an amount, `get_positions` for what somebody
// holds, and `submit` to move money in or out. BLND rewards come off a fifth,
// `claim`, which doubles as its own read: simulating it answers "how much has
// accrued" without spending anything.
//
// Hand-rolled rather than through Blend's SDK, for the same reason the escrow
// calls are: this file makes five calls against one contract, and a dependency
// that ships its own network layer, its own rate maths and its own idea of how
// to build a transaction is a lot of surface to take on for that.

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
import { BLEND_POOL_ID, RATE_SCALAR } from "./config";
import { networkPassphrase, readOnlySource, server } from "../stellar";

const INCLUSION_FEE = "1000000"; // Blend's writes are heavier than the escrow's

/**
 * The request types this app uses. Blend has ten; these four are ours.
 *
 * Supply and SupplyCollateral are two different positions, not two spellings
 * of one: collateral can be borrowed against and can be seized in a
 * liquidation, plain supply can be neither. We only ever CREATE plain supply —
 * see `assetRequest` — but we have to be able to READ and UNWIND collateral,
 * because a position made in Blend's own interface (which recommends
 * collateral) is the same person's money and must not be invisible here.
 */
export const REQUEST = {
  Supply: 0,
  Withdraw: 1,
  SupplyCollateral: 2,
  WithdrawCollateral: 3,
} as const;

export type Reserve = {
  asset: string;
  /** Position in `get_reserve_list`, which is how the pool names it everywhere. */
  index: number;
  /** bTokens → underlying, twelve decimal places. */
  bRate: bigint;
};

export type BlendPosition = {
  asset: string;
  index: number;
  /** Plain supply: lent, and nothing else. What this app creates. */
  supply: bigint;
  /** Collateral: lent and pledged. What Blend's own interface creates. */
  collateral: bigint;
  /** The two together, in the asset's own units — what the person has here. */
  underlying: bigint;
};

// ------------------------------------------------------------------- reading

async function read(method: string, ...args: xdr.ScVal[]): Promise<unknown> {
  const tx = new TransactionBuilder(readOnlySource(), {
    fee: INCLUSION_FEE,
    networkPassphrase,
  })
    .addOperation(new Contract(BLEND_POOL_ID).call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!sim.result) throw new Error(`${method}: the pool returned nothing`);
  return scValToNative(sim.result.retval);
}

/** Which assets this pool takes, in the order it indexes them. */
export async function reserveAssets(): Promise<string[]> {
  const list = (await read("get_reserve_list")) as string[];
  return list.map(String);
}

export async function loadReserve(
  asset: string,
  index: number,
): Promise<Reserve> {
  const raw = (await read("get_reserve", new Address(asset).toScVal())) as {
    data?: { b_rate?: unknown };
    b_rate?: unknown;
  };
  const bRate = (raw.data?.b_rate ?? raw.b_rate) as bigint | undefined;
  if (bRate === undefined) {
    throw new Error(`The pool gave no rate for ${asset}.`);
  }
  return { asset, index, bRate: BigInt(bRate) };
}

/**
 * What one address holds in this pool, counting both kinds of position.
 *
 * Reading only `supply` was a bug with a real victim: somebody who had already
 * lent through Blend's own interface holds `collateral`, and this panel showed
 * them nothing. Their money was exactly where they left it; our reader was
 * looking in one of the two places it could be.
 */
export async function loadPositions(
  owner: string,
  reserves: readonly Reserve[],
): Promise<BlendPosition[]> {
  const raw = (await read("get_positions", new Address(owner).toScVal())) as {
    supply?: Record<string | number, bigint>;
    collateral?: Record<string | number, bigint>;
  };

  const at = (m: Record<string | number, bigint> | undefined, i: number) =>
    BigInt(m?.[i] ?? m?.[String(i)] ?? 0n);

  return reserves.flatMap((r) => {
    const supply = toUnderlying(at(raw.supply, r.index), r.bRate);
    const collateral = toUnderlying(at(raw.collateral, r.index), r.bRate);
    if (supply === 0n && collateral === 0n) return [];
    return [
      {
        asset: r.asset,
        index: r.index,
        supply,
        collateral,
        underlying: supply + collateral,
      },
    ];
  });
}

/**
 * BLND accrued but not yet taken, read by simulating the call that takes it.
 *
 * A simulation runs the contract without submitting anything, so the number it
 * returns is the number the real call would pay out at this ledger. Nothing is
 * spent and nothing is claimed — it is the only honest way to show a reward
 * that the pool tracks but does not store as a balance.
 */
export async function accruedRewards(
  owner: string,
  reserveTokenIds: readonly number[],
): Promise<bigint> {
  if (reserveTokenIds.length === 0) return 0n;
  const addr = new Address(owner).toScVal();
  const raw = await read(
    "claim",
    addr,
    nativeToScVal(reserveTokenIds, { type: "u32" }),
    addr,
  );
  return BigInt(raw as bigint);
}

// ------------------------------------------------------------------- writing

/**
 * One request in a `submit` call.
 *
 * We only ever build `Supply`, never `SupplyCollateral`. Blend's integration
 * guide recommends collateral for most users because most users may want to
 * borrow against what they lend; nobody arriving here from a claim screen
 * wants to borrow, and the weaker position — one that cannot be pledged and
 * cannot be seized — is the safer one to hand somebody by default.
 */
function assetRequest(type: number, asset: string, amount: bigint): xdr.ScVal {
  return nativeToScVal(
    { request_type: type, address: new Address(asset), amount },
    {
      type: {
        request_type: ["symbol", "u32"],
        address: ["symbol", "address"],
        amount: ["symbol", "i128"],
      },
    },
  );
}

async function submitTx(
  from: string,
  requests: xdr.ScVal[],
): Promise<Transaction> {
  if (requests.length === 0) throw new Error("Nothing to do.");
  const account = await server().getAccount(from);
  const addr = new Address(from).toScVal();

  const tx = new TransactionBuilder(account, {
    fee: INCLUSION_FEE,
    networkPassphrase,
  })
    .addOperation(
      // from, spender and to are all the same person here. They differ only
      // when one account pays for another's position, which this app never does.
      new Contract(BLEND_POOL_ID).call(
        "submit",
        addr,
        addr,
        addr,
        xdr.ScVal.scvVec(requests),
      ),
    )
    .setTimeout(180)
    .build();

  return await server().prepareTransaction(tx);
}

export function buildSupply(
  from: string,
  asset: string,
  amount: bigint,
): Promise<Transaction> {
  return submitTx(from, [assetRequest(REQUEST.Supply, asset, amount)]);
}

/**
 * Takes the asset back out, with the interest it earned.
 *
 * An amount larger than a position is not an error: the pool pulls the request
 * down to whatever that position is worth. That is what makes "take it all
 * back" expressible at all — the figure grows with every ledger, so asking for
 * more than there is and letting the pool settle it is the only way to empty a
 * position without racing it.
 *
 * Both kinds come out in ONE transaction when both exist, because `submit`
 * takes a list. Two transactions would mean two wallet prompts to undo what
 * reads on screen as a single thing.
 */
export function buildWithdraw(
  from: string,
  asset: string,
  amounts: { supply: bigint; collateral: bigint },
): Promise<Transaction> {
  const requests: xdr.ScVal[] = [];
  if (amounts.supply > 0n) {
    requests.push(assetRequest(REQUEST.Withdraw, asset, amounts.supply));
  }
  if (amounts.collateral > 0n) {
    requests.push(
      assetRequest(REQUEST.WithdrawCollateral, asset, amounts.collateral),
    );
  }
  return submitTx(from, requests);
}

/**
 * How much to ask back from each kind, to take `want` out in total.
 *
 * Plain supply first: it is the position this app made, it is the weaker one,
 * and leaving collateral in place for as long as possible is the right default
 * for somebody who may be borrowing against it in Blend's own interface. Pure
 * arithmetic, and tested as such.
 */
export function splitWithdraw(
  want: bigint,
  position: { supply: bigint; collateral: bigint },
): { supply: bigint; collateral: bigint } {
  const supply = want < position.supply ? want : position.supply;
  const rest = want - supply;
  const collateral = rest < position.collateral ? rest : position.collateral;
  return { supply, collateral };
}

export async function buildClaim(
  from: string,
  reserveTokenIds: readonly number[],
): Promise<Transaction> {
  const account = await server().getAccount(from);
  const addr = new Address(from).toScVal();

  const tx = new TransactionBuilder(account, {
    fee: INCLUSION_FEE,
    networkPassphrase,
  })
    .addOperation(
      new Contract(BLEND_POOL_ID).call(
        "claim",
        addr,
        nativeToScVal(reserveTokenIds, { type: "u32" }),
        addr,
      ),
    )
    .setTimeout(180)
    .build();

  return await server().prepareTransaction(tx);
}

// --------------------------------------------------------------------- maths

/**
 * bTokens → the asset they stand for.
 *
 * Integer arithmetic, floored. A position is worth what the pool will pay for
 * it, and rounding a displayed balance up by one stroop invites a withdrawal
 * that asks for more than exists.
 */
export function toUnderlying(bTokens: bigint, bRate: bigint): bigint {
  return (bTokens * bRate) / RATE_SCALAR;
}

/** The other direction, for showing what a deposit would become. */
export function toBTokens(underlying: bigint, bRate: bigint): bigint {
  if (bRate === 0n) return 0n;
  return (underlying * RATE_SCALAR) / bRate;
}

/**
 * The id the pool uses when talking about emissions on a position.
 *
 * Two ids per reserve, and they are not interchangeable: the even one is the
 * debt side, the odd one is the supply side. Claiming with the wrong one asks
 * about rewards for a position nobody here holds, and answers zero — a silent
 * wrong answer rather than an error, which is why it is derived in one place.
 */
export function supplyEmissionId(reserveIndex: number): number {
  return reserveIndex * 2 + 1;
}

export function borrowEmissionId(reserveIndex: number): number {
  return reserveIndex * 2;
}
