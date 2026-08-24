#!/usr/bin/env bash
# Paytag — secret scanner
#
# This repo starts private and will be PUBLIC on delivery. Git history is
# permanent: a secret that is committed once stays in history even if it is
# deleted later, and becomes readable the moment the repo goes public. This
# script stops a secret from *entering* history in the first place.
#
# Usage:
#   scripts/scan-secrets.sh --staged   # scan the content about to be committed (pre-commit hook)
#   scripts/scan-secrets.sh --tree     # scan every tracked file (CI)
#
# To exempt a line deliberately, append this to the end of the line:
#   paytag-allow-secret
#
# PORTABILITY — CAREFUL:
# This script MUST run under the macOS system bash (3.2, 2007). Git hooks run
# with a restricted PATH and `env bash` there usually falls back to /bin/bash,
# i.e. 3.2. That is why bash 4+ features are NOT USED:
#   mapfile/readarray, ${x^^}, declare -A, ${!x@}
# Also, in bash 3.2 under `set -u`, the ${#ARR[@]} expression of an EMPTY array
# raises an "unbound variable" error; that is why the element count is kept in
# a separate integer variable.
set -uo pipefail

MODE="${1:---staged}"
FAIL=0

RED=$'\033[0;31m'; YEL=$'\033[0;33m'; GRN=$'\033[0;32m'; DIM=$'\033[2m'; OFF=$'\033[0m'

