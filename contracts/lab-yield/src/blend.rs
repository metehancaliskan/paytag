//! The slice of a Blend pool this experiment talks to.
//!
//! Four calls, declared here rather than pulled in as a dependency. Blend's
//! own crate would bring its whole type graph — reserves, emissions, auctions,
//! backstop — and this contract needs three numbers out of it. A narrow,
//! hand-declared client is also honest about the coupling: everything below is
//! a promise about somebody else's deployed contract, and the list is short
//! enough to check by hand against their source.

use soroban_sdk::{contractclient, contracttype, Address, Env, Map, Symbol, Val, Vec};

/// `RequestType::Supply` and `RequestType::Withdraw` from Blend's `actions.rs`.
///
/// Plain supply, never `SupplyCollateral`: an escrow must not be able to have
/// its holdings pledged against a loan, and collateral is exactly that.
pub const SUPPLY: u32 = 0;
pub const WITHDRAW: u32 = 1;

/// Blend's rates carry twelve decimal places.
pub const RATE_SCALAR: i128 = 1_000_000_000_000;

/// One instruction in a `submit` call. Mirrors Blend's `Request`.
#[contracttype]
#[derive(Clone)]
pub struct Request {
    pub request_type: u32,
    pub address: Address,
    pub amount: i128,
}

/// What an address holds in a pool. Mirrors Blend's `Positions`.
///
/// Three maps, keyed by reserve index. This contract only ever creates entries
/// in `supply`; the other two exist because the struct has to match the one
/// coming back over the wire, field for field, or it will not decode.
#[contracttype]
#[derive(Clone)]
pub struct Positions {
    pub collateral: Map<u32, i128>,
    pub liabilities: Map<u32, i128>,
    pub supply: Map<u32, i128>,
}

// The trait itself is only a shape for the generated client; nothing calls it
// directly, which is what the allow is for.
#[allow(dead_code)]
#[contractclient(name = "PoolClient")]
pub trait Pool {
    fn submit(
        env: Env,
        from: Address,
        spender: Address,
        to: Address,
        requests: Vec<Request>,
    ) -> Positions;

    fn get_positions(env: Env, address: Address) -> Positions;

    /// Deliberately untyped.
    ///
    /// Blend's `Reserve` is a large struct that has changed shape between
    /// versions, and this contract wants one field out of it: `b_rate`, which
    /// converts a position into an amount. Decoding the whole thing would mean
    /// mirroring every field and breaking on the next release; reading the map
    /// by key breaks only if that one key is renamed.
    fn get_reserve(env: Env, asset: Address) -> Map<Symbol, Val>;

    /// Assets in the order the pool indexes them — which is how positions are
    /// keyed, so an asset's place in this list is its identity everywhere else.
    fn get_reserve_list(env: Env) -> Vec<Address>;
}
