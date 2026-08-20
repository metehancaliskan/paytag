# Paytag — Anahtar ve Sır Yönetimi

> **Bu repo private başladı ve teslimde PUBLIC olacak.**
> Git geçmişi geri alınamaz. Bir sır bir kez commit edilirse, sonraki commit'te
> silinse bile geçmişte kalır ve repo public olduğu an okunabilir hale gelir.
> Bu dosyadaki kurallar tavsiye değil, kapı.

---

## 1. Anahtar envanteri — her sır nerede yaşar

| Sır | Ne işe yarar | Nerede yaşar | Repoda? |
|---|---|---|---|
| `paytag-dev` seed | Testnet deploy ve test işlemleri imzalar | macOS **Keychain** (`stellar keys generate --secure-store`) | ❌ asla |
| `VERIFIER_SECRET` | Claim yetkilerini ed25519 ile imzalar. **Escrow'un güvenlik kalbi.** | local: `web/.env.local` · prod: Vercel env vars | ❌ asla |
| Verifier **public** key | Kontratın `init()`'ine verilir, imzayı doğrular | Kontrat storage + `.env.example`'da placeholder | ✅ public key paylaşılabilir |
| `GITHUB_CLIENT_SECRET` | OAuth token değişimi | local: `web/.env.local` · prod: Vercel env vars | ❌ asla |
| `DATABASE_URL` | Neon Postgres (parola içerir) | local: `web/.env.local` · prod: Vercel env vars | ❌ asla |
| `SESSION_SECRET` | Oturum çerezi imzalar | local: `web/.env.local` · prod: Vercel env vars | ❌ asla |
| Contract ID (`C...`) | Deploy edilen escrow adresi | `docs/evidence/` + `.env` | ✅ public |
| Stellar public key (`G...`) | Hesap adresleri | Her yerde | ✅ public |

**Ayırt edici kural:** `S` ile başlayan 56 karakterlik her Stellar dizesi **secret seed**'dir ve
repoya asla girmez. `G` (hesap), `C` (kontrat) ve `M` (muxed) ile başlayanlar publictir, serbest.

---

## 2. Neden `VERIFIER_SECRET` en kritik sır

Kontrat GitHub'a HTTP isteği atamaz. Bu yüzden off-chain verifier sahipliği doğrulayıp sonucu
ed25519 ile imzalar, kontrat da `ed25519_verify` ile bu imzayı doğrular.

Sonuç: **bu anahtar ele geçerse, saldırgan escrow'daki herhangi bir ödeme için geçerli claim
yetkisi üretip fonları kendi cüzdanına çekebilir.** Kontratta başka bir kapı yok.

Bu yüzden:

- Anahtar **yalnızca** sunucu tarafı kodda okunur (Next.js route handler / server action)
- `NEXT_PUBLIC_` öneki **asla** verilmez — o önek değişkeni tarayıcı bundle'ına gömer
- Client component'lerden import edilen hiçbir modül bu değişkene dokunmaz
- Rotasyon yolu var: kontratın `set_verifier(new_pubkey)` fonksiyonu admin'e açık

---

## 3. Katmanlı savunma — 4 katman

Tek bir kontrole güvenmiyoruz. Sırayla:

### Katman 1 — `.gitignore`
`.env*` (sadece `.example` hariç), `*.pem`, `*.key`, `.stellar/`, `secrets/` ve arkadaşları.
Kazara `git add .` yapmaya karşı ilk bariyer.

### Katman 2 — `pre-commit` hook (en önemli katman)
`.githooks/pre-commit` → `scripts/scan-secrets.sh --staged`

Commit **oluşmadan** staged içeriği tarar ve bulursa commit'i reddeder. Bu katman kritik
çünkü sırrın geçmişe *girmesini* engelliyor — sonradan temizlemek çok daha zordur.

Kurulum (bir kez, `scripts/setup-mac.sh` otomatik yapar):

```bash
git config core.hooksPath .githooks
```

Neyi yakalar:

| Desen | Örnek |
|---|---|
| Stellar secret seed | `S` + 55 base32 karakter |
| PEM private key bloğu | `-----BEGIN ... PRIVATE KEY-----` |
| GitHub token | `ghp_…`, `gho_…`, `github_pat_…` |
| Sır isimli değişkene gerçek değer | `VERIFIER_SECRET="A9x…"` |
| Postgres URL'inde parola | `postgres://user:realpass@host` |
| `NEXT_PUBLIC_` ile sır | `NEXT_PUBLIC_VERIFIER_SECRET` |
| `.env` dosyasının kendisi | `.env`, `.env.local`, `.env.production` |
| Stellar identity dosyası | `.stellar/identity/*.toml` |

