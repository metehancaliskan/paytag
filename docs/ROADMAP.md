# Roadmap — after the hackathon

*Scale Track deliverable. What Paytag becomes once the two days are over, and
which funding path each stage is aimed at.*

Paytag today is a working testnet product: money sent to a GitHub or X handle,
claimed with an OAuth-proven signature, and cashed out as Turkish lira through a
SEP-6 anchor. Everything below is about turning that into something people use
with their own money.

---

## Where it stands

| | |
| --- | --- |
| Deployed | Stellar testnet, contract ids in the [README](../README.md#deployed-artifacts) |
| Fiat rail | TRY ↔ USDC, both directions, against a sandbox anchor |
| Tests | 72 contract, 231 web, plus an opt-in live anchor round trip |
| Users | Zero real ones. Nothing below counts until that changes. |

The honest gap is the last row, and the roadmap is ordered around closing it
rather than around adding features.

---

## Stage 1 — Make it safe to hold real money *(4–6 weeks)*

Nothing else on this list matters if the trust assumption stays where it is.

**Split the verifier key.** Today a single ed25519 key can mint claims. The fix
is an *m-of-n* verifier set: the contract stores several public keys and requires
a threshold of signatures, so one compromised server is not a theft. This is a
contract change plus an operator change and is the single highest-value piece of
work in this document.

**A real audit of the escrow.** 61 tests are not an audit. The contract is small
— deposit, claim, refund, expiry — which makes it cheap to audit properly, and
the result is the thing a grant committee and a first partner both want to see.

**Mainnet deployment behind a cap.** Ship to mainnet with a per-payment ceiling
in the contract, raised deliberately as the audit and the usage justify it.

*Funding fit:* this is the body of an **SCF Build Award** application — a
specific, scoped, verifiable deliverable set with a security outcome.

---

## Stage 2 — A production anchor and real lira *(4 weeks, overlapping)*

The SEP work is done and proven; what it is pointed at is a sandbox. Replacing
it is an integration and compliance exercise, not new protocol code:

- Move from the mock to a licensed TRY anchor, and put a real SEP-12 KYC
  provider behind the fields that are currently simulated.
- Off-ramp limits, fee display, and a settlement receipt the recipient can keep.
- Withdrawal status surfaced honestly: SEP-6 transactions have states, and a
  payout that is pending should say pending.

*Success is measurable and singular:* one real person receives lira in a real
bank account from a payment made to their GitHub handle.

---

## Stage 3 — Where the users actually are *(6–8 weeks)*

Paytag's users do not start on a payments site. They start in a pull request.

- **A GitHub App** that comments a Paytag link on merged PRs from unpaid
  contributors and on issues with a bounty label — the payment offered where the
  work happened.
- **A Chrome extension** that puts a pay button beside every GitHub and X
  profile. Nobody decides to pay a maintainer while looking at our website; they
  decide it on the profile, and today that means copying a handle into another
  tab. This removes the tab.
- **Repository identities.** The `owner/repo` kind byte already exists in the
  protocol with no verification path. Verifying repo ownership through the same
  OAuth the app already does turns "pay a person" into "fund a project."
- **Splits.** A merged PR usually has more than one author. One deposit, several
  identity hashes, proportional claims.

*Funding fit:* distribution and traction, which is what turns an SCF Build Award
into a follow-on and what **InstAward** is designed to support.

---

## Stage 4 — The parts deliberately left out

Written down so they are choices rather than omissions.

- **Lending the escrow while it waits.** Built, deployed, measured, rejected.
  The yield on a real Paytag payment is cents; the cost is that solvency stops
  being a number anyone can check. [The report](LAB-YIELD-ESCROW.md).
- **Custody.** Paytag never holds keys. Every alternative that shortens the
  off-ramp by one step turns it into a money transmitter.
- **Our own wallet.** [Sembol](https://sembol.xyz) already does passkey smart
  accounts with sponsored fees on Stellar, audited and MIT-licensed. Integrating
  it is stage 3 work; rebuilding it would be a second product.
- **A token.** There is no problem here that a token solves.

---

## What we would ask for, and for what

| Stage | Ask | Deliverable a reviewer can check |
| --- | --- | --- |
| 1 | SCF Build Award | Multisig verifier live on mainnet; published audit; capped mainnet contract |
| 2 | Anchor partnership | One real TRY payout, receipt and tx hash public |
| 3 | InstAward / SCF follow-on | GitHub App installed on *n* repositories; *m* contributors paid who had no wallet beforehand |

The metric that governs all three is the same one the hackathon tracks:
**people onboarded who did not have a Stellar wallet before they were paid.**
Every stage above is judged by whether it moves that number.

---

## Team and continuity

Paytag is built by [Bronix Engineering](https://github.com/bertankofon). The
contract, the app, the anchor integration, the DeFi clients and the CI are all
in this repository with their history intact; there is nothing to hand over
because nothing was hidden. Work continues after the event regardless of the
funding outcome — the roadmap above is the order it happens in, not a conditional
plan.

*Skill used in positioning this document:
[`skills/scf-submission-radar/SKILL.md`](https://github.com/lumenloop/lumenloop-skills/blob/main/skills/scf-submission-radar/SKILL.md).*
