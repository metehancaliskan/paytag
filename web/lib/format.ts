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
 * The same amount, for a glance: whole tokens, thousands grouped, no decimals.
 *
 * For the header chip, where seven decimal places are noise — nobody reads
 * "9973.9455807" as a quantity, they read the first four characters. It FLOORS
 * rather than rounds: a balance shown higher than it is invites a transaction
 * that fails, and "at least this much" is the only safe direction to lie in.
 *
 * The exact figure has to stay one click away (the account menu prints it in
 * full), for the same reason a shortened hash always keeps a copy button.
 */
export function wholeUnits(units: bigint, decimals = DEFAULT_DECIMALS): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / 10n ** BigInt(decimals);
  return (neg ? "-" : "") + whole.toLocaleString("en-US");
}

/**
 * An amount as the interface shows it: whole tokens, no decimals.
 *
 * Seven decimal places are what the chain stores, not what a person reads —
 * "26.1643118 XLM" is four characters of quantity and six of noise. So every
 * human-facing amount is floored to whole tokens, and the exact figure stays
 * reachable: a `title` on the element, the explorer link beside it, and the
 * account menu for a balance.
 *
 * Below one token it falls back to the exact value. Flooring 0.42 to "0" would
 * not be brevity, it would be wrong — and a sub-unit amount is already short.
 */
export function displayUnits(
  units: bigint,
  decimals = DEFAULT_DECIMALS,
): string {
  const abs = units < 0n ? -units : units;
  return abs >= 10n ** BigInt(decimals)
    ? wholeUnits(units, decimals)
    : fromUnits(units, decimals);
}

/**
 * Cents → a dollar figure short enough to sit in parentheses.
 *
 * Under ten dollars the cents are the information ("$4.05"); above it they are
 * three characters of noise on a number that is an estimate anyway ("$1,213").
 */
export function usdGlance(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const sign = neg ? "-" : "";
  if (abs < 1000n) {
    const whole = abs / 100n;
    const rest = (abs % 100n).toString().padStart(2, "0");
    return `${sign}$${whole}.${rest}`;
  }
  return `${sign}$${(abs / 100n).toLocaleString("en-US")}`;
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
