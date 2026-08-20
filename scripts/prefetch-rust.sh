#!/usr/bin/env bash
# Paytag — Rust toolchain tarball'larını paralel byte-range ile önceden çeker.
#
# SORUN:
# Bu hatta uzun transferler kısılıyor. Aynı rustup çalıştırmasında 826 KB'lık
# manifest 399 KB/s inerken 8.5 MB'lık cargo 35 KB/s'ye düşüyor. Yani sorun
# rustup'ın indiricisinde değil; throttle boyuta/süreye bağlı. 65 MB'lık
# rustc bu hızda 25+ dakika sürüyor ve sık sık kopuyor.
#
# ÇÖZÜM:
# Throttle çoğu zaman TCP bağlantısı BAŞINA uygulanır. Bu script her dosyayı
# HTTP Range ile parçalara bölüp paralel bağlantılarla çeker; toplam hız
# bağlantı sayısıyla çarpılır. Throttle global ise de zarar yok, aynı kalır.
#
# GÜVENLİK:
# rustup indirdiği her dosyayı $RUSTUP_HOME/downloads altında SHA256'sının
# hex adıyla saklar; kurulumda o dizinde doğru adlı bir dosya bulursa hash'ini
# DOĞRULAYIP indirmeyi atlar (rustup src/dist/download.rs). Bu script de
# birleştirdiği dosyanın SHA256'sını resmî manifest'e karşı doğrular ve
# uyuşmazsa önbelleğe koymaz. Doğrulama rustup tarafında ikinci kez yapılır.
#
# TAŞINABİLİRLİK: macOS bash 3.2 ile çalışır (mapfile / declare -A yok).
set -uo pipefail

TARGET_HOST="${PAYTAG_RUST_HOST:-aarch64-apple-darwin}"
EXTRA_TARGET="${PAYTAG_RUST_WASM:-wasm32v1-none}"
DIST="${RUSTUP_DIST_SERVER:-https://static.rust-lang.org}"
CHUNKS="${PAYTAG_CHUNKS:-8}"          # dosya başına paralel bağlantı
CHUNK_MIN=$((2 * 1024 * 1024))        # 2 MB'tan küçük dosyayı bölme

RUSTUP_DIR="${RUSTUP_HOME:-$HOME/.rustup}"
DL="$RUSTUP_DIR/downloads"
WORK="$DL/.paytag-prefetch"           # yarım parçalar burada, tekrar kullanılır

RED=$'\033[0;31m'; YEL=$'\033[1;33m'; GRN=$'\033[0;32m'; CYA=$'\033[1;36m'; DIM=$'\033[2m'; OFF=$'\033[0m'
say()  { printf "\n%s==> %s%s\n" "$CYA" "$1" "$OFF"; }
warn() { printf "%s!  %s%s\n" "$YEL" "$1" "$OFF"; }
die()  { printf "%s✖ %s%s\n" "$RED" "$1" "$OFF"; exit 1; }

if command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'; }
elif command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }
else
  die "sha256 aracı yok (shasum veya sha256sum gerekli)."
fi

mkdir -p "$WORK" || die "$WORK oluşturulamadı"
TMP="$(mktemp -d)" || die "geçici dizin açılamadı"
trap 'rm -rf "$TMP"' EXIT

# ---------------------------------------------------------------- manifest --
say "1/4 Manifest"
MANIFEST="$TMP/channel.toml"
curl -fsS --retry 3 --retry-delay 2 -o "$MANIFEST" "$DIST/dist/channel-rust-stable.toml" \
  || die "manifest indirilemedi ($DIST)"
# Sürümü [pkg.rustc] bölümünden al. Manifest'teki İLK `version =` satırı
# cargo'ya aittir (ör. 0.98.0) ve Rust sürümü sanılıp kafa karıştırır.
pkg_version() { # paket
  awk -v sec="[pkg.$1]" '
    $0 == sec { inside = 1; next }
    inside && substr($0,1,1) == "[" { exit }
    inside && $0 ~ /^version *=/ {
      eq = index($0, "="); v = substr($0, eq + 1)
      gsub(/^[ \t]*"?/, "", v); gsub(/"?[ \t\r]*$/, "", v)
      print v; exit
    }' "$MANIFEST"
}
RUSTV="$(pkg_version rustc)"
[ -n "$RUSTV" ] || RUSTV="$(pkg_version rust)"
printf "  rustc = %s\n" "${RUSTV:-bilinmiyor}"

