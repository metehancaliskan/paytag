# Kanıt — işlem hash'leri

Her deliverable için zincir üstünde doğrulanabilir kayıtlar.

**Ağ:** Stellar Testnet — passphrase `Test SDF Network ; September 2015`
**RPC:** `https://soroban-testnet.stellar.org` · **Protokol:** 27

> **Testnet sıfırlanır.** SDF testnet'i yılda 2–4 kez sıfırlar; hesaplar,
> bakiyeler, deploy edilmiş kontratlar ve tüm işlem geçmişi silinir. Bir
> sonraki planlı sıfırlama: **16 Aralık 2026**. O tarihten sonra aşağıdaki
> explorer linkleri ölür. Bu yüzden kalıcı kanıt olarak ekran görüntüleri
> (`docs/evidence/screenshots/`) ve komut çıktıları da saklanır.

---

## Adresler

| Rol | Adres |
|---|---|
| Escrow kontratı (Faz 2) | [`CDN2BQNGHWCC22IXLAKBAVIOL5ID4MTH4FNYISVEARWQ4HZ27ZA7OZ3B`](https://stellar.expert/explorer/testnet/contract/CDN2BQNGHWCC22IXLAKBAVIOL5ID4MTH4FNYISVEARWQ4HZ27ZA7OZ3B) |
| Test USDC (SAC) | [`CBU7HRUSXSVPI7QHA73G67UDRQTKSEOICFHWOMWSPOZ2S3R3DIWUCPKI`](https://stellar.expert/explorer/testnet/contract/CBU7HRUSXSVPI7QHA73G67UDRQTKSEOICFHWOMWSPOZ2S3R3DIWUCPKI) |
| Gönderen / admin (`paytag-dev`) | `GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG` |
| USDC issuer | `GARBYOHXSSS76ZOV2FUUZOZHQER7BAA3XNBJCMXNWJYS5M3W3XTBG3LZ` |
| Alıcı (`paytag-alice`) | `GDMQNCTLGOAZ7SJYBF7WYKMVW5WZ2BNLM3U654M7YMMCPQMMYBIA6WUA` |
| Verifier **public** key | `dbb4d698e7febec6390f19123733b526c1851b09491e57d3529eff78222b517b` |
| Faz 0 throwaway kontratı | [`CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU`](https://stellar.expert/explorer/testnet/contract/CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU) |

Verifier'ın **private** key'i `web/.env.local` içinde (gitignore'da, mod 600)
ve zincire hiçbir zaman gelmez. Kontrat yalnızca public key'i saklar ve
imzayı `ed25519_verify` ile doğrular.

**Tutarlar:** Stellar klasik varlıkları 7 ondalık basamak kullanır.
`2500000000` = 250 USDC, `500000000` = 50 USDC, `100000000` = 10 USDC.

---

## Faz 0.4 — Araç zinciri kanıtı (throwaway kontrat)

**Tarih:** 20.08.2026

Amaç: iş mantığı yazmadan önce Rust → wasm → deploy → invoke zincirinin
çalıştığını kanıtlamak.

| Adım | Değer |
|---|---|
| Wasm yükleme tx | [`df20beb0509a8658f4711bdfb0ad8b3431e2ee7036e86c661633cf61542ef640`](https://stellar.expert/explorer/testnet/tx/df20beb0509a8658f4711bdfb0ad8b3431e2ee7036e86c661633cf61542ef640) |
| Kontrat oluşturma tx | [`c5a03801aba998b3d925ab5f11142719839899875f026a2dd3ca21831883b61b`](https://stellar.expert/explorer/testnet/tx/c5a03801aba998b3d925ab5f11142719839899875f026a2dd3ca21831883b61b) |
| Wasm hash (yerel = zincir) | `b34c5a165514737b2a598750553ea3cb5521e26554e8644fe098b3b8d4a35a9a` |
| `ping` çağrısı | `"paytag"` (salt okunur, işlem gönderilmedi) |

**Sonuç: Faz 0.4 ✅**

---

## Faz 2.7 — Escrow kontratının canlı akışı

**Tarih:** 21.08.2026 · Başlangıç ledger'ı: 4.261.026

### Hazırlık: test USDC'si

Testnet'te resmî Circle USDC yok; kendi varlığımızı çıkarıp Stellar Asset
Contract'a sardık. Kontrat SEP-41 arayüzüne konuştuğu için mainnet USDC'ye
geçiş tek adres değişikliğidir.

| Adım | tx |
|---|---|
| Trustline — `paytag-dev` | [`e49b76738d80fd2ed80af872e21cd91b7eb8a405b77783369a47a7b66d2efcd9`](https://stellar.expert/explorer/testnet/tx/e49b76738d80fd2ed80af872e21cd91b7eb8a405b77783369a47a7b66d2efcd9) |
| Trustline — `paytag-alice` | [`4ec19c19bf96cb946b2d3bf994ff24ee8e14012232b1f40ff08091314a6c8e2a`](https://stellar.expert/explorer/testnet/tx/4ec19c19bf96cb946b2d3bf994ff24ee8e14012232b1f40ff08091314a6c8e2a) |
| USDC → SAC deploy | [`d36c742e4ab1d9617a07b4ef3458e2cb6c8b27806235f57ce85f7810bfef9348`](https://stellar.expert/explorer/testnet/tx/d36c742e4ab1d9617a07b4ef3458e2cb6c8b27806235f57ce85f7810bfef9348) |
| Mint 1.000 USDC → `paytag-dev` | [`65a1908162d14ba9e96ee789876ab6d6ac536f0adef550553c35fb191e43bbc6`](https://stellar.expert/explorer/testnet/tx/65a1908162d14ba9e96ee789876ab6d6ac536f0adef550553c35fb191e43bbc6) |

> **Trustline'lar neden gerekli:** Klasik hesaplar (`G…`) bir varlığı ancak
> trustline açtıktan sonra tutabilir. Kontrat adresleri (`C…`) bakiyeyi
> kontrat depolamasında tuttuğu için escrow'un trustline'a ihtiyacı yok.
> Bu ayrım geliştirme sırasında bizi bir kez yanılttı: alıcı hesabı testte
> var olmadığı için token transferi reddedilmiş, hata kodu bizim
> `PaymentExpired`'ımızla çakıştığı için yanlış yere bakmıştık. Soroban'da
> hata kodları kontrat başınadır.

### Kurulum

| Adım | Değer |
|---|---|
| Escrow deploy tx | _(kaydedilecek)_ |
| `init` tx | _(kaydedilecek)_ |
| `get_config` doğrulaması | `admin` = `GAD3LMKO…`, `verifier` = `dbb4d698…`, `default_expiry_ledgers` = 518400 |

### Uçtan uca akış

Ürünün ana vaadi: alıcının cüzdanı, kaydı, hatta Paytag'den haberi olmadan
kimliğine para gönderilebilir.

**1. Emanet — `github.com/torvalds` etiketine 250 USDC**

```
identity_key = sha256(0x00 ‖ "torvalds")
             = 9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b
expiry_ledger = 4361000
payment_id    = 1
```

tx: [`adcce001c50127e2224546dc26008e99f540b3a7ad630aa7cbdb655682a2c629`](https://stellar.expert/explorer/testnet/tx/adcce001c50127e2224546dc26008e99f540b3a7ad630aa7cbdb655682a2c629)

İki olay yayıldı: token transferi (gönderen → kontrat) ve `identity`
topic'li `DepositEvent`.

**2. Verifier imzası (off-chain)**

`scripts/paytag.mjs` ile üretildi — Faz 3'te bunu GitHub OAuth tetikleyecek.

```
nonce      = 7bade2458b9c9ca147c8b87f11fdac79bb46da920dcc2c0a6c949171080e23db
expires_at = 4265000
signature  = 8121f36dc7ca81f2fb07b98903f159ffda19c1e90941f52852f88ac7115cbf06
             d4a4efc6687c172c46f3ccee0fe6593293d3e390e480eb891b6f46be54f8e105
```

**3. Claim — para alıcıya geçti**

tx: [`0a553414aeacd43400653e5711aeb6fa966012939d973014fa248f8a8b2b2270`](https://stellar.expert/explorer/testnet/tx/0a553414aeacd43400653e5711aeb6fa966012939d973014fa248f8a8b2b2270)

Kontrat 195 baytlık preimage'ı argümanlardan yeniden kurdu ve
`ed25519_verify` ile doğruladı. Transfer bu sefer ters yönde: kontrat →
`GDMQNCTL…`. `ClaimEvent` yayıldı.

**4. İkinci emanet + iade**

| Adım | Değer | tx |
|---|---|---|
| Emanet, 50 USDC, kısa expiry (`+20` ledger) | `payment_id = 2` | [`9f03b00cad260da21fe90f8347df1b5ea7ea906a932766afa04d26fd99ca2766`](https://stellar.expert/explorer/testnet/tx/9f03b00cad260da21fe90f8347df1b5ea7ea906a932766afa04d26fd99ca2766) |
| Süre dolduktan sonra iade | gönderene geri | [`4e8aaa371720a3dc15e2670dde0906550b46db8530aa8d44d729e5190b44d7b5`](https://stellar.expert/explorer/testnet/tx/4e8aaa371720a3dc15e2670dde0906550b46db8530aa8d44d729e5190b44d7b5) |

**5. Korumanın canlı doğrulaması — erken iade reddedildi**

| Adım | Değer | tx |
|---|---|---|
| Emanet, 10 USDC, expiry `+400` ledger | `payment_id = 3` | [`fd653e5f7040dbd61a763740ed460f9ca77f0b5798658cf94d6634be094334c4`](https://stellar.expert/explorer/testnet/tx/fd653e5f7040dbd61a763740ed460f9ca77f0b5798658cf94d6634be094334c4) |
| Süre dolmadan iade denemesi | **`Error(Contract, #8)` = `NotYetExpired`** | işlem yok |

```
❌ error: transaction simulation failed: HostError: Error(Contract, #8)
   [Diagnostic Event] contract:CDN2BQNG…OZ3B, topics:[error, Error(Contract, #8)]
   [Diagnostic Event] topics:[fn_call, CDN2BQNG…OZ3B, refund], data:3
```

> Bu denemenin **tx hash'i yok** — hata simülasyon aşamasında yakalandığı
> için işlem ağa hiç gönderilmedi ve ücret oluşmadı. Soroban her çağrıyı
> önce simüle eder; başarısız olacak işlemler zincire yazılmaz.
>
> Kural şu: alıcının claim penceresi kapanmadan gönderen parayı geri
> çekemez. `test_refund::refund_expiry_oncesi_reddedilir` bunu birim testte
> doğruluyordu; burada aynı kural canlı ağda kanıtlandı.

**Sonuç: Faz 2.7 ✅** — `deposit`, `claim`, `refund` üçü de zincir üstünde
çalıştı; bir koruma kuralı da canlı olarak devreye girdi.

---

## Faz 3 — GitHub OAuth ile uçtan uca doğrulama

_(OAuth → verifier imzası → claim işlemi buraya)_
