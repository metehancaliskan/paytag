#![cfg(test)]
//! Faz 2.2 testleri — `deposit`.
//!
//! SPEC.md §5 kırmızı takım tablosundan karşılananlar: #13, #14.

use super::*;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{token, vec, Address, BytesN, Env, IntoVal, Map, Symbol, Val};

/// SPEC.md §2.3 test vektörü: sha256(0x00 ‖ "torvalds")
const TORVALDS: [u8; 32] = [
    0x9d, 0x86, 0x38, 0xcd, 0xf5, 0x59, 0x4e, 0xe5, 0xa5, 0x17, 0x8e, 0x3d, 0x41, 0x3f, 0xb8, 0x20,
    0x65, 0x13, 0x35, 0x6b, 0x94, 0x7d, 0xe1, 0xde, 0x60, 0x0f, 0x17, 0x85, 0x32, 0xc7, 0x06, 0x0b,
];

const START_LEDGER: u32 = 1_000;
const OK_EXPIRY: u32 = START_LEDGER + 100_000;

struct Fix<'a> {
    env: Env,
    client: PaytagEscrowClient<'a>,
    contract_id: Address,
    gonderen: Address,
    token: Address,
    identity: BytesN<32>,
}

/// Kurulmuş kontrat + 1000 birimlik bakiyesi olan bir gönderen.
fn fix() -> Fix<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    let contract_id = env.register(PaytagEscrow, ());
    let client = PaytagEscrowClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let verifier = BytesN::from_array(&env, &[7u8; 32]);
    client.init(&admin, &verifier, &518_400);

    // Test USDC'si: gerçekte SEP-41 arayüzüne konuşuyoruz, testte
    // Stellar Asset Contract aynı arayüzü sağlıyor.
    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token = sac.address();

    let gonderen = Address::generate(&env);
    token::StellarAssetClient::new(&env, &token).mint(&gonderen, &1_000);

    let identity = BytesN::from_array(&env, &TORVALDS);

    Fix {
        env,
        client,
        contract_id,
        gonderen,
        token,
        identity,
    }
}

fn bakiye(f: &Fix, who: &Address) -> i128 {
    token::Client::new(&f.env, &f.token).balance(who)
}

#[test]
fn deposit_parayi_kontrata_tasir() {
    let f = fix();

    let id = f
        .client
        .deposit(&f.gonderen, &f.identity, &f.token, &250, &OK_EXPIRY);

    assert_eq!(id, 1, "ilk ödeme id'si 1 olmalı (0 'yok' için ayrılmış)");
    assert_eq!(bakiye(&f, &f.gonderen), 750);
    assert_eq!(bakiye(&f, &f.contract_id), 250);

    let p = f.client.get_payment(&id);
    assert_eq!(p.from, f.gonderen);
    assert_eq!(p.identity, f.identity);
    assert_eq!(p.token, f.token);
    assert_eq!(p.amount, 250);
    assert_eq!(p.expiry_ledger, OK_EXPIRY);
    assert_eq!(p.status, Status::Pending);
}

#[test]
fn deposit_id_leri_artar() {
    let f = fix();
    let a = f
        .client
        .deposit(&f.gonderen, &f.identity, &f.token, &10, &OK_EXPIRY);
    let b = f
        .client
        .deposit(&f.gonderen, &f.identity, &f.token, &20, &OK_EXPIRY);
    let c = f
        .client
        .deposit(&f.gonderen, &f.identity, &f.token, &30, &OK_EXPIRY);
    assert_eq!((a, b, c), (1, 2, 3));
    assert_eq!(bakiye(&f, &f.contract_id), 60);
}

/// Aynı kimliğe farklı kişiler ödeme yapabilir; hepsi ayrı kayıt.
#[test]
fn ayni_kimlige_coklu_gonderen() {
    let f = fix();
    let ikinci = Address::generate(&f.env);
    token::StellarAssetClient::new(&f.env, &f.token).mint(&ikinci, &500);

    f.client
        .deposit(&f.gonderen, &f.identity, &f.token, &100, &OK_EXPIRY);
    f.client
        .deposit(&ikinci, &f.identity, &f.token, &400, &OK_EXPIRY);

    assert_eq!(bakiye(&f, &f.contract_id), 500);
    assert_eq!(f.client.get_payment(&1).from, f.gonderen);
    assert_eq!(f.client.get_payment(&2).from, ikinci);
}

/// SPEC.md §5 #13 — sıfır tutar reddedilir.
#[test]
fn deposit_sifir_tutari_reddeder() {
    let f = fix();
    let r = f
        .client
        .try_deposit(&f.gonderen, &f.identity, &f.token, &0, &OK_EXPIRY);
    assert_eq!(r, Err(Ok(Error::InvalidAmount)));
    assert_eq!(bakiye(&f, &f.gonderen), 1_000, "para hiç hareket etmemeli");
}

