/**
 * The two judgements in the X handle check that have nothing to do with the
 * network: is a cached answer still good, and what did X actually say.
 *
 * Split out of lib/x.ts so they can be tested without a bearer token, a
 * database or a Next.js request — the same reason lib/payout.ts and
 * lib/price.ts are their own files. Both of these cost money when they are
 * wrong, so both are worth pinning down in isolation.
 */

/**
 * Is a cached answer still worth trusting?
 *
 * Thirty days, and the reason it can be that long is what is being cached: not
 * a follower count or a display name, but whether the account exists. That
 * changes at most once, and the send page's own copy never claims the check is
 * live — it says the account exists, which a month-old answer still supports.
 *
 * The direction of the error matters too. A stale "found" sends money to a
 * handle whose owner deleted their account, and the sender gets it back at
 * expiry. A stale "missing" refuses a send that should have gone through, and
 * the sender presses the button again in a month. Neither is a lost cent, which
 * is what makes a long cache the right trade against a metered API.
 */
export function isFresh(
  fetchedAt: string | null,
  now: Date,
  days: number,
): boolean {
  if (!fetchedAt) return false;
  const then = Date.parse(fetchedAt);
  if (Number.isNaN(then)) return false;
  const age = now.getTime() - then;
  return age >= 0 && age < days * 86_400_000;
}

/**
 * What X actually said.
 *
 * The trap this exists for: **X answers 200 for a username nobody holds.** The
 * body carries an `errors` array instead of `data`, so a route that trusted the
 * status code would read "no such account" as "the API failed" and show the
 * unconfirmed warning for every correct handle. Status codes are checked by the
 * caller; the shape of the body is checked here.
 */
export function parseXUser(
  body: unknown,
): { id: string; username: string; name: string | null } | "missing" | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { data?: unknown; errors?: unknown };

  const d = b.data as { id?: unknown; username?: unknown; name?: unknown } | undefined;
  if (d && typeof d.id === "string" && typeof d.username === "string") {
    return {
      id: d.id,
      username: d.username,
      name: typeof d.name === "string" ? d.name : null,
    };
  }

  if (Array.isArray(b.errors)) {
    const notFound = b.errors.some((e) => {
      const t = (e as { title?: unknown })?.title;
      return typeof t === "string" && /not\s*found/i.test(t);
    });
    if (notFound) return "missing";
  }
  return null;
}
