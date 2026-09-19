// SEP-6 — the deposit itself, and then waiting.
//
// The shape of an on-ramp: ask the anchor to expect money, get bank details
// and a reference code back, send the lira through the normal banking system,
// and the anchor pays the asset on Stellar when it arrives. Nothing about the
// bank leg is on chain and nothing about it is ours; our side is a request, a
// set of instructions to show, and a status to watch.
//
// One endpoint here is NOT part of the standard: `simulate-bank-transfer`,
// which stands in for the bank on a sandbox anchor. It is kept apart from the
// standard calls and named for what it is, so that moving to a real anchor is
// deleting one button rather than untangling a flow.

import type { TokenGetter } from "./auth";
import { POLL_ATTEMPTS, POLL_INTERVAL_MS } from "./config";
import type { AnchorInfo } from "./toml";

/**
 * Either a token, or something that can produce one.
 *
 * A bare string is fine for a single call made immediately. Anything that
 * waits — the poll loop, above all — should be handed a getter, because the
 * anchor's JWT can expire in the middle of a bank transfer and re-signing is
 * one wallet prompt against a flow that otherwise dead-ends.
 */
export type Auth = string | TokenGetter;

export type DepositInstructions = {
  id: string;
  /** One-line human summary, when the anchor gives one. */
  how: string | null;
  /** Field by field: bank name, IBAN, the reference to write on the transfer. */
  fields: { label: string; value: string; description: string | null }[];
  moreInfoUrl: string | null;
  /** Sandbox only: present when this anchor can pretend the bank paid. */
  simulateUrl: string | null;
};

export type AnchorTransaction = {
  id: string;
  status: string;
  message: string | null;
  moreInfoUrl: string | null;
  amountIn: string | null;
  amountInAsset: string | null;
  amountOut: string | null;
  amountOutAsset: string | null;
  fee: string | null;
  stellarTransactionId: string | null;
  externalTransactionId: string | null;
};

export type Sep6Limits = {
  min: number | null;
  max: number | null;
  feePercent: number | null;
};

/** What the anchor will do for this asset, and between which amounts. */
export async function depositLimits(
  anchor: AnchorInfo,
): Promise<Sep6Limits> {
  const res = await fetch(`${anchor.transferServer}/info`);
  const body = (await res.json().catch(() => ({}))) as {
    deposit?: Record<
      string,
      { min_amount?: number; max_amount?: number; fee_percent?: number }
    >;
  };
  const d = body.deposit?.[anchor.assetCode];
  return {
    min: d?.min_amount ?? null,
    max: d?.max_amount ?? null,
    feePercent: d?.fee_percent ?? null,
  };
}

/**
 * Tells the anchor to expect a bank transfer, and returns what to send where.
 *
 * `amount` is in the FIAT currency — it is what leaves the person's bank
 * account. The asset amount is the anchor's arithmetic, reported back on the
 * transaction record once the money lands.
 */
export async function startDeposit(
  anchor: AnchorInfo,
  auth: Auth,
  account: string,
  fiatAmount: string,
): Promise<DepositInstructions> {
  const url =
    `${anchor.transferServer}/deposit?` +
    new URLSearchParams({
      asset_code: anchor.assetCode,
      account,
      amount: fiatAmount,
      type: "bank_account",
    });

  const body = await anchorJson(url, auth, "start the deposit");
  const id = typeof body.id === "string" ? body.id : null;
  if (!id) throw new Error("The anchor did not return a deposit id.");

  return {
    id,
    how: typeof body.how === "string" ? body.how : null,
    fields: readInstructions(body.instructions),
    moreInfoUrl:
      typeof body.more_info_url === "string" ? body.more_info_url : null,
    simulateUrl: `${anchor.transferServer}/tx/${id}/simulate-bank-transfer`,
  };
}

export type WithdrawInstructions = {
  id: string;
  /** Where the asset has to be sent. The anchor's own Stellar account. */
  accountId: string;
  /**
   * The memo, and the reason the off-ramp is not just a payment.
   *
   * Every customer of the anchor pays into the SAME account, so the memo is
   * the only thing that says whose transfer this is. A payment that arrives
   * without it, or with the wrong one, is money the anchor cannot attribute.
   */
  memo: string;
  memoType: string;
  moreInfoUrl: string | null;
};