field_of() { # paket hedef alan
  awk -v sec="[pkg.$1.target.$2]" -v key="$3" '
    $0 == sec { inside = 1; next }
    inside && substr($0,1,1) == "[" { exit }
    inside {
      eq = index($0, "="); if (eq == 0) next
      k = substr($0, 1, eq - 1); gsub(/[ \t]/, "", k)
      if (k != key) next
      v = substr($0, eq + 1)
      gsub(/^[ \t]*"?/, "", v); gsub(/"?[ \t\r]*$/, "", v)
      print v; exit
    }' "$MANIFEST"
}

# ------------------------------------------------- rustup'ın tercihini bul --
# rustup zst / xz / gz varyantlarından birini seçer. Hangisini seçtiğini
# tahmin etmek yerine ÖLÇÜYORUZ: daha önce başarıyla indirdiği bir bileşenin
# hangi varyant hash'iyle önbellekte durduğuna bakıyoruz.
PREFER=""
for probe in cargo rustc rust-std; do
  for v in zst xz gz; do
    if [ "$v" = "gz" ]; then h="$(field_of "$probe" "$TARGET_HOST" hash)"
    else                     h="$(field_of "$probe" "$TARGET_HOST" "${v}_hash")"; fi
    [ -n "$h" ] || continue
    if [ -f "$DL/$h" ]; then PREFER="$v"; break; fi
  done
  [ -n "$PREFER" ] && break
done
if [ -n "$PREFER" ]; then
  printf "  rustup'ın kullandığı biçim önbellekten tespit edildi: %s\n" "$PREFER"
else
  PREFER="xz"
  printf "  önbellek boş; varsayılan biçim: %s\n" "$PREFER"
fi

url_hash_of() { # paket hedef -> "url hash" (tercih edilen biçimde)
  local pkg="$1" tgt="$2" u h
  if [ "$PREFER" = "gz" ]; then
    u="$(field_of "$pkg" "$tgt" url)";            h="$(field_of "$pkg" "$tgt" hash)"
  else
    u="$(field_of "$pkg" "$tgt" "${PREFER}_url")"; h="$(field_of "$pkg" "$tgt" "${PREFER}_hash")"
  fi
  if [ -z "$u" ] || [ -z "$h" ]; then   # tercih edilen biçim yoksa xz'ye düş
    u="$(field_of "$pkg" "$tgt" xz_url)"; h="$(field_of "$pkg" "$tgt" xz_hash)"
  fi
  [ -n "$u" ] && [ -n "$h" ] || return 1
  printf '%s %s\n' "$u" "$h"
}

# --------------------------------------------------------- bileşen listesi --
say "2/4 Bileşenler çözümleniyor ($TARGET_HOST)"

WANT="rustc:$TARGET_HOST
cargo:$TARGET_HOST
rust-std:$TARGET_HOST
rust-std:$EXTRA_TARGET"

# rustfmt/clippy manifest'te -preview son ekiyle durur
for base in rustfmt clippy; do
  for cand in "$base-preview" "$base"; do
    if url_hash_of "$cand" "$TARGET_HOST" >/dev/null 2>&1; then
      WANT="$WANT
$cand:$TARGET_HOST"
      break
    fi
  done
done

PLAN="$TMP/plan.tsv"; : > "$PLAN"
TAB="$(printf '\t')"
OLDIFS="$IFS"; IFS='
'
for entry in $WANT; do
  [ -n "$entry" ] || continue
  pkg="${entry%%:*}"; tgt="${entry##*:}"
  if ! info="$(url_hash_of "$pkg" "$tgt")"; then
    warn "$pkg / $tgt manifest'te yok — atlanıyor"
    continue
  fi
  u="${info%% *}"; h="${info##* }"
  if [ -f "$DL/$h" ] && [ "$(sha256_of "$DL/$h")" = "$h" ]; then
    printf "  %s✓%s %-22s %-22s zaten önbellekte\n" "$GRN" "$OFF" "$pkg" "$tgt"
    continue
  fi
  printf "  %s↓%s %-22s %-22s\n" "$YEL" "$OFF" "$pkg" "$tgt"
  printf '%s%s%s%s%s%s%s\n' "$pkg" "$TAB" "$tgt" "$TAB" "$u" "$TAB" "$h" >> "$PLAN"
done
IFS="$OLDIFS"

if [ ! -s "$PLAN" ]; then
  say "Her şey önbellekte — indirilecek bir şey yok."
else

# ------------------------------------------------------- paralel indirme ----
say "3/4 Paralel indirme ($CHUNKS bağlantı/dosya)"

