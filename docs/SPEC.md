# Paytag — Teknik Spec

**Faz 1 çıktısı.** Kod yazılmadan önce kesinleşmesi gereken kararlar.
Faz 2 (kontrat) ve Faz 3 (verifier) bu belgeye göre yazılır; uyuşmazlık
çıkarsa doğru olan bu belgedir, kod düzeltilir.

**Durum:** taslak v1 — 20.08.2026

---

## 1. MVP kapsamı ve alınan kararlar

| Karar | Seçim | Gerekçe |
|---|---|---|
| Kimlik türü | **Yalnızca GitHub kullanıcı** | Tek doğrulama yolu (OAuth `login` eşleşmesi). Kalan süre kontratın negatif testlerine ve UI'a gider. Diğer türler mimaride yer tutar. |
| Etiketleme | **Handle tabanlı**, `sha256(kind ‖ handle)` | Etiket tamamen offline hesaplanır; alıcı hiç kayıt olmamışken bile ödeme yapılabilir. Bu ürünün ana vaadi. |
| Alıcı adresi | 56 karakterlik strkey (`G...` veya `C...`) | Cüzdanlar `G...` verir; kontrat adresi (`C...`) de aynı uzunlukta olduğu için ek iş gerektirmeden desteklenir. Muxed (`M...`, 69 karakter) reddedilir. |
| Token | SEP-41 arayüzü, testnet'te kendi USDC SAC'ımız | Mainnet USDC'ye geçiş tek adres değişikliği. |

`kind` byte'ı MVP'de tek değer alsa da protokole **şimdi** giriyor; sonradan
eklemek tüm mevcut `identity_key`'leri geçersiz kılardı.

---

## 2. `identity_key` — kimlikten etikete

Escrow'daki para bir cüzdana değil, bir **etikete** bağlanır. Etiket şudur:

```
identity_key = sha256( kind_byte ‖ utf8(normalized_handle) )   -> BytesN<32>
```

| kind | anlam | MVP |
|---|---|---|
| `0x00` | GithubUser | ✅ |
| `0x01` | GithubRepo | rezerve |
| `0x02` | XUser | rezerve |
| `0x03` | PaytagNick | rezerve |

### 2.1 Normalizasyon algoritması

Sırayla uygulanır. Girdi kullanıcıdan gelen ham metindir.

1. Baştaki/sondaki boşlukları kırp (`\t\n\r` ve boşluk).
2. Şu önekler varsa sırayla soy: `https://`, `http://`, `www.`, `github.com/`, `@`
3. Sondaki `/` karakterini soy.
4. Kalan metinde `/` varsa **reddet** (bu bir repo, MVP kapsamı dışı).
5. **ASCII küçük harfe** çevir (aşağıdaki uyarıya bak).
6. Doğrula; geçmezse **reddet**.

Doğrulama kuralı — GitHub kullanıcı adı dilbilgisi:

```
^[a-zA-Z0-9](?:-?[a-zA-Z0-9])*$      ve      1 <= uzunluk <= 39
```

Yani: yalnızca ASCII harf/rakam ve tek tire; tire ile başlayamaz veya
bitemez; art arda iki tire olamaz.

> ### ⚠️ Küçük harfe çevirmede tuzak — bu projeyi Türkiye'den yazıyoruz
>
> **Asla yerel ayara duyarlı küçültme kullanmayın.** JavaScript'te
> `"I".toLocaleLowerCase("tr")` sonucu `"ı"` (noktasız i) verir, `"i"`
> değil. Rust'ın `to_lowercase()`'i ise tam Unicode kuralları uygular.
> İkisi ayrışırsa `identity_key` ayrışır ve **claim hiç çalışmaz**.
>
> Zorunlu kural: yalnızca `A-Z` aralığındaki byte'lara `+32` ekleyin.
> Rust'ta `to_ascii_lowercase()`, TypeScript'te elle byte dönüşümü ya da
> en azından `toLowerCase()` — **`toLocaleLowerCase` yasak.**
>
> Doğrulama regex'i zaten ASCII dışını reddettiği için, geçerli bir
> handle'da bu iki yol aynı sonucu verir. Sıra önemli: **önce küçült,
> sonra doğrula** dersek Unicode sızabilir; bu yüzden 5. adımı ASCII'ye
> kilitledik ve 6. adımda reddediyoruz.

