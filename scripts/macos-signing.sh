#!/usr/bin/env bash
# Used only by the macOS release job; GITHUB_ENV carries the temporary path between steps.
set -euo pipefail

case "${1:-}" in
  setup)
    umask 077
    original_keychains=$(security list-keychains -d user)
    signing_dir=$(mktemp -d "$RUNNER_TEMP/alwith-u-signing.XXXXXX")
    echo "ALWITH_SIGNING_DIR=$signing_dir" >> "$GITHUB_ENV"
    printf '%s\n' "$original_keychains" > "$signing_dir/keychains.txt"
    printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$signing_dir/certificate.p12"
    keychain="$signing_dir/release.keychain-db"
    keychain_password=$(openssl rand -hex 32)
    security create-keychain -p "$keychain_password" "$keychain"
    security unlock-keychain -p "$keychain_password" "$keychain"
    security set-keychain-settings -lut 21600 "$keychain"
    keychains=()
    while read -r item; do
      item=${item#\"}
      keychains+=("${item%\"}")
    done < "$signing_dir/keychains.txt"
    security list-keychains -d user -s "$keychain" "${keychains[@]}"
    security import "$signing_dir/certificate.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" > /dev/null
    ;;
  cleanup)
    case "$ALWITH_SIGNING_DIR" in
      "$RUNNER_TEMP"/alwith-u-signing.*) ;;
      *) echo "Unexpected signing directory" >&2; exit 1 ;;
    esac
    status=0
    keychains=()
    if [[ -f "$ALWITH_SIGNING_DIR/keychains.txt" ]]; then
      while read -r item; do
        item=${item#\"}
        keychains+=("${item%\"}")
      done < "$ALWITH_SIGNING_DIR/keychains.txt"
      security list-keychains -d user -s "${keychains[@]}" || status=1
    fi
    if [[ -f "$ALWITH_SIGNING_DIR/release.keychain-db" ]]; then
      security delete-keychain "$ALWITH_SIGNING_DIR/release.keychain-db" || status=1
    fi
    rm -f "$ALWITH_SIGNING_DIR/certificate.p12" "$ALWITH_SIGNING_DIR/keychains.txt" || status=1
    rmdir "$ALWITH_SIGNING_DIR" || status=1
    exit "$status"
    ;;
  *)
    echo "Usage: bash scripts/macos-signing.sh <setup|cleanup>" >&2
    exit 1
    ;;
esac
