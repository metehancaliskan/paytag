import { DEFAULT_DECIMALS } from "./format";

/**
 * The XLM/USD rate, and the arithmetic that turns dollars into stroops.
 *
 * What this is NOT: an oracle. Nothing on chain reads this number, no contract
 * decision depends on it, and no balance is denominated in it. The escrow holds
 * XLM; the dollar figure exists only so a person typing "25" knows roughly what
 * they are sending. If the rate moves, the XLM in escrow does not change — the
 * recipient claims the XLM amount, whatever it is worth by then. The UI has to
 * say that out loud, because "$25" implies a promise the chain never made.
 */

export type Price = {
  /** Dollars per 1 XLM. */
  usdPerXlm: number;
  /** Where the number came from, shown to the reader rather than hidden. */
  source: string;
  /** Unix millis when the rate was fetched. */
  fetchedAt: number;
};

/** Cents per dollar — the working unit for USD, so no float ever holds money. */
const CENTS = 100n;

/**
 * "25", "25.40", "25,4" → cents as a BigInt.
 *
 * Same rule as the amount field: money never touches a float. Two decimals,
 * because that is what a dollar has.
 */
export function usdToCents(input: string): bigint {
  const s = input.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") {
    throw new Error("That is not a valid dollar amount.");
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 2) {
    throw new Error("At most two decimal places for a dollar amount.");
  }
  return BigInt((whole || "0") + frac.padEnd(2, "0"));
}

export function centsToUsd(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / CENTS;
  const rest = (abs % CENTS).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${rest}`;
}

/**
 * Dollars (in cents) → token units, at the given rate.
 *
 * The rate arrives as a float because that is what a price API returns, so it
 * is converted to an integer numerator ONCE, here, and every step after that is
 * exact. Rounding is toward zero: sending a hair less than the typed dollar
 * amount can never overdraw a balance, while rounding up could.
 */
export function centsToUnits(
  cents: bigint,
  usdPerToken: number,
  decimals = DEFAULT_DECIMALS,
): bigint {
  if (!Number.isFinite(usdPerToken) || usdPerToken <= 0) {
    throw new Error("No usable exchange rate.");
  }
  // 1e8 is comfortably finer than any realistic quote and stays well inside
  // Number's exact-integer range.
  const SCALE = 100_000_000n;
  const rateScaled = BigInt(Math.round(usdPerToken * Number(SCALE)));
  if (rateScaled <= 0n) throw new Error("The exchange rate rounded to zero.");

  const scale = 10n ** BigInt(decimals);
  // units = (cents / 100) / usdPerToken * 10^decimals
  return (cents * scale * SCALE) / (CENTS * rateScaled);
}

/** Token units → cents, for showing what an existing escrow is worth today. */
export function unitsToCents(
  units: bigint,
  usdPerToken: number,
  decimals = DEFAULT_DECIMALS,
): bigint {
  if (!Number.isFinite(usdPerToken) || usdPerToken <= 0) return 0n;
  const SCALE = 100_000_000n;
  const rateScaled = BigInt(Math.round(usdPerToken * Number(SCALE)));
  const scale = 10n ** BigInt(decimals);
  return (units * rateScaled * CENTS) / (scale * SCALE);
}

/** A rate formatted for the one line that explains the conversion. */
export function formatRate(p: Price): string {
  return `1 XLM = $${p.usdPerXlm.toFixed(4)}`;
}
