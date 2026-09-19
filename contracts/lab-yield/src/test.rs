#![cfg(test)]
//! The experiment's own tests, against a pool we control.
//!
//! A real Blend pool cannot be called from a unit test, and the interesting
//! questions here are not about Blend anyway — they are about whether OUR
//! accounting survives a rate that moves. So the pool is a stand-in with one
//! knob: `set_rate`. Turning it is what a week of interest looks like, and it
//! is the only way to ask the questions that matter before deploying anything.
//!
//! The question underneath all of them: can two escrows share one pool
//! position without either one paying out the other's money?

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Env};

// --------------------------------------------------------------- the stand-in

mod mock_pool {
    use soroban_sdk::{
        contract, contractimpl, contracttype, map, symbol_short, token, vec, Address, Env, IntoVal,
        Map, Symbol, Val, Vec,
    };

    use crate::blend::{Positions, Request, RATE_SCALAR, SUPPLY, WITHDRAW};

    #[contracttype]
    pub enum Key {
        Rate,
        Asset,
        Supply(Address),
    }

    /// A lending pool reduced to the one behaviour this experiment depends on:
    /// money in becomes a position, the position is worth more as a rate
    /// climbs, and the position converts back to money.
    #[contract]
    pub struct MockPool;

    #[contractimpl]
    impl MockPool {
        pub fn init(env: Env, asset: Address) {
            env.storage().instance().set(&Key::Asset, &asset);
            env.storage().instance().set(&Key::Rate, &RATE_SCALAR);
        }

        /// A week of interest, as one call.
        pub fn set_rate(env: Env, rate: i128) {
            env.storage().instance().set(&Key::Rate, &rate);
        }

        pub fn get_reserve_list(env: Env) -> Vec<Address> {
            let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
            vec![&env, asset]
        }

        /// Shaped like Blend's, nesting included.
        ///
        /// The real `Reserve` keeps its rates under `data`, and the first
        /// version of this stand-in did not — so the contract passed every
        /// test and then could not value a position on the live pool. A
        /// stand-in that is easier to satisfy than the real thing is worse
        /// than no stand-in.
        pub fn get_reserve(env: Env, _asset: Address) -> Map<Symbol, Val> {
            let rate: i128 = env.storage().instance().get(&Key::Rate).unwrap();
            let data: Map<Symbol, Val> = map![
                &env,
                (symbol_short!("b_rate"), rate.into_val(&env)),
                (symbol_short!("b_supply"), 0_i128.into_val(&env)),
                (symbol_short!("d_rate"), RATE_SCALAR.into_val(&env)),
            ];
            map![
                &env,
                (symbol_short!("asset"), _asset.into_val(&env)),
                (symbol_short!("data"), data.into_val(&env)),
                (symbol_short!("scalar"), 10_000_000_i128.into_val(&env)),
            ]
        }

        pub fn get_positions(env: Env, address: Address) -> Positions {
            let b: i128 = env
                .storage()
                .persistent()
                .get(&Key::Supply(address))
                .unwrap_or(0);
            Positions {
                collateral: map![&env],
                liabilities: map![&env],
                supply: if b == 0 {
                    map![&env]
                } else {
                    map![&env, (0u32, b)]
                },
            }
        }

        pub fn submit(
            env: Env,
            from: Address,
            _spender: Address,
            to: Address,
            requests: Vec<Request>,
        ) -> Positions {
            from.require_auth();
            let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
            let rate: i128 = env.storage().instance().get(&Key::Rate).unwrap();
            let pool = env.current_contract_address();
            let client = token::Client::new(&env, &asset);

            for r in requests.iter() {
                let mut held: i128 = env
                    .storage()
                    .persistent()
                    .get(&Key::Supply(from.clone()))
                    .unwrap_or(0);

                if r.request_type == SUPPLY {
                    client.transfer(&from, &pool, &r.amount);
                    held += r.amount * RATE_SCALAR / rate;
                } else if r.request_type == WITHDRAW {
                    // Blend pulls the request down to the position rather than
                    // failing, and burns the bTokens the amount is worth.
                    let worth = held * rate / RATE_SCALAR;
                    let paying = if r.amount > worth { worth } else { r.amount };
                    held -= paying * RATE_SCALAR / rate;
                    client.transfer(&pool, &to, &paying);
                }

                env.storage()
                    .persistent()
                    .set(&Key::Supply(from.clone()), &held);
            }

            Self::get_positions(env, from)
        }
    }
}

