#![cfg(test)]
//! Phase 2.4 tests — `refund`.
//!
//! Covered from the SPEC.md §5 red-team table: #8, #9, #10.

use super::*;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{token, vec, Address, BytesN, Env, IntoVal, Map, Symbol, Val};

/// SPEC.md §2.3 test vector: sha256(0x00 ‖ "torvalds")
const TORVALDS: [u8; 32] = [
    0x9d, 0x86, 0x38, 0xcd, 0xf5, 0x59, 0x4e, 0xe5, 0xa5, 0x17, 0x8e, 0x3d, 0x41, 0x3f, 0xb8, 0x20,
    0x65, 0x13, 0x35, 0x6b, 0x94, 0x7d, 0xe1, 0xde, 0x60, 0x0f, 0x17, 0x85, 0x32, 0xc7, 0x06, 0x0b,
];

const START_LEDGER: u32 = 1_000;
const EXPIRY: u32 = START_LEDGER + 10_000;

struct Fix<'a> {
    env: Env,
    client: PaytagEscrowClient<'a>,
    contract_id: Address,
    sender: Address,
    token: Address,
    identity: BytesN<32>,
}

/// An initialized contract + one pending escrow of 300 units (payment id = 1).
fn fix() -> Fix<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    let contract_id = env.register(PaytagEscrow, ());
    let client = PaytagEscrowClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.init(&admin, &BytesN::from_array(&env, &[7u8; 32]), &518_400);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    let sender = Address::generate(&env);
    token::StellarAssetClient::new(&env, &token).mint(&sender, &1_000);

    let identity = BytesN::from_array(&env, &TORVALDS);
    client.deposit(&sender, &identity, &token, &300, &EXPIRY);

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
fn refund_returns_the_money_after_expiry() {
    let f = fix();
    assert_eq!(balance(&f, &f.sender), 700);
    assert_eq!(balance(&f, &f.contract_id), 300);

    f.env.ledger().set_sequence_number(EXPIRY + 1);
    f.client.refund(&1);

    assert_eq!(
        balance(&f, &f.sender),
        1_000,
        "the money must be returned in full"
    );
    assert_eq!(balance(&f, &f.contract_id), 0);
    assert_eq!(f.client.get_payment(&1).status, Status::Refunded);
}

/// SPEC.md §5 #8 — a refund before expiry is rejected.
/// Otherwise the sender could snatch the money away while the recipient was
/// getting ready to claim.
#[test]
fn refund_is_rejected_before_expiry() {
    let f = fix();
    f.env.ledger().set_sequence_number(EXPIRY - 1);

    assert_eq!(f.client.try_refund(&1), Err(Ok(Error::NotYetExpired)));
    assert_eq!(balance(&f, &f.contract_id), 300, "the money must not budge");
    assert_eq!(f.client.get_payment(&1).status, Status::Pending);
}

/// Boundary: rejected EXACTLY on the expiry ledger too.
/// The rule is "AFTER expiry_ledger has passed" — that ledger still belongs
/// to the recipient.
#[test]
fn refund_is_rejected_exactly_on_the_expiry_ledger() {
    let f = fix();
    f.env.ledger().set_sequence_number(EXPIRY);
    assert_eq!(f.client.try_refund(&1), Err(Ok(Error::NotYetExpired)));
}

/// SPEC.md §5 #10 — a payment cannot be refunded twice.
#[test]
fn refund_is_rejected_the_second_time() {
    let f = fix();
    f.env.ledger().set_sequence_number(EXPIRY + 1);
    f.client.refund(&1);

    assert_eq!(f.client.try_refund(&1), Err(Ok(Error::AlreadySettled)));
    assert_eq!(
        balance(&f, &f.sender),
        1_000,
        "there must be no double refund"
    );
}

/// SPEC.md §5 #9 — nobody but the depositor can refund.
///
/// Soroban has no notion of a "caller"; the protection comes from
/// `p.from.require_auth()`. Here we mock ONLY the attacker's authorization:
/// with no signature from the sender, the call panics.
#[test]
#[should_panic]
fn refund_cannot_be_called_by_someone_else() {
    let f = fix();
    f.env.ledger().set_sequence_number(EXPIRY + 1);

    let attacker = Address::generate(&f.env);
    f.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &f.contract_id,
            fn_name: "refund",
            args: (1u64,).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);

    f.client.refund(&1);
}

#[test]
fn a_nonexistent_payment_cannot_be_refunded() {
    let f = fix();
    f.env.ledger().set_sequence_number(EXPIRY + 1);
    assert_eq!(f.client.try_refund(&99), Err(Ok(Error::PaymentNotFound)));
}

/// Refunding one payment does not affect another.
#[test]
fn refund_only_affects_the_targeted_payment() {
    let f = fix();
    f.client
        .deposit(&f.sender, &f.identity, &f.token, &200, &(EXPIRY + 5_000));
    assert_eq!(balance(&f, &f.contract_id), 500);

    f.env.ledger().set_sequence_number(EXPIRY + 1);
    f.client.refund(&1);

    assert_eq!(f.client.get_payment(&1).status, Status::Refunded);
    assert_eq!(f.client.get_payment(&2).status, Status::Pending);
    assert_eq!(
        balance(&f, &f.contract_id),
        200,
        "number 2 must stay in the contract"
    );
}

#[test]
fn refund_event_is_published_with_an_identity_topic() {
    let f = fix();
    f.env.ledger().set_sequence_number(EXPIRY + 1);
    f.client.refund(&1);

    // NOTE: `events().all()` only holds the events of the MOST RECENT call —
    // it does not accumulate over the test. The deposit event from fix() is
    // not visible here.
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.contract_id),
        vec![
            &f.env,
            (
                f.contract_id.clone(),
                (Symbol::new(&f.env, "refund"), f.identity.clone()).into_val(&f.env),
                Map::<Symbol, Val>::from_array(
                    &f.env,
                    [
                        (Symbol::new(&f.env, "payment_id"), 1u64.into_val(&f.env)),
                        (Symbol::new(&f.env, "to"), f.sender.into_val(&f.env)),
                        (Symbol::new(&f.env, "token"), f.token.into_val(&f.env)),
                        (Symbol::new(&f.env, "amount"), 300i128.into_val(&f.env)),
                    ]
                )
                .into_val(&f.env),
            )
        ]
    );
}