### 2.2 Reddetme, sessizce düzeltmeden iyidir

Geçersiz girdiyi "yakına en benzeyen"e çevirmiyoruz. Sebep: gönderen
`github.com/foo bar` yazdıysa niyeti belirsizdir ve yanlış tahmin, parayı
**başka birinin** etiketine yollamak demektir. Belirsizlikte hata veriyoruz.

### 2.3 Test vektörleri — parity fixture

Bu tablo Faz 3.4'teki `identity-key-parity.test.ts` testinin girdisidir.
Rust ve TypeScript implementasyonları **bu değerleri birebir** üretmek
zorundadır. Değerler `sha256(0x00 ‖ utf8(handle))` ile hesaplanmıştır.

| normalized handle | identity_key (hex) |
|---|---|
| `metehancaliskan` | `91e23a08973aba69e14664cb9e12cc20483a4f702afdd304c8ad7424a354ffff` |
| `torvalds` | `9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b` |
| `a` | `022a6979e6dab7aa5ae4c3e5e45f7e977112a7e63593820dbec1ec738a24f93c` |
| `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (39×`a`, max) | `2e7774be4389a7316830256eebfdebbc76f3a47ea6b62cea92b0efb7982de372` |

**Normalizasyon eşdeğerliği** — aşağıdaki girdilerin **hepsi**
`9d8638cd…060b` üretmelidir:

```
"torvalds"   "Torvalds"   "TORVALDS"   "@torvalds"
"github.com/torvalds"     "https://github.com/torvalds"
"https://github.com/Torvalds/"         "  torvalds  "
```

**Reddedilmesi gerekenler:**

```
""                  boş
"-torvalds"         tire ile başlıyor
"torvalds-"         tire ile bitiyor
"tor--valds"        çift tire
"torvalds/linux"    repo, MVP dışı
"a"*40              39 karakter sınırını aşıyor
"torvaldş"          ASCII dışı
"tor valds"         boşluk
```

**Kind ayrımı** — aynı handle, farklı `kind`, farklı key olmalı:

| kind | `torvalds` için identity_key |
|---|---|
| `0x00` GithubUser | `9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b` |
| `0x01` GithubRepo | `919ae1bad528b5f77e43e55a03d75409d6ceca8b23a4219fb35c1e3da936660c` |
| `0x02` XUser | `cb254de12f5a5a76717d0db39922eb02cbe081c4977bd82e7d492bba5a7e3d96` |
| `0x03` PaytagNick | `445e3e773d82aa85a04b41a66c387590d962f94bea1a9fefad12447d4b5a1359` |

---

## 3. Kontrat arayüzü

### 3.1 Fonksiyonlar

```rust
init(admin: Address, verifier: BytesN<32>, default_expiry_ledgers: u32)

deposit(from: Address, identity: BytesN<32>, token: Address,
        amount: i128, expiry_ledger: u32) -> u64

claim(payment_ids: Vec<u64>, identity: BytesN<32>, recipient: Address,
      nonce: BytesN<32>, expires_at: u32, sig: BytesN<64>)

refund(payment_id: u64)

