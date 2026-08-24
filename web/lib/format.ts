import { SECONDS_PER_LEDGER } from "./config";

/** Every Stellar asset uses 7 decimals, native XLM included: 1 XLM = 10_000_000 stroops. */
export const DEFAULT_DECIMALS = 7;

/** Chain units to a human-readable amount. Never touches a float. */
export function fromUnits(units: bigint, decimals = DEFAULT_DECIMALS): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const s = frac ? `${whole}.${frac}` : whole.toString();
  return neg ? `-${s}` : s;
}

/**
 * Turns input like "12.5" into chain units.
 * Never goes through a float: the 0.1 + 0.2 problem is not acceptable in money.
 */
export function toUnits(input: string, decimals = DEFAULT_DECIMALS): bigint {
  const s = input.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") {
    throw new Error("That is not a valid amount.");
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) {
    throw new Error(`At most ${decimals} decimal places.`);
  }
  return BigInt((whole || "0") + frac.padEnd(decimals, "0"));
}

/**
 * Validates an amount without throwing — for live feedback while typing.
 * Returns null when the input is fine, or the reason it is not.
 */
export function amountProblem(
  input: string,
  balance: bigint | null,
  decimals = DEFAULT_DECIMALS,
  symbol = "",
): string | null {
  const s = input.trim();
  if (s === "") return null; // empty is not an error, it is just not ready yet
  let units: bigint;
  try {
    units = toUnits(s, decimals);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  if (units <= 0n) return "The amount has to be greater than zero.";
  if (balance !== null && units > balance) {
    return `That is more than your balance of ${fromUnits(balance, decimals)}${symbol ? ` ${symbol}` : ""}.`;
  }
  return null;
}

export function shortAddr(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** A ledger delta as rough wall-clock time — the chain has ledgers, not clocks. */
export function ledgersToHuman(ledgers: number): string {
  const secs = ledgers * SECONDS_PER_LEDGER;
  if (secs <= 0) return "expired";
  const d = Math.floor(secs / 86_400);
  if (d >= 1) return `~${d} ${d === 1 ? "day" : "days"}`;
  const h = Math.floor(secs / 3_600);
  if (h >= 1) return `~${h} ${h === 1 ? "hour" : "hours"}`;
  const m = Math.max(1, Math.floor(secs / 60));
  return `~${m} ${m === 1 ? "minute" : "minutes"}`;
}

/**
 * The approximate calendar date a ledger will close on.
 *
 * Deliberately vague in the UI ("around 20 Sept"): ledger close time drifts,
 * so promising an exact minute would be a lie the chain never made.
 */
export function ledgerToApproxDate(
  targetLedger: number,
  currentLedger: number,
): Date {
  const secs = (targetLedger - currentLedger) * SECONDS_PER_LEDGER;
  return new Date(Date.now() + secs * 1000);
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
