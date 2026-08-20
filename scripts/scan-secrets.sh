#!/usr/bin/env bash
# Paytag — sır tarayıcı
#
# Bu repo private başlıyor ve teslimde PUBLIC olacak. Git geçmişi kalıcıdır:
# bir kez commit edilen sır, sonradan silinse bile geçmişte durur ve public
# olduğu an okunabilir. Bu script sırrın geçmişe *girmesini* engeller.
#
# Kullanım:
#   scripts/scan-secrets.sh --staged   # commit edilmek üzere olan içeriği tara (pre-commit hook)
#   scripts/scan-secrets.sh --tree     # takip edilen tüm dosyaları tara (CI)
#
# Bir satırı bilinçli olarak muaf tutmak için satır sonuna şunu ekle:
#   paytag-allow-secret
#
# TAŞINABİLİRLİK — DİKKAT:
# Bu script macOS'un sistem bash'i (3.2, 2007) ile çalışmak ZORUNDA. Git
# hook'ları sınırlı bir PATH ile koşar ve `env bash` orada çoğu zaman
# /bin/bash yani 3.2'ye düşer. Bu yüzden bash 4+ özellikleri KULLANILMAZ:
#   mapfile/readarray, ${x^^}, declare -A, ${!x@}
# Ayrıca bash 3.2'de `set -u` altında BOŞ bir dizinin ${#ARR[@]} ifadesi
# "unbound variable" hatası verir; bu yüzden eleman sayısı ayrı bir tamsayı
# değişkende tutulur.
set -uo pipefail

MODE="${1:---staged}"
FAIL=0

RED=$'\033[0;31m'; YEL=$'\033[0;33m'; GRN=$'\033[0;32m'; DIM=$'\033[2m'; OFF=$'\033[0m'

