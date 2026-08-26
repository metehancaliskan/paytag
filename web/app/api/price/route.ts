import { NextResponse } from "next/server";
import { PRICE_TTL_SECONDS } from "@/lib/config";

export const runtime = "nodejs";
// Next caches the response for this long, so a page full of components asking
// for the rate costs one upstream request per minute, not one per render.
// The handler itself reads no dynamic API, so without this the GET is
// prerendered at build and the first minute of traffic after a deploy gets the
// build-time rate. The inner fetch does the real caching.
export const dynamic = "force-dynamic";

export const revalidate = 60;

/**
 * The XLM/USD rate, fetched server-side.
 *
 * Server-side for two boring reasons: the browser would hit CORS, and every
 * visitor's browser calling a public price API from its own IP is the fastest
 * way to get rate-limited. One cached call per minute serves everyone.
 *
 * This is a mainnet market rate even when the app runs on testnet. The testnet
 * XLM in escrow is worth nothing at all, so the dollar figure there is a
 * dressed-up placeholder. The upstream provider is deliberately NOT named in
 * the response or anywhere in the interface: which service we happen to ask is
 * an implementation detail, and printing it invites a reader to treat the
 * number as a quote. What the interface says instead is that the figure is
 * approximate and that the escrow holds XLM — the honest part, kept.
 */
export async function GET() {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
      {
        headers: { Accept: "application/json" },
        next: { revalidate: PRICE_TTL_SECONDS },
      },
    );
    if (!res.ok) throw new Error(`price source returned ${res.status}`);

    const body = (await res.json()) as { stellar?: { usd?: number } };
    const usd = body.stellar?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
      throw new Error("price source returned no usable number");
    }

    return NextResponse.json({
      usdPerXlm: usd,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    // A missing rate must not block sending. The UI falls back to entering an
    // XLM amount directly, which needs no rate at all — degraded, still usable,
    // and honest about which of the two it is doing.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "price unavailable" },
      { status: 503 },
    );
  }
}
