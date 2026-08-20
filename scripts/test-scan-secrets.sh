#!/usr/bin/env bash
# scan-secrets.sh'in kendi testi.
#
# Bir sır tarayıcısına ancak test edilmişse güvenilir. Bu script 14 vaka koşar:
# 8 tanesi engellenmeli, 6 tanesi geçmeli. Yanlış alarmlar da hata sayılır —
# sürekli yanlış alarm veren bir tarayıcı, geliştiriciyi --no-verify'a iter ve
# hiç olmamasından daha kötü olur.
#
# CI'da ve scripts/setup-mac.sh içinde koşar.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

PASS=0; FAILN=0; FAILED=""
TMPDIR_TEST=".scan-test-tmp"

# DİKKAT: burada ÇIPLAK `git reset` ÇAĞIRMA.
# Çıplak reset index'in TAMAMINI boşaltır — bu script'in test dosyalarını
# değil, kullanıcının `git add` ile hazırladığı her şeyi. Sonuç sessizdir:
# commit "nothing added to commit" der ve sebebi görünmez. Yalnızca kendi
# geçici dizinimizi index'ten düşürüyoruz.
cleanup() {
  git reset -q -- "$TMPDIR_TEST" >/dev/null 2>&1 || true
  rm -rf "$TMPDIR_TEST"
}
trap cleanup EXIT

mkdir -p "$TMPDIR_TEST"

case_run() { # dosya_adı içerik etiket beklenen_exit
  local f="$TMPDIR_TEST/$1" c="$2" lbl="$3" exp="$4" rc
  printf '%s\n' "$c" > "$f"
  git add -f "$f" >/dev/null 2>&1
  if ! git diff --cached --name-only | grep -qxF "$f"; then
    printf "❌ %-34s (dosya stage edilemedi)\n" "$lbl"; FAILN=$((FAILN+1)); return
  fi
  ./scripts/scan-secrets.sh --staged >/dev/null 2>&1; rc=$?
  if [ "$rc" = "$exp" ]; then
    PASS=$((PASS+1)); printf "✅ %-34s exit=%s\n" "$lbl" "$rc"
  else
    FAILN=$((FAILN+1)); FAILED="$FAILED
   - $lbl (exit=$rc, beklenen=$exp)"
    printf "❌ %-34s exit=%s (beklenen %s)\n" "$lbl" "$rc" "$exp"
  fi
  git reset -q -- "$f" >/dev/null 2>&1; rm -f "$f"
}

# Test için sahte ama biçimsel olarak geçerli bir Stellar seed üret.
# Sabit bir dize gömmüyoruz ki bu dosyanın kendisi tarayıcıyı tetiklemesin.
FAKE_SEED="S$(LC_ALL=C tr -dc 'A-Z2-7' </dev/urandom | head -c 55)"

echo "═══ ENGELLENMESİ GEREKENLER ═══"
case_run a.ts     "export const s = \"$FAKE_SEED\";"                                  "Stellar secret seed"        1
case_run b.ts     'const t = "ghp_16C7e42F292c6912E7710c838347Ae178B4a";'              "GitHub token"               1
case_run c.ts     'const k = process.env.NEXT_PUBLIC_VERIFIER_SEED_B64;'               "NEXT_PUBLIC_ sır sızıntısı"  1
case_run d.ts     'export const GITHUB_CLIENT_SECRET = "9f2b7c1ae44d8e6013b5a7c9";'    "OAuth client secret"        1
case_run e.ts     'const DB_PASSWORD = "Kq9mZ2LpR7xA4nBv";'                            "Parola ataması"             1
case_run f.ts     'const u = "postgresql://own:npg_A9xKq2LmZ4pR@ep.neon.tech/db";'      "Postgres parolası"          1
case_run .env.local 'VERIFIER_SECRET=abc'                                              ".env.local dosyası"         1
case_run g.pem    '-----BEGIN OPENSSH PRIVATE KEY-----'                                "PEM private key"            1

echo
echo "═══ GEÇMESİ GEREKENLER (yanlış alarm avı) ═══"
case_run h.ts 'const a = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";'  "Stellar PUBLIC key (G...)"  0
case_run i.ts 'const c = "CCF3ND2GAWHJ42QGSFXTUQ4PS4PY4CTZCJWDRJQHVFCFXDGKGGZKV6RN";'  "Soroban contract id (C...)" 0
case_run j.ts 'const v = "a3f1c9b27e4d8056193b7ca2e0f4d68b5c917a3e2d0b4f6819c5a7e3b1d0f482";' "sha256 test vektörü" 0
case_run k.ts 'const s = process.env.VERIFIER_SECRET;'                                 "process.env okuması"        0
case_run l.ts 'const p = process.env.NEXT_PUBLIC_VERIFIER_PUBLIC_KEY;'                 "NEXT_PUBLIC_ PUBLIC key"    0
case_run m.env.example 'VERIFIER_SECRET=your-ed25519-seed-here'                        ".env.example placeholder"   0

echo
echo "═══ TAŞINABİLİRLİK (macOS sistem bash'i) ═══"
# Git hook'ları sınırlı PATH ile koşar; `env bash` orada macOS'un
# /bin/bash 3.2'sine düşebilir. `mapfile` gibi bash 4+ komutları orada
# "command not found" verir ve tarayıcı fiilen çöker — yani sır koruması
# sessizce kapanır. Bu vaka o regresyonu yakalar: temiz bir ağaçta
# scan-secrets.sh stderr'a HİÇBİR ŞEY yazmamalı.
if [ -x /bin/bash ]; then
  SYSBASH_VER="$(/bin/bash -c 'echo "$BASH_VERSION"')"
  PORT_ERR="$(/bin/bash ./scripts/scan-secrets.sh --tree 2>&1 >/dev/null)"
  if [ -n "$PORT_ERR" ]; then
    FAILN=$((FAILN+1)); FAILED="$FAILED
   - /bin/bash $SYSBASH_VER uyumluluğu: $(printf '%.140s' "$PORT_ERR")"
    printf "❌ %-34s (bash %s)\n" "/bin/bash uyumluluğu" "$SYSBASH_VER"
  else
    PASS=$((PASS+1)); printf "✅ %-34s bash %s\n" "/bin/bash uyumluluğu" "$SYSBASH_VER"
  fi
else
  printf "➖ %-34s\n" "/bin/bash yok — atlandı"
fi

echo
if [ "$FAILN" -ne 0 ]; then
  printf "\033[0;31m✖ %d/%d geçti. Başarısız:%s\033[0m\n" "$PASS" "$((PASS+FAILN))" "$FAILED"
  echo
  echo "Tarayıcı bozulmuş. Sır koruması bu testler yeşil olmadan güvenilir değil."
  exit 1
fi
printf "\033[0;32m✓ %d/%d vaka geçti — sır tarayıcı çalışıyor.\033[0m\n" "$PASS" "$PASS"
