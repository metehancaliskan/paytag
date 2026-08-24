#![no_std]
//! Paytag escrow — USDC held in escrow, tagged to an internet identity.
//!
//! For design decisions and attack analysis: docs/SPEC.md
//!
//! Phase 2.1: types, storage, init, set_verifier.
//! Phase 2.2: deposit.
//! Phase 2.3: claim (ed25519 verifier signature + nonce replay protection).
//! Phase 2.4: refund.
//! Phase 2.6: solvency invariant (test_fuzz).

// proptest and ed25519-dalek need std; the contract wasm is still no_std.
#[cfg(test)]
extern crate std;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Bytes,
    BytesN, Env, Vec,
};

/// Domain separator that pins down what a signature means.
/// Without this prefix, a signature the verifier produced for some other
/// purpose could be reinterpreted as claim authorization. SPEC.md §4.3
const CLAIM_DOMAIN: &[u8; 15] = b"paytag.claim.v1";

/// Stellar strkey length: `G...` account and `C...` contract addresses are
/// 56 characters. Muxed addresses (`M...`, 69 characters) are not supported.
const STRKEY_LEN: u32 = 56;

/// The spent-nonce record has to outlive the signature by a margin, so that a
/// signature submitted very close to its expiry does not get its record
/// deleted out from under it.
const NONCE_TTL_BUFFER: u32 = 17_280; // ~1 day

// Instance storage TTL: extended on every write.
// ~5 s/ledger → 30 days ≈ 518_400 ledgers.
const INSTANCE_TTL_THRESHOLD: u32 = 172_800; // when ~10 days are left
const INSTANCE_TTL_EXTEND: u32 = 518_400; // top up to ~30 days

// Payment records live in `persistent` storage and THERE IS MONEY IN THEM.
// If a record is archived the funds become unreachable, so the TTL must
// always outlast expiry_ledger. MAX_EXPIRY_LEDGERS guarantees that: even the
// furthest expiry we accept stays inside the TTL window.
const PAYMENT_TTL_THRESHOLD: u32 = 518_400; // when ~30 days are left
const PAYMENT_TTL_EXTEND: u32 = 1_036_800; // top up to ~60 days
const MAX_EXPIRY_LEDGERS: u32 = 518_400; // at most ~30 days from the deposit

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// init can only be called once.
    AlreadyInitialized = 1,
    /// The contract has not been initialized yet.
    NotInitialized = 2,
    /// Amount is zero or negative.
    InvalidAmount = 3,
    /// expiry_ledger is at or before the current ledger.
    ExpiryInPast = 4,
    /// expiry_ledger is beyond the storage TTL window. Deposits only —
    /// a signature that lives too long is `SignatureLifetimeTooLong`.
    ExpiryTooFar = 5,
    /// No such payment record.
    PaymentNotFound = 6,
    /// The payment has already been claimed or refunded.
    AlreadySettled = 7,
    /// expiry_ledger has not passed yet; the refund is early.
    NotYetExpired = 8,
    /// The claim call listed no payment ids at all.
    NoPayments = 9,
    /// The verifier signature has expired.
    SignatureExpired = 10,
    /// This nonce was already spent (replay attempt).
    NonceAlreadyUsed = 11,
    /// The payment's tag does not match the signed identity.
    IdentityMismatch = 12,
    /// The payment's claim window has closed; only refund is possible now.
    PaymentExpired = 13,
    /// Address is unsupported (strkey is not 56 characters, e.g. muxed M...).
    UnsupportedAddress = 14,
    /// The verifier signature's lifetime is longer than the contract allows.
    ///
    /// Separate from `ExpiryTooFar` on purpose: that one is about a payment's
    /// escrow window, this one about how long an authorization stays valid.
    /// They were the same code once, which meant a caller could be told their
    /// deposit window was too long when the real problem was the signature.
    SignatureLifetimeTooLong = 15,
}