set_verifier(new: BytesN<32>)               // yalnızca admin
get_payment(id: u64) -> PaymentData         // salt okunur
get_balance(identity: BytesN<32>, token: Address) -> i128
```

### 3.2 Ödeme kaydı

```rust
pub struct PaymentData {
    pub from: Address,
    pub identity: BytesN<32>,
    pub token: Address,
    pub amount: i128,
    pub expiry_ledger: u32,
    pub status: Status,        // Pending | Claimed | Refunded
}
```

### 3.3 Storage seçimi ve gerekçesi

| Veri | Storage | Neden |
|---|---|---|
| Config (admin, verifier pk, varsayılan expiry) | `instance` | Küçük, her çağrıda okunur, kontratla aynı ömre sahip olmalı. |
| Ödeme sayacı (`u64`) | `instance` | Aynı gerekçe. |
| `PaymentData` (id → kayıt) | `persistent` | İçinde **gerçek para** var. Süresi dolup arşivlenirse fon erişilemez hale gelir; `deposit`/`claim` çağrılarında `extend_ttl` ile uzatılır. |
| Harcanmış nonce'lar | `temporary`, TTL > `expires_at` | Replay koruması yalnızca imza geçerliyken gerekir. İmza `expires_at`'te ölür; nonce kaydının ondan sonra yaşamasına gerek yok. `temporary` daha ucuzdur ve otomatik temizlenir. |

> Nonce'u `temporary` yapmanın güvenliği bozmadığı argümanı şudur: kayıt
> silindikten sonra aynı nonce'lu bir imza tekrar sunulabilir, ama o imza
> `expires_at` kontrolünden geçemez. İki koruma birbirini tamamlıyor —
> ayrı ayrı değil, birlikte yeterli. **TTL, `expires_at`'ten kesinlikle
> uzun ayarlanmalıdır**; bu bir Faz 2 test maddesidir.

### 3.4 Event'ler

Hepsi `identity_key` topic'li — indexer bunları okuyacak.

```
deposit(identity, payment_id, from, token, amount, expiry_ledger)
claim  (identity, payment_id, recipient, token, amount)
refund (identity, payment_id, to, token, amount)
```

---

## 4. Verifier imza protokolü

Kontrat GitHub'a soramaz. Off-chain verifier, GitHub OAuth ile sahipliği
doğrular ve **bir yetki belgesi** imzalar. Kontrat imzayı
`env.crypto().ed25519_verify` ile doğrular.

### 4.1 İmzalanan veri (preimage)

Sabit uzunlukta, **195 byte**. Uzunluk sabit olduğu için ayırıcıya gerek
yok; alan sınırları belirsizliğe yer bırakmaz.

| Ofset | Uzunluk | Alan | Kodlama |
|---|---|---|---|
| 0 | 15 | domain ayırıcı | ASCII `paytag.claim.v1` |
| 15 | 56 | `contract_id` | strkey ASCII (`C...`) |
| 71 | 32 | `identity_key` | ham |
| 103 | 56 | `recipient` | strkey ASCII (`G...` veya `C...`) |
| 159 | 4 | `expires_at` | big-endian `u32` (ledger sırası) |
| 163 | 32 | `nonce` | ham, rastgele |

> **Adresler neden ham anahtar değil strkey?**
>
> İlk taslakta adresler 32 baytlık ham anahtar olarak gömülüyordu. Uygulama
> sırasında iki sorun çıktı:
>
> 1. `soroban-sdk` 26'da ham anahtarı çıkaran `Address::to_payload()`
>    `hazmat-address` özelliği arkasında ve dokümanı **"bunu ed25519 imza
>    doğrulamasında kimlik doğrulama amacıyla kullanmayın"** diye açıkça
>    uyarıyor (hesabın master key'i o hesabın imzacısı olmayabilir).
> 2. Ham bayta inmek adres türüne bağımlılık yaratıyor; yeni bir adres türü
>    çıktığında protokol kırılır.
>
> Strkey her iki sorunu da çözüyor: kanonik, adres türünden bağımsız, ve
> TypeScript tarafında `address.toString()` ile birebir üretilebiliyor —
> yani Faz 3'teki Rust/TS parity riskini de azaltıyor. Uzunluk kontrolü
> (56 bayt) muxed adresleri baştan eliyor.

```
sig = Ed25519-Sign(verifier_secret_key, preimage)
```

İmza **preimage'ın kendisi** üzerinedir, önceden hash'lenmez — ed25519
zaten içeride hash'ler. Kontrat argümanlardan preimage'ı yeniden kurar ve
doğrular; yeniden kurulan byte'lar birebir aynı değilse imza tutmaz.

### 4.2 Çalışılmış örnek (fixture)

Faz 2 ve Faz 3 testleri bu örneği kullanır.

```
contract_id  = CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU
identity_key = 9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b   ("torvalds")
recipient    = GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG
expires_at   = 1000000  -> 000f4240
nonce        = 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20
```

preimage (195 byte):

```
7061797461672e636c61696d2e763143424a58565147593234573241585a3758
4459334256474441444a525137504745564c36535632564d52595a4d4e363442
35474c555554559d8638cdf5594ee5a5178e3d413fb8206513356b947de1de60
0f178532c7060b474144334c4d4b4f4555513450564634324e47434456595a56
4d4c5a44415034524e52524e57455a3759374343584842374d4e51434b574700
0f42400102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d
1e1f20
```

Sağlama (imza değil, yalnızca preimage'ın doğru kurulduğunu test etmek için):

```
sha256(preimage) = 6797bc5d95d35ac19c7918c38bf139fffaea466406439b08b49e017c08780906
```

Bu değer kontratta bir test tarafından doğrulanıyor:
`test_claim::preimage_spec_altin_vektorune_uyuyor`. Kontrat SPEC'teki
adreste kaydedilip kendi `claim_preimage` fonksiyonu çağrılıyor ve
sonucun sha256'sı yukarıdaki sabitle karşılaştırılıyor. Faz 3'te
TypeScript verifier'ı aynı sağlamayı üretmek zorunda — parity çıpası budur.

### 4.3 Her alan hangi saldırıyı kapatıyor

Bu tablo tasarımın kalbi. Bir alanı çıkarmak, karşısındaki saldırıyı açar.

| Alan | Olmazsa ne olur |
|---|---|
| domain ayırıcı | Verifier'ın başka bir amaçla ürettiği bir imza, claim yetkisi olarak yeniden yorumlanabilir. Ayırıcı, imzanın anlamını sabitler. |
| `contract_id` | Aynı verifier'ı kullanan ikinci bir kontrata (veya testnet→mainnet) imza kopyalanabilir. |
| `identity_key` | Bir handle için alınmış yetki, başka bir handle'ın parasını çekmek için kullanılabilir. |
| `recipient` | Araya giren biri alıcıyı kendi adresiyle değiştirip parayı yönlendirir. |
| `expires_at` | İmza sonsuza kadar geçerli kalır; bir kez sızan yetki kalıcı arka kapıya dönüşür. |
| `nonce` | Aynı imza tekrar tekrar sunulur (replay). Kontrat harcanmış nonce'ları tutar. |

**`payment_ids` neden imzalanmıyor:** İmza "bu alıcı bu kimliğin
sahibidir" der. Hangi ödemelerin çekileceğini kontrat kendisi doğrular —
her `payment_id` için `payment.identity == identity` kontrolü yapılır.
Kimliğe ait olmayan bir ödeme zaten reddedilir; ait olanların hangi
alt kümesinin çekildiği ise güvenlik açısından fark etmez, hepsi aynı
kişinin parasıdır.

---

## 5. Kırmızı takım — bu tasarımı nasıl sömürürüm

Her satır Faz 2'de **negatif test** olarak yazılacaktır.

| # | Saldırı | Savunma | Test |
|---|---|---|---|
| 1 | Sahte imza uydur | `ed25519_verify`, verifier public key'i storage'da | 2.3 |
| 2 | Geçerli imzayı ikinci kez sun (replay) | Harcanmış nonce kaydı | 2.3 |
| 3 | İmzayı başka kontrata taşı | preimage'da `contract_id` | 2.3 |
| 4 | Alıcıyı değiştir | preimage'da `recipient` | 2.3 |
| 5 | Başka kimliğin imzasıyla claim | preimage'da `identity_key` + kontratta `payment.identity` kontrolü | 2.3 |
| 6 | Süresi geçmiş imzayı kullan | `expires_at` vs güncel ledger | 2.3 |
| 7 | Aynı ödemeyi iki kez claim et | `status != Pending` reddi | 2.3 |
| 8 | Expiry'den önce refund çek | `expiry_ledger` vs güncel ledger | 2.4 |
| 9 | Başkasının ödemesini refund et | `from` auth kontrolü | 2.4 |
| 10 | Claim edilmiş ödemeyi refund et | `status` kontrolü | 2.4 |
| 11 | Claim ile refund yarışı | Tek işlemde atomik durum geçişi | 2.4 |
| 12 | Toplu claim'e bir geçersiz id sıkıştır | Tüm çağrı revert eder | 2.5 |
| 13 | `amount <= 0` ile depozito | Panik | 2.2 |
| 14 | Geçmiş `expiry_ledger` ile depozito | Reddet | 2.2 |
| 15 | Kontrat bakiyesini `sum(unclaimed)` altına düşür | Solvency invariantı, property test | 2.6 |
| 16 | `init`'i ikinci kez çağır | Reddet | 2.1 |
| 17 | Admin olmadan `set_verifier` | Auth reddi | 2.1 |

---

## 6. Kabul edilmiş riskler

Bunlar bilinen ve **bilerek** kapsam dışı bırakılan zayıflıklardır.
README'de de açıkça yazılır — gizlenmiş varsayım, belgelenmiş varsayımdan
her zaman kötüdür.

### 6.1 Verifier anahtarının ele geçmesi

Verifier'ın ed25519 private key'i sızarsa, saldırgan **escrow'daki her
kimlik için** geçerli claim yetkisi üretebilir. Bu, mimarinin doğasında
olan merkezi güven noktasıdır.

Azaltma: anahtar yalnızca sunucu tarafı ortam değişkeninde, hiçbir zaman
client bundle'ında değil (Faz 3.5'te CI kuralıyla denetlenir).
Yol haritası: çoklu imza verifier seti; zincir üstü doğrulanabilir
attestation (zkTLS tarzı). İkisi de bu 30 günlük kapsamın dışında.

### 6.2 Handle devri / yeniden adlandırma

Etiket handle'ın hash'i olduğu için, bir kullanıcı handle'ını bırakır ve
başkası o handle'ı alırsa, **yeni sahip bekleyen parayı claim edebilir**.

Bu, "kayıt olmamış kişiye para gönderebilme" özelliğinin doğrudan bedeli.
Kalıcı sayısal GitHub ID'si ile etiketlemek riski kapatırdı ama gönderenin
deposit anında GitHub API'sine gitmesini zorunlu kılardı.

Azaltma: varsayılan expiry'yi kısa tutmak (gönderen parayı geri alabilir),
ve UI'da alıcıya "bekleyen paran var" bildirimini öne çıkarmak.
Yol haritası: `claim` anında handle→ID eşleşmesini verifier'ın kontrol
etmesi — etiketi bozmadan saldırıyı büyük ölçüde kapatır.

### 6.3 Testnet kalıcı değil

SDF testnet'i yılda 2–4 kez sıfırlar; kontratlar ve bakiyeler silinir.
Sonraki planlı sıfırlama **16 Aralık 2026**. Kanıt paketi bu yüzden
yalnızca explorer linklerine değil, ekran görüntülerine ve komut
çıktılarına da dayanır.

---

## 7. Faz 2'ye devredilen açık sorular

1. ~~**`recipient` alanının kontrat içinde ham 32 byte'a çevrilmesi.**~~
   **ÇÖZÜLDÜ (Faz 2.3):** Ham anahtar yerine strkey kullanılıyor; §4.1'deki
   nota bakın. `C...` adresli alıcı da destekleniyor, muxed (`M...`)
   `UnsupportedAddress` ile reddediliyor.
2. **Varsayılan expiry kaç ledger?** Testnet'te ~5 sn/ledger. 30 gün
   ≈ 518.400 ledger. Değer `init`'te ayarlanabilir; UI'da gönderene
   sunulacak varsayılan Faz 4'te kesinleşir.
3. **Aynı kimliğe aynı token'dan çok sayıda ödeme** — `get_balance`
   toplarken kaç kayıt taranacağı ve gaz sınırı. Gerekirse kimlik+token
   başına toplam bakiye ayrı bir kayıtta tutulur.
