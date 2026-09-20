# Submission inventory — Rise In x Stellar Pro Hackathon 2026

**Track: Scale Track.** Deadline: 20 September 2026, 12:00.
Portal: <https://www.risein.com/programs/stellar-pro-hackathon>

Everything the portal asks for, in the order it asks. Fields marked
**[CONFIRM]** are the ones only the team can fill in.

> ⚠ **You will only be evaluated for the tracks you select at submission.**
> Select **Scale Track** explicitly.

---

## 1. Team

| Field | Value |
| --- | --- |
| Team name | **[CONFIRM]** — Bronix Engineering |
| Member 1 | Bertan Kofon — bertan@bronixengineering.com — github.com/bertankofon |
| Member 2 | Metehan Çalışkan — mete@bronixengineering.com — github.com/metehancaliskan |
| Other members | **[CONFIRM]** — add anyone else who worked on this |

Scale Track eligibility: Soroban/smart-contract experience is evidenced by this
repository's own history — a Rust escrow contract with 72 tests, plus a second
contract written, deployed and measured during the event.

## 2. Links

| What | Link |
| --- | --- |
| GitHub repository (public) | <https://github.com/metehancaliskan/paytag> |
| Live demo / deployment URL | <https://paytag-six.vercel.app> |
| README (technical documentation) | <https://github.com/metehancaliskan/paytag#readme> |
| Architecture diagram (Mermaid) | [README § Architecture](../README.md#architecture) |
| Post-hackathon roadmap | [docs/ROADMAP.md](ROADMAP.md) |
| Pitch deck | **[CONFIRM]** — share the deck from its Share menu, then paste the link |
| Transaction evidence | [docs/evidence/tx-hashes.md](evidence/tx-hashes.md) |

> The pitch deck is private until it is shared. Open it, use **Share**, then put
> the link here and in the portal — judges cannot open it otherwise.

> The handbook requires the **official Stellar Pro Hackathon presentation
> template** and lists it as *TBD*. Check the portal for it before submitting.
> If a template exists, keep its structure and move the content of our deck into
> it; the slide order below already maps onto the required sections.

## 3. The narrative — why

**What we are building.** Paytag lets anyone send money to a GitHub or X
username. The payment goes into a Soroban escrow tagged with a hash of the
handle rather than a wallet address. The recipient proves the account is theirs
by signing in with it, and takes the money — to a wallet, to a lending pool, or
to a Turkish bank account as lira.

**The problem.** Stellar moves money well, but paying someone starts with
knowing their wallet address. Most of the people who deserve to be paid do not
have one, and asking is where a donation, a bounty or a freelance payout dies.

**Target users.** Open-source maintainers, creators and freelancers in Turkey
who are paid from abroad, and the people and companies who want to pay them.
Today that means a wallet address over DM, an expensive bank wire, or nothing.

**Why it is worth solving.** The last mile of crypto payments is not the
transfer — it is identity at one end and local currency at the other. Paytag
removes both: v1 removed the wallet from the sender's side, v2 removes the
blockchain from the recipient's side.

**Value proposition.** Pay a name, receive lira. The chain is an implementation
detail neither party has to understand.

## 4. MVP checklist

| Requirement | Status |
| --- | --- |
| Public GitHub repository | ✅ |
| Well-structured README | ✅ — architecture, components, integrations, trade-offs, setup |
| Smart contract(s) deployed on Stellar testnet | ✅ — two, ids below |
| Front-end / application URL | ✅ — paytag-six.vercel.app |
| Working live demo judges can interact with | ✅ — with one caveat, § 7 |
| Documented contract IDs and deployed artifacts | ✅ — [README § Deployed artifacts](../README.md#deployed-artifacts) |
| Built with the Soroban SDK | ✅ — `soroban-sdk` 26 |

### Deployed artifacts (Stellar testnet)

| What | Id |
| --- | --- |
| Paytag escrow | `CDN2BQNGHWCC22IXLAKBAVIOL5ID4MTH4FNYISVEARWQ4HZ27ZA7OZ3B` |
| XLM (SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| USDC (anchor's, SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| USDC (legacy, readable only) | `CBU7HRUSXSVPI7QHA73G67UDRQTKSEOICFHWOMWSPOZ2S3R3DIWUCPKI` |
| Blend v2 pool | `CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW` |
| XOXNO controller | `CCXRWJ6SIU2WPFEGLFGJVITPL57QAYIMIO6OAM2NBGNDQSSCK2FFV3F3` |
| XOXNO position NFT | `CDVN5JU675MEDPVRPCYC45AHFC275UH57WEU5OTFE4WFGZBNN7HTLPSY` |
| LAB escrow (the rejected experiment) | `CAKXFOP56LVXR7MSQJSEWCZVAXUXOXVACDKRUXQ7GFOINSY4RYXTMA6O` |
| Anchor home domain | `tr-mock-anchor.fly.dev` |
| Verifier public key | `dbb4d698e7febec6390f19123733b526c1851b09491e57d3529eff78222b517b` |

## 5. How we meet the three shared requirements

**1 · Integration with an eligible Stellar protocol.**
Blend v2 (on the eligible list) for recipient-side lending, plus XOXNO lending
from the wider SCF integration list. Both are read and written live on testnet.

**2 · Anchor / local payments.**
A full TRY ↔ USDC rail in both directions, implemented directly against SEP-1,
SEP-10, SEP-38 and SEP-6 (SEP-12 simulated by the sandbox anchor). A user puts
Turkish lira in at `/topup` and takes Turkish lira out at `/cashout`.

**3 · The integration is load-bearing.**
The anchor *is* the recipient's exit. Without it Paytag ends at a token balance,
which is exactly the wall the product exists to remove. Blend and XOXNO are what
the money does between arriving and being spent.

## 6. Stellar Skills used (required citation, by path)

- `SKILL.md` — [Anchors](https://github.com/CheesecakeLabs/stellar-anchor-skill/blob/main/SKILL.md).
  Shaped the whole SEP flow in `web/lib/anchor/*`, and its checklist found a real
  defect in our own code during the event (a SEP-10 token carried through a wait
  that can outlast it — now re-signed transparently).
- `skills/standards/SKILL.md` — [SEPs, CAPs & Ecosystem](https://github.com/stellar/stellar-dev-skill/blob/main/skills/standards/SKILL.md).
  Used to settle SEP-6 against SEP-24 for the ramps and to confirm SEP-41 as the
  token interface the escrow targets.
- `skills/scf-submission-radar/SKILL.md` — [SCF Submission Radar](https://github.com/lumenloop/lumenloop-skills/blob/main/skills/scf-submission-radar/SKILL.md).
  Used to shape [docs/ROADMAP.md](ROADMAP.md) as a positioning brief.

## 7. Known issue to disclose — read before the demo

**The sandbox TRY anchor's payout worker is currently stuck.** A SEP-6 deposit
reaches `pending_anchor` ("TRY received; paying USDC on Stellar") and stays
there indefinitely. Reproduced with plain HTTP against a fresh, trustlined
account, with no Paytag code in the path — so it is the shared sandbox, not our
integration. It worked end to end earlier in the event.

What to do:

1. Ask the organisers to restart the anchor's payout worker.
2. Until then, demo the off-ramp and the escrow flows, and show the on-ramp up
   to the bank instructions.
3. Our UI already degrades honestly: after three minutes of waiting it says the
   anchor has not finished, that nothing is lost, and offers to check again.

## 8. Evaluation path for a judge

1. Open <https://paytag-six.vercel.app>, connect Freighter on testnet.
2. `/send` — pay any GitHub handle in XLM or USDC. No address needed.
3. `/sent` — see it waiting, and refund it after the window if you like.
4. `/claim` — sign in with a GitHub or X account that has been paid, and take it.
5. `/topup` and `/cashout` — the lira rail, subject to § 7.
6. `/lab` is the rejected experiment and is deliberately **not** enabled on the
   deployed site. Read [docs/LAB-YIELD-ESCROW.md](LAB-YIELD-ESCROW.md) instead.

Locally:

```bash
cd contracts && cargo test    # 61 escrow + 11 laboratory tests
cd web && pnpm install && pnpm test   # 231 tests
```

## 9. Deck outline (maps onto the judging criteria)

| # | Slide | Criterion it serves |
| --- | --- | --- |
| 1 | Paytag | — |
| 2 | "What's your wallet address?" | Meaningful idea & real-world impact |
| 3 | So don't ask | Meaningful idea |
| 4 | Three steps | User experience |
| 5 | Lira in, lira out | **Ecosystem fit — highest weight** |
| 6 | The architecture | Technical implementation (Scale Track diagram) |
| 7 | Money that arrived can go to work | Ecosystem fit |
| 8 | Deployed, not described | Technical implementation |
| 9 | 0.022% — what we rejected | Technical judgement, presentation |
| 10 | Roadmap | Traction & continuity → SCF / InstAward |
| 11 | Links | Presentation & documentation |

---

*Last updated: 20 September 2026.*