use mock_pool::{MockPool, MockPoolClient};

// ------------------------------------------------------------------ the bench

struct Bench {
    env: Env,
    escrow: LabYieldEscrowClient<'static>,
    pool: MockPoolClient<'static>,
    token: token::Client<'static>,
    mint: token::StellarAssetClient<'static>,
    asset: Address,
    alice: Address,
    bob: Address,
}

const START_LEDGER: u32 = 1_000;
const WEEK: u32 = 120_960; // ledgers, at five seconds each

fn bench() -> Bench {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let asset = sac.address();
    let token = token::Client::new(&env, &asset);
    let mint = token::StellarAssetClient::new(&env, &asset);
    mint.mint(&alice, &1_000_000_000);

    let pool_id = env.register(MockPool, ());
    let pool = MockPoolClient::new(&env, &pool_id);
    pool.init(&asset);
    // A real pool holds more than its suppliers deposited, because borrowers
    // pay interest into it. Without that buffer the stand-in can credit a
    // position with interest it has no money to pay — which is a fine
    // description of insolvency and a poor one of Blend.
    mint.mint(&pool_id, &1_000_000_000);

    let escrow_id = env.register(LabYieldEscrow, ());
    let escrow = LabYieldEscrowClient::new(&env, &escrow_id);
    escrow.init(&admin, &pool_id);

    Bench {
        env,
        escrow,
        pool,
        token,
        mint,
        asset,
        alice,
        bob,
    }
}

