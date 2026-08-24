#![cfg(test)]
//! Phase 2.3 tests — `claim`. The contract's most critical block.
//!
//! Covered from the SPEC.md §5 red-team table:
//! #1 forged signature, #2 replay, #3 cross-contract transplant, #4 recipient
//! swap, #5 identity swap, #6 expired signature, #7 double claim,
//! #12 batch atomicity.

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{token, vec, Address, BytesN, Env, IntoVal, Map, String, Symbol, Val};

/// SPEC.md §2.3: sha256(0x00 ‖ "torvalds")
const TORVALDS: [u8; 32] = [
    0x9d, 0x86, 0x38, 0xcd, 0xf5, 0x59, 0x4e, 0xe5, 0xa5, 0x17, 0x8e, 0x3d, 0x41, 0x3f, 0xb8, 0x20,
    0x65, 0x13, 0x35, 0x6b, 0x94, 0x7d, 0xe1, 0xde, 0x60, 0x0f, 0x17, 0x85, 0x32, 0xc7, 0x06, 0x0b,
];
/// SPEC.md §2.3: sha256(0x00 ‖ "metehancaliskan")
const METEHAN: [u8; 32] = [
    0x91, 0xe2, 0x3a, 0x08, 0x97, 0x3a, 0xba, 0x69, 0xe1, 0x46, 0x64, 0xcb, 0x9e, 0x12, 0xcc, 0x20,
    0x48, 0x3a, 0x4f, 0x70, 0x2a, 0xfd, 0xd3, 0x04, 0xc8, 0xad, 0x74, 0x24, 0xa3, 0x54, 0xff, 0xff,
];

const START_LEDGER: u32 = 1_000;
const PAY_EXPIRY: u32 = START_LEDGER + 10_000;
const SIG_EXPIRES: u32 = START_LEDGER + 500;
const NONCE_A: [u8; 32] = [0xAA; 32];
const NONCE_B: [u8; 32] = [0xBB; 32];

struct Fix<'a> {
    env: Env,
    client: PaytagEscrowClient<'a>,
    contract_id: Address,
    sender: Address,
    recipient: Address,
    token: Address,
    identity: BytesN<32>,
    sk: SigningKey,
}

fn fix() -> Fix<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    // The verifier keypair. In production the private key stays on the server;
    // here the test holds it so it can produce signatures.
    let sk = SigningKey::from_bytes(&[3u8; 32]);
    let verifier = BytesN::from_array(&env, &sk.verifying_key().to_bytes());

    let contract_id = env.register(PaytagEscrow, ());
    let client = PaytagEscrowClient::new(&env, &contract_id);
    client.init(&Address::generate(&env), &verifier, &518_400);

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let sender = Address::generate(&env);
    token::StellarAssetClient::new(&env, &token).mint(&sender, &1_000);

    let identity = BytesN::from_array(&env, &TORVALDS);
    let recipient = Address::generate(&env);

    Fix {
        env,
        client,
        contract_id,
        sender,
        recipient,
        token,
        identity,
        sk,
    }
}

fn balance(f: &Fix, who: &Address) -> i128 {
    token::Client::new(&f.env, &f.token).balance(who)
}

fn strkey56(addr: &Address) -> [u8; 56] {
    let mut buf = [0u8; 56];
    addr.to_string().copy_into_slice(&mut buf);
    buf
}

/// Builds the SAME layout as `claim_preimage` in the contract, independently.
/// Deliberately does not call the contract's code: if the two implementations
/// diverge, the tests should catch it. SPEC.md §4.1
fn preimage(
    contract: &Address,
    identity: &[u8; 32],
    recipient: &Address,
    expires_at: u32,
    nonce: &[u8; 32],
) -> [u8; 195] {
    let mut b = [0u8; 195];
    b[0..15].copy_from_slice(b"paytag.claim.v1");
    b[15..71].copy_from_slice(&strkey56(contract));
    b[71..103].copy_from_slice(identity);
    b[103..159].copy_from_slice(&strkey56(recipient));
    b[159..163].copy_from_slice(&expires_at.to_be_bytes());
    b[163..195].copy_from_slice(nonce);
    b
}

/// The verifier's authorization signature.
fn sign(
    sk: &SigningKey,
    contract: &Address,
    identity: &[u8; 32],
    recipient: &Address,
    expires_at: u32,
    nonce: &[u8; 32],
) -> [u8; 64] {
    sk.sign(&preimage(contract, identity, recipient, expires_at, nonce))
        .to_bytes()
}

/// Produces the correct signature (the happy path).
fn valid_signature(f: &Fix, nonce: &[u8; 32]) -> BytesN<64> {
    BytesN::from_array(
        &f.env,
        &sign(
            &f.sk,
            &f.contract_id,
            &TORVALDS,
            &f.recipient,
            SIG_EXPIRES,
            nonce,
        ),
    )
}

