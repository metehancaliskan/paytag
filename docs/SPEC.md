# Paytag — Technical Spec

**Phase 1 output.** The decisions that have to be settled before any code
gets written. Phase 2 (the contract) and Phase 3 (the verifier) are written
against this document; if they disagree with it, this document is right and
the code gets fixed.

**Status:** v2 — 2026-08-21 (multi-identity flow: GitHub + X)

---

## 1. MVP scope and the decisions we made

| Decision | Choice | Rationale |
|---|---|---|
| Identity type | **GitHub user (`0x00`) and X user (`0x02`)** | The product serves two audiences at once: the developer who writes code and the person who contributes through social media. Each has its own verification path (OAuth `login` / `username` match). The other types are placeholders in the architecture. |
| Card ↔ identity relationship | **One card per identity** | The GitHub card and the X card are separate pages, separate escrow pools, separate claims. On-chain they do not know each other at all — the `kind` byte keeps them apart. From the contract's point of view there is no difference. |
| Condition for opening a card | **Verify first, card second** | The card form only opens after OAuth returns. An unverified card is the most dangerous thing you can put in front of a sender who is about to send money: anyone could fabricate an identity in the name of someone who is not there. |
| Linking between cards | **Cards under the same Paytag account link to each other** | Someone who has verified both identities gets reciprocal badges on their page. That is a second piece of evidence for the visitor; the money flow of the two cards stays entirely separate. |
| Tagging | **Handle-based**, `sha256(kind ‖ handle)` | The tag is computed entirely offline; payment works even when the recipient has never signed up. This is the product's core promise. |
| Recipient address | 56-character strkey (`G...` or `C...`) | Wallets hand you `G...`; a contract address (`C...`) is the same length, so it is supported with no extra work. Muxed (`M...`, 69 characters) is rejected. |
| Asset | SEP-41 interface. Native XLM by default, any SEP-41 token accepted | The token address is a `deposit` argument, so the contract is asset-agnostic. XLM leads because it needs no trustline; an issued asset cannot be held until the recipient opens one. |

The `kind` byte was in the protocol from day one; that is why adding X
required **not one line of change** in the contract. Had it been bolted on
later, it would have invalidated every existing `identity_key`.

---

## 2. `identity_key` — from identity to tag

Money in escrow is bound to a **tag**, not to a wallet. The tag is:

```
identity_key = sha256( kind_byte ‖ utf8(normalized_handle) )   -> BytesN<32>
```

| kind | meaning | MVP |
|---|---|---|
| `0x00` | GithubUser | ✅ §2.1 |
| `0x01` | GithubRepo | reserved |
| `0x02` | XUser | ✅ §2.4 |
| `0x03` | PaytagNick | reserved |

Every `kind` has **its own normalization rule**, and the rules are
independent of each other: GitHub accepts hyphens, X does not; GitHub goes
up to 39 characters, X stops at 15. The only things they share are ASCII
lowercasing and the "when in doubt, reject" principle.

### 2.1 Normalization algorithm — GitHub user (`kind 0x00`)

Applied in order. The input is raw text coming from the user.

1. Trim leading/trailing whitespace (`\t\n\r` and space).
2. Strip these prefixes, in order, if present: `https://`, `http://`, `www.`, `github.com/`, `@`
3. Strip a trailing `/`.
4. If the remaining text still contains `/`, **reject** (that is a repo, out of MVP scope).
5. Lowercase as **ASCII** (see the warning below).
6. Validate; **reject** if it does not pass.

Validation rule — the GitHub username grammar:

```
^[a-zA-Z0-9](?:-?[a-zA-Z0-9])*$      and      1 <= length <= 39
```

That is: ASCII letters/digits and single hyphens only; cannot start or end
with a hyphen; no two consecutive hyphens.

> ### ⚠️ The lowercasing trap — we are writing this project from Türkiye
>
> **Never use locale-aware lowercasing.** In JavaScript,
> `"I".toLocaleLowerCase("tr")` yields `"ı"` (dotless i), not `"i"`. Rust's
> `to_lowercase()`, meanwhile, applies the full Unicode rules. If the two
> diverge, the `identity_key` diverges and **claim simply never works**.
>
> The mandatory rule: add `+32` only to bytes in the `A-Z` range. In Rust
> that is `to_ascii_lowercase()`, in TypeScript a hand-written byte
> conversion or at the very least `toLowerCase()` — **`toLocaleLowerCase`
> is banned.**
>
> Because the validation regex already rejects anything non-ASCII, both
> paths give the same result for a valid handle. The ordering matters: if
> we said **lowercase first, validate second**, Unicode could leak in;
> that is why step 5 is pinned to ASCII and step 6 does the rejecting.

### 2.2 Rejecting beats silently fixing

We do not coerce invalid input to the "nearest thing that looks right."
The reason: if the sender typed `github.com/foo bar`, their intent is
ambiguous, and guessing wrong means sending money to **somebody else's**
tag. When it is ambiguous, we error out.

### 2.3 Test vectors — parity fixture

This table is the input to the `identity-key-parity.test.ts` test in
Phase 3.4. The Rust and TypeScript implementations are **required to
produce these values exactly**. The values were computed with
`sha256(0x00 ‖ utf8(handle))`.

