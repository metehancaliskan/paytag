# Paytag — Build Plan

**Project:** Paytag — claimable USDC payments to GitHub & X handles
**Source:** Instawards SOW, 30 days, $5,000, 3 deliverables
**Stack:** Next.js 16 (App Router, TS) + Rust/`soroban-sdk` 26.x + `stellar-cli` 27.x + Supabase (Postgres)
**Plan date:** 2026-08-19

---

## 0. Architecture — in one paragraph

The sender sends USDC to an **internet identity** (GitHub user/repo, X user, Paytag nick) without knowing the recipient's wallet. The money sits in escrow in a Soroban contract, tagged with an `identity_key`. The recipient shows up and proves via GitHub OAuth that they own the handle; an **off-chain verifier service** checks that and produces an ed25519-signed "claim authorization"; the contract verifies the signature with `env.crypto().ed25519_verify` and releases the money to the recipient's wallet. If nobody shows up, the sender calls `refund` after the expiry ledger.

```
Sender wallet ──deposit(identity_key, token, amount, expiry)──▶ ┌──────────────────┐
                                                                │ Soroban Escrow   │
GitHub ──OAuth──▶ Verifier API ──ed25519-signed claim auth──▶   │ Contract         │
                  (Next.js route)                               │ (identity-tagged)│
Recipient wallet ◀──claim(payment_ids, recipient, sig)────────  └──────────────────┘
Sender wallet ◀──refund(payment_id) [after expiry]──────────────
```

### The critical design decision: why the "verifier signature" pattern

The contract cannot make an HTTP request to GitHub. The only way to connect the chain to the outside world is for an off-chain party to do the verification and **sign** the result, with the contract verifying the signature. That creates a trust assumption: if the verifier's private key is compromised, the wrong person can claim. We will **say this out loud** in the README — judges don't like a hidden trust assumption, they like an honestly documented one. Post-MVP mitigation path: a multi-sig verifier set, or zkTLS/attestation. Out of scope, but it goes on the roadmap.

---

## 1. Stack choices — why these

| Decision | Choice | Rationale |
|---|---|---|
| Contract language | Rust + `soroban-sdk` 26.x | Soroban's only first-class language. No alternative. |
| CLI | `stellar-cli` 27.1 | `contract build/deploy/invoke` + **`bindings typescript`** → generates a typed TS client from the contract, which reduces hand-written RPC/XDR to zero. |
| Frontend + backend | **A single Next.js app** | The critical reason: the ed25519 private key the verifier signs with **must never reach the browser**. Next.js API routes keep that secret server-side, with no separate service to deploy. The GitHub OAuth callback lands on the same origin too — no CORS/cookie pain. Deploying and keeping two services in sync in 30 days is pure loss. The OAuth code-for-token exchange itself is Supabase Auth's job, not ours, which is why the GitHub client secret never enters this repo or its environment — it lives in the Supabase dashboard. |
| Wallet | Stellar Wallets Kit | Gives Freighter + xBull + Albedo + Lobstr behind one interface. Wiring up Freighter alone tells the judges "supports exactly one wallet". |
| DB | **Supabase (Postgres), SQL-first schema + row level security** | Needed for nickname records, OAuth sessions, and indexed events. Supabase gives Postgres + hosted auth + RLS in one box — otherwise the auth piece was going to be hand-rolled. RLS puts the access rule next to the data instead of in application code. No ORM: the schema is small and SQL is the source of truth (`db/schema.sql`). |
| Deploy | Vercel + Stellar Testnet | A live demo link is mandatory in the SOW (Deliverable 3). Vercel = 1 command. |
| Token | Our own `USDC` SAC on testnet | There is no official Circle USDC on testnet. We issue `USDC:GXXX` from our own issuer and turn it into a SAC with `stellar contract asset deploy`. Because the contract speaks the SEP-41 interface, moving to mainnet USDC is **one address change**. Worth stating in the README. |