fn deposit(f: &Fix, amount: i128) -> u64 {
    f.client
        .deposit(&f.sender, &f.identity, &f.token, &amount, &PAY_EXPIRY)
}

// --------------------------------------------------------------- happy path

#[test]
fn claim_with_a_valid_signature_pays_the_recipient() {
    let f = fix();
    let id = deposit(&f, 300);
    assert_eq!(balance(&f, &f.contract_id), 300);
    assert_eq!(balance(&f, &f.recipient), 0);

    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &valid_signature(&f, &NONCE_A),
    );

    assert_eq!(balance(&f, &f.recipient), 300);
    assert_eq!(balance(&f, &f.contract_id), 0);
    assert_eq!(f.client.get_payment(&id).status, Status::Claimed);
}

/// A single signature can collect several payments.
#[test]
fn claim_collects_multiple_payments_in_one_call() {
    let f = fix();
    let a = deposit(&f, 100);
    let b = deposit(&f, 200);
    let c = deposit(&f, 50);

    f.client.claim(
        &vec![&f.env, a, b, c],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &valid_signature(&f, &NONCE_A),
    );

    assert_eq!(balance(&f, &f.recipient), 350);
    assert_eq!(balance(&f, &f.contract_id), 0);
}

// ---------------------------------------------------------- signature attacks

/// SPEC.md §5 #1 — a made-up signature is rejected.
#[test]
#[should_panic]
fn claim_rejects_a_forged_signature() {
    let f = fix();
    let id = deposit(&f, 300);
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &BytesN::from_array(&f.env, &[9u8; 64]),
    );
}

/// A signature that is valid but made with a different key is rejected too.
#[test]
#[should_panic]
fn claim_rejects_a_signature_from_another_key() {
    let f = fix();
    let id = deposit(&f, 300);
    let wrong_sk = SigningKey::from_bytes(&[99u8; 32]);
    let sig = sign(
        &wrong_sk,
        &f.contract_id,
        &TORVALDS,
        &f.recipient,
        SIG_EXPIRES,
        &NONCE_A,
    );
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &BytesN::from_array(&f.env, &sig),
    );
}

/// SPEC.md §5 #4 — swap the recipient and the signature no longer holds.
/// Someone in the middle cannot substitute their own address and redirect
/// the money.
#[test]
#[should_panic]
fn claim_rejects_a_signature_for_another_recipient() {
    let f = fix();
    let id = deposit(&f, 300);
    let attacker = Address::generate(&f.env);

    // The signature was produced for f.recipient, the call is made for attacker.
    let sig = valid_signature(&f, &NONCE_A);
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &attacker,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &sig,
    );
}

/// SPEC.md §5 #5 — a signature obtained for another identity cannot be used.
#[test]
#[should_panic]
fn claim_rejects_a_signature_for_another_identity() {
    let f = fix();
    let id = deposit(&f, 300);

    // A signature for metehancaliskan, trying to withdraw torvalds' money.
    let sig = sign(
        &f.sk,
        &f.contract_id,
        &METEHAN,
        &f.recipient,
        SIG_EXPIRES,
        &NONCE_A,
    );
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &BytesN::from_array(&f.env, &sig),
    );
}

/// SPEC.md §5 #3 — a signature cannot be transplanted to another contract
/// that uses the same verifier. The contract_id inside the preimage prevents it.
#[test]
#[should_panic]
fn claim_rejects_a_signature_for_another_contract() {
    let f = fix();
    let id = deposit(&f, 300);

    // A second escrow contract; the signature is produced for its address.
    let second = register_second_contract(&f);
    let sig = sign(
        &f.sk,
        &second,
        &TORVALDS,
        &f.recipient,
        SIG_EXPIRES,
        &NONCE_A,
    );

    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &BytesN::from_array(&f.env, &sig),
    );
}

fn register_second_contract(f: &Fix) -> Address {
    f.env.register(PaytagEscrow, ())
}

/// SPEC.md §5 #6 — an expired signature cannot be used.
/// Authorization that leaks once must not become a permanent backdoor.
#[test]
fn claim_rejects_an_expired_signature() {
    let f = fix();
    let id = deposit(&f, 300);
    f.env.ledger().set_sequence_number(SIG_EXPIRES + 1);

    let r = f.client.try_claim(
        &vec![&f.env, id],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &valid_signature(&f, &NONCE_A),
    );
    assert_eq!(r, Err(Ok(Error::SignatureExpired)));
    assert_eq!(balance(&f, &f.contract_id), 300, "the money must not budge");
}

