#![cfg(test)]
//! Faz 2.3 testleri — `claim`. Kontratın en kritik bloğu.
//!
//! SPEC.md §5 kırmızı takım tablosundan karşılananlar:
//! #1 sahte imza, #2 replay, #3 kontratlar arası taşıma, #4 alıcı değişimi,
//! #5 kimlik değişimi, #6 süresi geçmiş imza, #7 çifte claim, #12 batch atomikliği.

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{token, vec, Address, BytesN, Env, IntoVal, Map, String, Symbol, Val};

/// SPEC.md §2.3: sha256(0x00 ‖ "torvalds")
const TORVALDS: [u8; 32] = [
    0x9d, 0x86, 0x38, 0xcd, 0xf5, 0x59, 0x4e, 0xe5, 0xa5, 0x17, 0x8e, 0x3d, 0x41, 0x3f, 0xb8, 0x20,
    0x65, 0x13, 0x35, 0x6b, 0x94, 0x7d, 0xe1, 0xde, 0x60, 0x0f, 0x17, 0x85, 0x32, 0xc7, 0x06, 0x0b,
];
/// SPEC.md §2.3: sha256(0x00 ‖ "metehancaliskan")
const METEHAN: [u8; 32] = [
    0x91, 0xe2, 0x3a, 0x08, 0x97, 0x3a, 0xba, 0x69, 0xe1, 0x46, 0x64, 0xcb, 0x9e, 0x12, 0xcc, 0x20,
    0x48, 0x3a, 0x4f, 0x70, 0x2a, 0xfd, 0xd3, 0x04, 0xc8, 0xad, 0x74, 0x24, 0xa3, 0x54, 0xff, 0xff,
];

const START_LEDGER: u32 = 1_000;
const PAY_EXPIRY: u32 = START_LEDGER + 10_000;
const SIG_EXPIRES: u32 = START_LEDGER + 500;
const NONCE_A: [u8; 32] = [0xAA; 32];
const NONCE_B: [u8; 32] = [0xBB; 32];

struct Fix<'a> {
    env: Env,
    client: PaytagEscrowClient<'a>,
    contract_id: Address,
    gonderen: Address,
    alici: Address,
    token: Address,
    identity: BytesN<32>,
    sk: SigningKey,
}

fn fix() -> Fix<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    // Verifier anahtar çifti. Gerçekte private key sunucuda kalır;
    // burada imzayı üretebilmek için testin elinde.
    let sk = SigningKey::from_bytes(&[3u8; 32]);
    let verifier = BytesN::from_array(&env, &sk.verifying_key().to_bytes());

    let contract_id = env.register(PaytagEscrow, ());
    let client = PaytagEscrowClient::new(&env, &contract_id);
    client.init(&Address::generate(&env), &verifier, &518_400);

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let gonderen = Address::generate(&env);
    token::StellarAssetClient::new(&env, &token).mint(&gonderen, &1_000);

    let identity = BytesN::from_array(&env, &TORVALDS);
    let alici = Address::generate(&env);

    Fix {
        env,
        client,
        contract_id,
        gonderen,
        alici,
        token,
        identity,
        sk,
    }
}

fn bakiye(f: &Fix, who: &Address) -> i128 {
    token::Client::new(&f.env, &f.token).balance(who)
}

fn strkey56(addr: &Address) -> [u8; 56] {
    let mut buf = [0u8; 56];
    addr.to_string().copy_into_slice(&mut buf);
    buf
}