/// A payment's lifecycle. Transitions are one-way:
/// Pending -> Claimed  or  Pending -> Refunded. There is no way back.
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
    /// Who deposited the money. Only this address can be refunded.
    pub from: Address,
    /// sha256(kind_byte ‖ normalized_handle) — SPEC.md §2
    pub identity: BytesN<32>,
    pub token: Address,
    pub amount: i128,
    /// Becomes refundable AFTER this ledger.
    pub expiry_ledger: u32,
    pub status: Status,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    /// The verifier's ed25519 PUBLIC key. The private key never touches chain.
    pub verifier: BytesN<32>,
    pub default_expiry_ledgers: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// instance — small, read on every call
    Config,
    /// instance — monotonically increasing payment id counter
    PaymentCounter,
    /// persistent — holds real money, must not be archived
    Payment(u64),
    /// temporary — replay protection, with a TTL longer than the signature's life
    Nonce(BytesN<32>),
}

/// Escrow deposited.
///
/// `identity` is emitted as a topic so an indexer can collect every payment
/// for one identity with a single filter. The "pending balance" screen in
/// phase 4 reads this.
#[contractevent(topics = ["deposit"])]
pub struct DepositEvent {
    #[topic]
    pub identity: BytesN<32>,
    pub payment_id: u64,
    pub from: Address,
    pub token: Address,
    pub amount: i128,
    pub expiry_ledger: u32,
}

/// Escrow withdrawn by the owner of the identity.
#[contractevent(topics = ["claim"])]
pub struct ClaimEvent {
    #[topic]
    pub identity: BytesN<32>,
    pub payment_id: u64,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
}

/// The escrow expired and was returned to the sender.
#[contractevent(topics = ["refund"])]
pub struct RefundEvent {
    #[topic]
    pub identity: BytesN<32>,
    pub payment_id: u64,
    pub to: Address,
    pub token: Address,
    pub amount: i128,
}

#[contract]
pub struct PaytagEscrow;