**Rejected alternatives:** a separate Express backend (extra deploy + CORS, zero gain), Vercel Postgres (a more expensive wrapper around Neon), tRPC (a pointless layer inside a single app), Prisma (serverless cold-start), Drizzle + Neon (Supabase folds Postgres, auth, and RLS into one box, which removes the reason for both the ORM and a hand-rolled auth layer).

---

## 2. Work breakdown — 6 phases, each step with "how it gets tested"

### Phase 0 — Repo skeleton + toolchain proof  *(~half a day)*

| # | To do | Definition of done (test) |
|---|---|---|
| 0.1 | `~/Desktop/github/paytag` monorepo: `contracts/`, `web/`, `docs/`, `scripts/` | `tree -L 2` shows the expected layout |
| 0.2 | Rust toolchain + `wasm32v1-none` target, `stellar-cli` 27.1 installed | `stellar --version` and `rustc --version` output written to `docs/evidence/toolchain.txt` |
| 0.3 | Testnet identity + friendbot funding | `stellar keys address paytag-dev` returns a G... address, balance > 0 |
| 0.4 | **Throwaway hello-world contract deploy** | Deploys on testnet, `invoke hello` returns → toolchain proven. Then deleted. |
| 0.5 | GitHub repo (public), `.gitignore`, MIT license, CI skeleton | First commit pushed, Actions green |

> Why 0.4: fighting "why is deploy blowing up" halfway through Phase 2 is the most expensive mistake in a 30-day sprint. Prove the toolchain with an **empty** contract, then write business logic.

---

### Phase 1 — Technical spec + data model  *(~1 day)* → SOW Week 1 output

| # | To do | Definition of done (test) |
|---|---|---|
| 1.1 | Finalize the `IdentityKey` scheme | In `docs/SPEC.md`: `identity_key = sha256(kind_byte ‖ normalized_handle)` → `BytesN<32>`. `kind`: 0=GithubUser, 1=GithubRepo, 2=XUser, 3=PaytagNick. Normalization rules (lowercase, trim, `owner/repo` format) written down, and **a vector table that yields the same result in both Rust and TS** exists |
| 1.2 | Contract storage + function signatures | The signature list in `SPEC.md`, which storage type (instance/persistent/temporary) and why — with the TTL/archival reasoning |
| 1.3 | Verifier signature payload format | `sha256(contract_id ‖ identity_key ‖ recipient ‖ nonce ‖ expires_at_ledger)` — domain separation included, closed to replay and cross-contract attacks |
| 1.4 | DB schema + UI screen list + wireframe | 6 screens: Search, Profile/Pay page, Send, Connect wallet, Claim dashboard, Tx evidence |
| 1.5 | **Spec review** | Red-team myself: a "how would I exploit this design?" list at the end of `SPEC.md`. At least 5 attack scenarios and their answers |

**Test:** the test for the spec is that the vector table from 1.1 produces the same hash in **two independent implementations** (Rust + TS) in Phases 2 and 3. If they disagree, the spec was incomplete.

---

### Phase 2 — Soroban escrow contract → **Deliverable 1**  *(~1 week)*

**Functions:**
```rust
init(admin: Address, verifier: BytesN<32>, default_expiry_ledgers: u32)
deposit(from: Address, identity: BytesN<32>, token: Address, amount: i128, expiry_ledger: u32) -> u64
claim(payment_ids: Vec<u64>, identity: BytesN<32>, recipient: Address,
      nonce: BytesN<32>, expires_at: u32, sig: BytesN<64>)
refund(payment_id: u64)
set_verifier(new: BytesN<32>)              // admin only
get_payment(id: u64) -> PaymentData        // read-only
get_balance(identity: BytesN<32>, token: Address) -> i128
```

**Events:** `deposit`, `claim`, `refund` — all topic'd on `identity_key`; the indexer reads these.

