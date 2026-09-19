#![no_std]
//! LAB — an escrow that lends while it waits.
//!
//! This is an experiment and it is deployed separately. It shares no storage,
//! no contract id and no code with the escrow the product actually uses; the
//! only thing it copies is the question, which is: what if money paid to a
//! handle started earning the moment it was sent, instead of sitting still
//! until somebody claims it?
//!
//! WHAT IT DOES. `deposit` takes the money, hands it straight to a Blend pool,
//! and remembers how many bTokens that bought. `claim` and `refund` convert
//! the bTokens back and pay out — principal AND whatever it earned. Nothing
//! is credited along the way; a Blend position is simply worth more as the
//! pool's rate climbs, so the same holding pays more later.
//!
//! WHAT IT DELIBERATELY DOES NOT DO. There is no verifier signature here. The
//! production escrow will not release money without an ed25519 authorization
//! proving the claimant owns the handle, and reproducing that was not the
//! point of the experiment: the question was whether the yield mechanics hold
//! up, not whether the identity ones do. `claim` here takes an address and
//! believes it. That is why this contract is called lab, why it is deployed
//! under its own id, and why nothing in the product points at it.
//!
//! WHAT IT COSTS. Three things stop being true the moment an escrow lends:
//!
//!   1. Solvency stops being an identity. The old invariant was `balance ==
//!      sum of pending`, provable by looking at one number. The new one is
//!      `value(positions) >= sum of pending principal`, which holds only while
//!      the pool's rate climbs — and Blend socialises bad debt across
//!      suppliers when a backstop cannot cover a default, which is precisely
//!      the case where it does not.
//!   2. Claiming acquires a dependency. Paying out now needs the pool to have
//!      liquidity and to be unpaused. An escrow that could always pay can now
//!      be told to wait by somebody else's contract.
//!   3. Both of those are the sender's risk taken on the recipient's behalf,
//!      by a product neither of them thought they were opting into.
//!
//! The numbers on all three are in docs/LAB-YIELD-ESCROW.md.

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, token, vec,
    Address, BytesN, Env, IntoVal, Map, Symbol, Val,
};

mod blend;
use blend::{PoolClient, Positions, Request, RATE_SCALAR, SUPPLY, WITHDRAW};

const INSTANCE_TTL_THRESHOLD: u32 = 172_800;
const INSTANCE_TTL_EXTEND: u32 = 518_400;
const PAYMENT_TTL_THRESHOLD: u32 = 518_400;
const PAYMENT_TTL_EXTEND: u32 = 1_036_800;
const MAX_EXPIRY_LEDGERS: u32 = 518_400;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    ExpiryInPast = 4,
    ExpiryTooFar = 5,
    PaymentNotFound = 6,
    AlreadySettled = 7,
    NotYetExpired = 8,
    PaymentExpired = 13,
    /// The pool does not list this asset, so there is nowhere to lend it.
    AssetNotInPool = 20,
    /// The pool's rate could not be read, so a position cannot be valued.
    RateUnreadable = 21,
    /// The pool gave back no position for a supply it accepted.
    PositionMissing = 22,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Pending = 0,
    Claimed = 1,
    Refunded = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentData {
    pub from: Address,
    pub identity: BytesN<32>,
    pub token: Address,
    /// What was deposited. The debt to whoever wins this escrow.
    pub principal: i128,
    /// The position that money bought. Worth more than the principal, later.
    pub b_tokens: i128,
    pub expiry_ledger: u32,
    pub status: Status,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    pub pool: Address,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    PaymentCounter,
    Payment(u64),
}

#[contractevent(topics = ["lab_deposit"])]
pub struct DepositEvent {
    #[topic]
    pub identity: BytesN<32>,
    pub payment_id: u64,
    pub principal: i128,
    pub b_tokens: i128,
}

#[contractevent(topics = ["lab_settle"])]
pub struct SettleEvent {
    #[topic]
    pub identity: BytesN<32>,
    pub payment_id: u64,
    pub to: Address,
    pub principal: i128,
    /// What the waiting earned. The entire point of the experiment.
    pub yield_paid: i128,
}

#[contract]
pub struct LabYieldEscrow;

