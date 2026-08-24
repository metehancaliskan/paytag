# Paytag

**Claimable payments to GitHub and X handles, escrowed on Soroban.**

Pay `github.com/someone`, `owner/repo`, `@handle`, or a Paytag nickname — before
that recipient has ever connected a Stellar wallet. Funds sit in a Soroban escrow contract
tagged to the *identity*. The recipient proves ownership of the handle, links a wallet, and
claims. Nobody claims? The sender refunds after expiry.

> Status: **Phase 2 complete** — escrow contract deployed to testnet with deposit/claim/refund proven on chain. Phase 3 (GitHub OAuth + verifier) is written but has not yet been run against a real Supabase project — see [docs/SETUP-AUTH.md](docs/SETUP-AUTH.md). See [docs/PLAN.md](docs/PLAN.md).

## Why

Stellar's payment rails are strong, but to pay a developer, a creator, or an open source
project you first have to know their wallet address. That slows down donations, bounty
payouts, and contributor rewards. Paytag removes that step.

## Architecture

```
Sender wallet ──deposit(identity_key, token, amount, expiry)──▶ ┌──────────────────┐
                                                                │ Soroban Escrow   │
GitHub ──OAuth via Supabase Auth──▶ Verifier ──signed claim──▶  │ (identity-tagged)│
                                    (Next.js route)             │                  │
Recipient wallet ◀──claim(payment_ids, recipient, sig)────────  └──────────────────┘
Sender wallet ◀──refund(payment_id) [after expiry]──────────────
```

## Trust assumptions (stated plainly)

A smart contract cannot make an HTTP request to GitHub. To bind the chain to internet
identities, an off-chain **verifier** confirms ownership via GitHub OAuth and signs the result
with ed25519; the contract verifies the signature with `ed25519_verify`.

The OAuth layer is **Supabase Auth**: it performs the code-for-token exchange and owns the
session, so the GitHub client secret never enters this repo. The handle itself is not taken from
the session — the callback asks `GET api.github.com/user` with the fresh provider token and uses
GitHub's own answer, because the session's `user_metadata` is writable by the user. The
verifier's identity row is then written with a key that bypasses row level security, which is
what makes the row's existence proof of ownership rather than an assertion. Details: [SPEC
§4.4](docs/SPEC.md).

What that means: **if the verifier's signing key is compromised, an attacker can mint valid
claim authorizations for funds sitting in escrow.** This is a known and accepted trust
assumption of this MVP. Mitigation roadmap: a multi-signature verifier set, and on-chain
verifiable attestation (zkTLS style). Both are out of scope for this 30-day window.

## Secret management

This repo started private and will be **public** at delivery. Git history cannot be undone, so
the protection was set up before the first secret ever existed: `.gitignore` → `pre-commit`
hook → `pre-push` hook → `gitleaks` scanning the entire history in CI. The scanner itself is
verified by its own test suite (`scripts/test-scan-secrets.sh`).

Setup is one command: `git config core.hooksPath .githooks` — `scripts/setup-mac.sh` does it
automatically.

For the key inventory, where each secret lives, and the mandatory pre-public checklist:
**[docs/SECURITY.md](docs/SECURITY.md)**

## Repo layout

```
contracts/        Rust / soroban-sdk 26 — escrow contract
  escrow/         paytag-escrow crate
web/              Next.js 16 — UI + verifier API routes (Phase 3-4)
db/
  schema.sql      Supabase schema, always current: profiles, identities, cards,
                  payout_prefs, claim_nonces, RLS policies
  schema_test.sql Behavioral test for the schema — nine negative cases, one retention case
  migration-001-roles.sql    Adds cards.role (shiller | dev) and the directory view
  migration-002-account.sql  Adds payout_prefs; keeps nonce records past account deletion
docs/
  PLAN.md         Phase-by-phase build plan, test criteria at every step
  SPEC.md         Technical spec + data model (Phase 1)
  SECURITY.md     Key inventory, layered defense, pre-public checklist
  SETUP-AUTH.md   Setting up GitHub OAuth + Supabase so claiming works
  DESIGN.md       The design language: the mark, the palette, the four screens
  DEPLOY.md       Going live on Vercel: the secret gate, env vars, auth URLs
  evidence/       Instawards evidence package: tx hashes, screenshots, logs
scripts/
  setup-mac.sh          One-time dev environment setup
  paytag.mjs            Off-chain verifier CLI: identity keys, keygen, claim signing
  scan-secrets.sh       Secret scanner (pre-commit + pre-push + CI)
  test-scan-secrets.sh  Test suite for the scanner
```

## Setup

```bash
./scripts/setup-mac.sh        # Rust + wasm target + stellar-cli + testnet identity
cd contracts && cargo test    # contract tests — 50 of them
cd web && pnpm install && pnpm test  # parity + unit tests — 57 of them
cd web && pnpm dev                   # the demo UI on http://localhost:3000
```

The testnet identity is funded by **Friendbot**, Stellar's testnet faucet — `stellar keys
generate --fund` calls it for you. No real money is involved anywhere in this repo.

**Claiming needs one more step.** Sending and refunding work with nothing but a wallet and the
contract address — no Supabase project, no OAuth App. Claiming does not: it needs a verified
identity, which means a GitHub OAuth App and a Supabase project. About 20 minutes, all free:
**[docs/SETUP-AUTH.md](docs/SETUP-AUTH.md)**. Skip it and the claim screen says so instead of
breaking.

## A note on the asset

The escrow takes the token address as an argument to `deposit` and moves money over the SEP-41
interface, so it is asset-agnostic by construction — nothing in the contract knows which asset
it is holding. Adding a second asset is a UI decision, not a contract change.

**XLM is the default, for one concrete reason: native XLM needs no trustline.** An issued asset
cannot be held by an account that has not opened a trustline for it first, and that is a wall
standing in front of exactly the people this product is for — the ones who have never touched
Stellar. Native XLM has no such wall.

The amount is typed in dollars and sent in XLM, at a rate fetched from a public price API. That
rate is display only: nothing on chain reads it, and the escrow holds XLM, so the recipient
claims the XLM amount, worth whatever it is worth by then. The UI says so on the send screen
rather than letting a dollar figure imply a promise the chain never made.

USDC stays available as an optional second asset (there is no official Circle USDC on testnet,
so we issue our own from a test issuer and wrap it in a Stellar Asset Contract). Moving to
mainnet USDC is a single address change.

## Out of scope (Instawards SOW)

Chrome extension · KYC/legal workflows · complex revenue splits

## License

MIT
