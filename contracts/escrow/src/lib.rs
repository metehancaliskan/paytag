#![no_std]
//! Paytag escrow — internet kimliğine etiketlenmiş USDC emaneti.
//!
//! Tasarım kararları ve saldırı analizi için: docs/SPEC.md
//!
//! Faz 2.1: tipler, storage, init, set_verifier.
//! Faz 2.2: deposit.
//! claim / refund sonraki adımlarda eklenecek.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, BytesN, Env,
};

// Instance storage TTL'i: her yazma işleminde uzatılır.
// ~5 sn/ledger → 30 gün ≈ 518_400 ledger.
const INSTANCE_TTL_THRESHOLD: u32 = 172_800; // ~10 gün kaldıysa
const INSTANCE_TTL_EXTEND: u32 = 518_400; // ~30 güne tamamla

// Ödeme kayıtları `persistent` storage'da ve İÇLERİNDE PARA VAR.
// Kayıt arşivlenirse fona erişilemez, dolayısıyla TTL her zaman
// expiry_ledger'dan uzun olmalı. MAX_EXPIRY_LEDGERS bunu garanti eder:
// kabul edilen en uzak expiry bile TTL penceresinin içinde kalır.
const PAYMENT_TTL_THRESHOLD: u32 = 518_400; // ~30 gün kaldıysa
const PAYMENT_TTL_EXTEND: u32 = 1_036_800; // ~60 güne tamamla
const MAX_EXPIRY_LEDGERS: u32 = 518_400; // deposit anından en fazla ~30 gün

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// init yalnızca bir kez çağrılabilir.
    AlreadyInitialized = 1,
    /// Kontrat henüz init edilmemiş.
    NotInitialized = 2,
    /// Tutar sıfır veya negatif.
    InvalidAmount = 3,
    /// expiry_ledger şimdiki ledger'dan geride veya ona eşit.
    ExpiryInPast = 4,
    /// expiry_ledger, storage TTL penceresinin ötesinde.
    ExpiryTooFar = 5,
    /// Böyle bir ödeme kaydı yok.
    PaymentNotFound = 6,
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

/// Emanet yatırıldı.
///
/// `identity` topic olarak yayılır: indexer bir kimliğe ait tüm ödemeleri
/// tek filtreyle toplayabilsin. Faz 4'teki "bekleyen bakiye" ekranı bunu okur.
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

    /// Bir internet kimliğine etiketli emanet yatırır.
    ///
    /// Para alıcının cüzdanına DEĞİL, kontrata geçer ve `identity` etiketiyle
    /// bekler. Alıcının bu sırada bir cüzdanı olması, hatta Paytag'den haberi
    /// olması gerekmez — ürünün ana vaadi budur (SPEC.md §2).
    ///
    /// Dönen `u64`, ödemenin kimliğidir; claim ve refund bununla yapılır.
    pub fn deposit(
        env: Env,
        from: Address,
        identity: BytesN<32>,
        token: Address,
        amount: i128,
        expiry_ledger: u32,
    ) -> Result<u64, Error> {
        // Kontrat kurulmadan para kabul etmeyiz: verifier anahtarı
        // belirlenmemişken yatırılan para hiçbir zaman claim edilemezdi.
        Self::load_config(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let now = env.ledger().sequence();
        if expiry_ledger <= now {
            // Zaten dolmuş bir emanet, anında refund edilebilir olurdu —
            // alıcıya hiç şans tanımayan anlamsız bir kayıt.
            return Err(Error::ExpiryInPast);
        }
        if expiry_ledger > now + MAX_EXPIRY_LEDGERS {
            // Kaydın TTL'i expiry'den kısa kalırsa para erişilemez hale gelir.
            return Err(Error::ExpiryTooFar);
        }

        from.require_auth();

        // Parayı gönderenden kontrata çek. Auth yoksa burada panikler.
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

    pub fn get_payment(env: Env, id: u64) -> Result<PaymentData, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Payment(id))
            .ok_or(Error::PaymentNotFound)
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

    fn bump_payment(env: &Env, id: u64) {
        env.storage().persistent().extend_ttl(
            &DataKey::Payment(id),
            PAYMENT_TTL_THRESHOLD,
            PAYMENT_TTL_EXTEND,
        );
    }

    /// Monoton artan ödeme id'si. 1'den başlar; 0 "yok" anlamına ayrılmıştır.
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
mod test_deposit;