#[contractimpl]
impl LabYieldEscrow {
    pub fn init(env: Env, admin: Address, pool: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Config, &Config { admin, pool });
        env.storage()
            .instance()
            .set(&DataKey::PaymentCounter, &0u64);
        Self::bump_instance(&env);
        Ok(())
    }

    pub fn get_config(env: Env) -> Result<Config, Error> {
        Self::load_config(&env)
    }

    /// Takes the money and lends it in the same transaction.
    ///
    /// The ordering matters and is not arbitrary: the money is pulled in
    /// first, then handed to the pool, then the record is written with the
    /// position the pool actually issued. Writing an expected position and
    /// hoping the pool agreed would be an accounting entry with nothing
    /// behind it.
    pub fn deposit(
        env: Env,
        from: Address,
        identity: BytesN<32>,
        token: Address,
        amount: i128,
        expiry_ledger: u32,
    ) -> Result<u64, Error> {
        let cfg = Self::load_config(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let now = env.ledger().sequence();
        if expiry_ledger <= now {
            return Err(Error::ExpiryInPast);
        }
        if expiry_ledger > now + MAX_EXPIRY_LEDGERS {
            return Err(Error::ExpiryTooFar);
        }

        // Asked BEFORE the money moves. A deposit that pulled the funds in and
        // only then discovered the pool does not list this asset would revert —
        // correctly — but the check costs one read and the ordering is the
        // difference between a contract that refuses and one that relies on a
        // rollback to save it.
        let client = PoolClient::new(&env, &cfg.pool);
        let index = Self::reserve_index(&client, &token)?;

        from.require_auth();

        let escrow = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&from, &escrow, &amount);

        let b_tokens = Self::supply_to_pool(&env, &client, &cfg.pool, &token, index, amount)?;

        // WHAT IS OWED IS WHAT IS HELD, not what was handed over.
        //
        // Buying a position rounds down: twenty XLM into a pool whose rate has
        // moved off 1.0 comes back as a position worth 19.9999999. On the live
        // pool it was exactly one stroop, every time. Recording the deposited
        // figure as the debt would make the escrow promise a stroop more than
        // it holds from the instant the payment is created — an invariant that
        // is false for as long as it takes the interest to cover the rounding.
        //
        // So the debt is what the pool says the position is worth. The stroop
        // is lost to rounding either way; the difference is whether the ledger
        // admits it.
        let credited = Self::underlying(&env, &cfg.pool, &token, b_tokens)?;
        let principal = if credited < amount { credited } else { amount };

        let id = Self::next_payment_id(&env);
        env.storage().persistent().set(
            &DataKey::Payment(id),
            &PaymentData {
                from,
                identity: identity.clone(),
                token,
                principal,
                b_tokens,
                expiry_ledger,
                status: Status::Pending,
            },
        );
        Self::bump_payment(&env, id);
        Self::bump_instance(&env);

        DepositEvent {
            identity,
            payment_id: id,
            principal,
            b_tokens,
        }
        .publish(&env);

        Ok(id)
    }

    /// What this payment is worth right now: principal plus what it earned.
    ///
    /// A read, so an interface can show the figure climbing without moving
    /// anything. It is also the number `claim` pays out, computed the same
    /// way, so the screen and the payout cannot disagree.
    pub fn value_of(env: Env, payment_id: u64) -> Result<i128, Error> {
        let cfg = Self::load_config(&env)?;
        let p: PaymentData = env
            .storage()
            .persistent()
            .get(&DataKey::Payment(payment_id))
            .ok_or(Error::PaymentNotFound)?;
        Self::underlying(&env, &cfg.pool, &p.token, p.b_tokens)
    }

    /// Pays the escrow out to `to`: principal, and everything it earned.
    ///
    /// NO IDENTITY CHECK. The production escrow demands a verifier signature
    /// naming the recipient; this one does not, because the experiment is
    /// about the money mechanics and adding a second unproven thing would
    /// make a failure impossible to attribute. Nothing in the product calls
    /// this contract.
    pub fn claim(env: Env, payment_id: u64, to: Address) -> Result<i128, Error> {
        let cfg = Self::load_config(&env)?;
        let mut p: PaymentData = env
            .storage()
            .persistent()
            .get(&DataKey::Payment(payment_id))
            .ok_or(Error::PaymentNotFound)?;

        if p.status != Status::Pending {
            return Err(Error::AlreadySettled);
        }
        if env.ledger().sequence() > p.expiry_ledger {
            return Err(Error::PaymentExpired);
        }

        p.status = Status::Claimed;
        Self::settle(&env, &cfg.pool, payment_id, &mut p, &to)
    }

    /// Returns an expired escrow to the sender, with what it earned.
    ///
    /// The yield follows the money. Whoever ends up with the principal ends up
    /// with the interest it made while it waited — there is no third party to
    /// argue about and no rule to remember.
    pub fn refund(env: Env, payment_id: u64) -> Result<i128, Error> {
        let cfg = Self::load_config(&env)?;
        let mut p: PaymentData = env
            .storage()
            .persistent()
            .get(&DataKey::Payment(payment_id))
            .ok_or(Error::PaymentNotFound)?;

        if p.status != Status::Pending {
            return Err(Error::AlreadySettled);
        }
        if env.ledger().sequence() <= p.expiry_ledger {
            return Err(Error::NotYetExpired);
        }

        p.from.require_auth();
        p.status = Status::Refunded;
        let to = p.from.clone();
        Self::settle(&env, &cfg.pool, payment_id, &mut p, &to)
    }

    pub fn get_payment(env: Env, id: u64) -> Result<PaymentData, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Payment(id))
            .ok_or(Error::PaymentNotFound)
    }
}

