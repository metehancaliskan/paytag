#![cfg(test)]
//! One person, two handles.
//!
//! The product's shape: somebody's GitHub username and their X username are
//! two separate tags. People pay either one, and the same person verifies both
//! and withdraws each. The question these tests answer is whether that shape
//! opens anything — whether two tags belonging to one human are in any way
//! joined on chain.
//!
//! They are not, and the reason is that the contract has no idea a human is
//! involved. It knows 32-byte keys. `identity_key = sha256(kind ‖ handle)`
//! puts the platform INSIDE the hash, so the two tags are two unrelated keys
//! with two unrelated pools, and every check in `claim` is per key.
//!
//! Which also settles the harder-sounding case: `torvalds` on GitHub and
//! `torvalds` on X may belong to two DIFFERENT people, and nothing has to
//! resolve that ambiguity, because at this layer the ambiguity never exists.

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, vec, Address, BytesN, Env};

/// sha256(0x00 ‖ "metehancaliskan") — the GitHub account.
const GITHUB: [u8; 32] = [
    0x91, 0xe2, 0x3a, 0x08, 0x97, 0x3a, 0xba, 0x69, 0xe1, 0x46, 0x64, 0xcb, 0x9e, 0x12, 0xcc, 0x20,
    0x48, 0x3a, 0x4f, 0x70, 0x2a, 0xfd, 0xd3, 0x04, 0xc8, 0xad, 0x74, 0x24, 0xa3, 0x54, 0xff, 0xff,
];
/// sha256(0x02 ‖ "metehancaliskan") — the X account. SAME NAME, other platform.
const X: [u8; 32] = [
    0x74, 0x62, 0xd3, 0xca, 0x2f, 0x7a, 0x62, 0x06, 0x60, 0x03, 0x30, 0x9a, 0x01, 0x8b, 0x93, 0x90,
    0x74, 0x72, 0x14, 0x5b, 0x9e, 0x23, 0x41, 0xe6, 0xb8, 0x8f, 0xbf, 0x40, 0xfc, 0x8b, 0x86, 0xff,
];

const START_LEDGER: u32 = 1_000;
const PAY_EXPIRY: u32 = START_LEDGER + 10_000;
const SIG_EXPIRES: u32 = START_LEDGER + 500;
const NONCE_1: [u8; 32] = [0x11; 32];
const NONCE_2: [u8; 32] = [0x22; 32];

struct Fix<'a> {
    env: Env,
    client: PaytagEscrowClient<'a>,
    contract_id: Address,
    sender: Address,
    token: Address,
    sk: SigningKey,
}