# The scanner itself and the docs contain pattern text; we do not scan those.
is_excluded() {
  case "$1" in
    scripts/scan-secrets.sh|scripts/test-scan-secrets.sh|.githooks/*|.gitleaks.toml|docs/SECURITY.md) return 0 ;;
    *) return 1 ;;
  esac
}

# The list of files to scan.
# `mapfile` is not used because it is a bash 4+ builtin (see the PORTABILITY
# note above). collect() fills the array in the current shell:
# `collect < <(...)` is a redirection, not a pipeline, so it opens no subshell
# and FILES does not get lost.
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
  *) echo "Usage: $0 [--staged|--tree]"; exit 2 ;;
esac

if [ "$NFILES" -eq 0 ]; then
  echo "${GRN}No files to scan.${OFF}"
  exit 0
fi

report() { # file line_no label content
  FAIL=1
  printf "%s✖ %s%s\n" "$RED" "$3" "$OFF"
  printf "  %s:%s\n" "$1" "$2"
  printf "  %s%s%s\n\n" "$DIM" "$(printf '%.160s' "$4")" "$OFF"
}

# --- Rule 0: a .env file can never be committed (.example excepted) ----------
for f in "${FILES[@]}"; do
  base="$(basename "$f")"
  case "$base" in
    .env|.env.*)
      case "$base" in
        *.example|*.sample|*.template) ;;
        *) FAIL=1
           printf "%s✖ Environment file being committed%s\n  %s\n  %sOnly .env.example is committed. Real values stay in Vercel/local.%s\n\n" \
             "$RED" "$OFF" "$f" "$DIM" "$OFF" ;;
      esac ;;
  esac
  # Stellar identity files (they contain a seed phrase)
  case "$f" in
    *.stellar/identity/*|*.config/stellar/*) FAIL=1
      printf "%s✖ Stellar identity file being committed (contains a seed phrase)%s\n  %s\n\n" "$RED" "$OFF" "$f" ;;
  esac
done

# --- Rules 1..N: content patterns ------------------------------------------
# VALUES that count as placeholders. Careful: this check applies to the
# assigned value only, not to the whole line. Otherwise the line
# `DB_PASSWORD=realSecret123` would be exempted just for containing the word
# "password".
PLACEHOLDER='(^|[^A-Za-z0-9])(xxx+|yyy+|zzz+|aaa+|your[-_]|my[-_]|changeme|change_me|replace|placeholder|example|sample|dummy|fake|test[-_]?only|todo|tbd|\.\.\.|<[^>]*>|\$\{|process\.env|import\.meta\.env|os\.environ|redacted|password@|passwd@|user:pass|dbname|hostname|localhost|127\.0\.0\.1|secret[-_]?here|seed[-_]?here|key[-_]?here)'

# Extracts the "value" part of a match: everything after the last = or :, with
# surrounding quotes and punctuation stripped.
value_of() {
  printf '%s' "$1" | sed -E 's/.*[=:]//; s/^[[:space:]]*["'"'"'`]?//; s/["'"'"'`][[:space:]]*[,;)]*[[:space:]]*$//'
}

scan_pattern() { # regex label
  local re="$1" label="$2"
  for f in "${FILES[@]}"; do
    is_excluded "$f" && continue
    [ -f "$f" ] || continue
    # skip binary files
    grep -qI . "$f" 2>/dev/null || continue
    while IFS=: read -r ln content; do
      [ -n "$ln" ] || continue
      # deliberate exemption
      case "$content" in *paytag-allow-secret*) continue ;; esac
      # The placeholder check is applied in two places:
      #   - the value of the matched fragment (when the pattern covers the
      #     value too)
      #   - the value of the whole line (when the pattern only caught the
      #     VARIABLE NAME, e.g. the NEXT_PUBLIC_ rule; then the value is in
      #     the rest of the line)
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

# scan_pattern_strict: the placeholder exemption is NOT applied.
# These patterns have no legitimate "example value" form — a match is an error.
# For the NEXT_PUBLIC_ leak in particular, a value of `process.env.X` does not
# make it safe; that is the leak itself: the variable name gets baked into the
# client bundle and its value is readable in the browser.
scan_pattern_strict() { # regex label
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

# Stellar secret seed: S + 55 base32 characters.
# Public keys (G...), contract ids (C...) and muxed accounts (M...) are safe and
# are not scanned.
scan_pattern_strict '\bS[A-Z2-7]{55}\b' 'Stellar SECRET SEED (S...) detected'

# PEM private key blocks
scan_pattern_strict 'BEGIN [A-Z ]*PRIVATE KEY' 'PEM private key block'

# GitHub tokens
scan_pattern_strict '\bgh[pousr]_[A-Za-z0-9]{30,}\b'      'GitHub token (ghp_/gho_/ghu_/ghs_/ghr_)'
scan_pattern_strict '\bgithub_pat_[A-Za-z0-9_]{20,}\b'    'GitHub fine-grained PAT'

# A real-looking value assigned to a secret-named variable
scan_pattern '(VERIFIER_(SECRET|SEED|PRIVATE_KEY)|SESSION_SECRET|NEXTAUTH_SECRET|GITHUB_CLIENT_SECRET|[A-Z0-9_]*(SECRET|PRIVATE_KEY|SEED|PASSWORD|TOKEN))[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9+/=_.\-]{16,}' \
  'Real value assigned to a secret-named variable'

# Password inside a Postgres connection string
scan_pattern 'postgres(ql)?://[^:@/[:space:]]+:[^@[:space:]]+@' 'Password inside a Postgres URL'

# Leaking a secret through NEXT_PUBLIC_ — it enters the client bundle.
# Careful: NEXT_PUBLIC_VERIFIER_PUBLIC_KEY is legitimate (a public key is meant
# to be shared), so "VERIFIER" alone is not enough; we look for
# SECRET/SEED/PRIVATE.
scan_pattern_strict 'NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PRIVATE_KEY|_SEED|PASSWORD|PASSWD)' \
  'Secret defined via NEXT_PUBLIC_ — it enters the browser bundle'

# The base64 form of a 32-byte ed25519 secret (44 characters, ends with =)
# Note: 64-digit hex is deliberately not scanned — the identity_key test vectors
# (sha256) are also 64 hex and would fire false alarms constantly.
scan_pattern '(secret|seed|private)[A-Za-z_]*[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9+/]{43}=["'"'"']' \
  'base64-encoded 32-byte secret'

echo
if [ "$FAIL" -ne 0 ]; then
  cat <<'MSG'
────────────────────────────────────────────────────────────────────────
COMMIT BLOCKED.

This repo will be PUBLIC on delivery. Git history cannot be undone: once a
secret is committed, it stays in history even if you delete it in the next
commit.

What to do:
  1. Take the value out of the file and put process.env.X in its place
  2. Write the real value into .env.local (which is gitignored)
  3. For deploys use Vercel > Settings > Environment Variables
  4. Add only a placeholder to .env.example

If you are certain this is a false alarm, append this to the end of the line:
  # paytag-allow-secret
────────────────────────────────────────────────────────────────────────
MSG
  exit 1
fi

printf "%s✓ Secret scan clean (%d files, mode: %s)%s\n" "$GRN" "$NFILES" "$MODE" "$OFF"
exit 0
