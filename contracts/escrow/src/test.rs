#![cfg(test)]
//! Faz 2.1 testleri — kurulum ve yetki.
//!
//! SPEC.md §5 kırmızı takım tablosundan karşılananlar: #16, #17.

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{BytesN, Env};

/// Test ortamı: kontrat kaydedilir, admin ve verifier anahtarı üretilir.
fn setup() -> (Env, PaytagEscrowClient<'static>, Address, BytesN<32>) {
    let env = Env::default();
    let id = env.register(PaytagEscrow, ());
    let client = PaytagEscrowClient::new(&env, &id);
    let admin = Address::generate(&env);
    let verifier = BytesN::from_array(&env, &[7u8; 32]);
    (env, client, admin, verifier)
}

#[test]
fn init_kurulumu_yazar() {
    let (env, client, admin, verifier) = setup();
    env.mock_all_auths();

    client.init(&admin, &verifier, &518_400);

    let cfg = client.get_config();
    assert_eq!(cfg.admin, admin);
    assert_eq!(cfg.verifier, verifier);
    assert_eq!(cfg.default_expiry_ledgers, 518_400);
}

/// SPEC.md §5 #16 — init ikinci kez çağrılamaz.
/// Aksi halde saldırgan verifier anahtarını kendi anahtarıyla değiştirip
/// escrow'daki her ödemeyi claim edebilirdi.
#[test]
fn init_ikinci_kez_reddedilir() {
    let (env, client, admin, verifier) = setup();
    env.mock_all_auths();
    client.init(&admin, &verifier, &518_400);

    let saldirgan = Address::generate(&env);
    let sahte_verifier = BytesN::from_array(&env, &[9u8; 32]);
    let sonuc = client.try_init(&saldirgan, &sahte_verifier, &100);

    assert_eq!(sonuc, Err(Ok(Error::AlreadyInitialized)));

    // Yapılandırma bozulmamış olmalı.
    let cfg = client.get_config();
    assert_eq!(cfg.admin, admin);
    assert_eq!(cfg.verifier, verifier);
}

#[test]
fn init_edilmemis_kontrat_config_vermez() {
    let (_env, client, _admin, _verifier) = setup();
    assert_eq!(client.try_get_config(), Err(Ok(Error::NotInitialized)));
}

#[test]
fn set_verifier_anahtari_degistirir() {
    let (env, client, admin, verifier) = setup();
    env.mock_all_auths();
    client.init(&admin, &verifier, &518_400);

    let yeni = BytesN::from_array(&env, &[42u8; 32]);
    client.set_verifier(&yeni);

    assert_eq!(client.get_config().verifier, yeni);
}

/// SPEC.md §5 #17 — admin yetkisi olmadan verifier değiştirilemez.
/// Bu, kontratın tek merkezi güç noktasıdır; korumasız kalırsa
/// herkes kendi anahtarını verifier yapıp bütün escrow'u boşaltır.
#[test]
#[should_panic]
fn set_verifier_auth_olmadan_reddedilir() {
    let (env, client, admin, verifier) = setup();
    env.mock_all_auths();
    client.init(&admin, &verifier, &518_400);

    // Yetkilendirmeyi kaldır: artık require_auth panikler.
    env.set_auths(&[]);
    let yeni = BytesN::from_array(&env, &[42u8; 32]);
    client.set_verifier(&yeni);
}

#[test]
fn init_edilmemis_kontratta_set_verifier_reddedilir() {
    let (env, client, _admin, _verifier) = setup();
    let yeni = BytesN::from_array(&env, &[42u8; 32]);
    assert_eq!(
        client.try_set_verifier(&yeni),
        Err(Ok(Error::NotInitialized))
    );
}