| normalized handle | identity_key (hex) |
|---|---|
| `metehancaliskan` | `91e23a08973aba69e14664cb9e12cc20483a4f702afdd304c8ad7424a354ffff` |
| `torvalds` | `9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b` |
| `a` | `022a6979e6dab7aa5ae4c3e5e45f7e977112a7e63593820dbec1ec738a24f93c` |
| `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (39×`a`, max) | `2e7774be4389a7316830256eebfdebbc76f3a47ea6b62cea92b0efb7982de372` |

**Normalization equivalence** — **all** of the inputs below must produce
`9d8638cd…060b`:

```
"torvalds"   "Torvalds"   "TORVALDS"   "@torvalds"
"github.com/torvalds"     "https://github.com/torvalds"
"https://github.com/Torvalds/"         "  torvalds  "
```

**Must be rejected:**

```
""                  empty
"-torvalds"         starts with a hyphen
"torvalds-"         ends with a hyphen
"tor--valds"        double hyphen
"torvalds/linux"    repo, outside the MVP
"a"*40              exceeds the 39-character limit
"torvaldş"          non-ASCII
"tor valds"         whitespace
```

**Kind separation** — same handle, different `kind`, must give a different key:

| kind | identity_key for `torvalds` |
|---|---|
| `0x00` GithubUser | `9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b` |
| `0x01` GithubRepo | `919ae1bad528b5f77e43e55a03d75409d6ceca8b23a4219fb35c1e3da936660c` |
| `0x02` XUser | `cb254de12f5a5a76717d0db39922eb02cbe081c4977bd82e7d492bba5a7e3d96` |
| `0x03` PaytagNick | `445e3e773d82aa85a04b41a66c387590d962f94bea1a9fefad12447d4b5a1359` |

### 2.4 Normalization algorithm — X user (`kind 0x02`)

X's handle grammar differs from GitHub's; using one function for both
identities would have left the door open to silent bugs. A separate rule:

1. Trim leading/trailing whitespace.
2. Strip these prefixes, in order, if present: `https://`, `http://`, `www.`,
   `x.com/`, `twitter.com/`, `@`
3. Strip a trailing `/`.
4. If the remaining text still contains `/`, **reject** (that is a tweet or
   a sub-page link; which account it means is ambiguous).
5. Lowercase as **ASCII** — the Turkish locale warning in §2.1 applies here
   verbatim.
6. Validate; **reject** if it does not pass.

Validation rule — the X username grammar:

```
^[a-z0-9_]+$      and      1 <= length <= 15
```

That is: ASCII letters/digits and underscore only. **No hyphen** (unlike
GitHub), no dot, upper bound 15 characters (39 on GitHub).

> **Why strip `twitter.com/` too?** The old links are still in circulation
> and both go to the same account. We accept both so the sender does not
> get an "invalid" answer when they paste the link they happen to have. You
> do not have to try the new spelling (`x.com`) first — order does not
> matter, both are stripped in a single pass.

**X test vectors** — `sha256(0x02 ‖ utf8(handle))`:

| normalized handle | identity_key (hex) |
|---|---|
| `metehancaliskan` | `7462d3ca2f7a62066003309a018b93907472145b9e2341e6b88fbf40fc8b86ff` |
| `elonmusk` | `631990ec6950b453cf0bf093706e41ef2670316556398a48aab1a0bc9e503892` |
| `a` | `f5fcb5a1e3534de6007b6c49b3a5f4c545edb7c0e0608a30b20e1695db3e43b2` |
| `_` | `859f52e06b88b733233b6ed3b1f14f8859d311c489b3d93b6462b1a155fd0a87` |
| `paytag_hq` | `46821a0d92388e22cc33b8eccdd8182015f44c345be052d53ca2877cb2b3ec0b` |
| `aaaaaaaaaaaaaaa` (15×`a`, max) | `b219a3f65891085e99adf52e16b7bcae281681b5b9afc5c6075ab44df5ef47f3` |

**Normalization equivalence** — all of these must produce `631990ec…3892`:

```
"elonmusk"   "ElonMusk"   "ELONMUSK"   "@elonmusk"
"x.com/elonmusk"          "https://x.com/ElonMusk"
"twitter.com/elonmusk"    "https://www.twitter.com/elonmusk/"
"  @elonmusk  "
```

**Must be rejected:**

```
""                     empty
"elon-musk"            hyphen — invalid on X, valid on GitHub
"elon.musk"            dot
"aaaaaaaaaaaaaaaa"     16 characters, over the limit
"elonmusk/status/1"    tweet link
"elonmuşk"             non-ASCII
"elon musk"            whitespace
```

> **Same text, two different identities.** `metehancaliskan` passes both the
> GitHub and the X rule, but produces two separate `identity_key`s
> (`91e23a08…` and `7462d3ca…`). That is not an accident, it is the design:
> two different people can use the same name, and money sent to the GitHub
> identity must not be withdrawable from the X account. Verification is
> separate too — GitHub OAuth does not open the X card.
>
> Conversely, `elon-musk` is valid on GitHub and invalid on X; that is the
> concrete reason we keep the rules apart.

---

## 3. Contract interface

### 3.1 Functions

