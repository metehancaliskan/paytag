/**
 * The browser's side of the X handle check.
 *
 * A thin wrapper over `POST /api/x/lookup`, and thin on purpose: everything
 * that decides whether the question gets asked — the wallet gate, the windows,
 * the cache, the monthly ceiling — lives on the server, where it cannot be
 * edited by the person it is limiting. What is here is the request, a per-tab
 * cache, and the vocabulary translation below.
 *
 * ONE VOCABULARY. The endpoint answers `unavailable`, meaning any of "the
 * feature is off", "the budget is spent", "X did not answer". This translates
 * that to `unreachable`, the word lib/github.ts already uses for the same idea,
 * so the send page has one shape to render rather than two that mean the same
 * thing. `configured` survives the translation because the page needs it: it is
 * the difference between a deployment that does not do this check and one that
 * tried and failed, and only the second is worth a line on screen.
 */

export type XAnswer =
  | {
      status: "found";
      handle: string;
      displayName: string | null;
      configured: boolean;
    }
  | { status: "missing"; handle: string; configured: boolean }
  | { status: "unreachable"; configured: boolean };

/**
 * Answers already paid for, for as long as this tab lives.
 *
 * The same reasoning as the cache in lib/github.ts, with the sharper edge that
 * here the budget being protected is OURS. Pressing Check, editing the amount
 * and pressing Check again is one question; on a metered endpoint it must not
 * be two. The server caches for thirty days across everybody, so this is only
 * about not making the round trip at all.
 *
 * Only definite answers are kept. `unreachable` is a fact about this moment —
 * caching it would turn one bad second, or one missing wallet, into a broken
 * check for the rest of the visit, including after the reader connects a wallet
 * and tries again.
 */
const seen = new Map<string, XAnswer>();

export async function lookupXHandle(
  handle: string,
  wallet: string | null,
): Promise<XAnswer> {
  const key = handle.toLowerCase();
  const known = seen.get(key);
  if (known) return known;

  const answer = await ask(handle, wallet);
  if (answer.status !== "unreachable") seen.set(key, answer);
  return answer;
}

async function ask(handle: string, wallet: string | null): Promise<XAnswer> {
  try {
    const res = await fetch("/api/x/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle, wallet }),
    });
    // A 4xx here is our own bug or a handle our normalizer should have caught.
    // Either way it is not evidence about the account, so it reads as
    // unreachable rather than as a refusal to send.
    if (!res.ok) return { status: "unreachable", configured: false };

    const body = (await res.json()) as {
      status?: unknown;
      handle?: unknown;
      displayName?: unknown;
      configured?: unknown;
    };
    const configured = body.configured === true;

    if (body.status === "found" && typeof body.handle === "string") {
      return {
        status: "found",
        handle: body.handle,
        displayName:
          typeof body.displayName === "string" ? body.displayName : null,
        configured,
      };
    }
    if (body.status === "missing" && typeof body.handle === "string") {
      return { status: "missing", handle: body.handle, configured };
    }
    return { status: "unreachable", configured };
  } catch {
    return { status: "unreachable", configured: false };
  }
}
