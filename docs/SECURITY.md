# Paytag — Key and Secret Management

> **This repo started private and will be PUBLIC at delivery.**
> Git history cannot be undone. Once a secret is committed, it stays in history even if
> the next commit deletes it, and it becomes readable the moment the repo goes public.
> The rules in this file are not advice, they are a gate.

---

## 1. Key inventory — where every secret lives

| Secret | What it does | Where it lives | In the repo? |
|---|---|---|---|
| `paytag-dev` seed | Signs testnet deploys and test transactions | macOS **Keychain** (`stellar keys generate --secure-store`) | ❌ never |
| `VERIFIER_SECRET` | Signs claim authorizations with ed25519. **The security heart of the escrow.** | local: `web/.env.local` · prod: Vercel env vars | ❌ never |
| Verifier **public** key | Passed to the contract's `init()`, verifies the signature | Contract storage + a placeholder in `.env.example` | ✅ a public key can be shared |
| GitHub OAuth client id + **client secret** | The OAuth code-for-token exchange — performed by **Supabase**, not by this app | Supabase dashboard → Authentication → Providers → GitHub | ❌ never — not in the repo and not in its env either |
| `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses row level security entirely** — a full-database key. **Server side only.** Its single job is writing the `identities` row after OAuth: the one write a user must never be able to make for themselves, because that row's existence *is* the proof of handle ownership | local: `web/.env.local` · prod: Vercel env vars | ❌ never |
| Supabase URL + `anon` key | Client access, bounded by the RLS policies in `db/schema.sql` | `NEXT_PUBLIC_` env vars, browser bundle | ✅ public by design |
| Contract ID (`C...`) | The deployed escrow address | `docs/evidence/` + `.env` | ✅ public |
| Stellar public key (`G...`) | Account addresses | Everywhere | ✅ public |

**The rule that tells them apart:** every 56-character Stellar string starting with `S` is a
**secret seed** and never enters the repo. Those starting with `G` (account), `C` (contract) and
`M` (muxed) are public, use them freely.

Sessions are Supabase's, not ours: there is no hand-rolled session cookie and therefore no
signing secret for one. `web/middleware.ts` refreshes the Supabase session on navigation, and
`supabase.auth.getUser()` revalidates the token with Supabase rather than trusting what the
cookie says.

### 1.1 The auth surface — what is public on purpose

Four variables serve the auth path. Two of them belong in the browser bundle; mistaking either
of the other two for those is the accident this section exists to prevent.

| Variable | Public? | Why |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | An address, not a permission. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | It carries no privilege of its own; everything it can read or write is whatever the RLS policies in `db/schema.sql` allow — public reads on `identities` and published `cards`, no writes on `identities` at all, nothing at all on `claim_nonces`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **no** | Bypasses RLS. In the browser it would let anyone write their own identity row, which is the same as letting anyone claim any handle. |
| `VERIFIER_SECRET` | **no** | See §2. |

The two server-side files that touch those secrets both begin with `import "server-only"` —
`web/lib/verifier.ts` and `web/lib/supabase/server.ts`. That import is not decoration: if a
client component ever imports either module, directly or through a chain, **the build fails**
instead of quietly shipping the secret to a browser. It is a compile-time control, which is the
kind that cannot be forgotten in review.

---

## 2. Why `VERIFIER_SECRET` is the most critical secret

The contract cannot make an HTTP request to GitHub. So the off-chain verifier confirms ownership
and signs the result with ed25519, and the contract verifies that signature with `ed25519_verify`.

The consequence: **if this key is compromised, an attacker can mint a valid claim authorization
for any payment in escrow and pull the funds into their own wallet.** There is no other gate in
the contract.

Which is why:

- The key is read **only** in server-side code (Next.js route handler / server action)
- It is **never** given the `NEXT_PUBLIC_` prefix — that prefix bakes the variable into the browser bundle
- No module imported from a client component touches this variable
- There is a rotation path: the contract's `set_verifier(new_pubkey)` function is open to the admin

---

## 3. Layered defense — 4 layers

We don't trust a single control. In order:

### Layer 1 — `.gitignore`
`.env*` (all but `.example`), `*.pem`, `*.key`, `.stellar/`, `secrets/` and friends.
The first barrier against an accidental `git add .`.

### Layer 2 — `pre-commit` hook (the most important layer)
`.githooks/pre-commit` → `scripts/scan-secrets.sh --staged`

Scans the staged content **before the commit exists** and rejects the commit if it finds
anything. This layer is critical because it stops the secret from *entering* history at all —
cleaning it up afterwards is far harder.

Setup (once; `scripts/setup-mac.sh` does it automatically):

```bash
git config core.hooksPath .githooks
```

What it catches:

| Pattern | Example |
|---|---|
| Stellar secret seed | `S` + 55 base32 characters |
| PEM private key block | `-----BEGIN ... PRIVATE KEY-----` |
| GitHub token | `ghp_…`, `gho_…`, `github_pat_…` |
| A real value on a secret-named variable | `VERIFIER_SECRET="A9x…"` |
| Password in a Postgres URL | `postgres://user:realpass@host` |
| A secret with `NEXT_PUBLIC_` | `NEXT_PUBLIC_VERIFIER_SECRET` |
| The `.env` file itself | `.env`, `.env.local`, `.env.production` |
| Stellar identity file | `.stellar/identity/*.toml` |