```rust
init(admin: Address, verifier: BytesN<32>, default_expiry_ledgers: u32)

deposit(from: Address, identity: BytesN<32>, token: Address,
        amount: i128, expiry_ledger: u32) -> u64

claim(payment_ids: Vec<u64>, identity: BytesN<32>, recipient: Address,
      nonce: BytesN<32>, expires_at: u32, sig: BytesN<64>)

refund(payment_id: u64)

set_verifier(new: BytesN<32>)               // admin only
get_payment(id: u64) -> PaymentData         // read-only
get_balance(identity: BytesN<32>, token: Address) -> i128
```

### 3.2 Payment record

```rust
pub struct PaymentData {
    pub from: Address,
    pub identity: BytesN<32>,
    pub token: Address,
    pub amount: i128,
    pub expiry_ledger: u32,
    pub status: Status,        // Pending | Claimed | Refunded
}
```

### 3.3 Storage choices and why

| Data | Storage | Why |
|---|---|---|
| Config (admin, verifier pk, default expiry) | `instance` | Small, read on every call, must live exactly as long as the contract. |
| Payment counter (`u64`) | `instance` | Same reason. |
| `PaymentData` (id → record) | `persistent` | There is **real money** in it. If it expires and gets archived, the funds become unreachable; it is extended with `extend_ttl` on `deposit`/`claim` calls. |
| Spent nonces | `temporary`, TTL > `expires_at` | Replay protection is only needed while the signature is valid. The signature dies at `expires_at`; the nonce record has no reason to outlive it. `temporary` is cheaper and cleans itself up. |

> The argument that making the nonce `temporary` does not break security
> goes like this: once the record is deleted, a signature carrying the same
> nonce could be presented again, but that signature cannot get past the
> `expires_at` check. The two protections complement each other — not
> individually, but together they are enough. **The TTL must be set strictly
> longer than `expires_at`**; that is a Phase 2 test item.

### 3.4 Events

All of them are topic'd on `identity_key` — the indexer will read these.

```
deposit(identity, payment_id, from, token, amount, expiry_ledger)
claim  (identity, payment_id, recipient, token, amount)
refund (identity, payment_id, to, token, amount)
```

---

## 4. Verifier signature protocol

The contract cannot ask GitHub. The off-chain verifier confirms ownership
via GitHub OAuth and signs **an authorization document**. The contract
verifies the signature with `env.crypto().ed25519_verify`.

### 4.1 The signed data (preimage)

Fixed length, **195 bytes**. Because the length is fixed there is no need
for a separator; the field boundaries leave no room for ambiguity.

| Offset | Length | Field | Encoding |
|---|---|---|---|
| 0 | 15 | domain separator | ASCII `paytag.claim.v1` |
| 15 | 56 | `contract_id` | strkey ASCII (`C...`) |
| 71 | 32 | `identity_key` | raw |
| 103 | 56 | `recipient` | strkey ASCII (`G...` or `C...`) |
| 159 | 4 | `expires_at` | big-endian `u32` (ledger sequence) |
| 163 | 32 | `nonce` | raw, random |

> **Why strkey for the addresses instead of the raw key?**
>
> In the first draft the addresses were embedded as 32-byte raw keys. Two
> problems showed up during implementation:
>
> 1. In `soroban-sdk` 26, `Address::to_payload()` — the call that gets you
>    the raw key — sits behind the `hazmat-address` feature, and its docs
>    explicitly warn **"do not use this for authentication purposes in
>    ed25519 signature verification"** (an account's master key may not be
>    a signer on that account).
> 2. Dropping to raw bytes creates a dependency on the address type; the
>    protocol breaks the moment a new address type appears.
>
> Strkey solves both: it is canonical, independent of the address type, and
> on the TypeScript side it can be reproduced exactly with
> `address.toString()` — which also lowers the Rust/TS parity risk in
> Phase 3. The length check (56 bytes) rules out muxed addresses up front.

```
sig = Ed25519-Sign(verifier_secret_key, preimage)
```

The signature is over **the preimage itself**, not pre-hashed — ed25519
already hashes internally. The contract rebuilds the preimage from the
arguments and verifies; if the rebuilt bytes are not byte-for-byte
identical, the signature does not hold.

### 4.2 Worked example (fixture)

The Phase 2 and Phase 3 tests use this example.

```
contract_id  = CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU
identity_key = 9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b   ("torvalds")
recipient    = GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG
expires_at   = 1000000  -> 000f4240
nonce        = 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20
```

preimage (195 bytes):

```
7061797461672e636c61696d2e763143424a58565147593234573241585a3758
4459334256474441444a525137504745564c36535632564d52595a4d4e363442
35474c555554559d8638cdf5594ee5a5178e3d413fb8206513356b947de1de60
0f178532c7060b474144334c4d4b4f4555513450564634324e47434456595a56
4d4c5a44415034524e52524e57455a3759374343584842374d4e51434b574700
0f42400102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d
1e1f20
```

Checksum (not a signature — just to test that the preimage was built
correctly):

```
sha256(preimage) = 6797bc5d95d35ac19c7918c38bf139fffaea466406439b08b49e017c08780906
```

This value is verified by a test in the contract:
`test_claim::preimage_matches_the_spec_golden_vector`. The contract is
registered at the address given in the SPEC, its own `claim_preimage`
function is called, and the sha256 of the result is compared against the
constant above. In Phase 3 the TypeScript verifier has to produce the same
checksum — this is the parity anchor.