#[contractimpl]
impl PaytagEscrow {
    /// Sets the contract up, once.
    ///
    /// `verifier`: ed25519 public key of the off-chain verifier.
    /// `default_expiry_ledgers`: the default escrow duration the UI suggests.
    pub fn init(
        env: Env,
        admin: Address,
        verifier: BytesN<32>,
        default_expiry_ledgers: u32,
    ) -> Result<(), Error> {
        // Check BEFORE auth: reject a second call without asking for a signature.
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                verifier,
                default_expiry_ledgers,
            },
        );
        env.storage()
            .instance()
            .set(&DataKey::PaymentCounter, &0u64);
        Self::bump_instance(&env);
        Ok(())
    }

    /// Rotates the verifier key. This is the emergency lever if the key leaks.
    /// Admin only.
    pub fn set_verifier(env: Env, new: BytesN<32>) -> Result<(), Error> {
        let mut cfg = Self::load_config(&env)?;
        cfg.admin.require_auth();
        cfg.verifier = new;
        env.storage().instance().set(&DataKey::Config, &cfg);
        Self::bump_instance(&env);
        Ok(())
    }

    pub fn get_config(env: Env) -> Result<Config, Error> {
        Self::load_config(&env)
    }

    /// Deposits escrow tagged to an internet identity.
    ///
    /// The money moves into the contract — NOT into the recipient's wallet —
    /// and waits there under the `identity` tag. The recipient need not have a
    /// wallet at this point, nor even know Paytag exists — that is the
    /// product's core promise (SPEC.md §2).
    ///
    /// The returned `u64` is the payment's id; claim and refund use it.
    pub fn deposit(
        env: Env,
        from: Address,
        identity: BytesN<32>,
        token: Address,
        amount: i128,
        expiry_ledger: u32,
    ) -> Result<u64, Error> {
        // We do not accept money before the contract is set up: money deposited
        // while no verifier key exists could never be claimed.
        Self::load_config(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let now = env.ledger().sequence();
        if expiry_ledger <= now {
            // An already-expired escrow would be refundable immediately — a
            // pointless record that gives the recipient no chance at all.
            return Err(Error::ExpiryInPast);
        }
        if expiry_ledger > now + MAX_EXPIRY_LEDGERS {
            // If the record's TTL is shorter than its expiry the money becomes
            // unreachable.
            return Err(Error::ExpiryTooFar);
        }

        from.require_auth();

        // Pull the money from the sender into the contract. Panics here if
        // there is no auth.
        let escrow = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&from, &escrow, &amount);

        let id = Self::next_payment_id(&env);
        let payment = PaymentData {
            from: from.clone(),
            identity: identity.clone(),
            token: token.clone(),
            amount,
            expiry_ledger,
            status: Status::Pending,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Payment(id), &payment);
        Self::bump_payment(&env, id);
        Self::bump_instance(&env);

        DepositEvent {
            identity,
            payment_id: id,
            from,
            token,
            amount,
            expiry_ledger,
        }
        .publish(&env);

        Ok(id)
    }

    /// Withdraws escrows into the recipient's wallet, authorized by a
    /// verifier signature.
    ///
    /// The contract cannot ask GitHub. The off-chain verifier confirms handle
    /// ownership over OAuth and ed25519-signs a preimage saying "the owner of
    /// this identity is this address"; that signature is verified here.
    /// The preimage's byte layout, and which attack each field closes:
    /// SPEC.md §4.
    ///
    /// The call either fully succeeds or has no effect at all: if a single
    /// payment in the list is invalid, the returned error rolls the whole
    /// transaction back (atomicity).
    #[allow(clippy::too_many_arguments)]
    pub fn claim(
        env: Env,
        payment_ids: Vec<u64>,
        identity: BytesN<32>,
        recipient: Address,
        nonce: BytesN<32>,
        expires_at: u32,
        sig: BytesN<64>,
    ) -> Result<(), Error> {
        let cfg = Self::load_config(&env)?;

        if payment_ids.is_empty() {
            return Err(Error::NoPayments);
        }

        let now = env.ledger().sequence();
        if expires_at <= now {
            return Err(Error::SignatureExpired);
        }
        // An excessively long signature lifetime would demand a nonce-record
        // TTL we cannot carry; if that record is deleted, replay protection
        // collapses.
        if expires_at > now + MAX_EXPIRY_LEDGERS {
            return Err(Error::SignatureLifetimeTooLong);
        }

        // Replay check BEFORE signature verification: we never run the
        // expensive crypto for an already-spent nonce.
        let nonce_key = DataKey::Nonce(nonce.clone());
        if env.storage().temporary().has(&nonce_key) {
            return Err(Error::NonceAlreadyUsed);
        }

        let preimage = Self::claim_preimage(&env, &identity, &recipient, expires_at, &nonce)?;
        // Panics on an invalid signature — it does not return a Result.
        env.crypto().ed25519_verify(&cfg.verifier, &preimage, &sig);

        // Spend the nonce. `temporary` is enough: even if the record is
        // deleted, the same signature cannot get past the `expires_at` check.
        // The two protections together are sufficient.
        env.storage().temporary().set(&nonce_key, &true);
        let nonce_ttl = expires_at - now + NONCE_TTL_BUFFER;
        env.storage()
            .temporary()
            .extend_ttl(&nonce_key, nonce_ttl, nonce_ttl);

        let escrow = env.current_contract_address();

        for id in payment_ids.iter() {
            let mut p: PaymentData = env
                .storage()
                .persistent()
                .get(&DataKey::Payment(id))
                .ok_or(Error::PaymentNotFound)?;

            if p.status != Status::Pending {
                return Err(Error::AlreadySettled);
            }
            // A signature authorizes exactly one identity. Without this check,
            // a valid signature could drain ANOTHER identity's money.
            if p.identity != identity {
                return Err(Error::IdentityMismatch);
            }
            // An expired payment belongs to the sender again; it cannot be claimed.
            if now > p.expiry_ledger {
                return Err(Error::PaymentExpired);
            }

            p.status = Status::Claimed;
            env.storage().persistent().set(&DataKey::Payment(id), &p);
            Self::bump_payment(&env, id);

            token::Client::new(&env, &p.token).transfer(&escrow, &recipient, &p.amount);

            ClaimEvent {
                identity: identity.clone(),
                payment_id: id,
                recipient: recipient.clone(),
                token: p.token,
                amount: p.amount,
            }
            .publish(&env);
        }

        Self::bump_instance(&env);
        Ok(())
    }

    /// Returns an expired escrow to the sender.
    ///
    /// Only whoever deposited the money can call this, and only AFTER
    /// `expiry_ledger` has passed. The sender cannot pull the money back
    /// before the recipient's claim window closes — otherwise the sender
    /// could snatch it away while the recipient was getting ready to claim.
    pub fn refund(env: Env, payment_id: u64) -> Result<(), Error> {
        let mut p: PaymentData = env
            .storage()
            .persistent()
            .get(&DataKey::Payment(payment_id))
            .ok_or(Error::PaymentNotFound)?;

        // One-way state machine: nothing but Pending can be refunded.
        // This single line guards both double-refund and already-claimed money.
        if p.status != Status::Pending {
            return Err(Error::AlreadySettled);
        }

        let now = env.ledger().sequence();
        if now <= p.expiry_ledger {
            return Err(Error::NotYetExpired);
        }

        p.from.require_auth();

        // Write the state FIRST, send the money AFTER (checks-effects-interactions).
        // The token contract is an outside party that can call back into us;
        // handing it control while our state is stale is a reentrancy risk.
        p.status = Status::Refunded;
        env.storage()
            .persistent()
            .set(&DataKey::Payment(payment_id), &p);
        Self::bump_payment(&env, payment_id);

        let escrow = env.current_contract_address();
        token::Client::new(&env, &p.token).transfer(&escrow, &p.from, &p.amount);

        RefundEvent {
            identity: p.identity,
            payment_id,
            to: p.from,
            token: p.token,
            amount: p.amount,
        }
        .publish(&env);

        Ok(())
    }

    pub fn get_payment(env: Env, id: u64) -> Result<PaymentData, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Payment(id))
            .ok_or(Error::PaymentNotFound)
    }
}