/// A signature whose lifetime runs past the contract's ceiling is refused with
/// its own error code, not with the deposit-window one.
///
/// The distinction matters to whoever has to read the failure: telling someone
/// their escrow window is too long when the real problem is the authorization
/// sends them looking in the wrong place entirely.
#[test]
fn claim_rejects_a_signature_that_lives_too_long() {
    let f = fix();
    let id = deposit(&f, 300);

    let far = START_LEDGER + MAX_EXPIRY_LEDGERS + 1;
    let sig = BytesN::from_array(
        &f.env,
        &sign(
            &f.sk,
            &f.contract_id,
            &TORVALDS,
            &f.recipient,
            far,
            &NONCE_A,
        ),
    );

    let r = f.client.try_claim(
        &vec![&f.env, id],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &far,
        &sig,
    );
    // The signature itself is perfectly valid — it is the window that is not.
    assert_eq!(r, Err(Ok(Error::SignatureLifetimeTooLong)));
    assert_eq!(balance(&f, &f.contract_id), 300, "the money must not budge");
}

/// SPEC.md §5 #2 — the same nonce cannot be used twice (replay).
#[test]
fn claim_rejects_the_same_nonce_twice() {
    let f = fix();
    let a = deposit(&f, 100);
    let b = deposit(&f, 200);
    let sig = valid_signature(&f, &NONCE_A);

    f.client.claim(
        &vec![&f.env, a],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &sig,
    );

    // Try to withdraw the second payment too, with the same signature and nonce.
    let r = f.client.try_claim(
        &vec![&f.env, b],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &sig,
    );
    assert_eq!(r, Err(Ok(Error::NonceAlreadyUsed)));
    assert_eq!(
        balance(&f, &f.recipient),
        100,
        "only the first claim may go through"
    );
}

/// A second claim with a different nonce is legitimate.
#[test]
fn claim_works_a_second_time_with_a_different_nonce() {
    let f = fix();
    let a = deposit(&f, 100);
    let b = deposit(&f, 200);

    f.client.claim(
        &vec![&f.env, a],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &valid_signature(&f, &NONCE_A),
    );
    f.client.claim(
        &vec![&f.env, b],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_B),
        &SIG_EXPIRES,
        &valid_signature(&f, &NONCE_B),
    );

    assert_eq!(balance(&f, &f.recipient), 300);
}

// ------------------------------------------------------------ payment rules

/// SPEC.md §5 #7 — the same payment cannot be claimed twice.
#[test]
fn a_claimed_payment_cannot_be_claimed_again() {
    let f = fix();
    let id = deposit(&f, 300);
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &valid_signature(&f, &NONCE_A),
    );

    let r = f.client.try_claim(
        &vec![&f.env, id],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_B),
        &SIG_EXPIRES,
        &valid_signature(&f, &NONCE_B),
    );
    assert_eq!(r, Err(Ok(Error::AlreadySettled)));
    assert_eq!(
        balance(&f, &f.recipient),
        300,
        "there must be no double payout"
    );
}

/// A valid signature cannot withdraw a payment belonging to ANOTHER identity.
/// The signature is correct, but the payment's tag does not match.
#[test]
fn claim_cannot_withdraw_another_identitys_payment() {
    let f = fix();
    let someone_else = BytesN::from_array(&f.env, &METEHAN);
    let id = f
        .client
        .deposit(&f.sender, &someone_else, &f.token, &300, &PAY_EXPIRY);

    let r = f.client.try_claim(
        &vec![&f.env, id],
        &f.identity, // torvalds signature
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &valid_signature(&f, &NONCE_A),
    );
    assert_eq!(r, Err(Ok(Error::IdentityMismatch)));
    assert_eq!(balance(&f, &f.contract_id), 300);
}

/// Once a payment has expired it belongs to the sender again; it cannot be claimed.
#[test]
fn claim_cannot_withdraw_an_expired_payment() {
    let f = fix();
    let id = deposit(&f, 300);

    let late = PAY_EXPIRY + 1;
    f.env.ledger().set_sequence_number(late);
    let sig = BytesN::from_array(
        &f.env,
        &sign(
            &f.sk,
            &f.contract_id,
            &TORVALDS,
            &f.recipient,
            late + 100,
            &NONCE_A,
        ),
    );

    let r = f.client.try_claim(
        &vec![&f.env, id],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &(late + 100),
        &sig,
    );
    assert_eq!(r, Err(Ok(Error::PaymentExpired)));
}

#[test]
fn claim_rejects_an_empty_list() {
    let f = fix();
    let r = f.client.try_claim(
        &vec![&f.env],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &valid_signature(&f, &NONCE_A),
    );
    assert_eq!(r, Err(Ok(Error::NoPayments)));
}