### 4.3 Which attack each field closes

This table is the heart of the design. Remove a field and you open the
attack across from it.

| Field | What happens without it |
|---|---|
| domain separator | A signature the verifier produced for some other purpose can be reinterpreted as claim authorization. The separator pins down what the signature means. |
| `contract_id` | The signature can be copied to a second contract that uses the same verifier (or testnet→mainnet). |
| `identity_key` | Authorization obtained for one handle can be used to withdraw another handle's money. |
| `recipient` | Someone in the middle swaps the recipient for their own address and redirects the money. |
| `expires_at` | The signature stays valid forever; one leaked authorization turns into a permanent backdoor. |
| `nonce` | The same signature gets presented over and over (replay). The contract keeps spent nonces. |

**Why `payment_ids` is not signed:** The signature says "this recipient is
the owner of this identity." Which payments get withdrawn is something the
contract verifies itself — for every `payment_id` it checks
`payment.identity == identity`. A payment that does not belong to the
identity is rejected anyway; and which subset of the ones that do belong
gets withdrawn makes no difference security-wise, it is all the same
person's money.

### 4.4 The implemented verification chain

What §4 describes as "the verifier confirms ownership" is, concretely, this
chain. Setup instructions: `docs/SETUP-AUTH.md`.

```
GitHub ──approves──▶ Supabase Auth ──provider_token──▶ /auth/callback
                                                            │
                                          GET api.github.com/user
                                                            │
                                            (service role, RLS bypassed)
                                                            ▼
                                                  public.identities row
                                                            │
                                            POST /api/verify/claim-auth
                                                            │
                                            ed25519 claim authorization
                                                            ▼
                                                  contract: ed25519_verify
```

1. **GitHub OAuth runs through Supabase Auth.** Supabase performs the
   code-for-token exchange, so the OAuth client secret never enters this
   repository. `read:user` is the only scope requested — the check needs the
   username and the numeric id, nothing else.
2. **`web/app/auth/callback/route.ts` asks GitHub who the token belongs to.**
   It calls `GET https://api.github.com/user` with the freshly issued
   `provider_token` and takes `login` and `id` from GitHub's own answer.
3. **The handle is normalized (§2.1) and the identity row is written with the
   service role** — `profiles` upsert, then `identities` upsert on
   `(profile_id, kind)`. A `23505` on `(kind, handle)` means another Paytag
   profile already holds that handle, and is surfaced as such rather than
   swallowed.
4. **`POST /api/verify/claim-auth` reads that row and signs.** It revalidates
   the session with `getUser()`, loads the `identities` row for that user,
   requires `identity.handle` to equal the normalized requested handle
   exactly, recomputes `identity_key` from the rule rather than trusting the
   stored column, and only then builds the §4.1 preimage and signs it.

> **Why the handle is NOT read from the Supabase JWT's `user_metadata`.**
> That field is writable by the user through `auth.updateUser({ data })`.
> Trusting it would let anyone sign in with their own GitHub account, rename
> themselves `torvalds`, and claim his escrow. `identity_data` is closer to
> safe, but asking GitHub directly needs no argument about which fields a
> provider or a client can rewrite.
>
> **Why the identity row is the proof.** Row level security gives users no
> INSERT on `identities` at all (`db/schema.sql`); only the service role
> writes there. So the existence of a row for the signed-in user *is* the
> evidence that a GitHub token was verified — not a claim the user made about
> themselves. If a user could write their own identity row, verification
> would be decoration.

The endpoint refuses any `kind` other than `0x00`; see §7.4.

### 4.5 How long a claim authorization lives

`CLAIM_AUTH_LEDGERS = 120` ledgers, about 10 minutes at ~5 s/ledger
(`web/lib/config.ts`). `expires_at` is set to the latest ledger read from RPC
plus that window.

Deliberately short, for the reason given in §3.3: the contract's spent-nonce
record lives in `temporary` storage and can be archived, so replay protection
based on it has an end date. The `expires_at` check does not — it is the half
of the pair that cannot expire. Ten minutes is long enough to sign a
transaction in a wallet and short enough that a leaked authorization is
worthless by the time anyone finds it.

### 4.6 `claim_nonces` — the off-chain record

Every authorization the verifier signs gets a row in `public.claim_nonces`
(`db/schema.sql`): `nonce` as primary key, plus the `profile_id`,
`identity_key`, `recipient` and `expires_at_ledger` it was signed for. Row
level security is on with no policies, so only the service role can reach it.

**The nonce is recorded before the signature is produced.** Reversing that
order would let a crash hand out a signature with no record of it. The
primary key does the rest: any attempt to sign an already-recorded nonce
fails at the insert, before signing happens, so the verifier can never
issue two authorizations carrying the same nonce.

This is a *different* guarantee from the contract's on-chain replay check.
The contract refuses a nonce it has already seen **on chain**; it knows
nothing about a signature that was issued and never submitted. This table
refuses double issuance. Both halves are needed, and neither replaces the
other. Nothing in the table is a secret or is money — if it were lost, the
contract's own replay check and the short `expires_at` window would still
hold.

---

### 4.7 The dollar figure is not a price feed

The send form takes an amount in dollars and deposits XLM, converted at a rate
fetched server-side from a public price API (`GET /api/price`, cached for
`PRICE_TTL_SECONDS`). Three properties of that number matter, and all three are
stated on the screen rather than left to be discovered:

- **Nothing on chain reads it.** No contract decision, no stored value and no
  balance depends on the rate. It is a label on an input box.
- **The escrow holds XLM.** Whoever claims receives the XLM amount, worth
  whatever it is worth then. A dollar figure implies a stability the chain never
  promised, so the form says outright that the amount is denominated in XLM, and
  the converted figure is written with a `≈`.
- **A missing rate degrades, it does not block.** If the price endpoint fails,
  the field switches to accepting XLM directly and says why. Refusing to let
  someone send money because a third-party price API is down would be the wrong
  trade every time.
- **The provider is not named.** Neither the response nor the interface says
  which service was asked. An earlier version printed it, on the theory that
  attribution is honesty; the opposite turned out to be true — a named source
  reads as a quote from an authority, when the number is an estimate we happen
  to have fetched. What the reader is told is what actually matters: this is
  approximate, and the escrow holds XLM.

Conversion arithmetic is integer-only (`lib/price.ts`): the rate is turned into
a scaled integer once and every step after that is exact, rounding toward zero
so a converted amount can never exceed the balance it was derived from. Tested
in `lib/price.test.ts`.

An issued asset that is dollar-pegged by construction (USDC) skips the
conversion entirely — one unit is one dollar, and no rate is involved.

## 5. Red team — how I would exploit this design

Every row will be written as a **negative test** in Phase 2.

| # | Attack | Defense | Test |
|---|---|---|---|
| 1 | Forge a signature | `ed25519_verify`, verifier public key in storage | 2.3 |
| 2 | Present a valid signature a second time (replay) | Spent-nonce record | 2.3 |
| 3 | Move the signature to another contract | `contract_id` in the preimage | 2.3 |
| 4 | Swap the recipient | `recipient` in the preimage | 2.3 |
| 5 | Claim with another identity's signature | `identity_key` in the preimage + the `payment.identity` check in the contract | 2.3 |
| 6 | Use an expired signature | `expires_at` vs the current ledger | 2.3 |
| 7 | Claim the same payment twice | `status != Pending` rejection | 2.3 |
| 8 | Pull a refund before expiry | `expiry_ledger` vs the current ledger | 2.4 |
| 9 | Refund someone else's payment | `from` auth check | 2.4 |
| 10 | Refund a payment that was already claimed | `status` check | 2.4 |
| 11 | Race claim against refund | Atomic state transition in a single invocation | 2.4 |
| 12 | Slip one invalid id into a batch claim | The whole call reverts | 2.5 |
| 13 | Deposit with `amount <= 0` | Panic | 2.2 |
| 14 | Deposit with an `expiry_ledger` in the past | Reject | 2.2 |
| 15 | Drive the contract balance below `sum(unclaimed)` | Solvency invariant, property test | 2.6 |
| 16 | Call `init` a second time | Reject | 2.1 |
| 17 | `set_verifier` without being admin | Auth rejection | 2.1 |

---

## 6. Accepted risks

These are known weaknesses that we left out of scope **deliberately**.
They are written out plainly in the README too — a hidden assumption is
always worse than a documented one.

### 6.1 Compromise of the verifier key

If the verifier's ed25519 private key leaks, the attacker can produce valid
claim authorization **for every identity in escrow**. This is the
centralized trust point inherent in the architecture.

Mitigation: the key lives only in a server-side environment variable, never
in the client bundle (audited by a CI rule in Phase 3.5).
Roadmap: a multi-signature verifier set; on-chain verifiable attestation
(zkTLS-style). Both are outside this 30-day scope.

### 6.2 Handle transfer / renaming

Because the tag is the hash of the handle, if a user gives up their handle
and somebody else takes it, **the new owner can claim the pending money**.

This is the direct price of the "you can send money to someone who has not
signed up" feature. Tagging by GitHub's permanent numeric ID would close
the risk, but it would force the sender to hit the GitHub API at deposit
time.

Mitigation: keep the default expiry short (the sender can get the money
back), and put the "you have money waiting" notification front and center
in the UI for the recipient.

**Implemented (Phase 2.4): the verifier checks the handle→id mapping at claim
time.** `identities.external_id` is the provider's permanent numeric id, and it
does not change hands; the handle does. So before signing anything,
`POST /api/verify/claim-auth` asks GitHub's public profile endpoint what id the
handle resolves to now, and refuses when it is a different one
(`lib/github.ts: handleStillBelongsTo`).

Two properties of that check are deliberate:

- **It refuses only on a definite mismatch.** Rate limit, outage, 404 → the
  answer is `null` and the claim proceeds. GitHub is rate-limited to 60
  unauthenticated requests an hour per IP, so a check that failed closed would
  freeze everybody's escrow the moment traffic arrived — a far likelier event
  than a handle transfer, and a worse one.
- **X does not get it.** X charges per profile read, so the equivalent call
  cannot be made on every claim. The gap is stated rather than papered over,
  and it is the reason the note below matters more for X than for GitHub.

> **On X this risk is bigger.** Giving up a handle is relatively rare on
> GitHub; on X, account names change, get abandoned and change hands often.
> The same mitigations apply, but we should consider keeping the default
> expiry on X cards shorter than on GitHub ones. At verification time we
> also store X's numeric `user id` (`identities.external_id`); during claim
> the verifier can check "does this handle still belong to that id." The tag
> itself stays handle-based — otherwise the sender would have to hit the X
> API before sending.