| # | To do | Definition of done (test) |
|---|---|---|
| 2.1 | Types + storage + `init` | `cargo test` — init cannot be called twice |
| 2.2 | `deposit` | Happy path: balance moves to the contract, an id is returned, an event fires. **Negative:** `amount <= 0` panics, no auth on `from` panics, a past `expiry_ledger` is rejected |
| 2.3 | `claim` + ed25519 verification | Happy path: valid signature → money moves to the recipient, the payment becomes `Claimed`. **Negative (the most critical block):** forged signature rejected; signature for a different `identity` rejected; signature for a different `recipient` rejected; **the same nonce a second time rejected (replay)**; signature with a past `expires_at` rejected; an already-claimed payment cannot be claimed again; a payment past expiry cannot be claimed |
| 2.4 | `refund` + expiry | Refund **before** expiry rejected; accepted after; nobody but the sender can refund; a claimed payment cannot be refunded |
| 2.5 | Batch claim | 3 payments collected in a single `claim` call, total correct; if one of them is invalid **the whole call** reverts (atomicity) |
| 2.6 | Fuzz / property test | With `proptest`: no sequence of calls can leave the contract balance below `sum(unclaimed)` (**invariant: solvency**) |
| 2.7 | Testnet deploy + real transactions | Deploy tx hash + 1 deposit + 1 claim + 1 refund tx hash in `docs/evidence/tx-hashes.md`. With explorer links |

**Test tooling:** `soroban_sdk::testutils` — `Env::default()`, `mock_all_auths()`, fake USDC via `token::StellarAssetClient`, jumping expiry with `env.ledger().set_sequence_number()`.
**Gate:** no moving to Phase 3 until `cargo test` passes 100%. Target: **≥ 20 tests, all green**, running in CI.

---

### Phase 3 — GitHub verification + verifier → **Deliverable 2**  *(~1 week)*

| # | To do | Definition of done (test) |
|---|---|---|
| 3.1 | GitHub OAuth App + OAuth callback | Manual: sign in → the right `login` shows up in the session. Vitest: a state param mismatch is rejected (CSRF). — **Built.** OAuth runs through **Supabase Auth**, so the code-for-token exchange, and with it the state handling that used to be ours, happens there and the GitHub client secret never enters this repo. The route is `web/app/auth/callback/route.ts`, not `/api/auth/github/callback`: it calls `GET api.github.com/user` with the fresh `provider_token` and writes the `identities` row with the service role. `next` is restricted to same-origin paths, and Supabase's redirect allow-list bounds it from the other side. Not yet run against a real project |
| 3.2 | Handle ownership check | The `login` on the OAuth token must match the claimed handle **exactly**. Test: trying to claim someone else's handle gets 403. — **Built.** `/api/verify/claim-auth` loads the `identities` row for the signed-in user and answers 403 unless `identity.handle` equals the normalized requested handle. No automated test yet |
| 3.3 | Repo ownership check | `GET /repos/{owner}/{repo}` → `permissions.admin == true`. Test: a repo where you're not admin gets 403. — **Not built.** `kind 0x01` stays reserved in the protocol; it would need the `repo` scope and the `permissions.admin` check. Outside MVP scope per SPEC §1 |
| 3.4 | `identity_key` TS implementation | **A test that compares the Phase 1.1 vector table bit for bit against Rust.** — **Done.** `web/lib/identity-key-parity.test.ts`: the §2.3 and §2.4 vectors, the normalization equivalence set, the rejection set, and the kind-separation table. `web/lib/claim-signature-parity.test.ts` goes one further and pins the §4.2 golden signature byte for byte, which ties `lib/verifier.ts` to `paytag.mjs` and to the contract's own `claim_preimage`. 57 tests, run in CI before the build |
| 3.5 | ed25519 signing endpoint (`/api/verify/claim-auth`) | Key comes from the `VERIFIER_SECRET` env var and **never leaks to the client** — there is a grep/CI rule that tests exactly that. Vitest: the signature produced is in the format the contract accepts. — **Built.** `web/lib/verifier.ts` reads the seed from the environment only and starts with `import "server-only"`, so a build that pulls it into a client bundle fails instead of shipping. The scanner rejects any secret carrying a `NEXT_PUBLIC_` prefix. No vitest yet |
| 3.6 | Nonce generation + single-use record | Nonce table in the DB, the same nonce is never signed twice. Test: two concurrent requests → one gets 409. — **Built.** `public.claim_nonces`, nonce as primary key, RLS on with no policies. The row is inserted **before** the signature is produced, so a crash cannot hand out an unrecorded authorization (SPEC §4.6). A duplicate nonce now returns 409 as the criterion asked; the concurrency test itself is still missing |
| 3.7 | Paytag nickname registry | Take/resolve a nick, collision rejection, reserved word list. Test: the same nick cannot be taken twice. — **Not built.** `kind 0x03` reserved; no table and no normalization rule yet |
| 3.8 | X verification — **conditional** | Same pattern if X API access/quota is available. If not, a "deferred due to API restrictions" note in `SPEC.md` + shown as disabled in the UI. The SOW already says "if API usage is allowed". — **Not done**, SPEC §7.4 still open. `/api/verify/claim-auth` refuses any `kind` other than GitHub as its first check: signing for an identity we cannot verify is the same as signing for anyone |
| 3.9 | **Integration test: end-to-end verification** | On testnet: deposit → OAuth → get signature → call `claim` → money arrived. Tx hash recorded. — **Not done.** The path is wired end to end in the UI, but it has never run against a real Supabase project, so `docs/evidence/tx-hashes.md` still has no claim transaction |