# Tarayıcının kendisi ve dokümanlar desen metni içerir; onları taramıyoruz.
is_excluded() {
  case "$1" in
    scripts/scan-secrets.sh|scripts/test-scan-secrets.sh|.githooks/*|.gitleaks.toml|docs/SECURITY.md) return 0 ;;
    *) return 1 ;;
  esac
}

# Taranacak dosya listesi.
# `mapfile` bash 4+ komutu olduğu için kullanılmıyor (yukarıdaki
# TAŞINABİLİRLİK notuna bak). collect() dizisi mevcut kabukta doldurur:
# `collect < <(...)` boru hattı değil yönlendirme olduğundan alt kabuk açmaz
# ve FILES kaybolmaz.
FILES=()
NFILES=0
collect() {
  local line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    FILES[NFILES]="$line"
    NFILES=$((NFILES + 1))
  done
}

case "$MODE" in
  --staged) collect < <(git diff --cached --name-only --diff-filter=ACMR) ;;
  --tree)   collect < <(git ls-files) ;;
  *) echo "Kullanım: $0 [--staged|--tree]"; exit 2 ;;
esac

if [ "$NFILES" -eq 0 ]; then
  echo "${GRN}Taranacak dosya yok.${OFF}"
  exit 0
fi

report() { # dosya satır_no etiket içerik
  FAIL=1
  printf "%s✖ %s%s\n" "$RED" "$3" "$OFF"
  printf "  %s:%s\n" "$1" "$2"
  printf "  %s%s%s\n\n" "$DIM" "$(printf '%.160s' "$4")" "$OFF"
}

# --- Kural 0: .env dosyası hiç commit edilemez (.example hariç) -------------
for f in "${FILES[@]}"; do
  base="$(basename "$f")"
  case "$base" in
    .env|.env.*)
      case "$base" in
        *.example|*.sample|*.template) ;;
        *) FAIL=1
           printf "%s✖ Ortam dosyası commit ediliyor%s\n  %s\n  %sSadece .env.example commit edilir. Gerçek değerler Vercel/local kalır.%s\n\n" \
             "$RED" "$OFF" "$f" "$DIM" "$OFF" ;;
      esac ;;
  esac
  # Stellar identity dosyaları (seed phrase içerir)
  case "$f" in
    *.stellar/identity/*|*.config/stellar/*) FAIL=1
      printf "%s✖ Stellar identity dosyası commit ediliyor (seed phrase içerir)%s\n  %s\n\n" "$RED" "$OFF" "$f" ;;
  esac
done

# --- Kural 1..N: içerik desenleri ------------------------------------------
# Placeholder sayılan DEĞERLER. Dikkat: bu kontrol satırın tamamına değil,
# yalnızca atanan değere uygulanır. Aksi halde `DB_PASSWORD=gercekSir123`
# satırı "password" kelimesini içerdiği için muaf sayılırdı.
PLACEHOLDER='(^|[^A-Za-z0-9])(xxx+|yyy+|zzz+|aaa+|your[-_]|my[-_]|changeme|change_me|replace|placeholder|example|sample|dummy|fake|test[-_]?only|todo|tbd|\.\.\.|<[^>]*>|\$\{|process\.env|import\.meta\.env|os\.environ|redacted|password@|passwd@|user:pass|dbname|hostname|localhost|127\.0\.0\.1|secret[-_]?here|seed[-_]?here|key[-_]?here)'

# Eşleşmenin "değer" kısmını çıkarır: son = veya : işaretinden sonrası,
# baştaki/sondaki tırnak ve noktalama temizlenmiş hali.
value_of() {
  printf '%s' "$1" | sed -E 's/.*[=:]//; s/^[[:space:]]*["'"'"'`]?//; s/["'"'"'`][[:space:]]*[,;)]*[[:space:]]*$//'
}

scan_pattern() { # regex etiket
  local re="$1" label="$2"
  for f in "${FILES[@]}"; do
    is_excluded "$f" && continue
    [ -f "$f" ] || continue
    # ikili dosyaları atla
    grep -qI . "$f" 2>/dev/null || continue
    while IFS=: read -r ln content; do
      [ -n "$ln" ] || continue
      # bilinçli muafiyet
      case "$content" in *paytag-allow-secret*) continue ;; esac
      # Placeholder kontrolü iki yerden yapılır:
      #   - eşleşen parçanın değeri (desen değeri de kapsıyorsa)
      #   - satırın tamamının değeri (desen sadece DEĞİŞKEN ADINI yakaladıysa,
      #     örn. NEXT_PUBLIC_ kuralı; o zaman değer satırın geri kalanındadır)
      local match val_match val_line
      match="$(printf '%s' "$content" | grep -oE -e "$re" | head -1)"
      val_match="$(value_of "${match:-$content}")"
      val_line="$(value_of "$content")"
      if printf '%s' "$val_match" | grep -qiE "$PLACEHOLDER"; then continue; fi
      if printf '%s' "$val_line"  | grep -qiE "$PLACEHOLDER"; then continue; fi
      report "$f" "$ln" "$label" "$content"
    done < <(grep -nE -e "$re" "$f" 2>/dev/null)
  done
}

# scan_pattern_strict: placeholder muafiyeti UYGULANMAZ.
# Bu desenlerin meşru bir "örnek değer" hali yok — eşleşme = hata.
# Özellikle NEXT_PUBLIC_ sızıntısında değerin `process.env.X` olması durumu
# düzeltmez, tam tersine sızıntının kendisidir: o değişken adı client
# bundle'ına gömülür ve değeri tarayıcıda okunur.
scan_pattern_strict() { # regex etiket
  local re="$1" label="$2"
  for f in "${FILES[@]}"; do
    is_excluded "$f" && continue
    [ -f "$f" ] || continue
    grep -qI . "$f" 2>/dev/null || continue
    while IFS=: read -r ln content; do
      [ -n "$ln" ] || continue
      case "$content" in *paytag-allow-secret*) continue ;; esac
      report "$f" "$ln" "$label" "$content"
    done < <(grep -nE -e "$re" "$f" 2>/dev/null)
  done
}

# Stellar secret seed: S + 55 base32 karakter.
# Public key (G...), contract id (C...) ve muxed (M...) güvenlidir, taranmaz.
scan_pattern_strict '\bS[A-Z2-7]{55}\b' 'Stellar SECRET SEED (S...) tespit edildi'

# PEM private key blokları
scan_pattern_strict 'BEGIN [A-Z ]*PRIVATE KEY' 'PEM private key bloğu'

# GitHub token'ları
scan_pattern_strict '\bgh[pousr]_[A-Za-z0-9]{30,}\b'      'GitHub token (ghp_/gho_/ghu_/ghs_/ghr_)'
scan_pattern_strict '\bgithub_pat_[A-Za-z0-9_]{20,}\b'    'GitHub fine-grained PAT'

# Sır isimli değişkene gerçek görünümlü değer atanması
scan_pattern '(VERIFIER_(SECRET|SEED|PRIVATE_KEY)|SESSION_SECRET|NEXTAUTH_SECRET|GITHUB_CLIENT_SECRET|[A-Z0-9_]*(SECRET|PRIVATE_KEY|SEED|PASSWORD|TOKEN))[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9+/=_.\-]{16,}' \
  'Sır isimli değişkene gerçek değer atanmış'

# Postgres bağlantı dizesinde parola
scan_pattern 'postgres(ql)?://[^:@/[:space:]]+:[^@[:space:]]+@' 'Postgres URL içinde parola'

# NEXT_PUBLIC_ ile sır sızdırma — client bundle'a girer.
# Dikkat: NEXT_PUBLIC_VERIFIER_PUBLIC_KEY meşrudur (public key paylaşılır),
# o yüzden "VERIFIER" tek başına yetmez; SECRET/SEED/PRIVATE aranır.
scan_pattern_strict 'NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PRIVATE_KEY|_SEED|PASSWORD|PASSWD)' \
  'NEXT_PUBLIC_ ile sır tanımlanmış — tarayıcı bundle'"'"'ına girer'

# ed25519 32-byte secret'ın base64 hali (44 karakter, = ile biter)
# Not: 64 haneli hex bilinçli olarak taranmıyor — identity_key test vektörleri
# (sha256) de 64 hex ve sürekli yanlış alarm verirdi.
scan_pattern '(secret|seed|private)[A-Za-z_]*[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9+/]{43}=["'"'"']' \
  'base64 kodlu 32-byte sır'

echo
if [ "$FAIL" -ne 0 ]; then
  cat <<'MSG'
────────────────────────────────────────────────────────────────────────
COMMIT ENGELLENDİ.

Bu repo teslimde PUBLIC olacak. Git geçmişi geri alınamaz: sır bir kez
commit edilirse, sonraki commit'te silsen bile geçmişte kalır.

Ne yapmalı:
  1. Değeri dosyadan çıkar, yerine process.env.X koy
  2. Gerçek değeri .env.local'a yaz (gitignore'da)
  3. Deploy için Vercel > Settings > Environment Variables kullan
  4. .env.example'a sadece placeholder ekle

Yanlış alarm olduğuna eminsen satır sonuna şunu ekle:
  # paytag-allow-secret
────────────────────────────────────────────────────────────────────────
MSG
  exit 1
fi

printf "%s✓ Sır taraması temiz (%d dosya, mod: %s)%s\n" "$GRN" "$NFILES" "$MODE" "$OFF"
exit 0