/** What the anchor will take back, and between which amounts. */
export async function withdrawLimits(anchor: AnchorInfo): Promise<Sep6Limits> {
  const res = await fetch(`${anchor.transferServer}/info`);
  const body = (await res.json().catch(() => ({}))) as {
    withdraw?: Record<
      string,
      { min_amount?: number; max_amount?: number; fee_percent?: number }
    >;
  };
  const w = body.withdraw?.[anchor.assetCode];
  return {
    min: w?.min_amount ?? null,
    max: w?.max_amount ?? null,
    feePercent: w?.fee_percent ?? null,
  };
}

/**
 * Asks the anchor to expect the asset back, and pay out lira for it.
 *
 * `amount` is in the STELLAR asset here, not the fiat — it is what leaves the
 * wallet. The mirror of `startDeposit`, where the amount is what leaves the
 * bank. Getting these two the wrong way round is the easiest mistake in a SEP
 * integration and the hardest to see: both are numbers, and both endpoints
 * accept either without complaint.
 */
export async function startWithdraw(
  anchor: AnchorInfo,
  auth: Auth,
  assetAmount: string,
): Promise<WithdrawInstructions> {
  const url =
    `${anchor.transferServer}/withdraw?` +
    new URLSearchParams({
      asset_code: anchor.assetCode,
      type: "bank_account",
      amount: assetAmount,
    });

  const body = await anchorJson(url, auth, "start the withdrawal");

  const id = str(body.id);
  const accountId = str(body.account_id);
  const memo = str(body.memo);
  if (!id || !accountId || !memo) {
    throw new Error(
      "The anchor did not say where to send the money. Nothing was sent.",
    );
  }

  return {
    id,
    accountId,
    memo,
    memoType: str(body.memo_type) ?? "id",
    moreInfoUrl: str(body.more_info_url),
  };
}

export async function getTransaction(
  anchor: AnchorInfo,
  auth: Auth,
  id: string,
): Promise<AnchorTransaction> {
  const body = await anchorJson(
    `${anchor.transferServer}/transaction?id=${encodeURIComponent(id)}`,
    auth,
    "read the transaction",
  );
  const t = (body.transaction ?? body) as Record<string, unknown>;

  return {
    id: String(t.id ?? id),
    status: String(t.status ?? "unknown"),
    message: str(t.message),
    moreInfoUrl: str(t.more_info_url),
    amountIn: str(t.amount_in),
    amountInAsset: str(t.amount_in_asset),
    amountOut: str(t.amount_out),
    amountOutAsset: str(t.amount_out_asset),
    fee: str(t.amount_fee),
    stellarTransactionId: str(t.stellar_transaction_id),
    externalTransactionId: str(t.external_transaction_id),
  };
}

/**
 * SANDBOX ONLY. Pretends the bank transfer arrived.
 *
 * Deposits only — the off-ramp needs no equivalent, because its trigger is a
 * real payment on a real (test) network. That asymmetry is worth noticing: the
 * half of the ramp that is simulated here is exactly the half a real anchor
 * replaces with a bank, and the Stellar half is already the production one.
 *
 * On a real anchor this call does not exist and this step is a person opening
 * their banking app. Kept as its own function, with this comment, so nobody
 * later mistakes it for part of the standard.
 */
export async function simulateBankTransfer(
  anchor: AnchorInfo,
  auth: Auth,
  id: string,
  fiatAmount: string,
): Promise<void> {
  const send = (token: string) =>
    fetch(`${anchor.transferServer}/tx/${id}/simulate-bank-transfer`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: fiatAmount }),
    });

  let res = await send(await bearer(auth));
  if (rejectedTheToken(res.status) && typeof auth === "function") {
    res = await send(await auth(true));
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "The sandbox could not simulate the transfer.");
  }
}

/**
 * Watches one transaction until it stops moving.
 *
 * `onUpdate` fires on every reading, not only the last, because the statuses
 * on the way are the interesting part: this is a flow where the honest answer
 * for a minute at a time is "the anchor is working on it", and a spinner that
 * says nothing is how people conclude a payment has been lost.
 *
 * This is the call that most needs a token getter rather than a token. The
 * wait here is a bank transfer clearing, which can outlast a SEP-10 JWT; with
 * a getter each reading carries a token that is valid when it is made.
 */
