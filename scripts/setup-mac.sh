#!/usr/bin/env bash
# Paytag — Mac development environment setup (Phase 0)
# One-off. Requires network access.
#
# This script never prints a secret key. The testnet key is stored in the macOS
# Keychain and never lands on disk in plaintext.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

say() { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }
warn() { printf "\033[1;33m!  %s\033[0m\n" "$1"; }

say "1/7 Git hooks — secret leak protection"
git config core.hooksPath .githooks
chmod +x .githooks/* scripts/*.sh
echo "core.hooksPath = $(git config core.hooksPath)"
echo "pre-commit and pre-push now scan for secrets on every commit/push."
# macOS still ships bash 3.2 (2007). The hook scripts were written for it;
# we print the version here purely for information, so that if an
# incompatibility does show up the error message is not context-free.
echo "hook shell: $(/bin/bash --version | head -1)"

say "2/7 Rust toolchain"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

# rust-docs (~23 MB) is unused in this project. On a slow or flaky connection
# the download stalls halfway and rustup reports:
#   could not rename downloaded file from '...partial' to '...'
# The minimal profile never downloads rust-docs at all; that removes the source
# of the problem.
#
# CAREFUL: `rustup set profile minimal` only affects NEW toolchain installs.
# `rustup update` preserves the recorded component list of the existing
# toolchain — if it was installed with the default profile earlier, rust-docs
# gets downloaded again. That is why the fallback below goes through
# uninstall + install.
RUSTUP_DIR="${RUSTUP_HOME:-$HOME/.rustup}"
rustup set profile minimal

# On a slow connection the default 180 s download timeout is not enough and the
# transfer breaks off with "error decoding response body". The 27 MB rust-std
# takes 10 minutes at 50 KB/s; we raise the limit accordingly.
export RUSTUP_DOWNLOAD_TIMEOUT="${RUSTUP_DOWNLOAD_TIMEOUT:-900}"

# Half-finished .partial files can cause permanent corruption — delete ONLY
# those. Wiping the whole `downloads` directory was wrong: rustup caches
# completed components there under their sha256 name and reuses them. Blowing
# the directory away makes a slow link re-download tens of MB on every attempt.
purge_partials() {
  [ -d "$RUSTUP_DIR/downloads" ] || return 0
  find "$RUSTUP_DIR/downloads" -name '*.partial' -delete 2>/dev/null || true
  rm -rf "$RUSTUP_DIR/tmp"
}
purge_partials

# Long transfers are throttled on this link (400 KB/s for the manifest, 40 KB/s
# for the 65 MB rustc). prefetch-rust.sh pulls the tarballs with parallel byte
# ranges and puts them into rustup's cache; rustup then downloads nothing.
if [ -x scripts/prefetch-rust.sh ]; then
  ./scripts/prefetch-rust.sh || warn "prefetch did not complete — rustup will continue with its own downloader (may be slow)"
fi

if ! rustup update stable; then
  warn "rustup update failed. Cleaning up partial files and retrying with the minimal profile."
  warn "Completed components stay in the cache — they will not be downloaded again."
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

say "4/7 gitleaks (for history scanning)"
if ! command -v gitleaks >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install gitleaks
  else
    warn "could not install gitleaks (no brew). CI will still scan."
  fi
fi

say "5/7 Node + pnpm"
command -v node >/dev/null 2>&1 || { echo "Install Node 22+: https://nodejs.org"; exit 1; }
command -v pnpm >/dev/null 2>&1 || npm install -g pnpm

say "6/7 Testnet identity — in the macOS Keychain"
stellar network use testnet >/dev/null 2>&1 || true
if stellar keys ls 2>/dev/null | grep -qx "paytag-dev"; then
  echo "paytag-dev already exists."
else
  # --secure-store: the seed goes into the macOS Keychain, it is NOT WRITTEN to
  # ~/.config/stellar in plaintext
  stellar keys generate paytag-dev --network testnet --fund --secure-store
fi
stellar keys fund paytag-dev --network testnet >/dev/null 2>&1 || true
ADDR="$(stellar keys address paytag-dev)"   # the PUBLIC address only
echo "paytag-dev public address: $ADDR"
warn "Never run 'stellar keys show' — it drops the secret into your terminal history."

say "7/7 Evidence: toolchain versions"
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
  echo "gitleaks: $(command -v gitleaks >/dev/null 2>&1 && gitleaks version || echo 'not installed')"
  echo
  echo "identity: paytag-dev (public) = $ADDR"
  echo "          secret -> macOS Keychain, no plaintext in the repo or on disk"
} > docs/evidence/toolchain.txt
cat docs/evidence/toolchain.txt

say "Verification"
./scripts/test-scan-secrets.sh
./scripts/scan-secrets.sh --tree
(cd contracts && cargo test)

say "Done. Next step: cp .env.example web/.env.local && git push -u origin develop"