/// Kontrattaki `claim_preimage` ile AYNI düzeni bağımsız olarak kurar.
/// Kasıtlı olarak kontratın kodunu çağırmıyor: iki uygulama ayrışırsa
/// testler bunu yakalasın. SPEC.md §4.1
fn preimage(
    contract: &Address,
    identity: &[u8; 32],
    recipient: &Address,
    expires_at: u32,
    nonce: &[u8; 32],
) -> [u8; 195] {
    let mut b = [0u8; 195];
    b[0..15].copy_from_slice(b"paytag.claim.v1");
    b[15..71].copy_from_slice(&strkey56(contract));
    b[71..103].copy_from_slice(identity);
    b[103..159].copy_from_slice(&strkey56(recipient));
    b[159..163].copy_from_slice(&expires_at.to_be_bytes());
    b[163..195].copy_from_slice(nonce);
    b
}

/// Verifier'ın yetki imzası.
fn imzala(
    sk: &SigningKey,
    contract: &Address,
    identity: &[u8; 32],
    recipient: &Address,
    expires_at: u32,
    nonce: &[u8; 32],
) -> [u8; 64] {
    sk.sign(&preimage(contract, identity, recipient, expires_at, nonce))
        .to_bytes()
}

/// Doğru imzayı üretir (mutlu yol).
fn gecerli_imza(f: &Fix, nonce: &[u8; 32]) -> BytesN<64> {
    BytesN::from_array(
        &f.env,
        &imzala(
            &f.sk,
            &f.contract_id,
            &TORVALDS,
            &f.alici,
            SIG_EXPIRES,
            nonce,
        ),
    )
}

fn yatir(f: &Fix, tutar: i128) -> u64 {
    f.client
        .deposit(&f.gonderen, &f.identity, &f.token, &tutar, &PAY_EXPIRY)
}

// ---------------------------------------------------------------- mutlu yol

#[test]
fn claim_gecerli_imzayla_parayi_aliciya_verir() {
    let f = fix();
    let id = yatir(&f, 300);
    assert_eq!(bakiye(&f, &f.contract_id), 300);
    assert_eq!(bakiye(&f, &f.alici), 0);

    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &gecerli_imza(&f, &NONCE_A),
    );

    assert_eq!(bakiye(&f, &f.alici), 300);
    assert_eq!(bakiye(&f, &f.contract_id), 0);
    assert_eq!(f.client.get_payment(&id).status, Status::Claimed);
}

/// Tek imzayla birden çok ödeme toplanabilir.
#[test]
fn claim_coklu_odemeyi_tek_cagrida_toplar() {
    let f = fix();
    let a = yatir(&f, 100);
    let b = yatir(&f, 200);
    let c = yatir(&f, 50);

    f.client.claim(
        &vec![&f.env, a, b, c],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &gecerli_imza(&f, &NONCE_A),
    );

    assert_eq!(bakiye(&f, &f.alici), 350);
    assert_eq!(bakiye(&f, &f.contract_id), 0);
}

// ------------------------------------------------------------ imza saldırıları

/// SPEC.md §5 #1 — uydurma imza reddedilir.
#[test]
#[should_panic]
fn claim_sahte_imza_reddedilir() {
    let f = fix();
    let id = yatir(&f, 300);
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &BytesN::from_array(&f.env, &[9u8; 64]),
    );
}

/// Başka bir anahtarla atılmış geçerli imza da reddedilir.
#[test]
#[should_panic]
fn claim_baska_anahtarin_imzasi_reddedilir() {
    let f = fix();
    let id = yatir(&f, 300);
    let sahte_sk = SigningKey::from_bytes(&[99u8; 32]);
    let sig = imzala(
        &sahte_sk,
        &f.contract_id,
        &TORVALDS,
        &f.alici,
        SIG_EXPIRES,
        &NONCE_A,
    );
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &BytesN::from_array(&f.env, &sig),
    );
}

/// SPEC.md §5 #4 — alıcı değiştirilirse imza tutmaz.
/// Araya giren biri alıcıyı kendi adresiyle değiştirip parayı yönlendiremez.
#[test]
#[should_panic]
fn claim_baska_alici_icin_imza_reddedilir() {
    let f = fix();
    let id = yatir(&f, 300);
    let saldirgan = Address::generate(&f.env);

    // İmza f.alici için üretildi, çağrı saldirgan için yapılıyor.
    let sig = gecerli_imza(&f, &NONCE_A);
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &saldirgan,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &sig,
    );
}

