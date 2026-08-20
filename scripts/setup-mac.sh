#!/usr/bin/env bash
# Paytag — Mac geliştirme ortamı kurulumu (Faz 0)
# Tek seferlik. Ağ erişimi gerektirir.
#
# Bu script hiçbir secret key'i ekrana yazmaz. Testnet anahtarı macOS
# Keychain'e kaydedilir, diske plaintext düşmez.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

say() { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }
warn() { printf "\033[1;33m!  %s\033[0m\n" "$1"; }

say "1/7 Git hook'ları — sır sızıntısı koruması"
git config core.hooksPath .githooks
chmod +x .githooks/* scripts/*.sh
echo "core.hooksPath = $(git config core.hooksPath)"
echo "pre-commit ve pre-push artık her commit/push'ta sır tarıyor."
# macOS hâlâ bash 3.2 (2007) gönderiyor. Hook script'leri buna göre yazıldı;
# burada sadece bilgi amaçlı yazdırıyoruz ki bir uyumsuzluk çıkarsa
# hata mesajı bağlamsız kalmasın.
echo "hook kabuğu: $(/bin/bash --version | head -1)"

say "2/7 Rust toolchain"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

# rust-docs (~23 MB) bu projede kullanılmıyor. Yavaş/kopan bağlantıda indirme
# yarıda kalıyor ve rustup şu hatayı veriyor:
#   could not rename downloaded file from '...partial' to '...'
# minimal profil rust-docs'u hiç indirmez; sorunun kaynağını ortadan kaldırır.
#
# DİKKAT: `rustup set profile minimal` yalnızca YENİ toolchain kurulumlarını
# etkiler. `rustup update`, mevcut toolchain'in kayıtlı bileşen listesini
# korur — daha önce varsayılan profille kurulmuşsa rust-docs yine iner.
# Bu yüzden aşağıdaki fallback uninstall + install yolunu kullanır.
RUSTUP_DIR="${RUSTUP_HOME:-$HOME/.rustup}"
rustup set profile minimal

# Yavaş bağlantıda varsayılan 180 sn'lik indirme timeout'u yetmiyor ve
# transfer "error decoding response body" ile yarıda kopuyor. 27 MB'lık
# rust-std 50 KB/s'de 10 dakika sürer; sınırı buna göre açıyoruz.
export RUSTUP_DOWNLOAD_TIMEOUT="${RUSTUP_DOWNLOAD_TIMEOUT:-900}"

# Yarım kalmış .partial dosyaları kalıcı bozukluk yapabiliyor — SADECE onları
# sil. `downloads` dizininin tamamını silmek yanlıştı: rustup tamamlanmış
# bileşenleri orada sha256 adıyla önbelleğe alır ve tekrar kullanır. Dizini
# uçurmak, yavaş hatta her denemede onlarca MB'ı boşuna yeniden indirtir.
purge_partials() {
  [ -d "$RUSTUP_DIR/downloads" ] || return 0
  find "$RUSTUP_DIR/downloads" -name '*.partial' -delete 2>/dev/null || true
  rm -rf "$RUSTUP_DIR/tmp"
}
purge_partials

# Bu hatta uzun transferler kısılıyor (manifest 400 KB/s, 65 MB'lık rustc
# 40 KB/s). prefetch-rust.sh tarball'ları paralel byte-range ile çekip
# rustup'ın önbelleğine koyar; rustup sonra hiç indirme yapmaz.
if [ -x scripts/prefetch-rust.sh ]; then
  ./scripts/prefetch-rust.sh || warn "önceden çekme tamamlanamadı — rustup kendi indiricisiyle devam edecek (yavaş olabilir)"
fi

if ! rustup update stable; then
  warn "rustup update başarısız. Yarım dosyalar temizlenip minimal profille yeniden denenecek."
  warn "Tamamlanmış bileşenler önbellekte korunuyor — baştan inmeyecek."
  purge_partials
  rustup toolchain uninstall stable >/dev/null 2>&1 || true
  rustup toolchain install stable --profile minimal
fi

rustup default stable
rustup component add rustfmt clippy
rustup target add wasm32v1-none

say "3/7 stellar-cli"
if ! command -v stellar >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install stellar-cli
  else
    cargo install --locked stellar-cli
  fi
fi

say "4/7 gitleaks (geçmiş taraması için)"
if ! command -v gitleaks >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install gitleaks
  else
    warn "gitleaks kurulamadı (brew yok). CI yine de tarayacak."
  fi
fi

say "5/7 Node + pnpm"
command -v node >/dev/null 2>&1 || { echo "Node 22+ kur: https://nodejs.org"; exit 1; }
command -v pnpm >/dev/null 2>&1 || npm install -g pnpm

say "6/7 Testnet identity — macOS Keychain'de"
stellar network use testnet >/dev/null 2>&1 || true
if stellar keys ls 2>/dev/null | grep -qx "paytag-dev"; then
  echo "paytag-dev zaten var."
else
  # --secure-store: seed macOS Keychain'e gider, ~/.config/stellar'a plaintext YAZILMAZ
  stellar keys generate paytag-dev --network testnet --fund --secure-store
fi
stellar keys fund paytag-dev --network testnet >/dev/null 2>&1 || true
ADDR="$(stellar keys address paytag-dev)"   # sadece PUBLIC adres
echo "paytag-dev public adresi: $ADDR"
warn "'stellar keys show' komutunu asla çalıştırma — secret'ı terminal geçmişine düşürür."

say "7/7 Kanıt: araç zinciri sürümleri"
mkdir -p docs/evidence
{
  echo "# Toolchain — $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo
  echo "rustc:    $(rustc --version)"
  echo "cargo:    $(cargo --version)"
  echo "targets:  $(rustup target list --installed | tr '\n' ' ')"
  echo "stellar:  $(stellar --version | head -1)"
  echo "node:     $(node --version)"
  echo "pnpm:     $(pnpm --version)"
  echo "gitleaks: $(command -v gitleaks >/dev/null 2>&1 && gitleaks version || echo 'kurulu değil')"
  echo
  echo "identity: paytag-dev (public) = $ADDR"
  echo "          secret -> macOS Keychain, repoda ve diskte plaintext yok"
} > docs/evidence/toolchain.txt
cat docs/evidence/toolchain.txt

say "Doğrulama"
./scripts/test-scan-secrets.sh
./scripts/scan-secrets.sh --tree
(cd contracts && cargo test)

say "Bitti. Sonraki adım: cp .env.example web/.env.local && git push -u origin develop"
