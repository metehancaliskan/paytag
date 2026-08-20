<h1>Paytag</h1>

**Claimable USDC payments to GitHub and X handles, escrowed on Soroban.**

Send USDC to `github.com/someone`, `owner/repo`, `@handle`, or a Paytag nickname — before
that recipient has ever connected a Stellar wallet. Funds sit in a Soroban escrow contract
tagged to the *identity*. The recipient proves ownership of the handle, links a wallet, and
claims. Nobody claims? The sender refunds after expiry.

> Status: **Faz 0 — iskelet.** Sprint devam ediyor, `docs/PLAN.md` yol haritasıdır.

## Neden

Stellar'ın ödeme rayları güçlü, ama bir geliştiriciye, içerik üreticisine veya açık kaynak
projesine ödeme yapmak için önce cüzdan adresini bilmen gerekiyor. Bu bağışları, bounty
ödemelerini ve katkıcı ödüllerini yavaşlatıyor. Paytag bu adımı kaldırıyor.

## Mimari

```
Gönderen cüzdanı ──deposit(identity_key, token, amount, expiry)──▶ ┌──────────────────┐
                                                                    │ Soroban Escrow   │
GitHub ──OAuth──▶ Verifier API ──ed25519 imzalı claim auth──▶       │ (identity-tagged)│
                  (Next.js route)                                   │                  │
Alıcı cüzdanı ◀──claim(payment_ids, recipient, sig)───────────────  └──────────────────┘
Gönderen cüzdanı ◀──refund(payment_id) [expiry sonrası]────────────
```

## Güven varsayımları (açıkça)

Bir akıllı kontrat GitHub'a HTTP isteği atamaz. Zinciri internet kimliklerine bağlamak için
off-chain bir **verifier** GitHub OAuth ile sahipliği doğrular ve sonucu ed25519 ile imzalar;
kontrat imzayı `ed25519_verify` ile doğrular.

Bunun anlamı: **verifier'ın imza anahtarı ele geçerse, saldırgan escrow'daki fonlar için
geçerli claim yetkisi üretebilir.** Bu MVP'nin bilinen ve kabul edilmiş güven varsayımıdır.
Azaltma yol haritası: çoklu imza verifier seti, ve zincir üstünde doğrulanabilir attestation
(zkTLS tarzı). Her ikisi de bu 30 günlük kapsamın dışında.

## Sır yönetimi

Bu repo private başladı ve teslimde **public** olacak. Git geçmişi geri alınamaz, o yüzden
koruma daha ilk sır doğmadan kuruldu: `.gitignore` → `pre-commit` hook → `pre-push` hook →
CI'da tüm geçmişi tarayan `gitleaks`. Tarayıcının kendisi de 14 vakalık bir testle doğrulanıyor
(`scripts/test-scan-secrets.sh`).

Kurulum tek komut: `git config core.hooksPath .githooks` — `scripts/setup-mac.sh` otomatik yapar.

Anahtar envanteri, hangi sırrın nerede yaşadığı ve public'e çıkmadan önceki zorunlu kontrol
listesi için: **[docs/SECURITY.md](docs/SECURITY.md)**

## Repo yapısı

```
contracts/        Rust / soroban-sdk 26 — escrow kontratı
  escrow/         paytag-escrow crate
web/              Next.js 15 — UI + verifier API route'ları (Faz 3-4)
docs/
  PLAN.md         Faz faz build planı, her adımda test kriteri
  SPEC.md         Teknik spec + veri modeli (Faz 1)
  SECURITY.md     Anahtar envanteri, katmanlı savunma, public'e çıkma kontrol listesi
  evidence/       Instawards kanıt paketi: tx hash, ekran görüntüsü, log
scripts/
  setup-mac.sh          Tek seferlik geliştirme ortamı kurulumu
  scan-secrets.sh       Sır tarayıcı (pre-commit + pre-push + CI)
  test-scan-secrets.sh  Tarayıcının 14 vakalık testi
```

## Kurulum

```bash
./scripts/setup-mac.sh      # Rust + wasm target + stellar-cli + testnet identity
cd contracts && cargo test  # kontrat testleri
```

## Token notu

Testnet'te resmî Circle USDC yok, o yüzden kendi test issuer'ımızdan bir `USDC` çıkarıp
Stellar Asset Contract'a deploy ediyoruz. Kontrat SEP-41 token arayüzüne konuşuyor, yani
mainnet USDC'ye geçiş tek bir kontrat adresi değişikliğidir.

## Kapsam dışı (Instawards SOW)

Chrome eklentisi · KYC/hukuki iş akışları · karmaşık gelir paylaşımı

## Lisans

MIT
