# Going live

Target of this document: the app on a public URL, on **testnet**, with the repo
public and no secret in it.

Decisions this reflects, so a future reader knows what was chosen and why:

| Decision | Choice | Why |
|---|---|---|
| Host | Vercel | Next 16's own platform: middleware, server components and ISR need no configuration. |
| Supabase | the existing project | The database holds no money — only "who is who". A second project is cleaner but buys little on testnet. |
| Network | testnet | Two mainnet blockers are still open: SPEC §6.4 (the admin can rotate the verifier key and authorize any claim) and §7.5 (the recipient pays the claim fee, so someone with an empty wallet cannot withdraw). |

---

## 0. The gate: no secret goes to GitHub

Run these from the repo root and read every answer before pushing. All four are
expected to come back empty or zero.

```bash
# The repo's own scanner, over every tracked file
scripts/scan-secrets.sh --tree

# Was a secret-shaped file EVER added, in any commit, on any branch?
git log --all --diff-filter=A --name-only --pretty=format: \
  | sort -u | grep -E '\.env|\.pem|\.key|\.stellar' | grep -v '\.env\.example'

# Any Stellar secret seed anywhere in history
git log -p --all | grep -cE '\bS[A-Z2-7]{55}\b'      # must print 0

# The three files that must never be tracked
git check-ignore -v web/.env.local .env _to_delete/
```

The four secrets, and where each one lives in production — none of them in the
repo, none of them in a `NEXT_PUBLIC_` variable:

| Secret | Production home |
|---|---|
| `VERIFIER_SECRET` | Vercel env var (Production) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env var (Production) |
| GitHub OAuth client secret | Supabase dashboard only — never reaches this app |
| `paytag-dev` seed | macOS Keychain only — never leaves the machine |

`docs/SECURITY.md` §5 is the full pre-public checklist. It ends with one item
that has to happen in the GitHub UI: **Settings → Code security → Secret
scanning + Push protection → on.** Both are free on public repositories, and
push protection is the only layer that stops a secret *before* it reaches the
remote.

---

## 1. Push the code

```bash
git status                      # read it; _to_delete/ must not appear
git add -A
git commit                      # the pre-commit hook scans the staged content
git push origin main
```

If the hook rejects the commit, it found something — read what it names and fix
it. `--no-verify` is the wrong answer; the pre-push hook will catch it anyway,
and CI's `gitleaks` job scans the entire history after that.

The repo can stay private through the first deploy and be flipped public once
the checklist above is green. Vercel builds a private repo just the same.

---

## 2. Vercel

**Import.** vercel.com → Add New → Project → pick the `paytag` repo.

**One setting matters:** *Root Directory* = `web`. The repo root holds the Rust
contracts; the Next app is one level down.

The framework is pinned in `web/vercel.json` rather than left to the dashboard:

```json
{ "$schema": "https://openapi.vercel.sh/vercel.json", "framework": "nextjs" }
```

That file exists because of a failure worth remembering. With the preset left at
"Other", the build ran perfectly — twelve pages prerendered, the route table
printed — and *then* died with:

```
Error: No Output Directory named "public" found after the Build completed.
```

Vercel had built a Next app and then gone looking for a plain static site's
`public/` folder. Nothing in the build log points at the framework preset, and
the deployment reads as "Error" with a green build above it. `vercel.json`
overrides the dashboard preset, so the answer now lives in the repo where the
next person will find it. Symptom to recognise: a *successful* build followed by
a missing-output error, or a deployment that goes "Ready" in two seconds and
serves 404 — that second one is the same mistake with Root Directory unset.

Everything else is detected: build `next build`, install via pnpm (the version
is pinned in `web/package.json`'s `packageManager`). If the dashboard has an
explicit **Output Directory** override, clear it — `vercel.json` sets the
framework, not that field.

**Environment variables.** Paste these into Settings → Environment Variables,
for Production *and* Preview. Values come from your `web/.env.local`, except the
two marked below.

| Variable | Value | Secret? |
|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` | public |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | public |
| `NEXT_PUBLIC_ESCROW_CONTRACT_ID` | the deployed `C…` address | public |
| `NEXT_PUBLIC_XLM_SAC_ID` | `stellar contract id asset --asset native --network testnet` | public |
| `NEXT_PUBLIC_USDC_SAC_ID` | the test USDC SAC, or leave unset for XLM only | public |
| `NEXT_PUBLIC_VERIFIER_PUBLIC_KEY` | the public half of the verifier key | public |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | public, bounded by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | **secret** |
| `VERIFIER_SECRET` | the seed the deployed contract already knows | **secret** |

Two rules that bite:

- **`NEXT_PUBLIC_*` values are baked in at build time.** Changing one and
  hitting reload does nothing; it needs a redeploy.
- **Never regenerate `VERIFIER_SECRET`.** The contract stores the matching
  public key; a new seed produces signatures the contract rejects inside
  `ed25519_verify` with no explanation. If it ever has to change, rotate the
  contract side too: `set_verifier`.

---

## 3. Point auth at the new URL

Sign-in fails on the live site until both of these are done. Neither is a code
change.

**Supabase → Authentication → URL Configuration**

- Site URL: `https://<your-domain>`
- Redirect URLs: add `https://<your-domain>/auth/callback` — keep
  `http://localhost:3000/auth/callback` so local development still works.

Supabase refuses to redirect anywhere not on that list, which is what stops a
crafted `redirectTo` from handing a fresh session to another site.

**GitHub OAuth App** — the callback URL stays
`https://<project-ref>.supabase.co/auth/v1/callback`. It points at Supabase, not
at us, so a new domain does not change it. Update *Homepage URL* to the live
domain for the consent screen's sake.

> Preview deployments get a different URL on every push, so OAuth will not work
> on them unless that exact URL is on the redirect list. Test sign-in on
> production or on localhost.

---

## 4. Check the live site in this order

Each step only depends on the ones before it, so the first failure tells you
where to look.

1. `/` loads → the build and the public env vars are fine.
2. `/app` lists people → Supabase URL and anon key are fine, and RLS lets a
   stranger read published cards.
3. A person's page (`/p/gh/<handle>`) shows what is waiting in escrow → the RPC
   URL and the escrow address are fine.
4. Sign in with GitHub → the redirect list and the provider are fine.
5. `/app/submit`, publish a card → your session can write through RLS.
6. Send a small amount to your own handle from a second wallet, then claim it →
   the verifier secret in Vercel matches the key in the contract. **This is the
   one that proves production end to end.** The hash goes in
   `docs/evidence/tx-hashes.md`.

If step 6 fails with a signature error, it is almost always the wrong
`VERIFIER_SECRET`. Compare `get_config` on the contract against
`NEXT_PUBLIC_VERIFIER_PUBLIC_KEY`.

---

## 5. What the live site is honest about

Nothing here needs hiding — it is already on the pages themselves, and a
reviewer reads it as care rather than weakness:

- The testnet strip across the top says the money is worth nothing.
- The accepted risks — the admin can rotate the verifier key (SPEC §6.4), and
  what has *not* been proven yet — are in `docs/SPEC.md` and
  `docs/evidence/tx-hashes.md`. They used to be on a `/evidence` page in the
  header; that page was removed, so this repository is now the only place a
  reviewer finds them. Say so when handing the deployment over.
- The X button is inert, with the reason in SPEC §7.4.

The mainnet gate, stated once so it does not get lost: §6.4 (admin power over
the verifier key) and §7.5 (who pays the claim fee) both need answers before
real money is involved. Deploying to testnet is not a step toward mainnet; it is
a demo of a thing that already works.
