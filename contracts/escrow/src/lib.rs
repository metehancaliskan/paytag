#![no_std]
//! Paytag escrow — internet kimliğine etiketlenmiş USDC emaneti.
//!
//! Tasarım kararları ve saldırı analizi için: docs/SPEC.md
//!
//! Faz 2.1: tipler, storage, init, set_verifier.
//! deposit / claim / refund sonraki adımlarda eklenecek.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, BytesN, Env};

// Instance storage TTL'i: her yazma işleminde uzatılır.
// ~5 sn/ledger → 30 gün ≈ 518_400 ledger.
const INSTANCE_TTL_THRESHOLD: u32 = 172_800; // ~10 gün kaldıysa
const INSTANCE_TTL_EXTEND: u32 = 518_400; // ~30 güne tamamla

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// init yalnızca bir kez çağrılabilir.
    AlreadyInitialized = 1,
    /// Kontrat henüz init edilmemiş.
    NotInitialized = 2,
}

/// Bir ödemenin yaşam döngüsü. Geçişler tek yönlüdür:
/// Pending -> Claimed  veya  Pending -> Refunded. Geri dönüş yok.
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
    /// Parayı yatıran. Yalnızca bu adres refund alabilir.
    pub from: Address,
    /// sha256(kind_byte ‖ normalized_handle) — SPEC.md §2
    pub identity: BytesN<32>,
    pub token: Address,
    pub amount: i128,
    /// Bu ledger'dan SONRA refund edilebilir hale gelir.
    pub expiry_ledger: u32,
    pub status: Status,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    /// Verifier'ın ed25519 PUBLIC key'i. Private key asla zincire gelmez.
    pub verifier: BytesN<32>,
    pub default_expiry_ledgers: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// instance — küçük, her çağrıda okunur
    Config,
    /// instance — monoton artan ödeme id sayacı
    PaymentCounter,
    /// persistent — içinde gerçek para var, arşivlenmemeli
    Payment(u64),
    /// temporary — replay koruması, imza ömründen uzun TTL ile
    Nonce(BytesN<32>),
}

#[contract]
pub struct PaytagEscrow;

#[contractimpl]
impl PaytagEscrow {
    /// Kontratı bir kez kurar.
    ///
    /// `verifier`: off-chain doğrulayıcının ed25519 public key'i.
    /// `default_expiry_ledgers`: UI'ın önereceği varsayılan emanet süresi.
    pub fn init(
        env: Env,
        admin: Address,
        verifier: BytesN<32>,
        default_expiry_ledgers: u32,
    ) -> Result<(), Error> {
        // Kontrol, auth'tan ÖNCE: ikinci çağrıda imza istemeden reddet.
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

    /// Verifier anahtarını döndürür. Anahtar ele geçerse acil müdahale yolu budur.
    /// Yalnızca admin.
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
}

// Kontrat arayüzüne çıkmayan yardımcılar.
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
}

#[cfg(test)]
mod test;