### 6.3 Testnet is not permanent

The SDF testnet is reset 2–4 times a year; contracts and balances are
wiped. The next scheduled reset is **2026-12-16**. That is why the evidence
package rests not only on explorer links but also on screenshots and
command output.

### 6.4 The admin can reach all of the money in escrow

The `set_verifier` function belongs to the admin and changes the verifier
key whenever they want, with no delay. The admin can load a key they
generated themselves and produce a valid claim signature for any
`identity`; the contract verifies the signature and hands over the money.
**In other words, the admin can drain the entire escrow balance.**

This is a separate item from §6.1: §6.1 is about the key being *stolen*,
whereas this risk stands even if the key never leaks. It is the one item
that undermines the product's claim that "we don't hold the money, it is
locked in the contract."

**Status: deliberately left open** (decision of 2026-08-21). For the
testnet demo and the delivery scope the contract stays as it is; closing
it means redeploying the contract and refreshing the addresses in the
evidence package.

**To be reopened before mainnet.** Three options on the table:

| Option | What it does | Cost |
|---|---|---|
| Remove `set_verifier` | The key is written once in `init` and nobody can change it. The admin path closes completely. | If the key leaks, there is no remedy other than redeploying the contract. |
| Time lock | The change does not take effect immediately, but N ledgers later. | Extra code + tests; users have to watch the window. |
| Multisig admin | One signature is not enough. | Key management brings operational overhead. |

---

## 7. Open questions handed to Phase 2

1. ~~**Converting the `recipient` field to raw 32 bytes inside the contract.**~~
   **RESOLVED (Phase 2.3):** strkey is used instead of the raw key; see the
   note in §4.1. A recipient with a `C...` address is supported too; muxed
   (`M...`) is rejected with `UnsupportedAddress`.
2. **How many ledgers should the default expiry be?** On testnet it is
   ~5 s/ledger. 30 days ≈ 518,400 ledgers. The value is configurable in
   `init`; the default presented to the sender in the UI will be settled in
   Phase 4.
3. **Many payments to the same identity in the same token** — how many
   records `get_balance` has to scan while summing, and the gas limit. If
   needed, the total balance per identity+token gets kept in its own
   record.
4. ~~**How will X verification be done?**~~ **RESOLVED, and it costs money.**
   Supabase's "X / Twitter (OAuth 2.0)" provider takes an X app's client id
   and secret and hands back a `provider_token`, exactly as GitHub does, so
   `/auth/callback` verifies X the same way it verifies GitHub: it asks
   `GET https://api.x.com/2/users/me` with that token and takes `username`
   and `id` from X's own answer. `POST /api/verify/claim-auth` now accepts
   `kind` `0x00` and `0x02`, and refuses anything else — the rule it enforces
   was never "GitHub only", it was "nothing we did not verify".

   What changed underneath is the price, not the protocol: X's free tier
   closed to new developers in February 2026, so that one profile read is
   billed (about $0.01 at the time of writing) and the X app needs a payment
   method. Two consequences are wired in rather than left implicit:

   - `NEXT_PUBLIC_X_ENABLED` gates the button. Nothing in a browser can see
     whether the Supabase provider is configured, and an enabled button that
     dead-ends at Supabase's error page is worse than a disabled one that
     says why.
   - A verification that fails because the API call was refused **stops**
     (`auth_error=x_unreachable`). It does not fall back to a weaker source.
     `X_TRUST_PROVIDER_IDENTITY=1` opts into that weaker source explicitly —
     the handle then comes from the `identity_data` Supabase received at
     sign-in rather than from our own call. That field is provider-filled and
     is not writable through `auth.updateUser` (which only touches
     `user_metadata`), so the trust moves from "our fetch" to "Supabase's
     fetch", not to the user. It is off by default, and it is a deployment
     decision that belongs in a note — a check that silently degrades when a
     card expires is worse than one that stops.
5. **Who pays the fee for claim?** In the current design the recipient pays:
   to withdraw, they need XLM in their wallet, and an open trustline too if
   the escrow holds an issued asset rather than native XLM (which is half of
   why XLM is now the default). This is exactly where the "send money to someone who has no
   wallet" promise stumbles — they have the money but cannot withdraw it.
   Candidates: Paytag absorbing the fee via fee-bump, Paytag opening the
   trustline via sponsored reserves.
   **Still open, but Phase 2 changed the shape of it:** `claim` does **not**
   call `recipient.require_auth()`. The verifier signature is the whole
   authorization, and the `recipient` is pinned inside the signed preimage
   (§4.1), so the money can only go where the signature says — but *any*
   funded account can submit the transaction that moves it. Fee sponsorship
   is therefore a real option rather than a rewrite: Paytag could submit and
   pay, and someone holding no XLM at all still gets their money. It needs a
   funded server-side key and the operational answer that comes with one,
   which makes it a decision, not an oversight. Today the recipient's own
   wallet builds, signs and submits the claim.
6. **Should the default expiry on X cards be shorter than on GitHub?**
   See the note in §6.2.

---

## 8. Cards, roles and the directory

