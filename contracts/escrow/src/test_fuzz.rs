#![cfg(test)]
//! Phase 2.6 — the solvency invariant (property-based test).
//!
//! SPEC.md §5 #15.
//!
//! The tests up to this point cover the scenarios we **thought of**. This
//! one hunts for what we did not: it runs randomly generated sequences of
//! `deposit` / `claim` / `refund` / "advance the ledger" and, after every
//! step, forces a single invariant:
//!
//! ```text
//! the contract's token balance == the sum of the payments still Pending
//! ```
//!
//! Equality is a stronger claim than inequality. Had we written `>=` we would
//! only be saying "money does not disappear"; `==` also says "no ownerless
//! money piles up in the contract". Either one breaking is the same class of
//! bug: the link between a state transition and a money movement coming apart.

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use proptest::prelude::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, vec as svec, Address, BytesN, Env};
use std::vec::Vec as StdVec;

/// Three separate identities: spreading payments across different tags also
/// puts pressure on whether identities can get mixed up.
const IDENTS: [[u8; 32]; 3] = [[0x11; 32], [0x22; 32], [0x33; 32]];

const START_LEDGER: u32 = 1_000;
const MINT: i128 = 1_000_000;

/// An abstract operation produced by the model.
#[derive(Debug, Clone)]
enum Op {
    Deposit {
        sender: u8,
        identity: u8,
        amount: i128,
        expiry_offset: u32,
    },
    /// `ids` is interpreted as indices into the payment ids; they may be
    /// invalid or repeated — by contract, the whole call must then roll back.
    Claim {
        identity: u8,
        ids: StdVec<u8>,
    },
    Refund {
        id: u8,
    },
    Advance {
        ledger: u32,
    },
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        4 => (0u8..3, 0u8..3, 1i128..5_000, 1u32..40_000).prop_map(
            |(sender, identity, amount, expiry_offset)| Op::Deposit {
                sender,
                identity,
                amount,
                expiry_offset,
            }
        ),
        3 => (0u8..3, prop::collection::vec(0u8..12, 1..4))
            .prop_map(|(identity, ids)| Op::Claim { identity, ids }),
        2 => (0u8..12).prop_map(|id| Op::Refund { id }),
        2 => (1u32..25_000).prop_map(|ledger| Op::Advance { ledger }),
    ]
}

/// The test-side mirror: keeps an independent account of what the contract
/// ought to be doing.
struct Mirror {
    amount: i128,
    pending: bool,
}

struct World {
    env: Env,
    client: PaytagEscrowClient<'static>,
    contract: Address,
    token: Address,
    senders: StdVec<Address>,
    recipient: Address,
    sk: SigningKey,
    nonce_counter: u64,
    mirror: StdVec<Mirror>,
}

fn setup() -> World {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    let sk = SigningKey::from_bytes(&[5u8; 32]);
    let contract = env.register(PaytagEscrow, ());
    let client = PaytagEscrowClient::new(&env, &contract);
    client.init(
        &Address::generate(&env),
        &BytesN::from_array(&env, &sk.verifying_key().to_bytes()),
        &518_400,
    );

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let sac = token::StellarAssetClient::new(&env, &token);

    let mut senders = StdVec::new();
    for _ in 0..3 {
        let a = Address::generate(&env);
        sac.mint(&a, &MINT);
        senders.push(a);
    }

    World {
        recipient: Address::generate(&env),
        env,
        client,
        contract,
        token,
        senders,
        sk,
        nonce_counter: 0,
        mirror: StdVec::new(),
    }
}

fn strkey56(addr: &Address) -> [u8; 56] {
    let mut buf = [0u8; 56];
    addr.to_string().copy_into_slice(&mut buf);
    buf
}

/// The SPEC.md §4.1 layout — built independently of the contract.
fn sign(w: &World, identity: &[u8; 32], expires_at: u32, nonce: &[u8; 32]) -> BytesN<64> {
    let mut b = [0u8; 195];
    b[0..15].copy_from_slice(b"paytag.claim.v1");
    b[15..71].copy_from_slice(&strkey56(&w.contract));
    b[71..103].copy_from_slice(identity);
    b[103..159].copy_from_slice(&strkey56(&w.recipient));
    b[159..163].copy_from_slice(&expires_at.to_be_bytes());
    b[163..195].copy_from_slice(nonce);
    BytesN::from_array(&w.env, &w.sk.sign(&b).to_bytes())
}

fn contract_balance(w: &World) -> i128 {
    token::Client::new(&w.env, &w.token).balance(&w.contract)
}

fn pending_total(w: &World) -> i128 {
    w.mirror
        .iter()
        .filter(|m| m.pending)
        .map(|m| m.amount)
        .sum()
}