/// SPEC.md §5 #5 — başka kimlik için alınmış imza kullanılamaz.
#[test]
#[should_panic]
fn claim_baska_kimlik_icin_imza_reddedilir() {
    let f = fix();
    let id = yatir(&f, 300);

    // metehancaliskan için imza, torvalds'ın parasını çekmeye çalışıyor.
    let sig = imzala(
        &f.sk,
        &f.contract_id,
        &METEHAN,
        &f.alici,
        SIG_EXPIRES,
        &NONCE_A,
    );
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &BytesN::from_array(&f.env, &sig),
    );
}

/// SPEC.md §5 #3 — aynı verifier'ı kullanan başka bir kontrata imza taşınamaz.
/// preimage'daki contract_id bunu engeller.
#[test]
#[should_panic]
fn claim_baska_kontrat_icin_imza_reddedilir() {
    let f = fix();
    let id = yatir(&f, 300);

    // İkinci bir escrow kontratı; imza onun adresi için üretiliyor.
    let ikinci = env_register_ikinci(&f);
    let sig = imzala(&f.sk, &ikinci, &TORVALDS, &f.alici, SIG_EXPIRES, &NONCE_A);

    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &BytesN::from_array(&f.env, &sig),
    );
}

fn env_register_ikinci(f: &Fix) -> Address {
    f.env.register(PaytagEscrow, ())
}

/// SPEC.md §5 #6 — süresi geçmiş imza kullanılamaz.
/// Bir kez sızan yetki kalıcı arka kapıya dönüşmemeli.
#[test]
fn claim_suresi_gecmis_imza_reddedilir() {
    let f = fix();
    let id = yatir(&f, 300);
    f.env.ledger().set_sequence_number(SIG_EXPIRES + 1);

    let r = f.client.try_claim(
        &vec![&f.env, id],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &gecerli_imza(&f, &NONCE_A),
    );
    assert_eq!(r, Err(Ok(Error::SignatureExpired)));
    assert_eq!(bakiye(&f, &f.contract_id), 300, "para kıpırdamamalı");
}

/// SPEC.md §5 #2 — aynı nonce ikinci kez kullanılamaz (replay).
#[test]
fn claim_ayni_nonce_ikinci_kez_reddedilir() {
    let f = fix();
    let a = yatir(&f, 100);
    let b = yatir(&f, 200);
    let sig = gecerli_imza(&f, &NONCE_A);

    f.client.claim(
        &vec![&f.env, a],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &sig,
    );

    // Aynı imza + aynı nonce ile ikinci ödemeyi de çekmeye çalış.
    let r = f.client.try_claim(
        &vec![&f.env, b],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &sig,
    );
    assert_eq!(r, Err(Ok(Error::NonceAlreadyUsed)));
    assert_eq!(bakiye(&f, &f.alici), 100, "yalnızca ilk claim geçmeli");
}

/// Farklı nonce ile ikinci claim meşrudur.
#[test]
fn claim_farkli_nonce_ile_ikinci_kez_calisir() {
    let f = fix();
    let a = yatir(&f, 100);
    let b = yatir(&f, 200);

    f.client.claim(
        &vec![&f.env, a],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &gecerli_imza(&f, &NONCE_A),
    );
    f.client.claim(
        &vec![&f.env, b],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_B),
        &SIG_EXPIRES,
        &gecerli_imza(&f, &NONCE_B),
    );

    assert_eq!(bakiye(&f, &f.alici), 300);
}

// ------------------------------------------------------------ ödeme kuralları

