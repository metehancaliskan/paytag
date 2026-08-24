#![cfg(test)]
//! Phase 2.1 tests — setup and authorization.
//!
//! Covered from the SPEC.md §5 red-team table: #16, #17.

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{BytesN, Env};

/// Test environment: the contract is registered, an admin and a verifier key
/// are generated.
fn setup() -> (Env, PaytagEscrowClient<'static>, Address, BytesN<32>) {
    let env = Env::default();
    let id = env.register(PaytagEscrow, ());
    let client = PaytagEscrowClient::new(&env, &id);
    let admin = Address::generate(&env);
    let verifier = BytesN::from_array(&env, &[7u8; 32]);
    (env, client, admin, verifier)
}

#[test]
fn init_writes_the_configuration() {
    let (env, client, admin, verifier) = setup();
    env.mock_all_auths();

    client.init(&admin, &verifier, &518_400);

    let cfg = client.get_config();
    assert_eq!(cfg.admin, admin);
    assert_eq!(cfg.verifier, verifier);
    assert_eq!(cfg.default_expiry_ledgers, 518_400);
}

/// SPEC.md §5 #16 — init cannot be called a second time.
/// Otherwise an attacker could swap the verifier key for their own and claim
/// every payment in escrow.
#[test]
fn init_is_rejected_the_second_time() {
    let (env, client, admin, verifier) = setup();
    env.mock_all_auths();
    client.init(&admin, &verifier, &518_400);

    let attacker = Address::generate(&env);
    let forged_verifier = BytesN::from_array(&env, &[9u8; 32]);
    let result = client.try_init(&attacker, &forged_verifier, &100);

    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));

    // The configuration must be untouched.
    let cfg = client.get_config();
    assert_eq!(cfg.admin, admin);
    assert_eq!(cfg.verifier, verifier);
}

#[test]
fn uninitialized_contract_returns_no_config() {
    let (_env, client, _admin, _verifier) = setup();
    assert_eq!(client.try_get_config(), Err(Ok(Error::NotInitialized)));
}

#[test]
fn set_verifier_rotates_the_key() {
    let (env, client, admin, verifier) = setup();
    env.mock_all_auths();
    client.init(&admin, &verifier, &518_400);

    let new = BytesN::from_array(&env, &[42u8; 32]);
    client.set_verifier(&new);

    assert_eq!(client.get_config().verifier, new);
}

/// SPEC.md §5 #17 — the verifier cannot be changed without admin authorization.
/// This is the contract's single point of centralized power; left unguarded,
/// anyone could make their own key the verifier and drain the whole escrow.
#[test]
#[should_panic]
fn set_verifier_is_rejected_without_auth() {
    let (env, client, admin, verifier) = setup();
    env.mock_all_auths();
    client.init(&admin, &verifier, &518_400);

    // Take the authorization away: require_auth now panics.
    env.set_auths(&[]);
    let new = BytesN::from_array(&env, &[42u8; 32]);
    client.set_verifier(&new);
}

#[test]
fn set_verifier_is_rejected_on_an_uninitialized_contract() {
    let (env, client, _admin, _verifier) = setup();
    let new = BytesN::from_array(&env, &[42u8; 32]);
    assert_eq!(
        client.try_set_verifier(&new),
        Err(Ok(Error::NotInitialized))
    );
}
