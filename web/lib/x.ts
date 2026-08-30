import "server-only";

import { adminSupabase } from "./supabase/server";
import { callerHash } from "./caller";
import { isFresh, parseXUser } from "./x-parse";
import {
  X_LOOKUP_CACHE_DAYS,
  X_LOOKUP_MONTHLY_CAP,
  X_LOOKUP_PER_CALLER,
  X_LOOKUP_WINDOW_HOURS,
} from "./config";

/**
 * "Is there an X account with this name?" — the one question on the send page
 * that costs money to answer.
 *
 * GitHub answers the same question for free, from the visitor's own browser,
 * against the visitor's own rate limit (lib/github.ts). X will not: the call
 * needs an app-only bearer token, so it has to come from here, and it bills
 * $0.010 to our credit balance with no free allowance. That single difference
 * is why this file is four times the size of its GitHub counterpart. Everything
 * past the fetch is about making sure the question is asked as rarely as
 * possible and can never be asked more times than we have agreed to pay for.
 *
 * The gates, in the order they run — the first three are free, and only a
 * request that clears all of them reaches the fourth:
 *
 *   1. Is the feature on at all? No bearer token, no lookups. A deployment
 *      that has not chosen to spend money does not spend money.
 *   2. Do we already know? A cached answer is free and, for a fact that changes
 *      about once in an account's lifetime, just as true. This is the gate that
 *      makes the feature cheap in normal use; the rest make the abnormal case
 *      survivable.
 *   3. Is there budget? `x_lookup_claim` answers and records in one statement —
 *      see db/schema.sql. It writes the row BEFORE we spend, so a crash
 *      overcounts by one rather than losing the record of a cent.
 *   4. Ask X.
 *
 * Three answers, never two, and the third is the one that matters:
 *
 *   found        there is such an account
 *   missing      there is not — the send page refuses on this one
 *   unavailable  we did not ask, or asked and got nothing back
 *
 * `unavailable` covers "the feature is off", "the budget is spent" and "X was
 * down", and the send page says the same honest thing for all three: we could
 * not confirm this account, here is the link, look with your own eyes. That is
 * exactly the behaviour the page had before this file existed, which is the
 * property worth keeping — the worst case of a metered feature is the state we
 * were already in, not a broken page.
 */

export type XLookup =
  | { status: "found"; handle: string; externalId: string; displayName: string | null }
  | { status: "missing"; handle: string }
  | { status: "unavailable"; reason: XUnavailable };

/** Why we have no answer. The route maps these onto status codes. */
export type XUnavailable =
  | "not_configured" // no bearer token, or no Supabase to cache and count with
  | "rate_limited" // this caller has spent their window
  | "budget_spent" // the deployment has spent its month
  | "upstream"; // X was asked and did not answer usefully

const X_API = "https://api.x.com/2/users/by/username";

function bearer(): string | null {
  return process.env.X_API_BEARER?.trim() || null;
}

function salt(): string | null {
  return process.env.RATE_LIMIT_IP_SALT?.trim() || null;
}

/**
 * The cap, tunable without a deploy because the right number is not knowable in
 * advance — it depends on traffic nobody has seen yet. The constant in
 * config.ts is the default and the documented figure; the environment can only
 * be read here, on the server, which is the point.
 */
function monthlyCap(): number {
  const raw = Number(process.env.X_LOOKUP_MONTHLY_CAP?.trim());
  return Number.isInteger(raw) && raw > 0 ? raw : X_LOOKUP_MONTHLY_CAP;
}

/** Is this deployment able to answer the question at all? */
export function xLookupConfigured(): boolean {
  return bearer() !== null && salt() !== null && adminSupabase() !== null;
}

// --------------------------------------------------------------- the flow

/**
 * @param handle  already normalized by `normalizeHandle(raw, KIND.XUser)`.
 * @param ip      the caller's address, or null when it could not be read.
 * @param wallet  the Stellar address the caller has connected. Checked for
 *                shape and checksum by the route before it gets here. It is a
 *                claim, not a proof — see the route for why that is still worth
 *                requiring.
 */
export async function lookupX(
  handle: string,
  ip: string,
  wallet: string,
): Promise<XLookup> {
  const token = bearer();
  const pepper = salt();
  const admin = adminSupabase();
  if (!token || !pepper || !admin) {
    return { status: "unavailable", reason: "not_configured" };
  }

  // 1. Cached? Free, and the answer most requests get.
  const { data: cached } = await admin
    .from("x_profiles")
    .select("found, external_id, display_name, fetched_at")
    .eq("handle", handle)
    .maybeSingle();

  if (cached && isFresh(cached.fetched_at as string | null, new Date(), X_LOOKUP_CACHE_DAYS)) {
    return cached.found
      ? {
          status: "found",
          handle,
          externalId: String(cached.external_id),
          displayName: (cached.display_name as string | null) ?? null,
        }
      : { status: "missing", handle };
  }

  // 2. Budget. The row is written here, before the money is spent, and that
  //    order is the point — see db/schema.sql. A failure to reach the database
  //    is not a licence to spend: no permission means no lookup.
  const { data: verdict, error: claimError } = await admin.rpc("x_lookup_claim", {
    p_handle: handle,
    p_ip_hash: callerHash(ip, pepper),
    p_wallet_hash: callerHash(wallet, pepper),
    p_per_caller: X_LOOKUP_PER_CALLER,
    p_window: `${X_LOOKUP_WINDOW_HOURS} hours`,
    p_monthly_cap: monthlyCap(),
  });

  if (claimError || typeof verdict !== "string") {
    return { status: "unavailable", reason: "not_configured" };
  }
  if (verdict === "global") {
    return { status: "unavailable", reason: "budget_spent" };
  }
  if (verdict !== "ok") {
    return { status: "unavailable", reason: "rate_limited" };
  }

  // 3. Spend it.
  const answer = await askX(handle, token);
  if (answer === null) {
    // The row stays. We asked, the attempt is on the meter whether or not X
    // charged for it, and quietly refunding a budget on every upstream error
    // would make "X is failing" the cheapest way to get unlimited retries.
    return { status: "unavailable", reason: "upstream" };
  }

  const row =
    answer === "missing"
      ? { handle, found: false, external_id: null, display_name: null }
      : {
          handle,
          found: true,
          external_id: answer.id,
          display_name: answer.name,
        };

  // Cache failures are not reported to the reader: the answer is in hand and
  // correct, and the only cost of not storing it is paying for the same
  // question again later.
  await admin.from("x_profiles").upsert({ ...row, fetched_at: new Date().toISOString() });

  return answer === "missing"
    ? { status: "missing", handle }
    : {
        status: "found",
        handle,
        externalId: answer.id,
        displayName: answer.name,
      };
}

/** The one paid call. Null means "no usable answer", never "no such account". */
async function askX(
  handle: string,
  token: string,
): Promise<{ id: string; username: string; name: string | null } | "missing" | null> {
  try {
    const res = await fetch(
      `${X_API}/${encodeURIComponent(handle)}?user.fields=name`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );

    // 404 is X's other way of saying the same thing the 200-with-errors body
    // says. 401/403 mean our token is wrong and 429 means X is throttling us —
    // all of those are our problem, not evidence about the account.
    if (res.status === 404) return "missing";
    if (!res.ok) return null;

    return parseXUser(await res.json());
  } catch {
    return null;
  }
}