// Helpers that are not part of the contract interface.
impl PaytagEscrow {
    fn load_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
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

    /// Builds the 195-byte fixed-layout preimage the verifier signs.
    ///
    /// | offset | length | field |
    /// |--------|--------|-------|
    /// | 0      | 15     | domain separator |
    /// | 15     | 56     | contract address (strkey, ASCII) |
    /// | 71     | 32     | identity_key |
    /// | 103    | 56     | recipient address (strkey, ASCII) |
    /// | 159    | 4      | expires_at, big-endian u32 |
    /// | 163    | 32     | nonce |
    ///
    /// Because the length is fixed, the field boundaries leave no ambiguity;
    /// no delimiter is needed. Addresses are embedded as strkeys rather than
    /// raw keys: the SDK's raw-key extraction path sits behind the
    /// `hazmat-address` feature and its documentation explicitly warns
    /// against using it for signature verification. A strkey can also be
    /// reproduced byte for byte on the TypeScript side with `toString()` —
    /// which lowers the parity risk in phase 3.
    fn claim_preimage(
        env: &Env,
        identity: &BytesN<32>,
        recipient: &Address,
        expires_at: u32,
        nonce: &BytesN<32>,
    ) -> Result<Bytes, Error> {
        let mut b = Bytes::from_array(env, CLAIM_DOMAIN);
        Self::append_strkey(&mut b, &env.current_contract_address())?;
        b.extend_from_array(&identity.to_array());
        Self::append_strkey(&mut b, recipient)?;
        b.extend_from_array(&expires_at.to_be_bytes());
        b.extend_from_array(&nonce.to_array());
        Ok(b)
    }

    fn append_strkey(b: &mut Bytes, addr: &Address) -> Result<(), Error> {
        let s = addr.to_string();
        if s.len() != STRKEY_LEN {
            return Err(Error::UnsupportedAddress);
        }
        let mut buf = [0u8; STRKEY_LEN as usize];
        s.copy_into_slice(&mut buf);
        b.extend_from_array(&buf);
        Ok(())
    }

    /// Monotonically increasing payment id. Starts at 1; 0 is reserved to
    /// mean "none".
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
}

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_claim;
#[cfg(test)]
mod test_crosslang;
#[cfg(test)]
mod test_deposit;
#[cfg(test)]
mod test_fuzz;
#[cfg(test)]
mod test_refund;