fetch_one() { # url hash pkg tgt
  local url="$1" hash="$2" pkg="$3" tgt="$4"
  local len ranges i start end out pids rc n

  # Content-Length ve Range desteği
  # NOT: awk'ın IGNORECASE'i gawk'a özgüdür; macOS'un BSD awk'ında yoktur.
  # Bu yüzden POSIX uyumlu tolower() ile eşleştiriyoruz.
  len="$(curl -fsSI --retry 2 "$url" 2>/dev/null \
        | awk 'tolower($0) ~ /^content-length:/ { v=$2; gsub(/[\r\n ]/,"",v); print v }' | tail -1)"

  case "$len" in ''|*[!0-9]*) len=0 ;; esac

  n="$CHUNKS"
  [ "$len" -lt "$CHUNK_MIN" ] && n=1
  [ "$len" -eq 0 ] && n=1

  printf "  %s (%s) — %s MB, %s parça\n" "$pkg" "$tgt" \
    "$( [ "$len" -gt 0 ] && echo $((len / 1048576)) || echo '?' )" "$n"

  pids=""; rc=0
  i=0
  while [ "$i" -lt "$n" ]; do
    out="$WORK/$hash.part$i"
    if [ "$n" -eq 1 ]; then
      # tek parça: aralık yok
      if [ ! -s "$out" ]; then
        curl -fsS --retry 5 --retry-delay 3 --retry-connrefused \
             --connect-timeout 20 -o "$out" "$url" &
        pids="$pids $!"
      fi
    else
      start=$(( len * i / n ))
      end=$(( len * (i + 1) / n - 1 ))
      [ "$i" -eq $((n - 1)) ] && end=$((len - 1))
      want=$((end - start + 1))
      # tamamlanmış parçayı tekrar indirme
      if [ -f "$out" ] && [ "$(wc -c < "$out" | tr -d ' ')" = "$want" ]; then
        i=$((i + 1)); continue
      fi
      rm -f "$out"
      curl -fsS --retry 5 --retry-delay 3 --retry-connrefused \
           --connect-timeout 20 -r "$start-$end" -o "$out" "$url" &
      pids="$pids $!"
    fi
    i=$((i + 1))
  done

  for p in $pids; do wait "$p" || rc=1; done
  [ "$rc" -eq 0 ] || { warn "$pkg ($tgt) parçalarından biri inmedi"; return 1; }

  # birleştir
  : > "$TMP/$hash.joined"
  i=0
  while [ "$i" -lt "$n" ]; do
    cat "$WORK/$hash.part$i" >> "$TMP/$hash.joined" || return 1
    i=$((i + 1))
  done

  got="$(sha256_of "$TMP/$hash.joined")"
  if [ "$got" != "$hash" ]; then
    warn "$pkg ($tgt) SHA256 uyuşmadı — parçalar siliniyor, tekrar denenecek"
    printf "   %sbeklenen %s%s\n   %sbulunan  %s%s\n" "$DIM" "$hash" "$OFF" "$DIM" "$got" "$OFF"
    rm -f "$WORK/$hash".part* "$TMP/$hash.joined"
    return 1
  fi

  mv "$TMP/$hash.joined" "$DL/$hash" || return 1
  rm -f "$WORK/$hash".part*
  printf "  %s✓ %s (%s) doğrulandı ve önbelleğe kondu%s\n" "$GRN" "$pkg" "$tgt" "$OFF"
  return 0
}

FAILED=""
while IFS="$TAB" read -r pkg tgt url hash; do
  [ -n "$hash" ] || continue
  if ! fetch_one "$url" "$hash" "$pkg" "$tgt"; then
    FAILED="$FAILED $pkg/$tgt"
  fi
done < "$PLAN"

if [ -n "$FAILED" ]; then
  warn "Şunlar tamamlanamadı:$FAILED"
  warn "Script'i tekrar çalıştırın — tamamlanmış parçalar korunuyor, kaldığı yerden devam eder."
  exit 1
fi
fi

# ------------------------------------------------------------------ bitiş ---
say "4/4 Hazır"
cat <<MSG
rustup artık bu dosyaları yeniden indirmeyecek; önbellekten okuyup
hash'lerini doğrulayarak kuracak.

Sıradaki adım:
  ${CYA}./scripts/setup-mac.sh${OFF}

Hâlâ uzun uzun indiriyorsa rustup beklediğimizden farklı bir sıkıştırma
biçimi seçmiş demektir — çıktıyı paylaşın, PAYTAG biçimini değiştiririz.
MSG