/// The invariant. Called after every operation.
fn invariant(w: &World, at: &str) -> Result<(), TestCaseError> {
    let actual = contract_balance(w);
    let expected = pending_total(w);
    prop_assert_eq!(
        actual,
        expected,
        "SOLVENCY BROKEN ({}): the contract holds {}, pending payments total {}",
        at,
        actual,
        expected
    );
    Ok(())
}

fn apply_op(w: &mut World, op: &Op) -> Result<(), TestCaseError> {
    match op {
        Op::Deposit {
            sender,
            identity,
            amount,
            expiry_offset,
        } => {
            let now = w.env.ledger().sequence();
            let from = w.senders[*sender as usize].clone();
            let ident = BytesN::from_array(&w.env, &IDENTS[*identity as usize]);

            let r = w
                .client
                .try_deposit(&from, &ident, &w.token, amount, &(now + expiry_offset));
            if r.is_ok() {
                w.mirror.push(Mirror {
                    amount: *amount,
                    pending: true,
                });
            }
        }

        Op::Claim { identity, ids } => {
            if w.mirror.is_empty() {
                return Ok(());
            }
            let now = w.env.ledger().sequence();
            let ident_raw = IDENTS[*identity as usize];
            let ident = BytesN::from_array(&w.env, &ident_raw);

            // A fresh nonce for every claim: replay is not what we are testing
            // here, and NonceAlreadyUsed would cut everything short and make
            // the search shallow.
            w.nonce_counter += 1;
            let mut nonce_raw = [0u8; 32];
            nonce_raw[..8].copy_from_slice(&w.nonce_counter.to_be_bytes());
            let nonce = BytesN::from_array(&w.env, &nonce_raw);

            let expires_at = now + 100;
            let sig = sign(w, &ident_raw, expires_at, &nonce_raw);

            let mut list = svec![&w.env];
            let mut selected: StdVec<usize> = StdVec::new();
            for i in ids {
                let idx = *i as usize;
                list.push_back((idx as u64) + 1); // ids start at 1
                selected.push(idx);
            }

            let r = w
                .client
                .try_claim(&list, &ident, &w.recipient, &nonce, &expires_at, &sig);

            // The call either goes through entirely or has no effect (atomicity).
            if r.is_ok() {
                for idx in selected {
                    w.mirror[idx].pending = false;
                }
            }
        }

        Op::Refund { id } => {
            let idx = *id as usize;
            let r = w.client.try_refund(&((idx as u64) + 1));
            if r.is_ok() {
                w.mirror[idx].pending = false;
            }
        }

        Op::Advance { ledger } => {
            let next = w.env.ledger().sequence() + ledger;
            w.env.ledger().set_sequence_number(next);
        }
    }
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 160,
        max_shrink_iters: 2_000,
        ..ProptestConfig::default()
    })]

    /// SPEC.md §5 #15 — the contract balance and the pending payments are
    /// always equal.
    #[test]
    fn solvency_holds_for_every_sequence(ops in prop::collection::vec(op_strategy(), 1..45)) {
        let mut w = setup();
        invariant(&w, "start")?;

        for (i, op) in ops.iter().enumerate() {
            apply_op(&mut w, op)?;
            invariant(&w, &std::format!("operation {}: {:?}", i + 1, op))?;
        }
    }
}

/// We also pin down by hand the kind of scenario the fuzzer is expected to
/// find: a claim racing a refund on the same payment (SPEC.md §5 #11).
/// Whichever lands first, the other must be rejected and the money must not
/// leave twice.
#[test]
fn claim_and_refund_cannot_race_on_the_same_payment() {
    let mut w = setup();
    let now = w.env.ledger().sequence();
    let ident_raw = IDENTS[0];
    let ident = BytesN::from_array(&w.env, &ident_raw);

    let id = w
        .client
        .deposit(&w.senders[0], &ident, &w.token, &500, &(now + 50));
    w.mirror.push(Mirror {
        amount: 500,
        pending: true,
    });

    // The claim goes through before expiry.
    let expires_at = now + 10;
    let nonce_raw = [0x7u8; 32];
    let sig = sign(&w, &ident_raw, expires_at, &nonce_raw);
    w.client.claim(
        &svec![&w.env, id],
        &ident,
        &w.recipient,
        &BytesN::from_array(&w.env, &nonce_raw),
        &expires_at,
        &sig,
    );
    w.mirror[0].pending = false;

    // After expiry the sender tries to get the same payment refunded.
    w.env.ledger().set_sequence_number(now + 100);
    assert_eq!(
        w.client.try_refund(&id),
        Err(Ok(Error::AlreadySettled)),
        "a claimed payment must not be refundable"
    );

    assert_eq!(contract_balance(&w), 0);
    assert_eq!(pending_total(&w), 0);
    assert_eq!(
        token::Client::new(&w.env, &w.token).balance(&w.recipient),
        500,
        "the money must leave only once"
    );
}
