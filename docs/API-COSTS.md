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

## X: metered, so the send page does not call it

At $0.010 per lookup, an X existence check on an **anonymous** page is a hole
somebody can pour our money through:

| Traffic | Cost if we checked X on every press |
| --- | --- |
| 100 checks / month (demo scale) | $1 |
| 1,000 checks / month | $10 |
| 10,000 checks / month | $100 |
| a script at 1 request/second | **$36/hour, $864/day** |

The last row is the whole argument. The endpoint would be reachable by anyone
with `curl` and no account, and each call spends real credit. Rate limiting turns
an uncapped bill into a capped one, but it does not turn an anonymous metered
endpoint into a good idea.

So the X section of `/send` makes **no API call**. It says plainly that we cannot
confirm the account and links the profile so the reader checks with their own
eyes. That is honest — an unchecked handle presented as checked would be worse
than no check — and it costs nothing.

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

### What it would take to turn the X check on

If it is ever wanted, these four together, not any one of them alone:

1. **Server side only.** A route handler, so the credential stays out of the
   browser and the spend is measurable in one place.
2. **Signed in.** A cost-bearing call behind `getUser()`. Anonymous visitors
   cannot spend our credits.
3. **Cached by handle for ~30 days.** An X account existing is a fact that
   almost never changes; repeat lookups of the same name should cost nothing.
   At realistic scale this is what makes it cheap: 200 sends/month with ~60%
   distinct handles is ~$1.20/month.
4. **A hard monthly cap** in the route, counted in the database — at the cap the
   check degrades to the honest "cannot confirm" text rather than failing the
   page. A ceiling we choose beats a bill we discover.

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

The most useful line in the check — whether the recipient can claim today or the
money will sit in escrow until somebody verifies — comes from our own database
and costs nothing. Worth remembering when weighing the metered one: the
expensive call answers "does this account exist", which the reader can also
answer by clicking the link; the free call answers "will this money move", which
they cannot.

## Sources

- <https://docs.x.com/x-api/getting-started/pricing> — pay-per-usage credits,
  User: Read $0.010 per resource, owned reads $0.001
- <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>
  — 60/hour per IP unauthenticated, 5,000/hour authenticated
