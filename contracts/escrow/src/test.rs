use super::*;
use soroban_sdk::Env;

#[test]
fn ping_works() {
    let env = Env::default();
    let id = env.register(PaytagEscrow, ());
    let client = PaytagEscrowClient::new(&env, &id);
    assert_eq!(client.ping(), symbol_short!("paytag"));
}
