#![no_std]
//! Paytag escrow — internet kimliğine etiketlenmiş USDC emaneti.
//!
//! Tasarım kararları ve saldırı analizi için: docs/SPEC.md
//!
//! Faz 2.1: tipler, storage, init, set_verifier.
//! Faz 2.2: deposit.
//! Faz 2.3: claim (ed25519 verifier imzası + nonce replay koruması).
//! Faz 2.4: refund.
//! Faz 2.6: solvency invariantı (test_fuzz).

// proptest ve ed25519-dalek std ister; kontrat wasm'ı hâlâ no_std.
#[cfg(test)]
extern crate std;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Bytes,
    BytesN, Env, Vec,
};

/// İmzanın anlamını sabitleyen alan ayırıcı (domain separation).
/// Verifier'ın başka bir amaçla ürettiği bir imza, bu önek olmadan
/// claim yetkisi olarak yeniden yorumlanabilirdi. SPEC.md §4.3
const CLAIM_DOMAIN: &[u8; 15] = b"paytag.claim.v1";

/// Stellar strkey uzunluğu: `G...` hesap ve `C...` kontrat adresleri
/// 56 karakterdir. Muxed (`M...`, 69 karakter) desteklenmiyor.
const STRKEY_LEN: u32 = 56;

/// Harcanmış nonce kaydı imzadan biraz uzun yaşamalı ki, imza son
/// geçerlilik anına çok yakın sunulduğunda kayıt erkenden silinmesin.
const NONCE_TTL_BUFFER: u32 = 17_280; // ~1 gün

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
    /// Ödeme zaten claim veya refund edilmiş.
    AlreadySettled = 7,
    /// expiry_ledger henüz geçmedi; refund erken.
    NotYetExpired = 8,
    /// claim çağrısında hiç ödeme id'si verilmemiş.
    NoPayments = 9,
    /// Verifier imzasının geçerlilik süresi dolmuş.
    SignatureExpired = 10,
    /// Bu nonce daha önce harcandı (replay denemesi).
    NonceAlreadyUsed = 11,
    /// Ödemenin etiketi, imzalanan kimlikle uyuşmuyor.
    IdentityMismatch = 12,
    /// Ödemenin claim penceresi kapandı; artık yalnızca refund edilebilir.
    PaymentExpired = 13,
    /// Adres desteklenmiyor (strkey 56 karakter değil, ör. muxed M...).
    UnsupportedAddress = 14,
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

/// Emanet, kimliğin sahibi tarafından çekildi.
#[contractevent(topics = ["claim"])]
pub struct ClaimEvent {
    #[topic]
    pub identity: BytesN<32>,
    pub payment_id: u64,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
}

/// Emanet süresi doldu ve gönderene iade edildi.
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

    /// Verifier'ın imzaladığı yetkiyle emanetleri alıcının cüzdanına çeker.
    ///
    /// Kontrat GitHub'a soramaz. Off-chain verifier OAuth ile handle
    /// sahipliğini doğrular ve "şu kimliğin sahibi şu adrestir" diyen bir
    /// preimage'ı ed25519 ile imzalar; burada o imza doğrulanır.
    /// Preimage'ın byte düzeni ve her alanın hangi saldırıyı kapattığı:
    /// SPEC.md §4.
    ///
    /// Çağrı ya tamamen başarılı olur ya da hiç etki etmez: listedeki tek bir
    /// ödeme geçersizse dönen hata tüm işlemi geri alır (atomiklik).
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
        // Aşırı uzun imza ömrü, nonce kaydına taşıyamayacağımız bir TTL
        // gerektirirdi; kayıt silinirse replay koruması çöker.
        if expires_at > now + MAX_EXPIRY_LEDGERS {
            return Err(Error::ExpiryTooFar);
        }

        // Replay kontrolü imza doğrulamasından ÖNCE: harcanmış bir nonce
        // için pahalı kriptoyu hiç çalıştırmıyoruz.
        let nonce_key = DataKey::Nonce(nonce.clone());
        if env.storage().temporary().has(&nonce_key) {
            return Err(Error::NonceAlreadyUsed);
        }

        let preimage = Self::claim_preimage(&env, &identity, &recipient, expires_at, &nonce)?;
        // Geçersiz imzada panikler — Result döndürmez.
        env.crypto().ed25519_verify(&cfg.verifier, &preimage, &sig);

        // Nonce'u harca. `temporary` yeterli: kayıt silinse bile aynı imza
        // `expires_at` kontrolünden geçemez. İki koruma birlikte yeterli.
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
            // İmza yalnızca bir kimlik için yetki verir. Bu kontrol olmasaydı
            // geçerli bir imzayla BAŞKA bir kimliğin parası çekilebilirdi.
            if p.identity != identity {
                return Err(Error::IdentityMismatch);
            }
            // Süresi dolmuş ödeme artık gönderenindir; claim edilemez.
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

    /// Süresi dolmuş bir emaneti gönderene iade eder.
    ///
    /// Yalnızca parayı yatıran çağırabilir ve yalnızca `expiry_ledger`
    /// GEÇTİKTEN sonra. Alıcının claim penceresi bitmeden gönderen
    /// parayı geri çekemez — aksi halde gönderen, alıcı claim'e
    /// hazırlanırken parayı kaçırabilirdi.
    pub fn refund(env: Env, payment_id: u64) -> Result<(), Error> {
        let mut p: PaymentData = env
            .storage()
            .persistent()
            .get(&DataKey::Payment(payment_id))
            .ok_or(Error::PaymentNotFound)?;

        // Tek yönlü durum makinesi: Pending dışında hiçbir şey iade edilemez.
        // Bu tek satır hem çifte-refund'ı hem claim edilmiş parayı korur.
        if p.status != Status::Pending {
            return Err(Error::AlreadySettled);
        }

        let now = env.ledger().sequence();
        if now <= p.expiry_ledger {
            return Err(Error::NotYetExpired);
        }

        p.from.require_auth();

        // ÖNCE durumu yaz, SONRA parayı gönder (checks-effects-interactions).
        // Token kontratı bize geri çağrı yapabilen bir dış taraftır; durum
        // güncel değilken ona kontrol devretmek yeniden giriş riskidir.
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

    /// Verifier'ın imzaladığı 195 baytlık sabit düzenli preimage'ı kurar.
    ///
    /// | ofset | uzunluk | alan |
    /// |-------|---------|------|
    /// | 0     | 15      | domain ayırıcı |
    /// | 15    | 56      | kontrat adresi (strkey, ASCII) |
    /// | 71    | 32      | identity_key |
    /// | 103   | 56      | alıcı adresi (strkey, ASCII) |
    /// | 159   | 4       | expires_at, big-endian u32 |
    /// | 163   | 32      | nonce |
    ///
    /// Uzunluk sabit olduğu için alan sınırları belirsizliğe yer bırakmaz;
    /// ayırıcı karakter gerekmez. Adresler ham anahtar yerine strkey olarak
    /// gömülür: SDK'nın ham anahtar çıkarma yolu `hazmat-address` özelliği
    /// arkasındadır ve dokümanı bunu imza doğrulamada kullanmaya karşı
    /// açıkça uyarır. Strkey ayrıca TypeScript tarafında `toString()` ile
    /// birebir üretilebilir — Faz 3'teki parity riskini azaltır.
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
mod test_claim;
#[cfg(test)]
mod test_crosslang;
#[cfg(test)]
mod test_deposit;
#[cfg(test)]
mod test_fuzz;
#[cfg(test)]
mod test_refund;
