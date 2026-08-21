#![cfg(test)]
//! Faz 2.6 — solvency invariantı (property-based test).
//!
//! SPEC.md §5 #15.
//!
//! Buraya kadarki 44 test, **düşündüğümüz** senaryoları kapsıyor. Bu test
//! düşünmediğimizi arıyor: rastgele üretilmiş `deposit` / `claim` / `refund` /
//! "ledger ilerlet" dizileri koşturup her adımdan sonra tek bir değişmezi
//! zorluyor:
//!
//! ```text
//! kontratın token bakiyesi == durumu Pending olan ödemelerin toplamı
//! ```
//!
//! Eşitlik, eşitsizlikten daha güçlü bir iddia. `>=` yazsaydık "para
//! kaybolmuyor" derdik; `==` ayrıca "kontratta sahipsiz para birikmiyor"
//! diyor. İkisi de bozulursa aynı hata sınıfı: bir durum geçişi ile para
//! hareketi arasındaki bağın kopması.

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use proptest::prelude::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, vec as svec, Address, BytesN, Env};
use std::vec::Vec as StdVec;

/// Üç ayrı kimlik: ödemelerin farklı etiketlere dağılması, kimlik karışması
/// olup olmadığını da baskı altına alır.
const IDENTS: [[u8; 32]; 3] = [[0x11; 32], [0x22; 32], [0x33; 32]];

const START_LEDGER: u32 = 1_000;
const MINT: i128 = 1_000_000;

/// Modelin ürettiği soyut işlem.
#[derive(Debug, Clone)]
enum Op {
    Deposit {
        gonderen: u8,
        kimlik: u8,
        tutar: i128,
        expiry_offset: u32,
    },
    /// `ids`, ödeme id'lerine indeks olarak yorumlanır; geçersiz/tekrarlı
    /// olabilir — sözleşme gereği bu durumda tüm çağrı geri alınmalı.
    Claim {
        kimlik: u8,
        ids: StdVec<u8>,
    },
    Refund {
        id: u8,
    },
    Ilerlet {
        ledger: u32,
    },
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        4 => (0u8..3, 0u8..3, 1i128..5_000, 1u32..40_000).prop_map(
            |(gonderen, kimlik, tutar, expiry_offset)| Op::Deposit {
                gonderen,
                kimlik,
                tutar,
                expiry_offset,
            }
        ),
        3 => (0u8..3, prop::collection::vec(0u8..12, 1..4))
            .prop_map(|(kimlik, ids)| Op::Claim { kimlik, ids }),
        2 => (0u8..12).prop_map(|id| Op::Refund { id }),
        2 => (1u32..25_000).prop_map(|ledger| Op::Ilerlet { ledger }),
    ]
}

/// Test tarafındaki ayna: kontratın ne yapması gerektiğini bağımsız tutar.
struct Ayna {
    tutar: i128,
    bekliyor: bool,
}

struct Diyar {
    env: Env,
    client: PaytagEscrowClient<'static>,
    kontrat: Address,
    token: Address,
    gonderenler: StdVec<Address>,
    alici: Address,
    sk: SigningKey,
    nonce_sayaci: u64,
    ayna: StdVec<Ayna>,
}

fn kur() -> Diyar {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    let sk = SigningKey::from_bytes(&[5u8; 32]);
    let kontrat = env.register(PaytagEscrow, ());
    let client = PaytagEscrowClient::new(&env, &kontrat);
    client.init(
        &Address::generate(&env),
        &BytesN::from_array(&env, &sk.verifying_key().to_bytes()),
        &518_400,
    );

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let sac = token::StellarAssetClient::new(&env, &token);

    let mut gonderenler = StdVec::new();
    for _ in 0..3 {
        let a = Address::generate(&env);
        sac.mint(&a, &MINT);
        gonderenler.push(a);
    }

    Diyar {
        alici: Address::generate(&env),
        env,
        client,
        kontrat,
        token,
        gonderenler,
        sk,
        nonce_sayaci: 0,
        ayna: StdVec::new(),
    }
}

fn strkey56(addr: &Address) -> [u8; 56] {
    let mut buf = [0u8; 56];
    addr.to_string().copy_into_slice(&mut buf);
    buf
}

/// SPEC.md §4.1 düzeni — kontrattan bağımsız olarak kurulur.
fn imzala(d: &Diyar, kimlik: &[u8; 32], expires_at: u32, nonce: &[u8; 32]) -> BytesN<64> {
    let mut b = [0u8; 195];
    b[0..15].copy_from_slice(b"paytag.claim.v1");
    b[15..71].copy_from_slice(&strkey56(&d.kontrat));
    b[71..103].copy_from_slice(kimlik);
    b[103..159].copy_from_slice(&strkey56(&d.alici));
    b[159..163].copy_from_slice(&expires_at.to_be_bytes());
    b[163..195].copy_from_slice(nonce);
    BytesN::from_array(&d.env, &d.sk.sign(&b).to_bytes())
}

fn kontrat_bakiyesi(d: &Diyar) -> i128 {
    token::Client::new(&d.env, &d.token).balance(&d.kontrat)
}

fn bekleyen_toplami(d: &Diyar) -> i128 {
    d.ayna.iter().filter(|a| a.bekliyor).map(|a| a.tutar).sum()
}