Paytag started as "pay a handle". A handle you have to already know, which
means the product only worked for people who had somebody in mind. §8 is the
other half: a place where the people worth paying say who they are.

### 8.1 Three kinds of user, two kinds of card

| User | Shown as | What they do here | Card? |
|---|---|---|---|
| Sender | *Sender* | Browses, picks somebody, sends. | No |
| `shiller` | *Community* | Threads, posts, explainers, spaces. | Yes |
| `dev` | *Developer* | Contracts, tools, SDKs, docs, fixes. | Yes |

The middle column is the label, and it is deliberately not the key. `shiller`
is what `cards.role` stores and what `?role=` filters on; *Community* is what
the chip says. Renaming the stored value to match would cost a migration, a
rewritten check constraint and every shared `?role=shiller` link, to change a
word that only appears in this repository. The person who only sends is called
*Sender* on the landing page for the same reason the other one is not: one word
cannot mean both the payer and the paid.

A community member gets no card on purpose: nobody needs to be convinced to
accept a gift, so a card for a sender would be a page nobody reads. The two
card roles are the two values `cards.role` accepts
(`db/migration-001-roles.sql`); adding a third means changing the check
constraint, which is the correct place for that decision to be blocked.

### 8.2 Verify first, then write the card

The order is deliberate and it is enforced by the schema, not by the UI:

```
GitHub OAuth ──► identities row (service role only) ──► cards row (own RLS)
```

`cards.identity_id` references `identities`, and an identity row exists only
after the OAuth callback confirmed the handle with GitHub itself (§4). So there
is no such thing as a card on an unverified handle, and nobody can write a page
in someone else's name. The alternative — let anyone write a card for any
handle and sort it out at claim time — was considered and rejected: the money
would still be safe (it is bound to the identity key, §2), but the directory
would fill with pages impersonating people who never showed up.

The card is written with the reader's **own** session. Row level security is
the whole enforcement: `cards_insert_own` and `cards_update_own` require
`profile_id = auth.uid()`, and a trigger
(`cards_profile_matches_identity`) refuses a card bound to an identity owned by
somebody else. The service role is not involved, because it does not need to
be — the weakest credential that can do the job is the one that should.

### 8.3 What a card cannot do

A card is a shop window. It carries no money, no address and no authority:

- It cannot redirect a payment. The escrow pays the identity key derived from
  the handle (§2), never anything stored in `cards`.
- It cannot fake verification. The `verified` badge is rendered from the
  existence of the `identities` row, which the user cannot write.
- Losing every card in the database costs nobody a cent. `db/schema.sql` says
  this about the whole database and it is still true here.

Consequences worth stating: a card's text is user-written and shown to
strangers, so links are parsed rather than trusted (`http`/`https` only, no
`javascript:`, no relative URLs — `lib/cards.ts`), and the tag list is a fixed
vocabulary rather than free text so the directory filter keeps working after
the second card.

### 8.4 The directory

`public_cards` is the one view both the directory and the profile page read.
It is `security_invoker`, so an unpublished card stays invisible to everyone
but its owner — the rule lives in the database rather than in a `where` clause
that a future page could forget. `has_card` distinguishes "verified, no card
yet" from "listed", because a verified handle with no card is still payable and
its page should say so.

X is carried everywhere in this section — the role, the card, the directory row,
the linked-identity line — and only the sign-in button is inert, for the reason
in §7.4. When X verification lands, nothing in §8 changes.

### 8.4b The same name on two platforms

`torvalds` on GitHub and `torvalds` on X are two different tags, and they may
belong to two different people. Nothing in the product has to *resolve* that
ambiguity, because the ambiguity never exists: the kind byte is inside the hash.

```
identity_key = sha256(0x00 ‖ "torvalds")  = 9d8638cd…   the GitHub account
identity_key = sha256(0x02 ‖ "torvalds")  = cb254de1…   the X account
```

Two unrelated 32-byte keys, so two escrow pools that cannot see each other. From
there it holds all the way up:

| Layer | What keeps them apart |
|---|---|
| Contract | The key is the map key. A claim signature names one key and `claim` refuses a payment whose `identity` differs (`Error::IdentityMismatch`). |
| Database | `unique (kind, handle)` — the same handle may exist once per kind, under **different** profiles. `unique (profile_id, kind)` — one account holds at most one of each. |
| Verifier | `POST /api/verify/claim-auth` takes `kind` and `handle`, looks up the identity row for *that* kind on the caller's profile, and recomputes the key from both. A GitHub session cannot obtain a signature for an X tag. |
| URLs | `/p/gh/torvalds` and `/p/x/torvalds` are separate pages. |
| Interface | Every row, card, chip and claim carries the platform icon and the `github.com/` or `x.com/` prefix. Nothing anywhere shows a bare handle as if it were unique. |

The last row is where the real risk lives, and it is a UI risk rather than a
protocol one. It bit once already: the "Is this you?" link on a person's page
passed only `?handle=`, so a claim reached from an X page announced the money as
waiting for `github.com/<name>`. The link now carries `?on=gh|x` and the claim
page reads it — both for the sentence it prints and for which row it opens on. A
handle without its kind is not an identity, and no link inside the product is
allowed to pass one.

---

### 8.5 Two front doors

The site splits at the root, and the split is in the file tree rather than in a
condition inside one layout:

```
app/page.tsx        →  /            landing. Own header, one button: App →
app/(app)/…         →  /app         the product. Header with nav + account menu
                       /app/submit  the card form
                       /claim /connect /evidence /p/[kind]/[handle]
```

A first visitor has no wallet to show and no account to manage, so the landing
page carries neither. Everything behind "App →" gets the product chrome from
`app/(app)/layout.tsx`. `/people` and `/card` were the earlier addresses of the
directory and the form; both are permanent redirects in `next.config.ts`, since
they were shared while they existed.

`/claim` is a list, not a wizard: one row per identity, both totals visible at
once, a Claim button on whichever row has something, and a row with a Verify
button for the provider not yet connected. It was three numbered steps with a
segmented control inside the first, which let a person with two handles see one
escrow at a time — on a page whose only real question is "how much is on each of
mine".

The dashboard at `/app` is about everyone except the reader. It carried two
rows about them and both were removed once the rest of the product caught up: a
"listed as @you" strip, made redundant by Settings — an account holds at most
two cards, and that page lists them — and the handle field, made redundant by a
directory that shows everyone.

Paying a handle that is *not* listed is still the original promise, and the
field that does it still exists: on a person's page (`/p/<kind>/<handle>`, where
"pay someone else" is the natural next thought) and on the 404, where someone
who mistyped a handle is exactly the person who needs it. `/p/<kind>/<handle>`
also resolves for any handle at all, listed or not — the URL is the API. What
was dropped is one field on one page, not a capability.

---

## 9. The account: where it pays, and how to leave

Two capabilities that belong together, because both answer the same question —
*how much of this is actually mine?*

### 9.1 The payout address (`payout_prefs`)

Until Phase 2.4 a claim paid whichever wallet happened to be connected in the
browser at that moment. That is not wrong, it is just the only option, and it
carries a weakness that has nothing to do with cryptography: whoever holds the
session decides the destination.

So the destination becomes something declared in advance.

```
payout_prefs(identity_id pk, profile_id, address, …)
   address ~ '^G[A-Z2-7]{55}$'          shape, in the database
   StrKey.isValidEd25519PublicKey()     checksum, in lib/payout.ts
```

Three properties, each one deliberate:

1. **One address per identity, not per account.** The GitHub escrow and the X
   escrow are separate pools (§8.1); nothing sums them, and nothing forces them
   into one wallet either.
2. **Enforced, not suggested.** `POST /api/verify/claim-auth` reads the row with
   the service role and refuses to sign for any other recipient. A stolen
   session cannot redirect the money, because the address was chosen before the
   thief arrived and cannot be changed from the claim path.
3. **Its own table, and that is the point.** Row level security grants
   privileges per row, not per column. An UPDATE policy on `identities` — the
   obvious way to add a column there — would have let a user rewrite their own
   `handle`, which is the one field the entire verification chain rests on.
   `identities` stays writable by the service role alone.

Empty is a legitimate state, not an unfinished one: it means "pay the wallet I
connect", which is what most people want. `claimDestination()` in
`lib/payout.ts` is the single place that resolves saved-or-connected, and both
the claim screen and the verifier endpoint call it, so the address shown is
always the address signed for.

What makes any of this possible is a property of the contract:
`claim` does not call `recipient.require_auth()` (§7.5). The recipient is pinned
inside the signed preimage, but *submitting* the transaction is open to any
funded account — so a hot wallet can pay the fee for a claim that lands in a
cold one.

Refused at save time: a definite "no such account" from the RPC — a Stellar
payment to an unfunded account fails, and an address saved today would become a
claim that reverts after the reader has already signed it. An RPC we cannot
reach is **not** a refusal (`accountExists()` returns `null`): an outage in our
own infrastructure is no reason to reject a wallet somebody owns.

### 9.2 Deleting the account

`POST /api/account/delete`, confirmed by typing the handle. An account you
cannot leave is not an account.

What goes: the Supabase Auth user, and by the cascades in `db/schema.sql` the
profile, the identities, the cards and the payout addresses. The handle is
released — the `unique (kind, handle)` constraint means it was held, and after
deletion anyone can verify it.

What stays, and why:

| Survives | Because |
|---|---|
| Money in escrow | It is bound to `sha256(kind ‖ handle)` on chain, not to this account. Verify the same handle again and the same escrow is claimable again. |
| `claim_nonces` rows | That table is what guarantees the verifier signs a nonce at most once, and it is the only trace an incident could be reconstructed from. `profile_id` becomes NULL (`migration-002`) instead of the row disappearing. What is left in it — an identity key and a public address — is in the claim transaction on chain anyway. |
| The provider's own record | GitHub and X keep their record that you authorized this app; the next sign-in may skip the consent screen. Revoking that is done on their side, and the interface does not pretend otherwise. |

That first row is what makes deletion safe to offer at all, and it is the
sentence the confirmation panel leads with. People read "delete my account" as
"lose my money"; here it is the opposite, and saying so plainly is what makes
the button pressable.

Two failure modes are handled rather than assumed away. If deleting the auth
user fails because a cascade is missing on that project, the public rows are
cleared and the delete is retried once — a half-deleted account that can still
sign in is worse than either outcome. And the session cookies are removed by
hand after `signOut()`, because a `signOut` whose user no longer exists can fail
and leave the browser holding a token that makes the app look signed in.
