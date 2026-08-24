#![cfg(test)]
//! Phase 2.2 tests — `deposit`.
//!
//! Covered from the SPEC.md §5 red-team table: #13, #14.

use super::*;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{token, vec, Address, BytesN, Env, IntoVal, Map, Symbol, Val};

/// SPEC.md §2.3 test vector: sha256(0x00 ‖ "torvalds")
const TORVALDS: [u8; 32] = [
    0x9d, 0x86, 0x38, 0xcd, 0xf5, 0x59, 0x4e, 0xe5, 0xa5, 0x17, 0x8e, 0x3d, 0x41, 0x3f, 0xb8, 0x20,
    0x65, 0x13, 0x35, 0x6b, 0x94, 0x7d, 0xe1, 0xde, 0x60, 0x0f, 0x17, 0x85, 0x32, 0xc7, 0x06, 0x0b,
];

const START_LEDGER: u32 = 1_000;
const OK_EXPIRY: u32 = START_LEDGER + 100_000;

struct Fix<'a> {
    env: Env,
    client: PaytagEscrowClient<'a>,
    contract_id: Address,
    sender: Address,
    token: Address,
    identity: BytesN<32>,
}

/// An initialized contract + a sender holding a balance of 1000 units.
fn fix() -> Fix<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    let contract_id = env.register(PaytagEscrow, ());
    let client = PaytagEscrowClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let verifier = BytesN::from_array(&env, &[7u8; 32]);
    client.init(&admin, &verifier, &518_400);

    // Test USDC: in production we talk to the SEP-41 interface, and in tests
    // the Stellar Asset Contract provides that same interface.
    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token = sac.address();

    let sender = Address::generate(&env);
    token::StellarAssetClient::new(&env, &token).mint(&sender, &1_000);

    let identity = BytesN::from_array(&env, &TORVALDS);

    Fix {
        env,
        client,
        contract_id,
        sender,
        token,
        identity,
    }
}

fn balance(f: &Fix, who: &Address) -> i128 {
    token::Client::new(&f.env, &f.token).balance(who)
}

#[test]
fn deposit_moves_the_money_into_the_contract() {
    let f = fix();

    let id = f
        .client
        .deposit(&f.sender, &f.identity, &f.token, &250, &OK_EXPIRY);

    assert_eq!(
        id, 1,
        "the first payment id must be 1 (0 is reserved for 'none')"
    );
    assert_eq!(balance(&f, &f.sender), 750);
    assert_eq!(balance(&f, &f.contract_id), 250);

    let p = f.client.get_payment(&id);
    assert_eq!(p.from, f.sender);
    assert_eq!(p.identity, f.identity);
    assert_eq!(p.token, f.token);
    assert_eq!(p.amount, 250);
    assert_eq!(p.expiry_ledger, OK_EXPIRY);
    assert_eq!(p.status, Status::Pending);
}

#[test]
fn deposit_ids_increase() {
    let f = fix();
    let a = f
        .client
        .deposit(&f.sender, &f.identity, &f.token, &10, &OK_EXPIRY);
    let b = f
        .client
        .deposit(&f.sender, &f.identity, &f.token, &20, &OK_EXPIRY);
    let c = f
        .client
        .deposit(&f.sender, &f.identity, &f.token, &30, &OK_EXPIRY);
    assert_eq!((a, b, c), (1, 2, 3));
    assert_eq!(balance(&f, &f.contract_id), 60);
}

/// Different people can pay the same identity; each one is a separate record.
#[test]
fn multiple_senders_to_the_same_identity() {
    let f = fix();
    let second = Address::generate(&f.env);
    token::StellarAssetClient::new(&f.env, &f.token).mint(&second, &500);

    f.client
        .deposit(&f.sender, &f.identity, &f.token, &100, &OK_EXPIRY);
    f.client
        .deposit(&second, &f.identity, &f.token, &400, &OK_EXPIRY);

    assert_eq!(balance(&f, &f.contract_id), 500);
    assert_eq!(f.client.get_payment(&1).from, f.sender);
    assert_eq!(f.client.get_payment(&2).from, second);
}

/// SPEC.md §5 #13 — a zero amount is rejected.
#[test]
fn deposit_rejects_zero_amount() {
    let f = fix();
    let r = f
        .client
        .try_deposit(&f.sender, &f.identity, &f.token, &0, &OK_EXPIRY);
    assert_eq!(r, Err(Ok(Error::InvalidAmount)));
    assert_eq!(
        balance(&f, &f.sender),
        1_000,
        "no money should have moved at all"
    );
}