/// SPEC.md §5 #12 — a batch claim is atomic.
/// Slipping a single invalid id into the list must roll the WHOLE call back;
/// otherwise an attacker could corrupt state through partial success.
#[test]
fn claim_batch_is_atomic() {
    let f = fix();
    let a = deposit(&f, 100);
    let b = deposit(&f, 200);

    let r = f.client.try_claim(
        &vec![&f.env, a, 999, b], // there is no payment 999
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &valid_signature(&f, &NONCE_A),
    );

    assert_eq!(r, Err(Ok(Error::PaymentNotFound)));
    assert_eq!(balance(&f, &f.recipient), 0, "no payment may go through");
    assert_eq!(balance(&f, &f.contract_id), 300);
    assert_eq!(f.client.get_payment(&a).status, Status::Pending);
    assert_eq!(f.client.get_payment(&b).status, Status::Pending);
}

/// A claimed payment cannot be refunded afterwards (complements SPEC.md §5 #10).
#[test]
fn a_claimed_payment_cannot_be_refunded() {
    let f = fix();
    let id = deposit(&f, 300);
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &valid_signature(&f, &NONCE_A),
    );

    f.env.ledger().set_sequence_number(PAY_EXPIRY + 1);
    assert_eq!(f.client.try_refund(&id), Err(Ok(Error::AlreadySettled)));
    assert_eq!(
        balance(&f, &f.sender),
        700,
        "the sender cannot get the money back"
    );
}

// -------------------------------------------------------------------- events

#[test]
fn claim_event_is_published_with_an_identity_topic() {
    let f = fix();
    let id = deposit(&f, 300);
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.recipient,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &valid_signature(&f, &NONCE_A),
    );

    assert_eq!(
        f.env.events().all().filter_by_contract(&f.contract_id),
        vec![
            &f.env,
            (
                f.contract_id.clone(),
                (Symbol::new(&f.env, "claim"), f.identity.clone()).into_val(&f.env),
                Map::<Symbol, Val>::from_array(
                    &f.env,
                    [
                        (Symbol::new(&f.env, "payment_id"), id.into_val(&f.env)),
                        (
                            Symbol::new(&f.env, "recipient"),
                            f.recipient.into_val(&f.env)
                        ),
                        (Symbol::new(&f.env, "token"), f.token.into_val(&f.env)),
                        (Symbol::new(&f.env, "amount"), 300i128.into_val(&f.env)),
                    ]
                )
                .into_val(&f.env),
            )
        ]
    );
}

// -------------------------------------------------------- SPEC golden vector

/// Verifies the worked example from SPEC.md §4.2 through the contract's OWN
/// code. In phase 3 the TypeScript verifier has to produce the same preimage;
/// this test is the Rust-side anchor of that contract.
///
/// We register the contract at the address from the SPEC so that
/// `current_contract_address()` returns the expected strkey.
#[test]
fn preimage_matches_the_spec_golden_vector() {
    let env = Env::default();

    let spec_contract = Address::from_string(&String::from_str(
        &env,
        "CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU",
    ));
    let spec_recipient = Address::from_string(&String::from_str(
        &env,
        "GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG",
    ));
    env.register_at(&spec_contract, PaytagEscrow, ());

    let identity = BytesN::from_array(&env, &TORVALDS);
    let mut nonce_raw = [0u8; 32];
    for (i, b) in nonce_raw.iter_mut().enumerate() {
        *b = (i + 1) as u8; // 0x01..0x20
    }
    let nonce = BytesN::from_array(&env, &nonce_raw);

    let pre = env.as_contract(&spec_contract, || {
        PaytagEscrow::claim_preimage(&env, &identity, &spec_recipient, 1_000_000, &nonce).unwrap()
    });

    assert_eq!(pre.len(), 195, "the preimage must be 195 bytes");

    // SPEC.md §4.2: sha256(preimage)
    const SPEC_HASH: [u8; 32] = [
        0x67, 0x97, 0xbc, 0x5d, 0x95, 0xd3, 0x5a, 0xc1, 0x9c, 0x79, 0x18, 0xc3, 0x8b, 0xf1, 0x39,
        0xff, 0xfa, 0xea, 0x46, 0x64, 0x06, 0x43, 0x9b, 0x08, 0xb4, 0x9e, 0x01, 0x7c, 0x08, 0x78,
        0x09, 0x06,
    ];
    assert_eq!(
        env.crypto().sha256(&pre).to_bytes(),
        BytesN::from_array(&env, &SPEC_HASH),
        "the contract's preimage does not match SPEC.md §4.2"
    );

    // The test's independent implementation must give the same result.
    let independent = preimage(
        &spec_contract,
        &TORVALDS,
        &spec_recipient,
        1_000_000,
        &nonce_raw,
    );
    assert_eq!(
        env.crypto()
            .sha256(&soroban_sdk::Bytes::from_slice(&env, &independent))
            .to_bytes(),
        BytesN::from_array(&env, &SPEC_HASH)
    );
}