fn fix() -> Fix<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

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

    Fix {
        env,
        client,
        contract_id,
        sender,
        token,
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

/// The same 195-byte layout as the contract's, written out independently.
fn sign(
    f: &Fix,
    identity: &[u8; 32],
    recipient: &Address,
    expires_at: u32,
    nonce: &[u8; 32],
) -> BytesN<64> {
    let mut b = [0u8; 195];
    b[0..15].copy_from_slice(b"paytag.claim.v1");
    b[15..71].copy_from_slice(&strkey56(&f.contract_id));
    b[71..103].copy_from_slice(identity);
    b[103..159].copy_from_slice(&strkey56(recipient));
    b[159..163].copy_from_slice(&expires_at.to_be_bytes());
    b[163..195].copy_from_slice(nonce);
    BytesN::from_array(&f.env, &f.sk.sign(&b).to_bytes())
}

fn deposit(f: &Fix, identity: &[u8; 32], amount: i128) -> u64 {
    f.client.deposit(
        &f.sender,
        &BytesN::from_array(&f.env, identity),
        &f.token,
        &amount,
        &PAY_EXPIRY,
    )
}

// ---------------------------------------------------------------------------

/// The premise. Same handle, two platforms, two unrelated keys — and they
/// differ from the very first byte, so no prefix comparison anywhere can
/// confuse them either.
#[test]
fn the_same_name_on_two_platforms_is_two_different_keys() {
    assert_ne!(GITHUB, X);
    assert_ne!(GITHUB[0], X[0]);
}

/// The product's happy path, end to end: two people pay two different handles
/// of the same person, and that person withdraws each one separately.
#[test]
fn each_handle_holds_its_own_escrow_and_is_claimed_separately() {
    let f = fix();
    let wallet = Address::generate(&f.env);

    let gh_id = deposit(&f, &GITHUB, 30);
    let x_id = deposit(&f, &X, 20);
    assert_eq!(balance(&f, &f.contract_id), 50);

    // Withdraw the GitHub escrow.
    f.client.claim(
        &vec![&f.env, gh_id],
        &BytesN::from_array(&f.env, &GITHUB),
        &wallet,
        &BytesN::from_array(&f.env, &NONCE_1),
        &SIG_EXPIRES,
        &sign(&f, &GITHUB, &wallet, SIG_EXPIRES, &NONCE_1),
    );

    // Only that one moved. The X escrow is untouched and still Pending.
    assert_eq!(balance(&f, &wallet), 30);
    assert_eq!(balance(&f, &f.contract_id), 20);
    assert_eq!(f.client.get_payment(&gh_id).status, Status::Claimed);
    assert_eq!(f.client.get_payment(&x_id).status, Status::Pending);

    // Withdraw the X escrow. A fresh nonce, because a nonce is spent once.
    f.client.claim(
        &vec![&f.env, x_id],
        &BytesN::from_array(&f.env, &X),
        &wallet,
        &BytesN::from_array(&f.env, &NONCE_2),
        &SIG_EXPIRES,
        &sign(&f, &X, &wallet, SIG_EXPIRES, &NONCE_2),
    );

    assert_eq!(balance(&f, &wallet), 50);
    assert_eq!(balance(&f, &f.contract_id), 0);
    assert_eq!(f.client.get_payment(&x_id).status, Status::Claimed);
}

/// Each handle can pay out to a DIFFERENT wallet, because the recipient is
/// signed per claim. This is what the per-identity payout address in the
/// interface relies on.
#[test]
fn the_two_handles_can_pay_out_to_two_different_wallets() {
    let f = fix();
    let hot = Address::generate(&f.env);
    let cold = Address::generate(&f.env);

    let gh_id = deposit(&f, &GITHUB, 30);
    let x_id = deposit(&f, &X, 20);

    f.client.claim(
        &vec![&f.env, gh_id],
        &BytesN::from_array(&f.env, &GITHUB),
        &cold,
        &BytesN::from_array(&f.env, &NONCE_1),
        &SIG_EXPIRES,
        &sign(&f, &GITHUB, &cold, SIG_EXPIRES, &NONCE_1),
    );
    f.client.claim(
        &vec![&f.env, x_id],
        &BytesN::from_array(&f.env, &X),
        &hot,
        &BytesN::from_array(&f.env, &NONCE_2),
        &SIG_EXPIRES,
        &sign(&f, &X, &hot, SIG_EXPIRES, &NONCE_2),
    );

    assert_eq!(balance(&f, &cold), 30);
    assert_eq!(balance(&f, &hot), 20);
}

/// The interesting one: ONE authorization cannot sweep both handles.
///
/// A claim carries a single `identity`, so listing the other handle's payment
/// alongside it is caught by the per-payment tag check — and because the batch
/// is atomic, the payment that *did* match does not move either.
#[test]
fn one_signature_cannot_sweep_both_handles() {
    let f = fix();
    let wallet = Address::generate(&f.env);

    let gh_id = deposit(&f, &GITHUB, 30);
    let x_id = deposit(&f, &X, 20);

    let r = f.client.try_claim(
        &vec![&f.env, gh_id, x_id],
        &BytesN::from_array(&f.env, &GITHUB),
        &wallet,
        &BytesN::from_array(&f.env, &NONCE_1),
        &SIG_EXPIRES,
        &sign(&f, &GITHUB, &wallet, SIG_EXPIRES, &NONCE_1),
    );

    assert_eq!(r, Err(Ok(Error::IdentityMismatch)));
    // Atomic: the GitHub payment was valid and still did not move.
    assert_eq!(balance(&f, &wallet), 0);
    assert_eq!(balance(&f, &f.contract_id), 50);
    assert_eq!(f.client.get_payment(&gh_id).status, Status::Pending);
    assert_eq!(f.client.get_payment(&x_id).status, Status::Pending);
}

/// A GitHub authorization cannot be re-pointed at the X tag. The identity is
/// inside the signed preimage, so changing it invalidates the signature —
/// `ed25519_verify` panics rather than returning, which is why this asserts a
/// panic instead of an error code.
#[test]
#[should_panic]
fn a_github_authorization_cannot_be_repointed_at_the_x_tag() {
    let f = fix();
    let wallet = Address::generate(&f.env);
    let x_id = deposit(&f, &X, 20);

    // Signed for GITHUB, submitted claiming to be for X.
    let sig = sign(&f, &GITHUB, &wallet, SIG_EXPIRES, &NONCE_1);
    f.client.claim(
        &vec![&f.env, x_id],
        &BytesN::from_array(&f.env, &X),
        &wallet,
        &BytesN::from_array(&f.env, &NONCE_1),
        &SIG_EXPIRES,
        &sig,
    );
}

/// And the nonce is per authorization, not per identity: having claimed the
/// GitHub escrow with a nonce, the X claim cannot reuse it even with a
/// correctly signed X authorization.
#[test]
fn the_second_handle_cannot_reuse_the_first_ones_nonce() {
    let f = fix();
    let wallet = Address::generate(&f.env);

    let gh_id = deposit(&f, &GITHUB, 30);
    let x_id = deposit(&f, &X, 20);

    f.client.claim(
        &vec![&f.env, gh_id],
        &BytesN::from_array(&f.env, &GITHUB),
        &wallet,
        &BytesN::from_array(&f.env, &NONCE_1),
        &SIG_EXPIRES,
        &sign(&f, &GITHUB, &wallet, SIG_EXPIRES, &NONCE_1),
    );

    let r = f.client.try_claim(
        &vec![&f.env, x_id],
        &BytesN::from_array(&f.env, &X),
        &wallet,
        &BytesN::from_array(&f.env, &NONCE_1), // the spent one
        &SIG_EXPIRES,
        &sign(&f, &X, &wallet, SIG_EXPIRES, &NONCE_1),
    );

    assert_eq!(r, Err(Ok(Error::NonceAlreadyUsed)));
    assert_eq!(balance(&f, &wallet), 30);
    assert_eq!(f.client.get_payment(&x_id).status, Status::Pending);
}

/// Refund is per payment as well: the sender taking back what they left for one
/// handle does not touch what they left for the other.
#[test]
fn refunding_one_handle_leaves_the_other_alone() {
    let f = fix();
    let before = balance(&f, &f.sender);

    let gh_id = deposit(&f, &GITHUB, 30);
    let x_id = deposit(&f, &X, 20);

    f.env.ledger().set_sequence_number(PAY_EXPIRY + 1);
    f.client.refund(&gh_id);

    assert_eq!(balance(&f, &f.sender), before - 20);
    assert_eq!(f.client.get_payment(&gh_id).status, Status::Refunded);
    assert_eq!(f.client.get_payment(&x_id).status, Status::Pending);
}
