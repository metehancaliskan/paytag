# An escrow that lends while it waits

*A laboratory report. Written after building the thing, deploying it to testnet,
and putting real money through it.*

**The question.** Paytag's escrow holds money still. A payment sits in the
contract from the moment it is sent until somebody claims it — days, sometimes
weeks — and earns nothing the entire time. What if it were lent out instead, the
instant it arrived, so that the waiting itself paid?

**The short answer.** It works. It is deployed, it has been tested, and money
has gone in and come back out worth more than it went in. It is also not worth
shipping, and the reason is arithmetic rather than engineering. The numbers are
below; the verdict is at the bottom.

---

## 1. What was built

Nothing in the product was touched. This is a separate contract under a separate
id, reached from a separate page, and no code path in Paytag calls it.

| | |
| --- | --- |
| Contract | `contracts/lab-yield` — Rust, `soroban-sdk` 26, 510 lines |
| Deployed | `CAKXFOP56LVXR7MSQJSEWCZVAXUXOXVACDKRUXQ7GFOINSY4RYXTMA6O` (testnet) |
| Lends into | Blend v2 pool `CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW` |
| UI | `/lab`, `noindex`, its own panel, reads nothing the product writes |
| Tests | 11 contract tests against a mock pool; the product's 61 still pass untouched |

### How it works

`deposit` pulls the money in, hands it to the pool in the same transaction, and
records the position the pool issued. `claim` and `refund` convert the position
back and pay out principal *plus* whatever it earned. Nothing is credited along
the way and no interest is tracked: a Blend supply position is simply worth more
as the pool's rate climbs, so the same holding pays more later.

The one piece of machinery worth naming is how an escrow lets a pool take its
money. The pool calls `transfer` on the token *as the escrow*, which the escrow
has to authorise for itself before making the call:

```rust
env.authorize_as_current_contract(vec![
    &env,
    InvokerContractAuthEntry::Contract(SubContractInvocation {
        context: ContractContext {
            contract: token.clone(),
            fn_name: symbol_short!("transfer"),
            args: (escrow.clone(), pool.clone(), amount).into_val(&env),
        },
        sub_invocations: vec![&env],
    }),
]);
```

That single authorisation is scoped to one token, one recipient and one amount —
not a blanket approval — which is the only reason a contract handing its balance
to somebody else's contract is defensible at all.

### What it deliberately does not do

There is no verifier signature. The production escrow will not release a stroop
without an ed25519 authorization proving the claimant owns the handle; the lab
takes an address and believes it. That was on purpose: the experiment was about
whether the *money* mechanics hold, and a second unproven thing would have made
any failure impossible to attribute. It is also why this is not a feature flag
on the real contract.

---

## 2. What was proven on chain

Two real deposits, made from a throwaway key, into the live Blend testnet pool:

| Payment | Sent | Principal recorded | Position bought | Value now |
| --- | --- | --- | --- | --- |
| #1 | 20 XLM | `199999999` | `199927694` bTokens | `200000000` |
| #2 | 50 XLM | `499999999` | `499819235` bTokens | `500000001` |

Both were worth more than what was owed on them, which is the whole claim the
experiment had to survive. #1 has since been claimed to a fresh account and paid
out `200000000` — twenty whole XLM, against a recorded debt of `199999999` —
which is the proof that the money comes back out of the pool as well as going
in. #2 is still pending and still growing.

The `/lab` page shows the two figures side by side — *owed to claimants* against
*held in the pool* — because on this design that comparison is the only way to
know the contract can pay.

### The bug that only a real pool finds

The first deployment recorded the *deposited* amount as the debt. Buying a
position rounds down, so 20 XLM bought a position worth 19.9999999 XLM and the
escrow immediately owed one stroop more than it held. Insolvent on arrival, by
one stroop, on a contract whose entire job is to be able to pay.

The fix is one line and it is the right line:

```rust
// WHAT IS OWED IS WHAT IS HELD, not what was handed over.
let credited = Self::underlying(&env, &cfg.pool, &token, b_tokens)?;
let principal = if credited < amount { credited } else { amount };
```

The sender loses up to one stroop per payment and the contract is never in
deficit. Worth recording that the mock pool had not caught this: the first mock
returned `b_rate` as a flat field, while Blend nests it under `data`, so the
contract's read failed against the real pool with `#21 RateUnreadable`. **A
stand-in that is easier to satisfy than the real thing is worse than no
stand-in.** Both were corrected, and the tests now assert the one-stroop
behaviour rather than ignoring it.

---

## 3. What it costs

Three things stop being true the moment an escrow lends, and none of them are
bugs. They are the design.

### 3.1 Solvency stops being an identity

Paytag's escrow can prove it can pay by reading one number: its balance equals
the sum of everything pending, always, exactly. That is an identity — a thing
that is either true or the contract is broken, checkable by anyone in one call.

A lending escrow replaces it with `value(positions) >= sum of principals`. That
is not an identity. It is a *valuation*, it depends on a number a third party
publishes, and it holds only while that number climbs. Blend socialises bad debt
across suppliers when a default outruns the backstop — exactly the case where it
does not climb. The escrow would then owe more than it holds, through nobody's
fault inside Paytag, and the loss would land on whichever claimant arrived last.

### 3.2 Claiming acquires a dependency

Paying out now needs the pool to have liquidity and to be unpaused. An escrow
that could always pay can now be told to wait by somebody else's contract. For a
product whose promise is *"the money is there whenever you turn up"*, that is a
change in kind, not in degree.

### 3.3 It is the sender's risk, taken on the recipient's behalf

Neither party asked for a lending position. The sender wanted to pay somebody;
the recipient wanted to be paid. Putting the money in a pool between those two
moments is a third thing, done by default, by a product neither of them thought
they were opting into.

