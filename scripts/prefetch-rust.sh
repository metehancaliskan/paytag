#!/usr/bin/env bash
# Paytag — prefetches the Rust toolchain tarballs with parallel byte ranges.
#
# PROBLEM:
# Long transfers are throttled on this link. Within the same rustup run, the
# 826 KB manifest comes down at 399 KB/s while the 8.5 MB cargo drops to
# 35 KB/s. So the problem is not rustup's downloader; the throttle depends on
# size/duration. At that speed the 65 MB rustc takes 25+ minutes and breaks off
# frequently.
#
# SOLUTION:
# The throttle is usually applied PER TCP connection. This script splits each
# file into chunks with HTTP Range and fetches them over parallel connections;
# total throughput is multiplied by the connection count. If the throttle is
# global instead, nothing is lost — it stays the same.
#
# SECURITY:
# rustup stores every file it downloads under $RUSTUP_HOME/downloads named by
# its SHA256 hex; at install time, if it finds a correctly named file in that
# directory it VERIFIES the hash and skips the download (rustup
# src/dist/download.rs). This script also verifies the SHA256 of the file it
# assembled against the official manifest and does not put it in the cache on a
# mismatch. The verification happens a second time on the rustup side.
#
# PORTABILITY: works with macOS bash 3.2 (no mapfile / declare -A).
set -uo pipefail

TARGET_HOST="${PAYTAG_RUST_HOST:-aarch64-apple-darwin}"
EXTRA_TARGET="${PAYTAG_RUST_WASM:-wasm32v1-none}"
DIST="${RUSTUP_DIST_SERVER:-https://static.rust-lang.org}"
CHUNKS="${PAYTAG_CHUNKS:-8}"          # parallel connections per file
CHUNK_MIN=$((2 * 1024 * 1024))        # do not split files smaller than 2 MB

RUSTUP_DIR="${RUSTUP_HOME:-$HOME/.rustup}"
DL="$RUSTUP_DIR/downloads"
WORK="$DL/.paytag-prefetch"           # partial chunks live here and get reused

RED=$'\033[0;31m'; YEL=$'\033[1;33m'; GRN=$'\033[0;32m'; CYA=$'\033[1;36m'; DIM=$'\033[2m'; OFF=$'\033[0m'
say()  { printf "\n%s==> %s%s\n" "$CYA" "$1" "$OFF"; }
warn() { printf "%s!  %s%s\n" "$YEL" "$1" "$OFF"; }
die()  { printf "%s✖ %s%s\n" "$RED" "$1" "$OFF"; exit 1; }

if command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'; }
elif command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }
else
  die "no sha256 tool (shasum or sha256sum required)."
fi

mkdir -p "$WORK" || die "could not create $WORK"
TMP="$(mktemp -d)" || die "could not create a temporary directory"
trap 'rm -rf "$TMP"' EXIT

# ---------------------------------------------------------------- manifest --
say "1/4 Manifest"
MANIFEST="$TMP/channel.toml"
curl -fsS --retry 3 --retry-delay 2 -o "$MANIFEST" "$DIST/dist/channel-rust-stable.toml" \
  || die "could not download the manifest ($DIST)"
