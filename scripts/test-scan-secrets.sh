#!/usr/bin/env bash
# The test suite for scan-secrets.sh.
#
# A secret scanner is only trustworthy once it has been tested. This script
# runs 14 cases: 8 must be blocked, 6 must pass. False alarms count as
# failures too — a scanner that keeps crying wolf pushes the developer towards
# --no-verify and ends up worse than no scanner at all.
#
# Runs in CI and from scripts/setup-mac.sh.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

PASS=0; FAILN=0; FAILED=""
TMPDIR_TEST=".scan-test-tmp"

# CAREFUL: do NOT call a BARE `git reset` here.
# A bare reset empties the ENTIRE index — not just this script's test files but
# everything the user has prepared with `git add`. The result is silent: the
# commit says "nothing added to commit" and the reason is invisible. We only
# drop our own temporary directory from the index.
cleanup() {
  git reset -q -- "$TMPDIR_TEST" >/dev/null 2>&1 || true
  rm -rf "$TMPDIR_TEST"
}
trap cleanup EXIT

mkdir -p "$TMPDIR_TEST"

case_run() { # file_name content label expected_exit
  local f="$TMPDIR_TEST/$1" c="$2" lbl="$3" exp="$4" rc
  printf '%s\n' "$c" > "$f"
  git add -f "$f" >/dev/null 2>&1
  if ! git diff --cached --name-only | grep -qxF "$f"; then
    printf "❌ %-34s (could not stage the file)\n" "$lbl"; FAILN=$((FAILN+1)); return
  fi
  ./scripts/scan-secrets.sh --staged >/dev/null 2>&1; rc=$?
  if [ "$rc" = "$exp" ]; then
    PASS=$((PASS+1)); printf "✅ %-34s exit=%s\n" "$lbl" "$rc"
  else
    FAILN=$((FAILN+1)); FAILED="$FAILED
   - $lbl (exit=$rc, expected=$exp)"
    printf "❌ %-34s exit=%s (expected %s)\n" "$lbl" "$rc" "$exp"
  fi
  git reset -q -- "$f" >/dev/null 2>&1; rm -f "$f"
}

# Generate a fake but structurally valid Stellar seed for the test.
# We do not embed a fixed string, so that this file itself does not trip the
# scanner.
FAKE_SEED="S$(LC_ALL=C tr -dc 'A-Z2-7' </dev/urandom | head -c 55)"

echo "═══ MUST BE BLOCKED ═══"
case_run a.ts     "export const s = \"$FAKE_SEED\";"                                  "Stellar secret seed"        1
case_run b.ts     'const t = "ghp_16C7e42F292c6912E7710c838347Ae178B4a";'              "GitHub token"               1
case_run c.ts     'const k = process.env.NEXT_PUBLIC_VERIFIER_SEED_B64;'               "NEXT_PUBLIC_ secret leak"   1
case_run d.ts     'export const GITHUB_CLIENT_SECRET = "9f2b7c1ae44d8e6013b5a7c9";'    "OAuth client secret"        1
case_run e.ts     'const DB_PASSWORD = "Kq9mZ2LpR7xA4nBv";'                            "Password assignment"        1
case_run f.ts     'const u = "postgresql://own:npg_A9xKq2LmZ4pR@ep.neon.tech/db";'      "Postgres password"          1
case_run .env.local 'VERIFIER_SECRET=abc'                                              ".env.local file"            1
case_run g.pem    '-----BEGIN OPENSSH PRIVATE KEY-----'                                "PEM private key"            1

echo
echo "═══ MUST PASS (false-alarm hunt) ═══"
case_run h.ts 'const a = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";'  "Stellar PUBLIC key (G...)"  0
case_run i.ts 'const c = "CCF3ND2GAWHJ42QGSFXTUQ4PS4PY4CTZCJWDRJQHVFCFXDGKGGZKV6RN";'  "Soroban contract id (C...)" 0
case_run j.ts 'const v = "a3f1c9b27e4d8056193b7ca2e0f4d68b5c917a3e2d0b4f6819c5a7e3b1d0f482";' "sha256 test vector"  0
case_run k.ts 'const s = process.env.VERIFIER_SECRET;'                                 "process.env read"           0
case_run l.ts 'const p = process.env.NEXT_PUBLIC_VERIFIER_PUBLIC_KEY;'                 "NEXT_PUBLIC_ PUBLIC key"    0
case_run m.env.example 'VERIFIER_SECRET=your-ed25519-seed-here'                        ".env.example placeholder"   0

echo
echo "═══ PORTABILITY (macOS system bash) ═══"
# Git hooks run with a restricted PATH; `env bash` there can fall back to
# macOS's /bin/bash 3.2. Bash 4+ builtins such as `mapfile` give
# "command not found" there and the scanner effectively crashes — meaning the
# secret protection silently switches off. This case catches that regression:
# on a clean tree, scan-secrets.sh must write NOTHING to stderr.
if [ -x /bin/bash ]; then
  SYSBASH_VER="$(/bin/bash -c 'echo "$BASH_VERSION"')"
  PORT_ERR="$(/bin/bash ./scripts/scan-secrets.sh --tree 2>&1 >/dev/null)"
  if [ -n "$PORT_ERR" ]; then
    FAILN=$((FAILN+1)); FAILED="$FAILED
   - /bin/bash $SYSBASH_VER compatibility: $(printf '%.140s' "$PORT_ERR")"
    printf "❌ %-34s (bash %s)\n" "/bin/bash compatibility" "$SYSBASH_VER"
  else
    PASS=$((PASS+1)); printf "✅ %-34s bash %s\n" "/bin/bash compatibility" "$SYSBASH_VER"
  fi
else
  printf "➖ %-34s\n" "no /bin/bash — skipped"
fi

echo
if [ "$FAILN" -ne 0 ]; then
  printf "\033[0;31m✖ %d/%d passed. Failures:%s\033[0m\n" "$PASS" "$((PASS+FAILN))" "$FAILED"
  echo
  echo "The scanner is broken. Secret protection is not trustworthy until these tests are green."
  exit 1
fi
printf "\033[0;32m✓ %d/%d cases passed — the secret scanner works.\033[0m\n" "$PASS" "$PASS"