fn tag(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// The rate as a percentage above where it started: 105 is five percent on.
fn rate(percent: i128) -> i128 {
    RATE_SCALAR * percent / 100
}

// ------------------------------------------------------------------- the tests

#[test]
fn a_deposit_goes_straight_into_the_pool() {
    let b = bench();
    let pool_before = b.token.balance(&b.pool.address);
    let id = b.escrow.deposit(
        &b.alice,
        &tag(&b.env, 1),
        &b.asset,
        &100_000_000,
        &(START_LEDGER + WEEK),
    );

    // The escrow is a conduit, not a vault: it should be holding nothing, and
    // the pool should be holding what it took in on top of its own buffer.
    assert_eq!(b.token.balance(&b.escrow.address), 0);
    assert_eq!(b.token.balance(&b.pool.address), pool_before + 100_000_000);

    let p = b.escrow.get_payment(&id);
    assert_eq!(p.principal, 100_000_000);
    assert_eq!(p.b_tokens, 100_000_000); // rate is 1.0 at the start
    assert_eq!(p.status, Status::Pending);
}

#[test]
fn the_position_is_measured_and_not_assumed() {
    // At a rate above 1.0 the same money buys fewer bTokens. A contract that
    // recorded the amount instead of the position would overstate every
    // payment made after the pool had accrued anything at all.
    let b = bench();
    b.pool.set_rate(&rate(125));

    let id = b.escrow.deposit(
        &b.alice,
        &tag(&b.env, 1),
        &b.asset,
        &100_000_000,
        &(START_LEDGER + WEEK),
    );

    assert_eq!(b.escrow.get_payment(&id).b_tokens, 80_000_000);
    // And it is still worth what was put in — this rate divides exactly, so
    // there is no rounding to swallow.
    assert_eq!(b.escrow.value_of(&id), 100_000_000);
    assert_eq!(b.escrow.get_payment(&id).principal, 100_000_000);
}

#[test]
fn waiting_is_what_pays() {
    let b = bench();
    let id = b.escrow.deposit(
        &b.alice,
        &tag(&b.env, 1),
        &b.asset,
        &100_000_000,
        &(START_LEDGER + WEEK),
    );
    assert_eq!(b.escrow.value_of(&id), 100_000_000);

    b.pool.set_rate(&rate(110));
    assert_eq!(b.escrow.value_of(&id), 110_000_000);
}

#[test]
fn a_claim_pays_the_principal_and_the_interest() {
    let b = bench();
    let id = b.escrow.deposit(
        &b.alice,
        &tag(&b.env, 1),
        &b.asset,
        &100_000_000,
        &(START_LEDGER + WEEK),
    );
    b.pool.set_rate(&rate(110));

    let paid = b.escrow.claim(&id, &b.bob);

    assert_eq!(paid, 110_000_000);
    assert_eq!(b.token.balance(&b.bob), 110_000_000);
    assert_eq!(b.escrow.get_payment(&id).status, Status::Claimed);
    // Nothing left behind in the conduit.
    assert_eq!(b.token.balance(&b.escrow.address), 0);
}

#[test]
fn a_refund_pays_the_sender_the_same_way() {
    // Yield follows the money. Whoever ends up with the principal ends up with
    // what it earned, and there is no third rule to remember.
    let b = bench();
    let before = b.token.balance(&b.alice);
    let id = b.escrow.deposit(
        &b.alice,
        &tag(&b.env, 1),
        &b.asset,
        &100_000_000,
        &(START_LEDGER + WEEK),
    );
    b.pool.set_rate(&rate(110));
    b.env.ledger().set_sequence_number(START_LEDGER + WEEK + 1);

    let paid = b.escrow.refund(&id);

    assert_eq!(paid, 110_000_000);
    assert_eq!(b.token.balance(&b.alice), before + 10_000_000);
}

#[test]
fn two_escrows_share_a_position_without_robbing_each_other() {
    // THE question. One pool position holds everybody's money, and the only
    // thing keeping them apart is our own arithmetic. If it is wrong, the
    // first person to claim takes somebody else's interest with them — and
    // the loss lands on whoever claims last.
    let b = bench();
    b.mint.mint(&b.bob, &1_000_000_000);

    let first = b.escrow.deposit(
        &b.alice,
        &tag(&b.env, 1),
        &b.asset,
        &100_000_000,
        &(START_LEDGER + WEEK),
    );
    b.pool.set_rate(&rate(110));
    let second = b.escrow.deposit(
        &b.bob,
        &tag(&b.env, 2),
        &b.asset,
        &100_000_000,
        &(START_LEDGER + WEEK),
    );

    // The second deposit bought fewer bTokens, because it arrived later.
    assert!(b.escrow.get_payment(&second).b_tokens < b.escrow.get_payment(&first).b_tokens);
    assert_eq!(b.escrow.value_of(&first), 110_000_000);
    // One stroop short of what was deposited, and that is correct: buying a
    // position at a rate above 1.0 floors, so the depositor pays the rounding
    // rather than the pool. Every later figure inherits it.
    assert_eq!(b.escrow.value_of(&second), 99_999_999);

    b.pool.set_rate(&rate(121));

    let carol = Address::generate(&b.env);
    let dave = Address::generate(&b.env);

    // The first one out takes exactly its own share…
    let paid_first = b.escrow.claim(&first, &carol);
    assert_eq!(paid_first, 121_000_000);

    // …and the one still waiting is untouched by that.
    assert_eq!(b.escrow.value_of(&second), 109_999_998);
    let paid_second = b.escrow.claim(&second, &dave);
    assert_eq!(paid_second, 109_999_998);

    // Both were paid in full, and nothing is stranded.
    assert_eq!(b.token.balance(&carol), 121_000_000);
    assert_eq!(b.token.balance(&dave), 109_999_998);
    assert_eq!(b.token.balance(&b.escrow.address), 0);
}

#[test]
fn every_pending_escrow_is_covered_by_what_the_pool_holds() {
    // The invariant, restated for a contract that lends. The old one was an
    // equality against a balance; this one is an inequality against a
    // position, and it only holds while the rate climbs.
    let b = bench();
    b.mint.mint(&b.bob, &1_000_000_000);

    let mut principal = 0i128;
    for (who, amount) in [(&b.alice, 70_000_000i128), (&b.bob, 30_000_000)] {
        b.escrow.deposit(
            who,
            &tag(&b.env, 9),
            &b.asset,
            &amount,
            &(START_LEDGER + WEEK),
        );
        principal += amount;
    }

    for percent in [100i128, 103, 117] {
        b.pool.set_rate(&rate(percent));
        let held = b.token.balance(&b.pool.address);
        assert!(
            held >= principal,
            "the pool holds {held}, which does not cover {principal}",
        );
    }
}

#[test]
fn the_windows_still_hold() {
    let b = bench();
    let id = b.escrow.deposit(
        &b.alice,
        &tag(&b.env, 1),
        &b.asset,
        &10_000_000,
        &(START_LEDGER + WEEK),
    );

    // Too early for a refund…
    assert_eq!(
        b.escrow.try_refund(&id).err(),
        Some(Ok(Error::NotYetExpired))
    );

    b.env.ledger().set_sequence_number(START_LEDGER + WEEK + 1);

    // …and too late for a claim.
    assert_eq!(
        b.escrow.try_claim(&id, &b.bob).err(),
        Some(Ok(Error::PaymentExpired))
    );

    b.escrow.refund(&id);
    assert_eq!(
        b.escrow.try_refund(&id).err(),
        Some(Ok(Error::AlreadySettled))
    );
}

#[test]
fn an_asset_the_pool_does_not_list_is_refused() {
    // Before the money moves, not after. A deposit that succeeded and then
    // found nowhere to lend would leave the escrow holding an asset with no
    // position behind it.
    let b = bench();
    let admin = Address::generate(&b.env);
    let other = env_asset(&b.env, &admin);

    let err = b
        .escrow
        .try_deposit(
            &b.alice,
            &tag(&b.env, 1),
            &other,
            &1_000,
            &(START_LEDGER + WEEK),
        )
        .err();
    assert_eq!(err, Some(Ok(Error::AssetNotInPool)));
}

fn env_asset(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
}

#[test]
fn the_rate_has_to_be_readable() {
    // If the pool stops answering with a rate, a position cannot be valued —
    // and the contract refuses rather than guessing at what somebody is owed.
    let b = bench();
    let id = b.escrow.deposit(
        &b.alice,
        &tag(&b.env, 1),
        &b.asset,
        &10_000_000,
        &(START_LEDGER + WEEK),
    );
    b.pool.set_rate(&0);

    assert_eq!(
        b.escrow.try_value_of(&id).err(),
        Some(Ok(Error::RateUnreadable))
    );
    assert_eq!(
        b.escrow.try_claim(&id, &b.bob).err(),
        Some(Ok(Error::RateUnreadable))
    );
}

#[test]
fn the_debt_never_exceeds_the_position() {
    // A rate that does not divide the deposit evenly costs a stroop when the
    // position is bought. Recording the deposited figure would make the escrow
    // owe more than it holds from the very first ledger; recording what the
    // pool says it holds keeps the books true.
    let b = bench();
    b.pool.set_rate(&rate(110));

    let id = b.escrow.deposit(
        &b.alice,
        &tag(&b.env, 1),
        &b.asset,
        &100_000_000,
        &(START_LEDGER + WEEK),
    );

    let p = b.escrow.get_payment(&id);
    assert_eq!(p.principal, 99_999_999);
    assert!(b.escrow.value_of(&id) >= p.principal);

    // And the claim covers it.
    assert!(b.escrow.claim(&id, &b.bob) >= p.principal);
}