impl LabYieldEscrow {
    fn load_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    /// Hands `amount` to the pool and returns the position it issued.
    ///
    /// The position is measured rather than predicted: the pool's own answer
    /// before and after, differenced. Predicting it would mean recomputing
    /// Blend's rounding, and being off by one in our favour is an IOU nobody
    /// funded.
    fn supply_to_pool(
        env: &Env,
        client: &PoolClient,
        pool: &Address,
        token: &Address,
        index: u32,
        amount: i128,
    ) -> Result<i128, Error> {
        let escrow = env.current_contract_address();

        let before = Self::supply_at(&client.get_positions(&escrow), index);

        // The pool will make the token move money out of this contract, and
        // the token will ask this contract whether that is allowed. It is a
        // sub-invocation we do not make ourselves, so it has to be authorised
        // in advance and narrowly: this token, this transfer, this amount.
        env.authorize_as_current_contract(vec![
            env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: token.clone(),
                    fn_name: Symbol::new(env, "transfer"),
                    args: (escrow.clone(), pool.clone(), amount).into_val(env),
                },
                sub_invocations: vec![env],
            }),
        ]);

        let after = client.submit(
            &escrow,
            &escrow,
            &escrow,
            &vec![
                env,
                Request {
                    request_type: SUPPLY,
                    address: token.clone(),
                    amount,
                },
            ],
        );

        let gained = Self::supply_at(&after, index) - before;
        if gained <= 0 {
            return Err(Error::PositionMissing);
        }
        Ok(gained)
    }

    /// Converts one payment's position back to money and pays it out.
    fn settle(
        env: &Env,
        pool: &Address,
        payment_id: u64,
        p: &mut PaymentData,
        to: &Address,
    ) -> Result<i128, Error> {
        let value = Self::underlying(env, pool, &p.token, p.b_tokens)?;

        // State first, money after. The pool and the token are both outside
        // parties, and handing either of them control while this record still
        // says Pending is how the same escrow gets settled twice.
        env.storage()
            .persistent()
            .set(&DataKey::Payment(payment_id), p);
        Self::bump_payment(env, payment_id);

        let client = PoolClient::new(env, pool);
        let escrow = env.current_contract_address();
        client.submit(
            &escrow,
            &escrow,
            &escrow,
            &vec![
                env,
                Request {
                    request_type: WITHDRAW,
                    address: p.token.clone(),
                    amount: value,
                },
            ],
        );

        // What actually came back, not what was asked for. Blend rounds when
        // it converts a position, and paying out the requested figure when the
        // pool sent a stroop less would quietly drain the next payment.
        let balance = token::Client::new(env, &p.token).balance(&escrow);
        let paid = if balance < value { balance } else { value };
        token::Client::new(env, &p.token).transfer(&escrow, to, &paid);

        SettleEvent {
            identity: p.identity.clone(),
            payment_id,
            to: to.clone(),
            principal: p.principal,
            yield_paid: paid - p.principal,
        }
        .publish(env);

        Self::bump_instance(env);
        Ok(paid)
    }

    /// bTokens → money, at the pool's rate right now.
    ///
    /// Blend nests the rate: `Reserve { asset, config, data: { b_rate, .. } }`.
    /// The first deployment of this contract read the top level, found nothing
    /// and refused to value anything — which is the failure mode that was
    /// wanted (refuse, do not guess) arriving for the wrong reason. Both
    /// shapes are tried now, because a nesting is exactly the kind of thing a
    /// minor release moves.
    fn underlying(
        env: &Env,
        pool: &Address,
        token: &Address,
        b_tokens: i128,
    ) -> Result<i128, Error> {
        let reserve = PoolClient::new(env, pool).get_reserve(token);

        let rate: i128 = match reserve.get(symbol_short!("data")) {
            Some(data) => {
                let data: Map<Symbol, Val> = data.into_val(env);
                data.get(symbol_short!("b_rate"))
                    .ok_or(Error::RateUnreadable)?
                    .into_val(env)
            }
            None => reserve
                .get(symbol_short!("b_rate"))
                .ok_or(Error::RateUnreadable)?
                .into_val(env),
        };

        if rate <= 0 {
            return Err(Error::RateUnreadable);
        }
        Ok(b_tokens * rate / RATE_SCALAR)
    }

    fn reserve_index(client: &PoolClient, token: &Address) -> Result<u32, Error> {
        let list = client.get_reserve_list();
        for (i, asset) in list.iter().enumerate() {
            if asset == *token {
                return Ok(i as u32);
            }
        }
        Err(Error::AssetNotInPool)
    }

    fn supply_at(positions: &Positions, index: u32) -> i128 {
        positions.supply.get(index).unwrap_or(0)
    }

    fn next_payment_id(env: &Env) -> u64 {
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PaymentCounter)
            .unwrap_or(0)
            + 1;
        env.storage().instance().set(&DataKey::PaymentCounter, &id);
        id
    }

    fn bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
    }

    fn bump_payment(env: &Env, id: u64) {
        env.storage().persistent().extend_ttl(
            &DataKey::Payment(id),
            PAYMENT_TTL_THRESHOLD,
            PAYMENT_TTL_EXTEND,
        );
    }
}

#[cfg(test)]
mod test;