### 3.4 And it is measurably heavier

Same deposit, 10 XLM of XLM, simulated against both contracts from the same
account on the same ledger:

| | Production escrow | Lab escrow | |
| --- | --- | --- | --- |
| CPU instructions | 967,771 | 5,400,552 | **5.6×** |
| Ledger entries touched | 6 | 16 | 2.7× |
| Write bytes | 1,088 | 1,960 | 1.8× |
| Minimum resource fee | 797,822 stroops | 898,076 stroops | +12.6% |

The fee difference is small. The instruction count is not: 5.4M against a 100M
per-transaction ceiling, with three contracts in the call chain, is why the lab
client has to inflate the simulated resources before submitting — the estimate
was tight enough to fail on the way through. Every extra contract in the path is
another thing that can be paused, upgraded, or reverted underneath a payment.

---

## 4. The economics, which is where it actually dies

The Blend XLM pool's supply rate, measured directly off `b_rate` on testnet,
sampled every two minutes while this was being written:

| | |
| --- | --- |
| Pool utilisation | 23.8% (140,629 XLM borrowed against 589,537 supplied) |
| `b_rate` growth | 3.21 × 10⁻⁹ over 465 seconds |
| **Annualised** | **0.022%** |

At that rate the 20 XLM position earned exactly **one stroop** in the fifty
minutes it was live — which was, to the stroop, enough to repay the rounding
loss from §2 and nothing more. The live claim settled for `200000000`, so the
claimant received 20.0000000 XLM against a 20 XLM deposit and a recorded debt of
`199999999` ([tx `c5196d14`](https://stellar.expert/explorer/testnet/tx/c5196d1422e8a892a5359920702ee8de0231ac5aa81cb18967b9e4f5b9f89cc3)).
The round trip is whole. The profit is zero.

Testnet rates are not mainnet rates, so take a realistic mainnet supply APY of
**5%** and ask what a Paytag escrow would actually earn. The typical payment is
small and the typical claim window is short — that is the product working, not
failing:

| Payment | Unclaimed for | Earns at 5% APY |
| --- | --- | --- |
| $20 | 2 days | $0.0055 |
| $50 | 7 days | $0.048 |
| $200 | 30 days | $0.82 |
| $1,000 | 90 days | $12.33 |

The extra gas on the deposit alone is ~100,000 stroops, and the claim pays a
withdrawal on top. At 5% APY a 20 XLM escrow needs roughly **four days just to
cover the extra gas of having been lent** — and the median escrow is claimed
faster than that. For the payments Paytag is actually for, the yield is smaller
than the cost of producing it.

This is the finding. Not that it cannot be built — it is built, it is deployed,
it works — but that the thing it produces is worth a few cents, while the
solvency guarantee it spends is worth the entire product.

---

## 5. What is genuinely impossible, and what merely was not done

**Impossible as designed:**

- *Solvency as a one-number check.* Gone permanently. Any lending escrow is a
  valuation, not a balance. No amount of care recovers this.
- *Paying out independently of the pool.* A claim needs pool liquidity. You can
  keep a buffer, which means not lending the buffer, which shrinks the yield
  that motivated the exercise.
- *Yield on an asset the pool does not list.* The contract refuses such a
  deposit outright, before touching the money. A multi-asset Paytag would have
  to fall back to the plain escrow per asset, i.e. run both contracts.

**Possible, just not done here:**

- The verifier signature. Straightforward — it is the production escrow's code,
  and the lab left it out to isolate the variable.
- Splitting the yield between sender and recipient. The contract pays it all to
  whoever ends up with the principal, which is the only rule that needs no
  explaining; any split is a policy decision, not a technical one.
- Emissions. Supplying to Blend accrues BLND, which this contract never claims,
  so it is currently leaving a second yield on the table. That would raise the
  numbers in §4 — and it is already implemented on the *recipient* side, where
  it belongs.

---

## 6. DEĞER Mİ? — the verdict

**No, not for Paytag, and not because it was hard.**

It is worth having built. It answers the question with measurements instead of
opinions, it is a genuine piece of Soroban composability — an escrow that safely
authorises another protocol to move its money — and it is a better demo than the
argument would have been.

It is not worth shipping, for three reasons in descending order of weight:

1. **The yield is cents and the guarantee is the product.** §4. A user's mental
   model of Paytag is "the money is waiting for me." Trading a provable version
   of that for $0.05 is a bad trade at any exchange rate.
2. **The risk lands on the wrong person.** The recipient did not choose Blend,
   and would be the one holding the loss if the pool socialised bad debt.
3. **It is already solved on the right side of the transaction.** Paytag
   *already* offers Blend and XOXNO on the claim page. The recipient opts in
   knowingly, after the money is theirs, with their own risk appetite, and can
   pull it out whenever they like. Same yield, correct consent, none of the
   solvency cost.

The version that *would* be defensible, if this is ever revisited: **opt-in, by
the sender, above a threshold.** A sender paying a $5,000 bounty with a 90-day
window, who ticks a box saying they understand the money is lent and who takes
the yield back on refund, is a different proposition — a real amount, a real
duration, and consent from the party whose money it is. The contract in this
directory is most of that build. The default must stay: the money sits still.

---

## 7. Reproducing this

```bash
cargo test -p lab-yield-escrow           # 11 tests, mock pool
cargo test                               # 61 production tests, untouched
```

The page is at `/lab` and appears only when `NEXT_PUBLIC_LAB_ESCROW_ID` is set —
it is deliberately absent from the deployed site's environment, so the
production app has no laboratory in it at all.

The contract's own header comment carries the same warnings as §3, so that
nobody reads the code without reading the cost.
