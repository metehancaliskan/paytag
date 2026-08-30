# What the handle checks cost

Checked 26 August 2026. Two platforms, and they are not comparable: one of these
lookups is free and the other one is metered per call, so they cannot be built
the same way.

## The prices

| Call | Price | Charged to |
| --- | --- | --- |
| GitHub `GET /users/{login}`, unauthenticated | **$0**, 60 requests/hour | the **caller's IP** |
| GitHub `GET /users/{login}`, with a token | **$0**, 5,000 requests/hour | the token |
| X `GET /2/users/by/username/{name}` | **$0.010 per user returned** | our credit balance |
| X "owned read" (the signed-in user's own profile) | **$0.001 per resource** | our credit balance |

X moved off the old Basic/Pro subscriptions to pay-per-usage credits: there is no
monthly floor and no free allowance, which is better for us at low volume and
much worse if the endpoint is left open.

## GitHub: free, and it stays free because it runs in the browser

`api.github.com` sends `Access-Control-Allow-Origin: *`, so `lookupGithub()` is
called from the visitor's own browser. Two consequences, both of them the reason
it is built this way:

- The 60/hour is counted against **their** IP, not ours. Our bill is $0 at any
  traffic level, and no amount of other people's traffic can exhaust the limit
  for the person in front of the page.
- A server-side version would put every visitor's checks on one Vercel egress IP.
  Unauthenticated that is 60/hour **for the whole site**; with a token it is
  5,000/hour for the whole site, still free but now a shared resource that one
  script can drain for everybody. There is no reason to take that on.

Cost of the whole GitHub side of the send page, at any volume: **$0**.

The per-tab cache in `lib/github.ts` is not about money then — it is about not
spending the *visitor's* 60 on the same question twice. Pressing Check, editing
the amount, pressing Check again is one answer, not two. Definite answers are
kept; `unreachable` is not, so one bad second does not look like a broken GitHub
for the rest of the visit.

`handleStillBelongsTo()` deliberately does **not** use that cache. It runs
server-side at claim time, once per claim, on the freshest answer available —
that one is about who gets money, and a cached id is the wrong trade there.

## X: metered, so the send page meters it

At $0.010 per lookup, an existence check on an **anonymous** page is a hole
somebody can pour our money through:

| Traffic | Cost, unmetered |
| --- | --- |
| 100 checks / month (demo scale) | $1 |
| 1,000 checks / month | $10 |
| 10,000 checks / month | $100 |
| a script at 1 request/second | **$36/hour, $864/day** |

The last row is the whole argument, and it is why this check is not simply the
GitHub one with a different URL. It cannot run in the browser (X will only
answer a request carrying an app-only bearer token), the caller does not have to
have an account (`/send` needs a wallet and nothing else, by design), and every
answer draws on a credit balance with no free allowance.

So `/api/x/lookup` exists, and five gates stand in front of it. The first four
are free; only a request that clears all of them spends a cent.

| # | Gate | Where | What it stops |
| --- | --- | --- | --- |
| 0 | Already verified on Paytag | `components/SendTo.tsx` | paying to learn less than we know |
| 1 | A connected wallet, checksum-valid | `app/api/x/lookup/route.ts` | `curl` in a loop |
| 2 | 30-day cache, per handle | `x_profiles` | paying twice for one question |
| 3 | 50 lookups per 3 hours, per IP **and** per wallet | `x_lookup_claim` | one caller going haywire |
| 4 | 1,000 paid lookups per calendar month, whole deployment | `x_lookup_claim` | the bill |

**Gate 1 is a claim, not a proof, and the code says so.** Nothing checks that
the caller holds the key to that address, because doing so would mean a
signature prompt before a spelling check and nobody would sit through it. What
it buys is that an attacker has to produce well-formed, checksum-valid Stellar
addresses and rotate them to get fresh budget. That is a speed bump, which is
why it is one gate of four rather than the only one. A sign-in wall would be
stronger and was the wrong trade: it would put the check out of reach of exactly
the person it is for — the stranger sending money to a handle for the first
time.

**Gate 0 is free and it is the one that matters most in normal use.** The paid
call answers "is there an account with this name". Somebody verified on Paytag
signed in through X's own OAuth, which answers that *and* says who holds the
handle. So a verified handle never buys a lookup — and verified handles are
exactly the ones people pay most often, because they are what the directory
links to. Without this gate they would have been most of the bill.

It is also why the send page no longer prints "this account is unconfirmed"
under "verified on Paytag". Those two lines contradicted each other in front of
somebody about to send money, and the alarming one was the one that knew less.

**Gate 2 is what makes it cheap.** Whether an X account exists changes about
once in that account's lifetime. Both answers are cached, deliberately: a name
nobody holds is the answer that refuses a send, and re-asking it every time is
how one nonexistent handle in a loop drains a budget.

**Gate 4 is what makes it safe.** Gate 3 sounds tight until it is multiplied
out — 50 per window, eight windows a day, thirty days is 12,000 lookups, $120,
from one caller. A per-caller limit stops a person. Only a ceiling stops a bill.
It is `X_LOOKUP_MONTHLY_CAP`, defaulting to the 1,000 in `web/lib/config.ts`.

**What the reader sees when a gate closes.** Not an error: the same sentence the
page showed before this endpoint existed — we cannot confirm this account, here
is the profile, look for yourself — plus the avatar, which is free. The worst
case of the metered feature is the state the page was already in. That is the
property that makes it switchable off at any time: empty `X_API_BEARER` and the
check is simply gone, with nothing broken.

**One row per cent.** `x_lookups` records only *paid* lookups, cache hits
excluded, and the row is written **before** the call to X — the same discipline
`claim_nonces` follows for the verifier (SPEC §4.6). A crash overcounts by one
rather than losing the record of a spend. Count the rows in a month and you have
the bill.

**The meter cannot become a surveillance log.** The IP and the wallet reach the
table only as `sha256(salt ‖ value)`, with the salt in the environment. The
counting needs to tell two callers apart; it does not need to know who they are,
and without a salt the digest of an IP address would be reversible in an
afternoon.

### The profile picture is a separate question, and it is free

X's own API would hand over `profile_image_url` as part of that $0.010 user read.
We do not buy it. `avatarUrl()` in `lib/cards.ts` returns
`unavatar.io/x/<handle>?fallback=false`, loaded by the visitor's browser as an
`<img>` source:

- **$0 to us.** No key. The anonymous quota (25/day) is counted against the
  visitor's IP, exactly like GitHub's rate limit, and their cache hits do not
  count at all.
- **`fallback=false` matters.** Without it an unresolvable handle answers 200
  with a generic silhouette — a picture that reads as a real account on a page
  about to move money. With it the request 404s and `<Avatar>` shows initials.
- **A third party is in the request path.** unavatar (microlink) sees the
  visitor's IP and which X handle is on screen. GitHub's avatar CDN already sees
  the same for GitHub handles. Nothing else is sent.
- **It is not evidence.** A picture that loads does not mean this is the right
  account, and no copy on the page says otherwise. It is a face to recognise,
  which is a better check than a sentence saying we could not make one.

If unavatar disappears or throttles, every X avatar becomes initials and nothing
else changes. That is the whole blast radius, which is why a third party is
acceptable here and would not be in the claim path.

### One X cost we already pay

Every X sign-in makes one request for the authenticated user's own profile —
that is how Supabase learns the handle. Billed as an owned read, that is
**$0.001 per sign-in**: 1,000 X sign-ins ≈ $1. Negligible, but it is the reason
to keep an eye on the credit balance even with no lookups anywhere in the
product. (GitHub sign-in has no equivalent charge.)

## Everything else on the page

| Call | Where | Cost |
| --- | --- | --- |
| "Verified on Paytag?" | our own `identities` table, world-readable | $0 |
| `latestLedger()`, balances, escrow lists | Soroban RPC | $0 |
| the send transaction itself | Stellar network fee | ~0.00001 XLM |
| XLM/USD rate | `/api/price`, cached server-side | $0 |
| "Does this X account exist?" | `/api/x/lookup` | **$0.010**, and the only line here that is not free |

The most useful line in the check — whether the recipient can claim today or the
money will sit in escrow until somebody verifies — comes from our own database
and costs nothing. Worth keeping in proportion next to the metered one: the
expensive call answers "does this account exist", which the reader can also
answer by clicking the link; the free call answers "will this money move", which
they cannot. That ordering is why the X check degrades quietly instead of
failing loudly — losing it costs the page its second-best line, not its best
one.

## Sources

- <https://docs.x.com/x-api/getting-started/pricing> — pay-per-usage credits,
  User: Read $0.010 per resource, owned reads $0.001
- <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>
  — 60/hour per IP unauthenticated, 5,000/hour authenticated