Setup for everything above — the OAuth App, the Supabase project, the env
vars, and pointing the contract at the right verifier key — is in
`docs/SETUP-AUTH.md`.

**Gate:** no moving to 3.5 until 3.4 (the parity test) passes. If Rust and TS don't produce the same `identity_key`, no claim works at all, and that bug surfaces in the most expensive possible way in Phase 4. **The gate was crossed out of order** — 3.5 was written before 3.4 — but it is now closed: the parity suite exists, runs in CI ahead of the build, and covers the signature as well as the identity key. Three independent implementations of the same 195 bytes (Rust, the Node CLI, the Next.js route) are now pinned to one golden vector.

---

### Phase 4 — Demo UI + end-to-end flow → **Deliverable 3**  *(~1 week)*

| # | Screen / task | Definition of done (test) |
|---|---|---|
| 4.1 | Wallet connect (Wallets Kit) | Connect/disconnect with Freighter, address visible. Manual + Playwright (mocked) |
| 4.2 | Search: `github.com/foo`, `@foo`, `foo/bar`, nick | Playwright: all 4 input formats resolve to the right identity type; invalid input gives a comprehensible error |
| 4.3 | Profile / payment page (`/pay/github/foo`) | Pending balance, past payments, shareable link. Playwright: the 0-balance and N-balance cases |
| 4.4 | Send flow | Pick amount + expiry → sign → tx confirmation + explorer link. Playwright against a real tx on testnet |
| 4.5 | Claim dashboard | Connect GitHub → claimables listed → claim in one click. A real testnet claim |
| 4.6 | Refund flow | A "take it back" button for a payment past expiry. A real refund on testnet using a short expiry |
| 4.7 | Tx evidence page | Every demo transaction in one table with explorer links — the one place the judges see it all at a glance |
| 4.8 | Vercel deploy | Live URL works, written down in `docs/` |
| 4.9 | **Playwright E2E suite** | `pnpm test:e2e` — 6 scenarios green, running in CI. This is the automated form of the SOW's "end-to-end demo" evidence |

---

### Phase 5 — Evidence package  *(~3 days)*

Maps **one-to-one** onto the table in SOW Section 6. The ambassador lead is not technical — every row has to be verifiable with a single link.

| # | To do | Definition of done |
|---|---|---|
| 5.1 | `README.md` | What, why, architecture diagram, setup, **trust assumptions section**, note on moving to mainnet USDC |
| 5.2 | `docs/evidence/tx-hashes.md` | Deliverable → tx hash → explorer link table, for each flow |
| 5.3 | Screenshots | All 6 screens, in `docs/evidence/screenshots/` |
| 5.4 | Test logs | `cargo test` + `vitest` + `playwright` output to file, CI run link |
| 5.5 | Demo video (2-3 min) | Voiced narration: problem → send → verify → claim → refund. One take, no cuts (that builds trust) |
| 5.6 | **Fill in the SOW evidence checklist** | `docs/SOW-EVIDENCE.md` naming which link corresponds to each row of Section 6.1 |

