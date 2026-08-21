#![cfg(test)]
//! Rust ↔ TypeScript imza uyumluluğu.
//!
//! `scripts/paytag.mjs` (Node, sıfır bağımlılık) ile üretilmiş GERÇEK bir
//! ed25519 imzasının, kontratın kendi kurduğu preimage üzerinde doğrulandığını
//! kanıtlar. Faz 3'teki verifier bu koddan türeyecek.
//!
//! İki taraf ayrışırsa hiçbir claim çalışmaz ve hata Faz 4'e kadar görünmez.
//! Bu test o felaketin çıpası — SPEC.md §4.2 altın vektörünü kullanır.

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env, String};

/// scripts/paytag.mjs, seed [3u8; 32] ile:
///   node scripts/paytag.mjs selftest
const NODE_PUB: &str = "ed4928c628d1c2c6eae90338905995612959273a5c63f93636c14614ac8737d1";
const NODE_SIG: &str = "c73892370f1a383a7965a1d1b164e7e9b9068aa4e4dd533ecfc09be805b2f95d\
                        d25a60306f8979b6f6e24891d4eb85bfc4347c610cf61346924514847032b40d";

const SPEC_CONTRACT: &str = "CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU";
const SPEC_RECIPIENT: &str = "GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG";
const TORVALDS: [u8; 32] = [
    0x9d, 0x86, 0x38, 0xcd, 0xf5, 0x59, 0x4e, 0xe5, 0xa5, 0x17, 0x8e, 0x3d, 0x41, 0x3f, 0xb8, 0x20,
    0x65, 0x13, 0x35, 0x6b, 0x94, 0x7d, 0xe1, 0xde, 0x60, 0x0f, 0x17, 0x85, 0x32, 0xc7, 0x06, 0x0b,
];

fn hex32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

fn hex64(s: &str) -> [u8; 64] {
    let c: std::string::String = s.chars().filter(|c| !c.is_whitespace()).collect();
    let mut out = [0u8; 64];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&c[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

fn spec_preimage(env: &Env) -> soroban_sdk::Bytes {
    let kontrat = Address::from_string(&String::from_str(env, SPEC_CONTRACT));
    let alici = Address::from_string(&String::from_str(env, SPEC_RECIPIENT));
    env.register_at(&kontrat, PaytagEscrow, ());

    let identity = BytesN::from_array(env, &TORVALDS);
    let mut nonce_raw = [0u8; 32];
    for (i, b) in nonce_raw.iter_mut().enumerate() {
        *b = (i + 1) as u8;
    }
    let nonce = BytesN::from_array(env, &nonce_raw);

    env.as_contract(&kontrat, || {
        PaytagEscrow::claim_preimage(env, &identity, &alici, 1_000_000, &nonce).unwrap()
    })
}

/// Node'un imzası, kontratın kurduğu preimage üzerinde doğrulanıyor.
/// `ed25519_verify` geçersiz imzada panikler; panik yoksa imza geçerlidir.
#[test]
fn node_imzasi_kontratta_dogrulaniyor() {
    let env = Env::default();
    let pre = spec_preimage(&env);

    env.crypto().ed25519_verify(
        &BytesN::from_array(&env, &hex32(NODE_PUB)),
        &pre,
        &BytesN::from_array(&env, &hex64(NODE_SIG)),
    );
}

/// Karşı kontrol: aynı imza, tek biti değiştirilmiş preimage'da tutmamalı.
/// Bu olmadan yukarıdaki test "her şeyi kabul ediyor" olabilirdi.
#[test]
#[should_panic]
fn node_imzasi_degistirilmis_veride_tutmuyor() {
    let env = Env::default();
    let mut pre = spec_preimage(&env);
    let son = pre.len() - 1;
    let bozuk = pre.get(son).unwrap() ^ 0x01;
    pre.set(son, bozuk);

    env.crypto().ed25519_verify(
        &BytesN::from_array(&env, &hex32(NODE_PUB)),
        &pre,
        &BytesN::from_array(&env, &hex64(NODE_SIG)),
    );
}

/// Node'un ürettiği public key, kontratın beklediği 32 baytlık biçimde.
#[test]
fn node_public_key_bicimi_dogru() {
    let env = Env::default();
    let pk = BytesN::from_array(&env, &hex32(NODE_PUB));
    assert_eq!(pk.len(), 32);
    let _ = Address::generate(&env); // testutils kullanımı
}