Placeholders (`your-…`, `xxx…`, `process.env.…`, `<…>`) don't raise an alarm — the check applies
to the **assigned value**, not the whole line, so `DB_PASSWORD=realSecret123` is caught but
`DB_PASSWORD=your-password` is not.

If you're certain it's a false positive, add `# paytag-allow-secret` at the end of the line.
Think twice before using it — the exemption is deliberately noisy so it shows up in code review.

### Layer 3 — `pre-push` hook
If someone skips Layer 2 with `git commit --no-verify`, every tracked file is re-scanned before
the push. The last local line of defense.

### Layer 4 — CI (`gitleaks`, entire history)
On every push, GitHub Actions scans **the whole commit history** with `gitleaks`. This layer
looks backwards: if an old commit made before the local hooks were installed contains a secret,
it surfaces here.

---

## 4. Key generation — the right way

### Testnet deploy key

```bash
# Stored in the macOS Keychain, never written to disk in plaintext
stellar keys generate paytag-dev --network testnet --fund --secure-store
stellar keys address paytag-dev     # prints only the PUBLIC address
```

**Never** let `stellar keys show` land in your terminal history or a screenshot.
When recording the demo video, make sure you don't run that command.

### Verifier key

```bash
node scripts/paytag.mjs keygen      # from the repo root
```

This script **does not write the secret to stdout**; it appends it straight to
`web/.env.local` and prints only the public key. You pass the public key to the contract's `init()`.

---

## 5. Before going public — mandatory checklist

Before making the repo public, in order:

- [ ] `scripts/scan-secrets.sh --tree` → clean
- [ ] `gitleaks detect --source . --config .gitleaks.toml --log-opts="--all"` → 0 findings **across the entire history**
- [ ] `git log --all --diff-filter=A --name-only | sort -u | grep -E '\.env|\.pem|\.key|\.stellar'` → empty
- [ ] `git log -p --all | grep -cE '\bS[A-Z2-7]{55}\b'` → `0`
- [ ] The env variables in Vercel are not in the repo, only in Vercel
- [ ] No secret key, `.env` contents, or terminal history visible in any screenshot
- [ ] No `stellar keys show` output or `.env.local` contents visible in the demo video
- [ ] Supabase's redirect allow-list contains the production URL (the OAuth App's own callback points at Supabase, not at us)
- [ ] **Secret scanning** + **Push protection** enabled in the GitHub repo settings (free on public repos)

**If a secret is found in history:** deleting the commit is not enough. The right way:

1. **Rotate the secret immediately** — a leaked key is a dead key, cleanup is secondary
   (for the verifier: generate a new key → call `set_verifier`)
2. Then clean the history: `git filter-repo --invert-paths --path <file>` or rebuild the
   repo from a clean initial commit
3. Going public does not get deferred past step 1 — never go public without rotating

The order matters: revoking a leaked key is more urgent than scrubbing history, because someone
with access to the private repo may already have copied the key.

---

## 6. Vulnerability reporting

This is an MVP and a grant deliverable; it holds no mainnet funds. If you find a security
problem, write directly instead of opening an issue: mete@bronixengineering.com
