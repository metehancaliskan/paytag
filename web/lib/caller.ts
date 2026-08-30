import "server-only";

import { createHash } from "node:crypto";

/**
 * Who is asking, for the purpose of counting — and no further than that.
 *
 * The X lookup endpoint has to tell two callers apart so it can hold each of
 * them to a limit. It does NOT need to know who they are, and the difference is
 * the whole design of this file: what reaches the database is a salted digest,
 * so `x_lookups` can bound a bill without becoming a record of which visitor
 * asked about which handle.
 *
 * The salt lives in the environment. Without it the digest of an IP address
 * would be trivially reversible — the whole IPv4 space is four billion hashes,
 * an afternoon's work — and the table would be a list of visitors wearing a
 * disguise that fools nobody.
 */

/** Hex sha256 of `salt ‖ value`. Not a password hash; it does not need to be. */
export function callerHash(value: string, salt: string): string {
  return createHash("sha256").update(salt).update("\0").update(value).digest("hex");
}

/**
 * The client's address, as far as it can be known behind a proxy.
 *
 * `x-forwarded-for` is a LIST: each proxy appends, so the leftmost entry is
 * what the first proxy saw and everything after it is infrastructure. Vercel
 * puts the real client first, which is why the first entry is the one taken —
 * but that is a fact about the deployment, not about the header. Anyone can
 * send an `x-forwarded-for` of their choosing to an origin that is not behind a
 * proxy that overwrites it.
 *
 * So this is a soft signal and it is treated as one: it is a per-caller limit
 * layered under a global cap, not the thing that bounds the bill. If it can be
 * spoofed, the monthly cap still holds, and that ordering is deliberate.
 *
 * `x-real-ip` is the fallback for platforms that set only that one. A missing
 * address answers null and the caller decides — the route refuses, because a
 * request with no address at all cannot be held to any limit.
 */
export function callerIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return normalizeIp(first);
  }
  const real = headers.get("x-real-ip")?.trim();
  return real ? normalizeIp(real) : null;
}

/**
 * The same machine must always produce the same digest, so the spellings of one
 * address have to collapse into one string first.
 *
 * `[2001:db8::1]:443` and `2001:db8::1` are the same caller; so are `1.2.3.4`
 * and `1.2.3.4:51234`. Left alone, a client whose port changes per connection —
 * which is every client — would get a fresh budget on every request, and the
 * per-IP limit would count nothing.
 */
function normalizeIp(raw: string): string {
  let s = raw.trim().toLowerCase();

  // [v6]:port or [v6]
  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    if (close > 0) return s.slice(1, close);
  }
  // v4:port — a bare IPv6 also contains colons, so only strip when there is
  // exactly one and what follows it is a port.
  const parts = s.split(":");
  if (parts.length === 2 && /^\d+$/.test(parts[1])) s = parts[0];

  return s;
}