export async function pollTransaction(
  anchor: AnchorInfo,
  auth: Auth,
  id: string,
  onUpdate: (tx: AnchorTransaction) => void,
  shouldStop: () => boolean = () => false,
): Promise<AnchorTransaction> {
  let last: AnchorTransaction | null = null;

  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    if (shouldStop()) break;
    last = await getTransaction(anchor, auth, id);
    onUpdate(last);
    if (isFinal(last.status)) return last;
    await sleep(POLL_INTERVAL_MS);
  }

  if (!last) throw new Error("The anchor never answered about this transfer.");
  return last;
}

// ------------------------------------------------------------------ statuses

/** Nothing else will happen without somebody doing something. */
export function isFinal(status: string): boolean {
  return status === "completed" || status === "error" || status === "refunded";
}

/** Is the anchor waiting on the PERSON rather than on itself? */
export function needsUser(status: string): boolean {
  return (
    status === "pending_user_transfer_start" ||
    status === "pending_trust" ||
    status === "incomplete"
  );
}

/**
 * The status as a sentence.
 *
 * SEP-6 statuses are precise and unreadable — `pending_user_transfer_start` is
 * a correct name for "we are waiting for your money" and a useless thing to
 * print on a screen. The anchor's own `message` is preferred when it sends
 * one, because it knows more than we do; this is the fallback.
 */
export function describeStatus(status: string): string {
  switch (status) {
    case "incomplete":
      return "The anchor needs more information before it can continue.";
    case "pending_user_transfer_start":
      return "Waiting for your bank transfer to arrive.";
    case "pending_user_transfer_complete":
      return "Your transfer has been sent; the anchor is confirming it.";
    case "pending_anchor":
      return "The anchor received the money and is paying out on Stellar.";
    case "pending_stellar":
      return "The payment is on its way over Stellar.";
    case "pending_external":
      return "Waiting on the banking system.";
    case "pending_trust":
      return "Your wallet cannot hold this asset yet — it needs a trustline. The anchor pays as soon as there is one.";
    case "pending_customer_info_update":
      return "The anchor is asking for more details about you.";
    case "completed":
      return "Done.";
    case "refunded":
      return "The anchor sent the money back.";
    case "error":
      return "The anchor could not finish this transfer.";
    default:
      return `The anchor reports: ${status}.`;
  }
}

// ------------------------------------------------------------------- helpers

/** The token this call should carry, asking for one if we were given a getter. */
async function bearer(auth: Auth, force = false): Promise<string> {
  return typeof auth === "string" ? auth : auth(force);
}

/**
 * The anchor is saying the credential is the problem, not the request.
 *
 * 403 is included because anchors are not consistent about which of the two
 * they use for a spent token, and the cost of being wrong is one extra
 * signature rather than a lost transfer.
 */
function rejectedTheToken(status: number): boolean {
  return status === 401 || status === 403;
}

async function anchorJson(
  url: string,
  auth: Auth,
  what: string,
): Promise<Record<string, unknown>> {
  const get = async (token: string) => {
    try {
      return await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new Error(`Could not reach the anchor to ${what}.`);
    }
  };

  let res = await get(await bearer(auth));

  // One retry, and only with a genuinely new signature. A getter that hands
  // back the same cached token would turn this into two identical failures,
  // which is why `force` exists on the other side.
  if (rejectedTheToken(res.status) && typeof auth === "function") {
    res = await get(await auth(true));
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const said = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(`The anchor refused to ${what}: ${said}`);
  }
  return body;
}

/**
 * The `instructions` object, flattened for display.
 *
 * SEP-6 sends a map of field name to `{ value, description }`, and the field
 * names are machine names (`bank_account_number`). They are turned into words
 * here rather than in the component, so that an anchor sending a field we have
 * never seen still renders as something readable instead of being dropped.
 */
export function readInstructions(raw: unknown): DepositInstructions["fields"] {
  if (!raw || typeof raw !== "object") return [];

  return Object.entries(raw as Record<string, unknown>).flatMap(
    ([key, entry]) => {
      if (!entry || typeof entry !== "object") return [];
      const { value, description } = entry as {
        value?: unknown;
        description?: unknown;
      };
      if (typeof value !== "string" || value === "") return [];
      return [
        {
          label: humanise(key),
          value,
          description: typeof description === "string" ? description : null,
        },
      ];
    },
  );
}

/** `bank_account_number` -> `Bank account number`. */
export function humanise(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