/// SPEC.md §5 #7 — aynı ödeme iki kez claim edilemez.
#[test]
fn claim_edilmis_odeme_tekrar_claim_edilemez() {
    let f = fix();
    let id = yatir(&f, 300);
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &gecerli_imza(&f, &NONCE_A),
    );

    let r = f.client.try_claim(
        &vec![&f.env, id],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_B),
        &SIG_EXPIRES,
        &gecerli_imza(&f, &NONCE_B),
    );
    assert_eq!(r, Err(Ok(Error::AlreadySettled)));
    assert_eq!(bakiye(&f, &f.alici), 300, "çifte ödeme olmamalı");
}

/// Geçerli imzayla BAŞKA bir kimliğe ait ödeme çekilemez.
/// İmza doğru, ama ödemenin etiketi tutmuyor.
#[test]
fn claim_baska_kimligin_odemesini_cekemez() {
    let f = fix();
    let baskasi = BytesN::from_array(&f.env, &METEHAN);
    let id = f
        .client
        .deposit(&f.gonderen, &baskasi, &f.token, &300, &PAY_EXPIRY);

    let r = f.client.try_claim(
        &vec![&f.env, id],
        &f.identity, // torvalds imzası
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &gecerli_imza(&f, &NONCE_A),
    );
    assert_eq!(r, Err(Ok(Error::IdentityMismatch)));
    assert_eq!(bakiye(&f, &f.contract_id), 300);
}

/// Ödemenin süresi dolduysa artık gönderenindir; claim edilemez.
#[test]
fn claim_suresi_dolmus_odemeyi_cekemez() {
    let f = fix();
    let id = yatir(&f, 300);

    let gec = PAY_EXPIRY + 1;
    f.env.ledger().set_sequence_number(gec);
    let sig = BytesN::from_array(
        &f.env,
        &imzala(
            &f.sk,
            &f.contract_id,
            &TORVALDS,
            &f.alici,
            gec + 100,
            &NONCE_A,
        ),
    );

    let r = f.client.try_claim(
        &vec![&f.env, id],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &(gec + 100),
        &sig,
    );
    assert_eq!(r, Err(Ok(Error::PaymentExpired)));
}

#[test]
fn claim_bos_liste_reddedilir() {
    let f = fix();
    let r = f.client.try_claim(
        &vec![&f.env],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &gecerli_imza(&f, &NONCE_A),
    );
    assert_eq!(r, Err(Ok(Error::NoPayments)));
}

/// SPEC.md §5 #12 — toplu claim atomiktir.
/// Listeye tek bir geçersiz id sıkıştırmak TÜM çağrıyı geri almalı;
/// aksi halde saldırgan kısmi başarıyla durumu bozabilirdi.
#[test]
fn claim_batch_atomiktir() {
    let f = fix();
    let a = yatir(&f, 100);
    let b = yatir(&f, 200);

    let r = f.client.try_claim(
        &vec![&f.env, a, 999, b], // 999 diye bir ödeme yok
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &gecerli_imza(&f, &NONCE_A),
    );

    assert_eq!(r, Err(Ok(Error::PaymentNotFound)));
    assert_eq!(bakiye(&f, &f.alici), 0, "hiçbir ödeme geçmemeli");
    assert_eq!(bakiye(&f, &f.contract_id), 300);
    assert_eq!(f.client.get_payment(&a).status, Status::Pending);
    assert_eq!(f.client.get_payment(&b).status, Status::Pending);
}

/// Claim edilmiş ödeme sonradan refund edilemez (SPEC.md §5 #10 tamamlayıcı).
#[test]
fn claim_edilmis_odeme_refund_edilemez() {
    let f = fix();
    let id = yatir(&f, 300);
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &gecerli_imza(&f, &NONCE_A),
    );

    f.env.ledger().set_sequence_number(PAY_EXPIRY + 1);
    assert_eq!(f.client.try_refund(&id), Err(Ok(Error::AlreadySettled)));
    assert_eq!(bakiye(&f, &f.gonderen), 700, "gönderen para geri alamaz");
}

// ------------------------------------------------------------------- olaylar

