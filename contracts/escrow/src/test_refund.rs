#![cfg(test)]
//! Faz 2.4 testleri — `refund`.
//!
//! SPEC.md §5 kırmızı takım tablosundan karşılananlar: #8, #9, #10.

use super::*;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{token, vec, Address, BytesN, Env, IntoVal, Map, Symbol, Val};

/// SPEC.md §2.3 test vektörü: sha256(0x00 ‖ "torvalds")
const TORVALDS: [u8; 32] = [
    0x9d, 0x86, 0x38, 0xcd, 0xf5, 0x59, 0x4e, 0xe5, 0xa5, 0x17, 0x8e, 0x3d, 0x41, 0x3f, 0xb8, 0x20,
    0x65, 0x13, 0x35, 0x6b, 0x94, 0x7d, 0xe1, 0xde, 0x60, 0x0f, 0x17, 0x85, 0x32, 0xc7, 0x06, 0x0b,
];

const START_LEDGER: u32 = 1_000;
const EXPIRY: u32 = START_LEDGER + 10_000;

struct Fix<'a> {
    env: Env,
    client: PaytagEscrowClient<'a>,
    contract_id: Address,
    gonderen: Address,
    token: Address,
    identity: BytesN<32>,
}

/// Kurulmuş kontrat + 300 birimlik bekleyen bir emanet (payment id = 1).
fn fix() -> Fix<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    let contract_id = env.register(PaytagEscrow, ());
    let client = PaytagEscrowClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.init(&admin, &BytesN::from_array(&env, &[7u8; 32]), &518_400);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    let gonderen = Address::generate(&env);
    token::StellarAssetClient::new(&env, &token).mint(&gonderen, &1_000);

    let identity = BytesN::from_array(&env, &TORVALDS);
    client.deposit(&gonderen, &identity, &token, &300, &EXPIRY);

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
fn refund_expiry_sonrasi_parayi_geri_verir() {
    let f = fix();
    assert_eq!(bakiye(&f, &f.gonderen), 700);
    assert_eq!(bakiye(&f, &f.contract_id), 300);

    f.env.ledger().set_sequence_number(EXPIRY + 1);
    f.client.refund(&1);

    assert_eq!(bakiye(&f, &f.gonderen), 1_000, "para tam iade edilmeli");
    assert_eq!(bakiye(&f, &f.contract_id), 0);
    assert_eq!(f.client.get_payment(&1).status, Status::Refunded);
}

/// SPEC.md §5 #8 — expiry'den önce refund reddedilir.
/// Aksi halde gönderen, alıcı claim'e hazırlanırken parayı kaçırabilirdi.
#[test]
fn refund_expiry_oncesi_reddedilir() {
    let f = fix();
    f.env.ledger().set_sequence_number(EXPIRY - 1);

    assert_eq!(f.client.try_refund(&1), Err(Ok(Error::NotYetExpired)));
    assert_eq!(bakiye(&f, &f.contract_id), 300, "para kıpırdamamalı");
    assert_eq!(f.client.get_payment(&1).status, Status::Pending);
}

/// Sınır: expiry ledger'ının TAM üzerinde de reddedilir.
/// Kural "expiry_ledger GEÇTİKTEN sonra" — o ledger hâlâ alıcının.
#[test]
fn refund_tam_expiry_ledgerinda_reddedilir() {
    let f = fix();
    f.env.ledger().set_sequence_number(EXPIRY);
    assert_eq!(f.client.try_refund(&1), Err(Ok(Error::NotYetExpired)));
}

/// SPEC.md §5 #10 — iki kez refund edilemez.
#[test]
fn refund_ikinci_kez_reddedilir() {
    let f = fix();
    f.env.ledger().set_sequence_number(EXPIRY + 1);
    f.client.refund(&1);

    assert_eq!(f.client.try_refund(&1), Err(Ok(Error::AlreadySettled)));
    assert_eq!(bakiye(&f, &f.gonderen), 1_000, "çifte iade olmamalı");
}

/// SPEC.md §5 #9 — parayı yatırandan başkası refund edemez.
///
/// Soroban'da "çağıran" diye bir kavram yok; korumayı sağlayan şey
/// `p.from.require_auth()`. Burada YALNIZCA saldırganın yetkisini
/// mock'luyoruz: gönderenin imzası olmadığı için çağrı panikler.
#[test]
#[should_panic]
fn refund_baskasi_tarafindan_cagrilamaz() {
    let f = fix();
    f.env.ledger().set_sequence_number(EXPIRY + 1);

    let saldirgan = Address::generate(&f.env);
    f.env.mock_auths(&[MockAuth {
        address: &saldirgan,
        invoke: &MockAuthInvoke {
            contract: &f.contract_id,
            fn_name: "refund",
            args: (1u64,).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);

    f.client.refund(&1);
}

#[test]
fn olmayan_odeme_refund_edilemez() {
    let f = fix();
    f.env.ledger().set_sequence_number(EXPIRY + 1);
    assert_eq!(f.client.try_refund(&99), Err(Ok(Error::PaymentNotFound)));
}

/// Bir ödemenin iadesi diğerini etkilemez.
#[test]
fn refund_yalnizca_hedef_odemeyi_etkiler() {
    let f = fix();
    f.client
        .deposit(&f.gonderen, &f.identity, &f.token, &200, &(EXPIRY + 5_000));
    assert_eq!(bakiye(&f, &f.contract_id), 500);

    f.env.ledger().set_sequence_number(EXPIRY + 1);
    f.client.refund(&1);

    assert_eq!(f.client.get_payment(&1).status, Status::Refunded);
    assert_eq!(f.client.get_payment(&2).status, Status::Pending);
    assert_eq!(
        bakiye(&f, &f.contract_id),
        200,
        "2 numara kontratta kalmalı"
    );
}

#[test]
fn refund_olayi_identity_topicli_yayinlanir() {
    let f = fix();
    f.env.ledger().set_sequence_number(EXPIRY + 1);
    f.client.refund(&1);

    // NOT: `events().all()` yalnızca EN SON çağrının olaylarını tutar,
    // test boyunca birikmez. fix() içindeki deposit olayı burada görünmez.
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.contract_id),
        vec![
            &f.env,
            (
                f.contract_id.clone(),
                (Symbol::new(&f.env, "refund"), f.identity.clone()).into_val(&f.env),
                Map::<Symbol, Val>::from_array(
                    &f.env,
                    [
                        (Symbol::new(&f.env, "payment_id"), 1u64.into_val(&f.env)),
                        (Symbol::new(&f.env, "to"), f.gonderen.into_val(&f.env)),
                        (Symbol::new(&f.env, "token"), f.token.into_val(&f.env)),
                        (Symbol::new(&f.env, "amount"), 300i128.into_val(&f.env)),
                    ]
                )
                .into_val(&f.env),
            )
        ]
    );
}