# Take the version from the [pkg.rustc] section. The FIRST `version =` line in
# the manifest belongs to cargo (e.g. 0.98.0) and gets mistaken for the Rust
# version.
pkg_version() { # package
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
printf "  rustc = %s\n" "${RUSTV:-unknown}"

field_of() { # package target field
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

# --------------------------------------------- find out rustup's preference --
# rustup picks one of the zst / xz / gz variants. Instead of guessing which one
# it picked, we MEASURE it: we look at which variant hash a previously and
# successfully downloaded component sits under in the cache.
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
  printf "  format rustup uses, detected from the cache: %s\n" "$PREFER"
else
  PREFER="xz"
  printf "  cache is empty; default format: %s\n" "$PREFER"
fi

url_hash_of() { # package target -> "url hash" (in the preferred format)
  local pkg="$1" tgt="$2" u h
  if [ "$PREFER" = "gz" ]; then
    u="$(field_of "$pkg" "$tgt" url)";            h="$(field_of "$pkg" "$tgt" hash)"
  else
    u="$(field_of "$pkg" "$tgt" "${PREFER}_url")"; h="$(field_of "$pkg" "$tgt" "${PREFER}_hash")"
  fi
  if [ -z "$u" ] || [ -z "$h" ]; then   # fall back to xz if the preferred format is missing
    u="$(field_of "$pkg" "$tgt" xz_url)"; h="$(field_of "$pkg" "$tgt" xz_hash)"
  fi
  [ -n "$u" ] && [ -n "$h" ] || return 1
  printf '%s %s\n' "$u" "$h"
}

# ------------------------------------------------------- component list --
say "2/4 Resolving components ($TARGET_HOST)"

WANT="rustc:$TARGET_HOST
cargo:$TARGET_HOST
rust-std:$TARGET_HOST
rust-std:$EXTRA_TARGET"

# rustfmt/clippy appear in the manifest with a -preview suffix
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
    warn "$pkg / $tgt is not in the manifest — skipping"
    continue
  fi
  u="${info%% *}"; h="${info##* }"
  if [ -f "$DL/$h" ] && [ "$(sha256_of "$DL/$h")" = "$h" ]; then
    printf "  %s✓%s %-22s %-22s already cached\n" "$GRN" "$OFF" "$pkg" "$tgt"
    continue
  fi
  printf "  %s↓%s %-22s %-22s\n" "$YEL" "$OFF" "$pkg" "$tgt"
  printf '%s%s%s%s%s%s%s\n' "$pkg" "$TAB" "$tgt" "$TAB" "$u" "$TAB" "$h" >> "$PLAN"
done
IFS="$OLDIFS"

if [ ! -s "$PLAN" ]; then
  say "Everything is cached — nothing to download."
else

# ------------------------------------------------------- parallel download ---
say "3/4 Parallel download ($CHUNKS connections/file)"

fetch_one() { # url hash pkg tgt
  local url="$1" hash="$2" pkg="$3" tgt="$4"
  local len ranges i start end out pids rc n

  # Content-Length and Range support
  # NOTE: awk's IGNORECASE is gawk-specific; macOS's BSD awk does not have it.
  # That is why we match with POSIX-compatible tolower().
  len="$(curl -fsSI --retry 2 "$url" 2>/dev/null \
        | awk 'tolower($0) ~ /^content-length:/ { v=$2; gsub(/[\r\n ]/,"",v); print v }' | tail -1)"

  case "$len" in ''|*[!0-9]*) len=0 ;; esac

  n="$CHUNKS"
  [ "$len" -lt "$CHUNK_MIN" ] && n=1
  [ "$len" -eq 0 ] && n=1

  printf "  %s (%s) — %s MB, %s chunks\n" "$pkg" "$tgt" \
    "$( [ "$len" -gt 0 ] && echo $((len / 1048576)) || echo '?' )" "$n"

  pids=""; rc=0
  i=0
  while [ "$i" -lt "$n" ]; do
    out="$WORK/$hash.part$i"
    if [ "$n" -eq 1 ]; then
      # single chunk: no range
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
      # do not re-download a completed chunk
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
  [ "$rc" -eq 0 ] || { warn "one of the chunks of $pkg ($tgt) did not download"; return 1; }

  # join
  : > "$TMP/$hash.joined"
  i=0
  while [ "$i" -lt "$n" ]; do
    cat "$WORK/$hash.part$i" >> "$TMP/$hash.joined" || return 1
    i=$((i + 1))
  done

  got="$(sha256_of "$TMP/$hash.joined")"
  if [ "$got" != "$hash" ]; then
    warn "$pkg ($tgt) SHA256 mismatch — deleting the chunks, will retry"
    printf "   %sexpected %s%s\n   %sgot      %s%s\n" "$DIM" "$hash" "$OFF" "$DIM" "$got" "$OFF"
    rm -f "$WORK/$hash".part* "$TMP/$hash.joined"
    return 1
  fi

  mv "$TMP/$hash.joined" "$DL/$hash" || return 1
  rm -f "$WORK/$hash".part*
  printf "  %s✓ %s (%s) verified and put in the cache%s\n" "$GRN" "$pkg" "$tgt" "$OFF"
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
  warn "These did not complete:$FAILED"
  warn "Run the script again — completed chunks are kept, it resumes where it left off."
  exit 1
fi
fi

# ------------------------------------------------------------------- done ---
say "4/4 Ready"
cat <<MSG
rustup will not download these files again; it will read them from the cache
and install them after verifying their hashes.

Next step:
  ${CYA}./scripts/setup-mac.sh${OFF}

If it still downloads for a long time, rustup has picked a compression format
other than the one we expected — share the output and we will change the
PAYTAG format.
MSG
