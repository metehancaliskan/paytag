# Paytag — Build Planı

**Proje:** Paytag — GitHub & X handle'larına claim edilebilir USDC ödemeleri
**Kaynak:** Instawards SOW, 30 gün, $5.000, 3 deliverable
**Stack:** Next.js 15 (App Router, TS) + Rust/`soroban-sdk` 26.x + `stellar-cli` 27.x + Postgres (Neon)
**Plan tarihi:** 19.08.2026

---

## 0. Mimari — tek paragrafta

Gönderen, alıcının cüzdanını bilmeden bir **internet kimliğine** (GitHub user/repo, X user, Paytag nick) USDC gönderir. Para Soroban kontratında `identity_key` etiketiyle emanette (escrow) bekler. Alıcı gelir, GitHub OAuth ile handle'ının sahibi olduğunu kanıtlar; **off-chain verifier servisi** bunu doğrulayıp ed25519 ile imzalı bir "claim yetkisi" üretir; kontrat bu imzayı `env.crypto().ed25519_verify` ile doğrular ve parayı alıcının cüzdanına salar. Kimse gelmezse expiry ledger'ından sonra gönderen `refund` çağırır.

```
Gönderen cüzdanı ──deposit(identity_key, token, amount, expiry)──▶ ┌──────────────────┐
                                                                    │ Soroban Escrow   │
GitHub ──OAuth──▶ Verifier API ──ed25519 imzalı claim auth──▶       │ Contract         │
                  (Next.js route)                                   │ (identity-tagged)│
Alıcı cüzdanı ◀──claim(payment_ids, recipient, sig)───────────────  └──────────────────┘
Gönderen cüzdanı ◀──refund(payment_id) [expiry sonrası]────────────
```

### Kritik tasarım kararı: neden "verifier imzası" deseni

Kontrat GitHub'a HTTP isteği atamaz. Zinciri dış dünyaya bağlamanın tek yolu, off-chain bir tarafın doğrulama yapıp sonucu **imzalaması** ve kontratın imzayı doğrulaması. Bu bir güven varsayımı yaratır: verifier'ın private key'i ele geçerse yanlış kişi claim edebilir. Bunu README'de **açıkça yazacağız** — jüri gizlenmiş güven varsayımından hoşlanmaz, dürüstçe belgelenmişinden hoşlanır. MVP sonrası azaltma yolu: multi-sig verifier seti veya zkTLS/attestation. Kapsam dışı, ama yol haritasına yazılır.

---

## 1. Stack seçimi — neden bu

| Karar | Seçim | Gerekçe |
|---|---|---|
| Kontrat dili | Rust + `soroban-sdk` 26.x | Soroban'ın tek birinci sınıf dili. Alternatif yok. |
| CLI | `stellar-cli` 27.1 | `contract build/deploy/invoke` + **`bindings typescript`** → kontrattan tipli TS client üretir, elle RPC/XDR yazmayı sıfırlar. |
| Frontend + backend | **Tek Next.js uygulaması** | Kritik neden: verifier'ın imza attığı ed25519 private key **asla tarayıcıya gitmemeli**. Next.js API route'ları bu sırrı sunucu tarafında tutar, ayrı bir servis deploy etmeye gerek kalmaz. GitHub OAuth callback'i de aynı origin'de olur — CORS/cookie derdi yok. 30 günde iki servis deploy etmek/senkronlamak saf kayıp. |
| Cüzdan | Stellar Wallets Kit | Freighter + xBull + Albedo + Lobstr'ı tek arayüzle verir. Freighter'a tek başına bağlanmak jüriye "sadece bir cüzdan destekliyor" gösterir. |
| DB | Postgres (Neon free) + Drizzle | Nickname kaydı, OAuth oturumu, indekslenmiş event'ler için gerekli. Neon: kredi kartı yok, branch'lenebilir, Vercel entegre. Drizzle: Prisma'nın aksine serverless'ta cold-start yemez. |
| Deploy | Vercel + Stellar Testnet | Canlı demo linki SOW'da zorunlu (Deliverable 3). Vercel = 1 komut. |
| Token | Testnet'te kendi ürettiğimiz `USDC` SAC'ı | Testnet'te resmî Circle USDC yok. Kendi issuer'ımızla `USDC:GXXX` çıkarıp `stellar contract asset deploy` ile SAC'a çeviririz. Kontrat SEP-41 arayüzüne konuştuğu için mainnet USDC'ye geçiş **tek adres değişikliği**. Bunu README'de belirtmek önemli. |