/// SPEC.md §5 #13 — negatif tutar reddedilir.
/// Kontrol olmasaydı negatif transfer, kontrattan para ÇEKME anlamına gelebilirdi.
#[test]
fn deposit_negatif_tutari_reddeder() {
    let f = fix();
    let r = f
        .client
        .try_deposit(&f.gonderen, &f.identity, &f.token, &-100, &OK_EXPIRY);
    assert_eq!(r, Err(Ok(Error::InvalidAmount)));
    assert_eq!(bakiye(&f, &f.gonderen), 1_000);
}

/// SPEC.md §5 #14 — geçmiş expiry reddedilir.
#[test]
fn deposit_gecmis_expiry_reddeder() {
    let f = fix();
    let r = f.client.try_deposit(
        &f.gonderen,
        &f.identity,
        &f.token,
        &100,
        &(START_LEDGER - 1),
    );
    assert_eq!(r, Err(Ok(Error::ExpiryInPast)));
}

/// Sınır: expiry == şimdiki ledger de reddedilmeli.
/// Aksi halde alıcıya sıfır saniyelik pencere tanınırdı.
#[test]
fn deposit_expiry_simdiki_ledgera_esitse_reddeder() {
    let f = fix();
    let r = f
        .client
        .try_deposit(&f.gonderen, &f.identity, &f.token, &100, &START_LEDGER);
    assert_eq!(r, Err(Ok(Error::ExpiryInPast)));
}

/// TTL penceresinin ötesindeki expiry reddedilir.
/// Kabul edilseydi kayıt arşivlenir ve para erişilemez hale gelirdi.
#[test]
fn deposit_cok_uzak_expiry_reddeder() {
    let f = fix();
    let cok_uzak = START_LEDGER + MAX_EXPIRY_LEDGERS + 1;
    let r = f
        .client
        .try_deposit(&f.gonderen, &f.identity, &f.token, &100, &cok_uzak);
    assert_eq!(r, Err(Ok(Error::ExpiryTooFar)));

    // Tam sınır kabul edilmeli.
    let sinir = START_LEDGER + MAX_EXPIRY_LEDGERS;
    assert_eq!(
        f.client
            .deposit(&f.gonderen, &f.identity, &f.token, &100, &sinir),
        1
    );
}

/// Kurulmamış kontrat para kabul etmemeli: verifier anahtarı yokken
/// yatırılan para hiçbir zaman claim edilemezdi.
#[test]
fn deposit_init_edilmemis_kontratta_reddedilir() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    let client = PaytagEscrowClient::new(&env, &env.register(PaytagEscrow, ()));
    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let gonderen = Address::generate(&env);
    let identity = BytesN::from_array(&env, &TORVALDS);

    let r = client.try_deposit(&gonderen, &identity, &token, &100, &OK_EXPIRY);
    assert_eq!(r, Err(Ok(Error::NotInitialized)));
}

/// Gönderenin imzası olmadan para çekilemez.
#[test]
#[should_panic]
fn deposit_auth_olmadan_reddedilir() {
    let f = fix();
    f.env.set_auths(&[]);
    f.client
        .deposit(&f.gonderen, &f.identity, &f.token, &100, &OK_EXPIRY);
}

#[test]
fn deposit_olayi_identity_topicli_yayinlanir() {
    let f = fix();
    let id = f
        .client
        .deposit(&f.gonderen, &f.identity, &f.token, &250, &OK_EXPIRY);

    // Yalnızca escrow kontratının olayları — token transferininkiler elenir.
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.contract_id),
        vec![
            &f.env,
            (
                f.contract_id.clone(),
                // topic'ler: sabit "deposit" + dinamik identity
                (Symbol::new(&f.env, "deposit"), f.identity.clone()).into_val(&f.env),
                // veri: alan adı -> değer
                Map::<Symbol, Val>::from_array(
                    &f.env,
                    [
                        (Symbol::new(&f.env, "payment_id"), id.into_val(&f.env)),
                        (Symbol::new(&f.env, "from"), f.gonderen.into_val(&f.env)),
                        (Symbol::new(&f.env, "token"), f.token.into_val(&f.env)),
                        (Symbol::new(&f.env, "amount"), 250i128.into_val(&f.env)),
                        (
                            Symbol::new(&f.env, "expiry_ledger"),
                            OK_EXPIRY.into_val(&f.env)
                        ),
                    ]
                )
                .into_val(&f.env),
            )
        ]
    );
}

#[test]
fn olmayan_odeme_sorulunca_hata() {
    let f = fix();
    assert_eq!(
        f.client.try_get_payment(&99),
        Err(Ok(Error::PaymentNotFound))
    );
}
