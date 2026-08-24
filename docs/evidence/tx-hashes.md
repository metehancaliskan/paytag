# Evidence — transaction hashes

On-chain verifiable records for every deliverable.

**Network:** Stellar Testnet — passphrase `Test SDF Network ; September 2015`
**RPC:** `https://soroban-testnet.stellar.org` · **Protocol:** 27

> **The testnet gets reset.** The SDF testnet is reset 2–4 times a year;
> accounts, balances, deployed contracts and the entire transaction history
> are wiped. Next scheduled reset: **2026-12-16**. After that date the
> explorer links below are dead. That is why screenshots
> (`docs/evidence/screenshots/`) and command output are kept as permanent
> evidence as well.

---

## Addresses

| Role | Address |
|---|---|
| Escrow contract (Phase 2) | [`CDN2BQNGHWCC22IXLAKBAVIOL5ID4MTH4FNYISVEARWQ4HZ27ZA7OZ3B`](https://stellar.expert/explorer/testnet/contract/CDN2BQNGHWCC22IXLAKBAVIOL5ID4MTH4FNYISVEARWQ4HZ27ZA7OZ3B) |
| Test USDC (SAC) | [`CBU7HRUSXSVPI7QHA73G67UDRQTKSEOICFHWOMWSPOZ2S3R3DIWUCPKI`](https://stellar.expert/explorer/testnet/contract/CBU7HRUSXSVPI7QHA73G67UDRQTKSEOICFHWOMWSPOZ2S3R3DIWUCPKI) |
| Sender / admin (`paytag-dev`) | `GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG` |
| USDC issuer | `GARBYOHXSSS76ZOV2FUUZOZHQER7BAA3XNBJCMXNWJYS5M3W3XTBG3LZ` |
| Recipient (`paytag-alice`) | `GDMQNCTLGOAZ7SJYBF7WYKMVW5WZ2BNLM3U654M7YMMCPQMMYBIA6WUA` |
| Verifier **public** key | `dbb4d698e7febec6390f19123733b526c1851b09491e57d3529eff78222b517b` |
| Phase 0 throwaway contract | [`CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU`](https://stellar.expert/explorer/testnet/contract/CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU) |

The verifier's **private** key lives in `web/.env.local` (gitignored, mode
600) and never touches the chain. The contract stores only the public key
and verifies the signature with `ed25519_verify`.

**Amounts:** Stellar classic assets use 7 decimal places.
`2500000000` = 250 USDC, `500000000` = 50 USDC, `100000000` = 10 USDC.

---

## Phase 0.4 — Toolchain evidence (throwaway contract)

**Date:** 2026-08-20

Goal: prove that the Rust → wasm → deploy → invoke chain works before
writing any business logic.

| Step | Value |
|---|---|
| Wasm upload tx | [`df20beb0509a8658f4711bdfb0ad8b3431e2ee7036e86c661633cf61542ef640`](https://stellar.expert/explorer/testnet/tx/df20beb0509a8658f4711bdfb0ad8b3431e2ee7036e86c661633cf61542ef640) |
| Contract creation tx | [`c5a03801aba998b3d925ab5f11142719839899875f026a2dd3ca21831883b61b`](https://stellar.expert/explorer/testnet/tx/c5a03801aba998b3d925ab5f11142719839899875f026a2dd3ca21831883b61b) |
| Wasm hash (local = chain) | `b34c5a165514737b2a598750553ea3cb5521e26554e8644fe098b3b8d4a35a9a` |
| `ping` call | `"paytag"` (read-only, no transaction sent) |

**Result: Phase 0.4 ✅**

---

## Phase 2.7 — The escrow contract's live flow

**Date:** 2026-08-21 · Starting ledger: 4,261,026

### Preparation: test USDC

There is no official Circle USDC on testnet; we issued our own asset and
wrapped it in a Stellar Asset Contract. Because the contract talks to the
SEP-41 interface, moving to mainnet USDC is a single address change.

| Step | tx |
|---|---|
| Trustline — `paytag-dev` | [`e49b76738d80fd2ed80af872e21cd91b7eb8a405b77783369a47a7b66d2efcd9`](https://stellar.expert/explorer/testnet/tx/e49b76738d80fd2ed80af872e21cd91b7eb8a405b77783369a47a7b66d2efcd9) |
| Trustline — `paytag-alice` | [`4ec19c19bf96cb946b2d3bf994ff24ee8e14012232b1f40ff08091314a6c8e2a`](https://stellar.expert/explorer/testnet/tx/4ec19c19bf96cb946b2d3bf994ff24ee8e14012232b1f40ff08091314a6c8e2a) |
| USDC → SAC deploy | [`d36c742e4ab1d9617a07b4ef3458e2cb6c8b27806235f57ce85f7810bfef9348`](https://stellar.expert/explorer/testnet/tx/d36c742e4ab1d9617a07b4ef3458e2cb6c8b27806235f57ce85f7810bfef9348) |
| Mint 1,000 USDC → `paytag-dev` | [`65a1908162d14ba9e96ee789876ab6d6ac536f0adef550553c35fb191e43bbc6`](https://stellar.expert/explorer/testnet/tx/65a1908162d14ba9e96ee789876ab6d6ac536f0adef550553c35fb191e43bbc6) |

> **Why the trustlines are needed:** classic accounts (`G…`) can only hold an
> asset after opening a trustline. Contract addresses (`C…`) keep the
> balance in contract storage, so the escrow needs no trustline. This
> distinction misled us once during development: the recipient account did
> not exist in the test, so the token transfer was rejected, and because the
> error code collided with our own `PaymentExpired` we were looking in the
> wrong place. In Soroban, error codes are per contract.

### Setup

| Step | Value |
|---|---|
| Escrow deploy tx | _(to be recorded)_ |
| `init` tx | _(to be recorded)_ |
| `get_config` verification | `admin` = `GAD3LMKO…`, `verifier` = `dbb4d698…`, `default_expiry_ledgers` = 518400 |

### End-to-end flow

The product's core promise: money can be sent to someone's identity without
them having a wallet, an account, or even any idea that Paytag exists.

**1. Escrow — 250 USDC to the `github.com/torvalds` tag**

```
identity_key = sha256(0x00 ‖ "torvalds")
             = 9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b
expiry_ledger = 4361000
payment_id    = 1
```

tx: [`adcce001c50127e2224546dc26008e99f540b3a7ad630aa7cbdb655682a2c629`](https://stellar.expert/explorer/testnet/tx/adcce001c50127e2224546dc26008e99f540b3a7ad630aa7cbdb655682a2c629)

Two events were emitted: the token transfer (sender → contract) and the
`DepositEvent` topic'd on `identity`.

**2. Verifier signature (off-chain)**

Produced with `scripts/paytag.mjs` — in Phase 3 this will be triggered by
GitHub OAuth.

```
nonce      = 7bade2458b9c9ca147c8b87f11fdac79bb46da920dcc2c0a6c949171080e23db
expires_at = 4265000
signature  = 8121f36dc7ca81f2fb07b98903f159ffda19c1e90941f52852f88ac7115cbf06
             d4a4efc6687c172c46f3ccee0fe6593293d3e390e480eb891b6f46be54f8e105
```

**3. Claim — the money moved to the recipient**

tx: [`0a553414aeacd43400653e5711aeb6fa966012939d973014fa248f8a8b2b2270`](https://stellar.expert/explorer/testnet/tx/0a553414aeacd43400653e5711aeb6fa966012939d973014fa248f8a8b2b2270)

The contract rebuilt the 195-byte preimage from the arguments and verified
it with `ed25519_verify`. The transfer went the other way this time:
contract → `GDMQNCTL…`. A `ClaimEvent` was emitted.

**4. Second escrow + refund**

| Step | Value | tx |
|---|---|---|
| Escrow, 50 USDC, short expiry (`+20` ledgers) | `payment_id = 2` | [`9f03b00cad260da21fe90f8347df1b5ea7ea906a932766afa04d26fd99ca2766`](https://stellar.expert/explorer/testnet/tx/9f03b00cad260da21fe90f8347df1b5ea7ea906a932766afa04d26fd99ca2766) |
| Refund after expiry | back to the sender | [`4e8aaa371720a3dc15e2670dde0906550b46db8530aa8d44d729e5190b44d7b5`](https://stellar.expert/explorer/testnet/tx/4e8aaa371720a3dc15e2670dde0906550b46db8530aa8d44d729e5190b44d7b5) |

**5. Live verification of a guard — early refund rejected**

| Step | Value | tx |
|---|---|---|
| Escrow, 10 USDC, expiry `+400` ledgers | `payment_id = 3` | [`fd653e5f7040dbd61a763740ed460f9ca77f0b5798658cf94d6634be094334c4`](https://stellar.expert/explorer/testnet/tx/fd653e5f7040dbd61a763740ed460f9ca77f0b5798658cf94d6634be094334c4) |
| Refund attempt before expiry | **`Error(Contract, #8)` = `NotYetExpired`** | no transaction |

```
❌ error: transaction simulation failed: HostError: Error(Contract, #8)
   [Diagnostic Event] contract:CDN2BQNG…OZ3B, topics:[error, Error(Contract, #8)]
   [Diagnostic Event] topics:[fn_call, CDN2BQNG…OZ3B, refund], data:3
```

> This attempt has **no tx hash** — the error was caught at the simulation
> stage, so the transaction was never sent to the network and no fee was
> incurred. Soroban simulates every call first; transactions that would fail
> are never written to the chain.
>
> The rule is this: the sender cannot pull the money back before the
> recipient's claim window closes.
> `test_refund::refund_is_rejected_before_expiry` was verifying this in a
> unit test; here the same rule was proven on the live network.

**Result: Phase 2.7 ✅** — `deposit`, `claim` and `refund` all three ran
on-chain; and one guard rule kicked in live as well.

---

## Phase 3 — End-to-end verification with GitHub OAuth

_(OAuth → verifier signature → claim transaction goes here)_
