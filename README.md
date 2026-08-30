# Paytag

**Send money to a GitHub or X username, before that person has a wallet.**

You pay `github.com/torvalds` or `x.com/someone`. The money goes into a Soroban
contract on Stellar, tagged with a hash of the handle rather than an address.
The recipient turns up whenever they like, proves the account is theirs by
signing in with it, connects a wallet, and takes the money. If nobody turns up,
the sender takes it back once the claim window closes.

Live on Stellar testnet: **[paytag-six.vercel.app](https://paytag-six.vercel.app)**

| | |
| --- | --- |
| Contract | Rust, `soroban-sdk` 26, deployed to testnet with deposit, claim and refund proven on chain ([tx hashes](docs/evidence/tx-hashes.md)) |
| App | Next.js 16, deployed on Vercel, GitHub and X sign-in working |
| Tests | 61 contract tests, 149 web tests, all in CI |
| Money | Testnet only. Nothing here is worth anything. |

## The problem

Stellar moves money well, but paying a developer or a creator means knowing
their wallet address first. Most people who deserve to be paid do not have one,
and asking for it is where a donation or a bounty payout usually dies. Paytag
removes that step: you pay the name you already know.

## How it works

```
Sender wallet ──deposit(identity_key, token, amount, expiry)──▶ ┌──────────────────┐
                                                                │  Soroban escrow  │
GitHub / X ──OAuth via Supabase──▶ Verifier ──signed claim──▶   │ (identity-tagged)│
                                   (Next.js route)              │                  │
Recipient wallet ◀──claim(payment_ids, recipient, sig)────────  └──────────────────┘
Sender wallet ◀──refund(payment_id) [after the window closes]───
```

The tag is `identity_key = sha256(kind_byte ‖ normalized_handle)`. It is
computed identically in three places (the Rust contract, a Node CLI, and the
Next.js route), and a test suite pins all three to the same bytes. If they ever
disagreed, money would land on one tag while the claim looked for another, so
that parity check runs before anything else in CI.

## The trust assumption

A smart contract cannot call GitHub. So an off chain **verifier** confirms
ownership through OAuth and signs the result with ed25519, and the contract
checks that signature with `ed25519_verify`.

**If the verifier's signing key is compromised, whoever holds it can mint valid
claim authorizations and take money out of the contract.** That is a real,
accepted limitation of this version, and it is written here rather than buried.
The mitigation path is a multi signature verifier set, or on chain attestation
(zkTLS style). Both are outside this build.

Two things narrow it today. The signing key is read from the server environment
only, in a module marked `server-only`, so a build that pulled it toward the
browser fails instead of shipping. And the handle is never taken from the
session: the OAuth callback asks the provider itself with the token it just
received, because session metadata is writable by the user.

Detail: [SPEC §4](docs/SPEC.md), [SECURITY.md](docs/SECURITY.md).

## What is built

**Working:** sending to a GitHub or X handle, GitHub and X verification,
claiming, refunding after expiry, a public directory of people who can be paid,
contribution cards, a saved payout address, and a "Sent by me" list so a sender
can find and refund a payment without remembering who it went to.

**Reserved but not built:** repository identities (`owner/repo`) and Paytag
nicknames. Both have a kind byte in the protocol and neither has a verification
path, so the verifier refuses to sign for them.

## Getting started

```bash
./scripts/setup-mac.sh               # Rust, wasm target, stellar-cli, funded testnet identity
cd contracts && cargo test           # 61 contract tests
cd web && pnpm install && pnpm test  # 149 parity and unit tests
cd web && pnpm dev                   # http://localhost:3000
```

The testnet identity is funded by Friendbot, Stellar's faucet. No real money is
involved anywhere in this repo.

**Sending and refunding need nothing but a wallet and the contract address.**
Claiming needs more, because proving a handle is the whole job: a GitHub OAuth
App and a Supabase project, about twenty minutes and free. See
[docs/SETUP-AUTH.md](docs/SETUP-AUTH.md). Skip it and the claim screen says so
rather than breaking.

## Decisions worth knowing

**The contract is asset agnostic.** `deposit` takes the token address as an
argument and moves money over the SEP-41 interface, so nothing in the contract
knows which asset it holds. Changing assets is a UI decision, not a redeploy.

**XLM only, and native XLM specifically.** An issued asset cannot be held by an
account that has not opened a trustline for it first. That is a wall standing in
front of exactly the people this product is for, the ones who have never touched
Stellar. USDC stays defined and is still named in payment history, because
deposits in it exist on the deployed contract, but it is not offered to new
senders. Re offering it is one line in `web/lib/config.ts` (`SENDABLE_TOKENS`).

**Amounts are typed in XLM, and the dollar figure is the estimate underneath.**
The two are not equally true. XLM is what leaves the wallet, what the contract
holds, and what the recipient claims; the dollar figure is one public API's
opinion of what that is worth this minute, and nothing on chain reads it. A
missing rate therefore costs nothing: the estimate disappears and the field
keeps working.

**The X account check is metered, so it is gated.** GitHub answers "does this
account exist" for free from the visitor's own browser. X charges $0.010 per
lookup against a credit balance, so that check runs server side behind five
gates: already verified on Paytag, a connected wallet, a thirty day cache, a per
caller window, and a monthly ceiling. Any gate closing degrades to the honest
"we could not confirm this account" the page showed before the feature existed.
Arithmetic and sources: [docs/API-COSTS.md](docs/API-COSTS.md).

## Secrets

This repo was built private and published at delivery. Git history cannot be
undone, so the protection was in place before the first secret existed:
`.gitignore`, a pre commit hook, a pre push hook, and gitleaks scanning the
entire history in CI. The scanner has its own test suite
(`scripts/test-scan-secrets.sh`), because a scanner nobody tests is a scanner
nobody can trust.

Hooks are enabled with `git config core.hooksPath .githooks`, which
`scripts/setup-mac.sh` does for you.

Key inventory and the pre public checklist: [docs/SECURITY.md](docs/SECURITY.md).

## Repo layout

```
contracts/escrow/     Rust, soroban-sdk 26. The escrow contract and its tests.
web/                  Next.js 16. The interface and the verifier API routes.
db/
  schema.sql          Supabase schema, always current. Tables, RLS policies, views.
  schema_test.sql     Behavioural test: ten rejection cases, two retention cases.
  migration-*.sql     For projects created before a change. catch-up.sql has them all.
docs/
  PLAN.md             Phase by phase build plan, with a test criterion per step.
  SPEC.md             Protocol and data model. Identity keys, signatures, red team.
  SECURITY.md         Key inventory, layered defence, pre public checklist.
  SETUP-AUTH.md       GitHub OAuth and Supabase, so claiming works.
  API-COSTS.md        What each external call costs and what stops it running away.
  DESIGN.md           The mark, the palette, the screens.
  DEPLOY.md           Going live on Vercel.
  evidence/           Transaction hashes, screenshots, logs.
scripts/
  setup-mac.sh        One time development setup.
  paytag.mjs          Off chain verifier CLI: identity keys, keygen, claim signing.
  scan-secrets.sh     Secret scanner, and its own test suite beside it.
```

## Out of scope

Chrome extension, KYC and legal workflows, revenue splits.

## License

MIT