#[test]
fn claim_olayi_identity_topicli_yayinlanir() {
    let f = fix();
    let id = yatir(&f, 300);
    f.client.claim(
        &vec![&f.env, id],
        &f.identity,
        &f.alici,
        &BytesN::from_array(&f.env, &NONCE_A),
        &SIG_EXPIRES,
        &gecerli_imza(&f, &NONCE_A),
    );

    assert_eq!(
        f.env.events().all().filter_by_contract(&f.contract_id),
        vec![
            &f.env,
            (
                f.contract_id.clone(),
                (Symbol::new(&f.env, "claim"), f.identity.clone()).into_val(&f.env),
                Map::<Symbol, Val>::from_array(
                    &f.env,
                    [
                        (Symbol::new(&f.env, "payment_id"), id.into_val(&f.env)),
                        (Symbol::new(&f.env, "recipient"), f.alici.into_val(&f.env)),
                        (Symbol::new(&f.env, "token"), f.token.into_val(&f.env)),
                        (Symbol::new(&f.env, "amount"), 300i128.into_val(&f.env)),
                    ]
                )
                .into_val(&f.env),
            )
        ]
    );
}

// ------------------------------------------------------- SPEC altın vektörü

/// SPEC.md §4.2'deki çalışılmış örneği kontratın KENDİ kodu üzerinden
/// doğrular. Faz 3'te TypeScript verifier'ı aynı preimage'ı üretmek
/// zorunda; bu test o sözleşmenin Rust tarafındaki çıpası.
///
/// Kontratı SPEC'teki adreste kaydediyoruz ki `current_contract_address()`
/// beklenen strkey'i döndürsün.
#[test]
fn preimage_spec_altin_vektorune_uyuyor() {
    let env = Env::default();

    let spec_contract = Address::from_string(&String::from_str(
        &env,
        "CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU",
    ));
    let spec_recipient = Address::from_string(&String::from_str(
        &env,
        "GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG",
    ));
    env.register_at(&spec_contract, PaytagEscrow, ());

    let identity = BytesN::from_array(&env, &TORVALDS);
    let mut nonce_raw = [0u8; 32];
    for (i, b) in nonce_raw.iter_mut().enumerate() {
        *b = (i + 1) as u8; // 0x01..0x20
    }
    let nonce = BytesN::from_array(&env, &nonce_raw);

    let pre = env.as_contract(&spec_contract, || {
        PaytagEscrow::claim_preimage(&env, &identity, &spec_recipient, 1_000_000, &nonce).unwrap()
    });

    assert_eq!(pre.len(), 195, "preimage 195 bayt olmalı");

    // SPEC.md §4.2: sha256(preimage)
    const SPEC_HASH: [u8; 32] = [
        0x67, 0x97, 0xbc, 0x5d, 0x95, 0xd3, 0x5a, 0xc1, 0x9c, 0x79, 0x18, 0xc3, 0x8b, 0xf1, 0x39,
        0xff, 0xfa, 0xea, 0x46, 0x64, 0x06, 0x43, 0x9b, 0x08, 0xb4, 0x9e, 0x01, 0x7c, 0x08, 0x78,
        0x09, 0x06,
    ];
    assert_eq!(
        env.crypto().sha256(&pre).to_bytes(),
        BytesN::from_array(&env, &SPEC_HASH),
        "kontratın preimage'ı SPEC.md §4.2 ile uyuşmuyor"
    );

    // Testteki bağımsız uygulama da aynı sonucu vermeli.
    let bagimsiz = preimage(
        &spec_contract,
        &TORVALDS,
        &spec_recipient,
        1_000_000,
        &nonce_raw,
    );
    assert_eq!(
        env.crypto()
            .sha256(&soroban_sdk::Bytes::from_slice(&env, &bagimsiz))
            .to_bytes(),
        BytesN::from_array(&env, &SPEC_HASH)
    );
}