/// SPEC.md §5 #13 — a negative amount is rejected.
/// Without the check, a negative transfer could mean PULLING money OUT of
/// the contract.
#[test]
fn deposit_rejects_negative_amount() {
    let f = fix();
    let r = f
        .client
        .try_deposit(&f.sender, &f.identity, &f.token, &-100, &OK_EXPIRY);
    assert_eq!(r, Err(Ok(Error::InvalidAmount)));
    assert_eq!(balance(&f, &f.sender), 1_000);
}

/// SPEC.md §5 #14 — an expiry in the past is rejected.
#[test]
fn deposit_rejects_expiry_in_the_past() {
    let f = fix();
    let r = f
        .client
        .try_deposit(&f.sender, &f.identity, &f.token, &100, &(START_LEDGER - 1));
    assert_eq!(r, Err(Ok(Error::ExpiryInPast)));
}

/// Boundary: expiry == the current ledger must be rejected too.
/// Otherwise the recipient would get a zero-second window.
#[test]
fn deposit_rejects_expiry_equal_to_the_current_ledger() {
    let f = fix();
    let r = f
        .client
        .try_deposit(&f.sender, &f.identity, &f.token, &100, &START_LEDGER);
    assert_eq!(r, Err(Ok(Error::ExpiryInPast)));
}

/// An expiry beyond the TTL window is rejected.
/// If it were accepted, the record would be archived and the money would
/// become unreachable.
#[test]
fn deposit_rejects_expiry_too_far_away() {
    let f = fix();
    let too_far = START_LEDGER + MAX_EXPIRY_LEDGERS + 1;
    let r = f
        .client
        .try_deposit(&f.sender, &f.identity, &f.token, &100, &too_far);
    assert_eq!(r, Err(Ok(Error::ExpiryTooFar)));

    // The exact boundary must be accepted.
    let boundary = START_LEDGER + MAX_EXPIRY_LEDGERS;
    assert_eq!(
        f.client
            .deposit(&f.sender, &f.identity, &f.token, &100, &boundary),
        1
    );
}

/// An uninitialized contract must not accept money: with no verifier key,
/// a deposit could never be claimed.
#[test]
fn deposit_is_rejected_on_an_uninitialized_contract() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    let client = PaytagEscrowClient::new(&env, &env.register(PaytagEscrow, ()));
    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let sender = Address::generate(&env);
    let identity = BytesN::from_array(&env, &TORVALDS);

    let r = client.try_deposit(&sender, &identity, &token, &100, &OK_EXPIRY);
    assert_eq!(r, Err(Ok(Error::NotInitialized)));
}

/// Money cannot be pulled without the sender's signature.
#[test]
#[should_panic]
fn deposit_is_rejected_without_auth() {
    let f = fix();
    f.env.set_auths(&[]);
    f.client
        .deposit(&f.sender, &f.identity, &f.token, &100, &OK_EXPIRY);
}

#[test]
fn deposit_event_is_published_with_an_identity_topic() {
    let f = fix();
    let id = f
        .client
        .deposit(&f.sender, &f.identity, &f.token, &250, &OK_EXPIRY);

    // Only the escrow contract's events — the token transfer's are filtered out.
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.contract_id),
        vec![
            &f.env,
            (
                f.contract_id.clone(),
                // topics: the constant "deposit" + the dynamic identity
                (Symbol::new(&f.env, "deposit"), f.identity.clone()).into_val(&f.env),
                // data: field name -> value
                Map::<Symbol, Val>::from_array(
                    &f.env,
                    [
                        (Symbol::new(&f.env, "payment_id"), id.into_val(&f.env)),
                        (Symbol::new(&f.env, "from"), f.sender.into_val(&f.env)),
                        (Symbol::new(&f.env, "token"), f.token.into_val(&f.env)),
                        (Symbol::new(&f.env, "amount"), 250i128.into_val(&f.env)),
                        (
                            Symbol::new(&f.env, "expiry_ledger"),
                            OK_EXPIRY.into_val(&f.env)
                        ),
                    ]
                )
                .into_val(&f.env),
            )
        ]
    );
}

#[test]
fn querying_a_nonexistent_payment_errors() {
    let f = fix();
    assert_eq!(
        f.client.try_get_payment(&99),
        Err(Ok(Error::PaymentNotFound))
    );
}