---

## 3. Schedule

| Week | Phase | Main output |
|---|---|---|
| 1 | Phase 0 + 1 | Repo, toolchain proof, `SPEC.md`, wireframe |
| 2 | Phase 2 | Escrow contract, ≥20 tests green, testnet deploy + tx hashes |
| 3 | Phase 3 | OAuth + verifier + parity test + end-to-end verification tx |
| 4 | Phase 4 + 5 | 6 screens, Playwright suite, Vercel demo, evidence package, video |

**Rule: evidence accumulates, it is not gathered at the end.** `docs/evidence/` is updated at the end of every phase. The biggest failure mode in this SOW is working code left without evidence.

---

## 4. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Rust/TS `identity_key` mismatch | Phase 3.4 parity test, as a gate |
| Verifier key leak | Server-side env only, CI grep rule, explicit trust note in the README |
| No USDC on testnet | Our own SAC + the SEP-41 interface → one address change to go to mainnet |
| X API access | The SOW wrote it as conditional; if unavailable it gets documented and deferred, GitHub works fully |
| Storage TTL / archival | Payments are `persistent`, with `extend_ttl` calls on deposit/claim |
| Scope creep | Chrome extension / KYC / revenue split are **out of scope**, written into the SOW — we don't touch them |
| Contract balance inconsistency | The Phase 2.6 solvency invariant fuzz test |

---

## 5. Where we are, and the next move

**Updated 2026-08-21.**

| Phase | State |
|---|---|
| 0 — Skeleton + toolchain proof | ✅ done — throwaway contract deployed and invoked on testnet |
| 1 — Spec + data model | ✅ done — `docs/SPEC.md`, now at v2 (GitHub + X identities) |
| 2 — Escrow contract | ✅ done — 50 tests green, `deposit`/`claim`/`refund` proven on testnet, see `docs/evidence/tx-hashes.md` |
| 3 — GitHub verification + verifier | 🔨 largely implemented, entirely untested — OAuth via Supabase Auth, the `/auth/callback` route, `POST /api/verify/claim-auth`, and the `claim_nonces` table all exist, but no Supabase project and no GitHub OAuth App have been created yet, so none of it has run once. Setup: `docs/SETUP-AUTH.md`. The 3.4 parity gate is now closed (57 tests in `web/`). Still missing: X verification and the recorded end-to-end claim |
| 4 — Demo UI | 🔨 in progress — search, profile page, send, **claim and refund** all exist. Refund works end to end on testnet today; claim needs the Phase 3 setup in `docs/SETUP-AUTH.md` before it can run at all |
| 5 — Evidence package | ⏳ accumulating as we go |

**The immediate next move, in this order:**

1. Create the GitHub OAuth App and the Supabase project, and walk `docs/SETUP-AUTH.md` end to
   end. Everything in Phase 3 is written against an environment that does not exist yet; until
   it does, "implemented" and "working" are different words.
2. Run the full claim path on testnet — deposit → sign in → authorization → `claim` — and record
   the transaction hash in `docs/evidence/tx-hashes.md` (3.9).
3. Redeploy the contract. `Error::SignatureLifetimeTooLong` (15) was added so that an
   over-long authorization stops reporting itself as a deposit-window problem; the currently
   deployed contract predates it. Refresh the addresses in the evidence package when you do.

**Two decisions still open, both from SPEC §7:**

- **Who pays the claim fee?** Today the recipient's own wallet builds, signs and submits the
  claim, which means they need XLM and, on mainnet, a USDC trustline. That is exactly the person
  the product promised not to burden. Phase 2 left the door open here: `claim` does not call
  `recipient.require_auth()`, so any funded account can submit the transaction and fee
  sponsorship is a configuration decision rather than a contract change. It needs a funded
  server-side key. See SPEC §7.5.
- **How is X ownership verified?** Whether "Sign in with X" works on the free tier is unresolved.
  The schema and the UI already carry both identity kinds, and the signing endpoint refuses any
  kind but GitHub on purpose; the X path stays visibly disabled until access is settled.