**Reddedilen alternatifler:** ayrı Express backend (fazladan deploy + CORS, sıfır kazanç), Vercel Postgres (Neon'un daha pahalı sarmalayıcısı), tRPC (tek uygulamada gereksiz katman), Prisma (serverless cold-start).

---

## 2. İş kırılımı — 6 faz, her adımda "nasıl test edilecek"

### Faz 0 — Repo iskeleti + araç zinciri kanıtı  *(~yarım gün)*

| # | Yapılacak | Bitti kabul kriteri (test) |
|---|---|---|
| 0.1 | `~/Desktop/github/paytag` monorepo: `contracts/`, `web/`, `docs/`, `scripts/` | `tree -L 2` beklenen yapıyı verir |
| 0.2 | Rust toolchain + `wasm32v1-none` target, `stellar-cli` 27.1 kurulu | `stellar --version` ve `rustc --version` çıktısı `docs/evidence/toolchain.txt`'e yazılı |
| 0.3 | Testnet identity + friendbot fonlama | `stellar keys address paytag-dev` bir G... adresi döner, bakiye > 0 |
| 0.4 | **Throwaway hello-world kontrat deploy** | Testnet'te deploy olur, `invoke hello` çağrısı döner → araç zinciri kanıtlandı. Sonra silinir. |
| 0.5 | GitHub repo (public), `.gitignore`, MIT lisans, CI iskeleti | İlk commit push'lanır, Actions yeşil |

> Neden 0.4: Faz 2'nin ortasında "deploy neden patlıyor" ile boğuşmak 30 günlük sprintte en pahalı hatadır. Araç zincirini **boş** bir kontratla kanıtla, sonra iş mantığı yaz.

---

### Faz 1 — Teknik spec + veri modeli  *(~1 gün)* → SOW Hafta 1 çıktısı

| # | Yapılacak | Bitti kabul kriteri (test) |
|---|---|---|
| 1.1 | `IdentityKey` şeması kesinleştir | `docs/SPEC.md`'de: `identity_key = sha256(kind_byte ‖ normalized_handle)` → `BytesN<32>`. `kind`: 0=GithubUser, 1=GithubRepo, 2=XUser, 3=PaytagNick. Normalizasyon kuralları (lowercase, trim, `owner/repo` formatı) yazılı ve **hem Rust hem TS'te aynı sonucu veren bir vektör tablosu** var |
| 1.2 | Kontrat storage + fonksiyon imzaları | `SPEC.md`'de imza listesi, hangi storage tipi (instance/persistent/temporary) ve neden — TTL/arşivleme gerekçesiyle |
| 1.3 | Verifier imza payload formatı | `sha256(contract_id ‖ identity_key ‖ recipient ‖ nonce ‖ expires_at_ledger)` — domain separation dahil, replay ve cross-contract saldırısına kapalı |
| 1.4 | DB şeması + UI ekran listesi + wireframe | 6 ekran: Search, Profile/Pay page, Send, Connect wallet, Claim dashboard, Tx evidence |
| 1.5 | **Spec review** | Kendi kendime kırmızı takım: "bu tasarımı nasıl sömürürüm?" listesi `SPEC.md` sonunda. En az 5 saldırı senaryosu ve karşılığı |

**Test:** Spec'in testi, 1.1'deki vektör tablosunun Faz 2 ve 3'te **iki bağımsız implementasyonda** (Rust + TS) aynı hash'i üretmesi. Uyuşmazsa spec eksikti.

---

### Faz 2 — Soroban escrow kontratı → **Deliverable 1**  *(~1 hafta)*

**Fonksiyonlar:**
```rust
init(admin: Address, verifier: BytesN<32>, default_expiry_ledgers: u32)
deposit(from: Address, identity: BytesN<32>, token: Address, amount: i128, expiry_ledger: u32) -> u64
claim(payment_ids: Vec<u64>, identity: BytesN<32>, recipient: Address,
      nonce: BytesN<32>, expires_at: u32, sig: BytesN<64>)
refund(payment_id: u64)
set_verifier(new: BytesN<32>)              // admin only
get_payment(id: u64) -> PaymentData        // read-only
get_balance(identity: BytesN<32>, token: Address) -> i128
```

**Event'ler:** `deposit`, `claim`, `refund` — hepsi `identity_key` topic'li, indexer bunları okuyacak.

| # | Yapılacak | Bitti kabul kriteri (test) |
|---|---|---|
| 2.1 | Tipler + storage + `init` | `cargo test` — init iki kez çağrılamaz |
| 2.2 | `deposit` | Happy path: bakiye kontrata geçer, id döner, event çıkar. **Negatif:** `amount <= 0` panik, `from` auth'u yoksa panik, geçmiş `expiry_ledger` reddedilir |
| 2.3 | `claim` + ed25519 doğrulama | Happy path: geçerli imza → para alıcıya geçer, payment `Claimed` olur. **Negatif (en kritik blok):** forge imza reddedilir; başka `identity` için imza reddedilir; başka `recipient` için imza reddedilir; **aynı nonce ikinci kez reddedilir (replay)**; `expires_at` geçmiş imza reddedilir; zaten claim edilmiş payment tekrar claim edilemez; expiry geçmiş payment claim edilemez |
| 2.4 | `refund` + expiry | Expiry'den **önce** refund reddedilir; sonra kabul edilir; gönderenden başkası refund edemez; claim edilmiş payment refund edilemez |
| 2.5 | Batch claim | 3 payment tek `claim` çağrısıyla toplanır, toplam doğru; içlerinden biri geçersizse **tüm çağrı** revert eder (atomiklik) |
| 2.6 | Fuzz / property test | `proptest` ile: hiçbir çağrı dizisi kontrat bakiyesini `sum(unclaimed)`'dan düşük bırakamaz (**invariant: solvency**) |
| 2.7 | Testnet deploy + gerçek işlem | Deploy tx hash + 1 deposit + 1 claim + 1 refund tx hash `docs/evidence/tx-hashes.md`'de. Explorer linkleriyle |

**Test aracı:** `soroban_sdk::testutils` — `Env::default()`, `mock_all_auths()`, `token::StellarAssetClient` ile sahte USDC, `env.ledger().set_sequence_number()` ile expiry zıplatma.
**Kapı:** `cargo test` %100 geçmeden Faz 3'e geçilmez. Hedef: **≥ 20 test, hepsi yeşil**, CI'da koşuyor.

---

### Faz 3 — GitHub doğrulama + verifier → **Deliverable 2**  *(~1 hafta)*

| # | Yapılacak | Bitti kabul kriteri (test) |
|---|---|---|
| 3.1 | GitHub OAuth App + `/api/auth/github/callback` | Manuel: giriş yap → oturumda doğru `login` görünür. Vitest: state param uyuşmazlığı reddedilir (CSRF) |
| 3.2 | Handle sahiplik kontrolü | OAuth token'ın `login`'i, claim edilen handle ile **birebir** eşleşmeli. Test: başkasının handle'ını claim denemesi 403 |
| 3.3 | Repo sahiplik kontrolü | `GET /repos/{owner}/{repo}` → `permissions.admin == true`. Test: admin olmayan repo 403 |
| 3.4 | `identity_key` TS implementasyonu | **Faz 1.1 vektör tablosunu Rust ile bit-bit karşılaştıran test.** Bu testin adı `identity-key-parity.test.ts` — Rust testinden çıkan hash'leri fixture olarak okur |
| 3.5 | ed25519 imzalama endpoint'i (`/api/verify/claim-auth`) | Key `VERIFIER_SECRET` env'den, **asla client'a sızmıyor** — bunu test eden bir grep/CI kuralı var. Vitest: üretilen imza kontratın kabul ettiği formatta |
| 3.6 | Nonce üretimi + tek kullanımlık kayıt | DB'de nonce tablosu, aynı nonce ikinci kez imzalanmaz. Test: eşzamanlı iki istek → biri 409 |
| 3.7 | Paytag nickname kaydı | Nick al/çöz, çakışma reddi, rezerve kelime listesi. Test: aynı nick iki kez alınamaz |
| 3.8 | X doğrulama — **koşullu** | X API erişimi/kotası varsa aynı desen. Yoksa `SPEC.md`'ye "API kısıtı nedeniyle ertelendi" notu + UI'da devre dışı görünür. SOW zaten "if API usage is allowed" diyor. |
| 3.9 | **Entegrasyon testi: uçtan uca doğrulama** | Testnet'te: deposit → OAuth → imza al → `claim` çağır → para geldi. Tx hash kaydedilir |

**Kapı:** 3.4 (parity testi) geçmeden 3.5'e geçilmez. Rust ve TS aynı `identity_key`'i üretmiyorsa hiçbir claim çalışmaz ve bu hata en pahalı şekilde Faz 4'te ortaya çıkar.

---

### Faz 4 — Demo UI + uçtan uca akış → **Deliverable 3**  *(~1 hafta)*

| # | Ekran / iş | Bitti kabul kriteri (test) |
|---|---|---|
| 4.1 | Cüzdan bağlama (Wallets Kit) | Freighter ile bağlan/kes, adres görünür. Manuel + Playwright (mock'lu) |
| 4.2 | Arama: `github.com/foo`, `@foo`, `foo/bar`, nick | Playwright: 4 girdi formatı doğru identity tipine çözülür; geçersiz girdi anlaşılır hata verir |
| 4.3 | Profil / ödeme sayfası (`/pay/github/foo`) | Bekleyen bakiye, geçmiş ödemeler, paylaşılabilir link. Playwright: 0 bakiye ve N bakiye durumları |
| 4.4 | Gönder akışı | Tutar + expiry seç → imzala → tx onayı + explorer linki. Playwright testnet'te gerçek tx |
| 4.5 | Claim dashboard | GitHub'a bağlan → claim edilebilirler listelenir → tek tıkla claim. Gerçek testnet claim |
| 4.6 | Refund akışı | Expiry geçmiş ödeme için "geri al" butonu. Testnet'te kısa expiry ile gerçek refund |
| 4.7 | Tx evidence sayfası | Tüm demo işlemleri tabloda, explorer linkli — jürinin tek bakışta göreceği yer |
| 4.8 | Vercel deploy | Canlı URL çalışıyor, `docs/` içinde yazılı |
| 4.9 | **Playwright E2E suite** | `pnpm test:e2e` — 6 senaryo yeşil, CI'da koşuyor. Bu SOW'un "end-to-end demo" kanıtının otomatik hali |

---

### Faz 5 — Kanıt paketi  *(~3 gün)*

SOW Bölüm 6 tablosuna **birebir** eşlenir. Ambassador lead teknik değil — her satır tek linkle doğrulanabilir olmalı.

| # | Yapılacak | Bitti kabul kriteri |
|---|---|---|
| 5.1 | `README.md` | Ne, neden, mimari diyagram, kurulum, **güven varsayımları bölümü**, mainnet USDC'ye geçiş notu |
| 5.2 | `docs/evidence/tx-hashes.md` | Deliverable → tx hash → explorer linki tablosu, her akış için |
| 5.3 | Ekran görüntüleri | 6 ekranın hepsi, `docs/evidence/screenshots/` |
| 5.4 | Test log'ları | `cargo test` + `vitest` + `playwright` çıktıları dosyaya, CI run linki |
| 5.5 | Demo videosu (2-3 dk) | Sesli anlatım: problem → gönder → doğrula → claim → refund. Tek çekim, kesme yok (güven verir) |
| 5.6 | **SOW evidence checklist'i doldur** | Bölüm 6.1'in her satırı için hangi linkin karşılık geldiğini yazan `docs/SOW-EVIDENCE.md` |

---

## 3. Takvim

| Hafta | Faz | Ana çıktı |
|---|---|---|
| 1 | Faz 0 + 1 | Repo, araç zinciri kanıtı, `SPEC.md`, wireframe |
| 2 | Faz 2 | Escrow kontratı, ≥20 test yeşil, testnet deploy + tx hash |
| 3 | Faz 3 | OAuth + verifier + parity testi + uçtan uca doğrulama tx'i |
| 4 | Faz 4 + 5 | 6 ekran, Playwright suite, Vercel demo, kanıt paketi, video |

**Kural: kanıt biriktirilir, sonda toplanmaz.** Her fazın sonunda `docs/evidence/` güncellenir. SOW'daki en büyük başarısızlık modu, çalışan kodun kanıtsız kalması.

---

## 4. Riskler ve önlemler

| Risk | Önlem |
|---|---|
| Rust/TS `identity_key` uyuşmazlığı | Faz 3.4 parity testi, kapı olarak |
| Verifier key sızması | Sadece server-side env, CI grep kuralı, README'de açık güven notu |
| Testnet USDC yok | Kendi SAC'ımız + SEP-41 arayüzü → mainnet'e tek adres değişikliği |
| X API erişimi | SOW koşullu yazmış; yoksa belgelenip ertelenir, GitHub tam çalışır |
| Storage TTL / arşivleme | Payment'lar `persistent`, `extend_ttl` çağrıları deposit/claim'de |
| Scope kayması | Chrome extension / KYC / revenue split **kapsam dışı**, SOW'da yazılı — dokunmuyoruz |
| Kontrat bakiyesi tutarsızlığı | Faz 2.6 solvency invariant fuzz testi |

---

## 5. Sıradaki hamle

Faz 0'ı hemen başlatmak için gerekenler:

1. **Onay:** Bölüm 1'deki stack kararları ve Bölüm 2'deki `identity_key`/verifier tasarımı tamam mı?
2. **GitHub:** `paytag` adında public repo açılacak mı, hangi org/hesap altında?
3. **Takvim:** SOW'da sprint başlangıcı 24.06.2026 yazıyor, bugün 19.08.2026. Chapter lead ile tarih güncellendi mi?