Placeholder'lar (`your-…`, `xxx…`, `process.env.…`, `<…>`) alarm vermez — kontrol satırın
tamamına değil **atanan değere** uygulanır, yani `DB_PASSWORD=gercekSir123` yakalanır ama
`DB_PASSWORD=your-password` yakalanmaz.

Yanlış alarm olduğuna eminsen satır sonuna `# paytag-allow-secret` ekle. Bunu kullanırken
iki kez düşün — muafiyet code review'da görünür olsun diye bilinçli olarak gürültülü.

### Katman 3 — `pre-push` hook
Biri `git commit --no-verify` ile Katman 2'yi atlarsa, push öncesi tüm takip edilen dosyalar
yeniden taranır. Son yerel savunma hattı.

### Katman 4 — CI (`gitleaks`, tüm geçmiş)
GitHub Actions her push'ta `gitleaks` ile **tüm commit geçmişini** tarar. Bu katman geriye
dönük bakar: yerel hook'lar kurulmadan atılmış eski bir commit'te sır varsa burada çıkar.

---

## 4. Anahtar üretimi — doğru yol

### Testnet deploy anahtarı

```bash
# macOS Keychain'de saklanır, diske plaintext yazılmaz
stellar keys generate paytag-dev --network testnet --fund --secure-store
stellar keys address paytag-dev     # sadece PUBLIC adresi yazdırır
```

`stellar keys show` komutunu **asla** terminal geçmişine veya ekran görüntüsüne düşürme.
Demo videosu çekerken bu komutu çalıştırmadığından emin ol.

### Verifier anahtarı

```bash
cd web && pnpm run verifier:keygen
```

Bu script secret'ı **stdout'a yazmaz**; doğrudan `web/.env.local`'a ekler ve sadece public
key'i ekrana basar. Public key'i kontratın `init()`'ine verirsin.

---

## 5. Public'e çıkmadan önce — zorunlu kontrol listesi

Repo'yu public yapmadan önce, sırayla:

- [ ] `scripts/scan-secrets.sh --tree` → temiz
- [ ] `gitleaks detect --source . --config .gitleaks.toml --log-opts="--all"` → **tüm geçmişte** 0 bulgu
- [ ] `git log --all --diff-filter=A --name-only | sort -u | grep -E '\.env|\.pem|\.key|\.stellar'` → boş
- [ ] `git log -p --all | grep -cE '\bS[A-Z2-7]{55}\b'` → `0`
- [ ] Vercel'deki env değişkenleri repoda değil, sadece Vercel'de
- [ ] Ekran görüntülerinde secret key, `.env` içeriği veya terminal geçmişi görünmüyor
- [ ] Demo videosunda `stellar keys show` çıktısı veya `.env.local` içeriği görünmüyor
- [ ] GitHub OAuth App'in callback URL'i production domain'ine ayarlı
- [ ] GitHub repo ayarlarında **Secret scanning** + **Push protection** açık (public repo'larda ücretsiz)

**Eğer geçmişte bir sır bulunursa:** commit'i silmek yetmez. Doğru yol:

1. Sırrı **hemen rotasyona sok** — sızmış anahtar ölü anahtardır, temizlik ikincil
   (verifier için: yeni anahtar üret → `set_verifier` çağır)
2. Sonra geçmişi temizle: `git filter-repo --invert-paths --path <dosya>` veya
   temiz bir başlangıç commit'i ile repoyu yeniden kur
3. Public'e çıkmayı 1. adım bitene kadar erteleme yok — rotasyon yapılmadan public olma

Sıralama önemli: sızmış anahtarı iptal etmek geçmişi temizlemekten daha aciltir, çünkü
private repo'ya erişimi olan biri anahtarı zaten kopyalamış olabilir.

---

## 6. Zafiyet bildirimi

Bu bir MVP ve hibe teslimidir, mainnet fonu tutmuyor. Bir güvenlik sorunu bulursan issue
açmak yerine doğrudan yaz: mete@bronixengineering.com
