#![cfg(test)]
//! Rust ↔ TypeScript signature compatibility.
//!
//! Proves that a REAL ed25519 signature produced by `scripts/paytag.mjs`
//! (Node, zero dependencies) verifies against the preimage the contract builds
//! itself. The phase 3 verifier will be derived from that code.
//!
//! If the two sides diverge, no claim works at all, and the bug stays
//! invisible until phase 4. This test is the anchor against that disaster —
//! it uses the SPEC.md §4.2 golden vector.

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env, String};

/// scripts/paytag.mjs, with seed [3u8; 32]:
///   node scripts/paytag.mjs selftest
const NODE_PUB: &str = "ed4928c628d1c2c6eae90338905995612959273a5c63f93636c14614ac8737d1";
const NODE_SIG: &str = "c73892370f1a383a7965a1d1b164e7e9b9068aa4e4dd533ecfc09be805b2f95d\
                        d25a60306f8979b6f6e24891d4eb85bfc4347c610cf61346924514847032b40d";

const SPEC_CONTRACT: &str = "CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU";
const SPEC_RECIPIENT: &str = "GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG";
const TORVALDS: [u8; 32] = [
    0x9d, 0x86, 0x38, 0xcd, 0xf5, 0x59, 0x4e, 0xe5, 0xa5, 0x17, 0x8e, 0x3d, 0x41, 0x3f, 0xb8, 0x20,
    0x65, 0x13, 0x35, 0x6b, 0x94, 0x7d, 0xe1, 0xde, 0x60, 0x0f, 0x17, 0x85, 0x32, 0xc7, 0x06, 0x0b,
];

fn hex32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

fn hex64(s: &str) -> [u8; 64] {
    let c: std::string::String = s.chars().filter(|c| !c.is_whitespace()).collect();
    let mut out = [0u8; 64];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&c[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

fn spec_preimage(env: &Env) -> soroban_sdk::Bytes {
    let contract = Address::from_string(&String::from_str(env, SPEC_CONTRACT));
    let recipient = Address::from_string(&String::from_str(env, SPEC_RECIPIENT));
    env.register_at(&contract, PaytagEscrow, ());

    let identity = BytesN::from_array(env, &TORVALDS);
    let mut nonce_raw = [0u8; 32];
    for (i, b) in nonce_raw.iter_mut().enumerate() {
        *b = (i + 1) as u8;
    }
    let nonce = BytesN::from_array(env, &nonce_raw);

    env.as_contract(&contract, || {
        PaytagEscrow::claim_preimage(env, &identity, &recipient, 1_000_000, &nonce).unwrap()
    })
}

/// Node's signature verifies against the preimage the contract builds.
/// `ed25519_verify` panics on an invalid signature; no panic means the
/// signature is valid.
#[test]
fn node_signature_verifies_in_the_contract() {
    let env = Env::default();
    let pre = spec_preimage(&env);

    env.crypto().ed25519_verify(
        &BytesN::from_array(&env, &hex32(NODE_PUB)),
        &pre,
        &BytesN::from_array(&env, &hex64(NODE_SIG)),
    );
}

/// The counter-check: the same signature must not hold on a preimage with a
/// single bit flipped. Without this, the test above could be passing simply
/// because everything is accepted.
#[test]
#[should_panic]
fn node_signature_does_not_hold_on_modified_data() {
    let env = Env::default();
    let mut pre = spec_preimage(&env);
    let last = pre.len() - 1;
    let flipped = pre.get(last).unwrap() ^ 0x01;
    pre.set(last, flipped);

    env.crypto().ed25519_verify(
        &BytesN::from_array(&env, &hex32(NODE_PUB)),
        &pre,
        &BytesN::from_array(&env, &hex64(NODE_SIG)),
    );
}

/// The key Node produces survives a round trip through contract storage.
///
/// `init` writes the verifier key and `get_config` reads it back; a `BytesN<32>`
/// asserting its own length proves nothing, but proving the deployed contract
/// would actually be holding Node's key does. Every claim in production depends
/// on those two bytes-for-bytes matching.
#[test]
fn node_public_key_round_trips_through_contract_storage() {
    let env = Env::default();
    env.mock_all_auths();

    let contract = env.register(PaytagEscrow, ());
    let client = PaytagEscrowClient::new(&env, &contract);
    let node_key = BytesN::from_array(&env, &hex32(NODE_PUB));

    client.init(&Address::generate(&env), &node_key, &518_400);

    assert_eq!(
        client.get_config().verifier,
        node_key,
        "the key the contract stores must be the key Node signs with"
    );
}
