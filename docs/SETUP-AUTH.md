# Setting up identity verification

Phase 3 in one page: what to create, in what order, and what each secret is
allowed to do. Nothing here is optional if you want claiming to work — but note
that **sending and refunding work without any of it**, so a half-finished setup
never takes the demo down.

Roughly 20 minutes, and every step is free.

---

## The trust chain you are building

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

Two properties are worth naming before you start, because the setup only makes
sense in their light:

**The handle comes from GitHub, not from the token.** `/auth/callback` calls
`GET /user` with the freshly issued provider token and takes `login` and `id`
from GitHub's own answer. It does not read `user_metadata` out of the Supabase
JWT — that field is writable by the user through `auth.updateUser`, so trusting
it would let anyone sign in with their own account, rename themselves
`torvalds`, and empty his escrow.

**The identity row is the proof.** Row level security gives users no INSERT on
`identities`; only the service role writes there. So when
`/api/verify/claim-auth` finds a row for the signed-in user, that row is
evidence a GitHub token was verified, not a claim the user made about
themselves.

---

## 1. Create the GitHub OAuth App

<https://github.com/settings/developers> → **New OAuth App**

| Field | Value |
|---|---|
| Application name | Paytag (dev) |
| Homepage URL | `http://localhost:3000` |
| Authorization callback URL | `https://<your-project-ref>.supabase.co/auth/v1/callback` |

The callback URL points at **Supabase**, not at this app. Supabase performs the
code-for-token exchange, which is why the OAuth client secret never enters this
repository. You will not have the project ref until step 2 — create the project
first if you prefer, or come back and edit this field.

Generate a client secret and keep the tab open.

> Make a separate OAuth App for production. Sharing one between localhost and a
> live deployment means a leak in either takes both.

---

## 2. Create the Supabase project

<https://supabase.com/dashboard> → **New project**. Free tier, no card.

Then, in order:

**a. Run the schema.** SQL Editor → paste `db/schema.sql` → Run. It creates
`profiles`, `identities`, `cards`, `claim_nonces`, their row level security
policies, and the `public_cards` view. Running it twice is safe — every
statement is `if not exists` or `create or replace`.

**b. Verify the schema does what it claims.** SQL Editor → paste
`db/schema_test.sql` → Run. Six negative cases, each one an attack the schema
must refuse. A passing run ends with a single row reading *All six rejection
cases passed*; a failing case raises an exception and aborts the script, so
there is no ambiguous outcome. It ends in `rollback` and leaves nothing behind.
If a case fails, stop here — the failure is in the schema, not in the test.

**c. Enable the GitHub provider.** Authentication → Providers → GitHub → on.
Paste the client id and secret from step 1. Copy the callback URL Supabase
shows you back into the GitHub OAuth App if you guessed it earlier.

**d. Set the redirect allow-list.** Authentication → URL Configuration →
Redirect URLs: add `http://localhost:3000/auth/callback` (and your production
URL later). Supabase refuses to redirect anywhere not on this list, which is
what stops a crafted `redirectTo` from sending a freshly authenticated session
to somebody else's site.

---

## 3. Fill in the environment

`web/.env.local` — copy `.env.example` and set:

| Variable | Where it comes from | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → anon key | public, bounded by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role key | **full database access, server only** |
| `VERIFIER_SECRET` | `node scripts/paytag.mjs keygen` | **the escrow's signing key** |

The service role key and the verifier secret are the two that matter. Neither
may ever be given a `NEXT_PUBLIC_` prefix — that prefix compiles a value into
the browser bundle. The secret scanner and CI both check for it, but the rule is
worth knowing rather than relying on.

---

## 4. Point the contract at your verifier

The contract stores the verifier's **public** key and checks every claim
signature against it. A signature from a key the contract does not know fails
inside `ed25519_verify` with nothing to explain why, so make sure the two match:

```bash
# Generates a seed, writes it straight into web/.env.local at mode 600, and
# prints ONLY the public key. It refuses to overwrite an existing seed, so it
# is safe to run twice.
node scripts/paytag.mjs keygen

# What the deployed contract currently expects
stellar contract invoke --id <ESCROW_ID> --network testnet -- get_config
```

If they differ, either point `.env.local` at the seed the contract knows, or
rotate the contract's key as admin:

```bash
stellar contract invoke --id <ESCROW_ID> --source paytag-dev --network testnet \
  -- set_verifier --new <64-hex-public-key>
```

> `set_verifier` is admin-only, and it is also the hole documented in SPEC §6.4:
> an admin who can rotate the key can authorize any claim. That is a known,
> accepted MVP assumption on testnet, and a blocker for mainnet.

---

## 5. Try it end to end

```bash
cd web && pnpm install && pnpm dev
```

0. Run `db/migration-001-roles.sql` in the SQL Editor if you set the schema up
   before the directory existed. It adds `cards.role` and recreates the
   `public_cards` view; it is safe to run twice and prints
   `Migration 001 applied.` when it worked.
1. Open `/connect` — or the account menu in the header, **Connect GitHub** —
   and press **Continue with GitHub**.
2. Approve. You land back where you started, showing `@you` with a
   **verified** badge. The account menu shows the same handle from then on.
3. Check the database: `select handle, external_login, identity_key from identities;`
   — one row, written by the callback with the service role.
4. Open `/app/submit`, pick a role, write two sentences, publish. You should
   appear on `/app` and on your own `/p/gh/<your-handle>`.
5. From another wallet, send XLM to `/p/gh/<your-handle>`.
6. Open `/claim`, connect a wallet and press **Claim**. The transaction hash
   goes in `docs/evidence/tx-hashes.md`.

Both `/connect` and `/claim` render an `auth_error` from the callback, and the
callback sends failures back to whichever of the two started the flow.

---

## What is deliberately not here

**X verification.** SPEC §7.4: whether "Sign in with X" works on the free tier
is unresolved. The schema and the UI carry both identity kinds, and
`/api/verify/claim-auth` refuses anything other than GitHub — signing for an
identity we cannot verify is the same as signing for anyone.

**Repo identities (`kind 0x01`).** Would need the `repo` scope and an
`permissions.admin` check on `GET /repos/{owner}/{repo}`. The kind byte is
reserved in the protocol; nothing else exists yet.

**Who pays the claim fee.** SPEC §7.5, still open. Worth knowing:
`claim` does not call `recipient.require_auth()`, so the signature alone
authorizes the payout and *any* funded account can submit the transaction. That
makes fee sponsorship a real option — Paytag submits and pays, and someone with
no XLM still gets their money. It needs a funded server-side key, so it is a
decision, not an oversight.