/// Değişmez. Her işlemden sonra çağrılır.
fn invariant(d: &Diyar, nerede: &str) -> Result<(), TestCaseError> {
    let gercek = kontrat_bakiyesi(d);
    let beklenen = bekleyen_toplami(d);
    prop_assert_eq!(
        gercek,
        beklenen,
        "SOLVENCY BOZULDU ({}): kontratta {} var, bekleyen ödemeler toplamı {}",
        nerede,
        gercek,
        beklenen
    );
    Ok(())
}

fn uygula(d: &mut Diyar, op: &Op) -> Result<(), TestCaseError> {
    match op {
        Op::Deposit {
            gonderen,
            kimlik,
            tutar,
            expiry_offset,
        } => {
            let simdi = d.env.ledger().sequence();
            let from = d.gonderenler[*gonderen as usize].clone();
            let ident = BytesN::from_array(&d.env, &IDENTS[*kimlik as usize]);

            let r = d
                .client
                .try_deposit(&from, &ident, &d.token, tutar, &(simdi + expiry_offset));
            if r.is_ok() {
                d.ayna.push(Ayna {
                    tutar: *tutar,
                    bekliyor: true,
                });
            }
        }

        Op::Claim { kimlik, ids } => {
            if d.ayna.is_empty() {
                return Ok(());
            }
            let simdi = d.env.ledger().sequence();
            let ident_raw = IDENTS[*kimlik as usize];
            let ident = BytesN::from_array(&d.env, &ident_raw);

            // Her claim taze bir nonce ile: replay'i burada test etmiyoruz,
            // NonceAlreadyUsed her şeyi erken kesip aramayı sığlaştırırdı.
            d.nonce_sayaci += 1;
            let mut nonce_raw = [0u8; 32];
            nonce_raw[..8].copy_from_slice(&d.nonce_sayaci.to_be_bytes());
            let nonce = BytesN::from_array(&d.env, &nonce_raw);

            let expires_at = simdi + 100;
            let sig = imzala(d, &ident_raw, expires_at, &nonce_raw);

            let mut liste = svec![&d.env];
            let mut secilen: StdVec<usize> = StdVec::new();
            for i in ids {
                let idx = *i as usize;
                liste.push_back((idx as u64) + 1); // id'ler 1'den başlar
                secilen.push(idx);
            }

            let r = d
                .client
                .try_claim(&liste, &ident, &d.alici, &nonce, &expires_at, &sig);

            // Çağrı ya tamamen geçer ya hiç etki etmez (atomiklik).
            if r.is_ok() {
                for idx in secilen {
                    d.ayna[idx].bekliyor = false;
                }
            }
        }

        Op::Refund { id } => {
            let idx = *id as usize;
            let r = d.client.try_refund(&((idx as u64) + 1));
            if r.is_ok() {
                d.ayna[idx].bekliyor = false;
            }
        }

        Op::Ilerlet { ledger } => {
            let yeni = d.env.ledger().sequence() + ledger;
            d.env.ledger().set_sequence_number(yeni);
        }
    }
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 160,
        max_shrink_iters: 2_000,
        ..ProptestConfig::default()
    })]

    /// SPEC.md §5 #15 — kontrat bakiyesi ile bekleyen ödemeler her zaman eşit.
    #[test]
    fn solvency_hicbir_dizide_bozulmaz(ops in prop::collection::vec(op_strategy(), 1..45)) {
        let mut d = kur();
        invariant(&d, "başlangıç")?;

        for (i, op) in ops.iter().enumerate() {
            uygula(&mut d, op)?;
            invariant(&d, &std::format!("{}. işlem: {:?}", i + 1, op))?;
        }
    }
}

/// Fuzz'un bulması beklenen türden bir senaryoyu elle de sabitliyoruz:
/// aynı ödeme üzerinde claim ve refund yarışı (SPEC.md §5 #11).
/// Hangisi önce geçerse diğeri reddedilmeli ve para iki kez çıkmamalı.
#[test]
fn claim_ve_refund_ayni_odemede_yarisamaz() {
    let mut d = kur();
    let simdi = d.env.ledger().sequence();
    let ident_raw = IDENTS[0];
    let ident = BytesN::from_array(&d.env, &ident_raw);

    let id = d
        .client
        .deposit(&d.gonderenler[0], &ident, &d.token, &500, &(simdi + 50));
    d.ayna.push(Ayna {
        tutar: 500,
        bekliyor: true,
    });

    // Süre dolmadan önce claim geçer.
    let expires_at = simdi + 10;
    let nonce_raw = [0x7u8; 32];
    let sig = imzala(&d, &ident_raw, expires_at, &nonce_raw);
    d.client.claim(
        &svec![&d.env, id],
        &ident,
        &d.alici,
        &BytesN::from_array(&d.env, &nonce_raw),
        &expires_at,
        &sig,
    );
    d.ayna[0].bekliyor = false;

    // Süre dolduktan sonra gönderen aynı ödemeyi iade almaya çalışır.
    d.env.ledger().set_sequence_number(simdi + 100);
    assert_eq!(
        d.client.try_refund(&id),
        Err(Ok(Error::AlreadySettled)),
        "claim edilmiş ödeme refund edilememeli"
    );

    assert_eq!(kontrat_bakiyesi(&d), 0);
    assert_eq!(bekleyen_toplami(&d), 0);
    assert_eq!(
        token::Client::new(&d.env, &d.token).balance(&d.alici),
        500,
        "para yalnızca bir kez çıkmalı"
    );
}
