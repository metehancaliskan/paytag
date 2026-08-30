import { NextResponse, type NextRequest } from "next/server";
import { KIND, normalizeHandle } from "@/lib/identity";
import { isPayoutAddress } from "@/lib/payout";
import { callerIp } from "@/lib/caller";
import { lookupX, xLookupConfigured, type XLookup } from "@/lib/x";

export const runtime = "nodejs";

/**
 * "Is there an X account called this?" — asked here rather than in the browser,
 * because X will only answer a server holding an app-only token, and because
 * every answer costs $0.010 (docs/API-COSTS.md).
 *
 * This is the only endpoint in the product that spends money on being called.
 * The escrow routes move money that is already committed; this one draws on a
 * credit balance, from a page that needs no account. So the checks below are
 * not about correctness, they are about who is allowed to spend, and each one
 * exists because leaving it out has a price attached.
 *
 * WHY A CONNECTED WALLET RATHER THAN A SIGN-IN. Requiring an account would be
 * the stronger gate and it was the wrong one: /send needs no account by design
 * — paying a handle takes a wallet and nothing else — so a sign-in wall would
 * put the check out of reach of exactly the person it is for, the stranger
 * sending money to a handle for the first time. A wallet address is what that
 * person already has.
 *
 * And its limits are stated plainly rather than implied: the address is a
 * CLAIM, not a proof. Nothing here checks that the caller holds its key,
 * because doing so would mean a signature prompt before a spelling check, which
 * nobody would sit through. What it buys is that a caller has to produce a
 * well-formed, checksum-valid Stellar address and vary it to get a fresh
 * budget — enough to stop `curl` in a loop, not enough to stop somebody who
 * means it. That is why it is the third of four gates and not the only one; the
 * monthly cap in db/schema.sql is the one that actually bounds the bill.
 *
 * The reader never sees any of this fail as a failure. Every refusal below
 * answers 200 with `status: "unavailable"`, and the send page prints what it
 * printed before this endpoint existed: we cannot confirm this account, here is
 * the profile, look for yourself. A metered feature whose worst case is the
 * state we were already in is a feature that can be switched off at any time.
 */
export async function POST(request: NextRequest) {
  let body: { handle?: unknown; wallet?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  // A bad request is still a bad request — these answer 4xx, because they are
  // the caller's mistake and telling them so costs nothing.
  if (typeof body.handle !== "string") {
    return NextResponse.json({ error: "handle is required." }, { status: 400 });
  }

  // Whether this deployment offers the check at all, told to the browser
  // deliberately. It is not a secret — it is the difference between "we do not
  // do this here" and "we tried and could not", and a send page that cannot
  // tell those apart has to either stay silent when it should warn or warn
  // permanently, which is wallpaper. Nothing about the credential leaks: the
  // answer is a boolean about a feature, not about a key.
  const configured = xLookupConfigured();

  let handle: string;
  try {
    handle = normalizeHandle(body.handle, KIND.XUser);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid handle." },
      { status: 400 },
    );
  }

  // No wallet connected yet. A normal state, not an error: the reader can open
  // /send and check a handle before they have connected anything, and the page
  // says so rather than refusing. Only a wallet that is PRESENT and malformed
  // is a 400, because that is our own bug or somebody probing.
  const wallet = body.wallet;
  if (wallet === undefined || wallet === null || wallet === "") {
    return NextResponse.json(answer({ status: "unavailable", reason: "not_configured" }, configured));
  }
  // Checksum included. A malformed address is not a caller we can hold to a
  // limit — it is a free budget, one typo at a time.
  if (typeof wallet !== "string" || !isPayoutAddress(wallet)) {
    return NextResponse.json(
      { error: "That is not a valid Stellar account address." },
      { status: 400 },
    );
  }

  // No address, no limit, no lookup. This is the one refusal that is a flat no
  // rather than a degrade: a request nobody can count is the request an
  // attacker would want to make.
  const ip = callerIp(request.headers);
  if (!ip) {
    return NextResponse.json(
      answer({ status: "unavailable", reason: "not_configured" }, configured),
    );
  }

  return NextResponse.json(answer(await lookupX(handle, ip, wallet), configured));
}

/**
 * What the browser gets. Deliberately narrower than what `lookupX` knows:
 * `reason` is folded away and the numeric id is dropped.
 *
 * The id is the thing worth withholding. It is the value that does not change
 * when a handle does, so it is what a future transfer check would compare
 * against — the same role `external_id` plays for GitHub in lib/github.ts — and
 * it belongs in the database, not in a response anybody can enumerate. Nothing
 * on the send page draws it.
 */
function answer(result: XLookup, configured: boolean) {
  if (result.status === "found") {
    return {
      status: "found" as const,
      handle: result.handle,
      displayName: result.displayName,
      configured,
    };
  }
  if (result.status === "missing") {
    return { status: "missing" as const, handle: result.handle, configured };
  }
  return { status: "unavailable" as const, configured };
}
