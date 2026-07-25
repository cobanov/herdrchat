#!/usr/bin/env bash
# Build a signed Android App Bundle and upload it to a Google Play track.
#
# The Android counterpart of scripts/testflight.sh. Play requires App Bundles for
# new apps, so this runs `bundleRelease`, not `assembleDebug` — a debug APK cannot
# be published no matter which track you aim at.
#
# Prereqs (one-time; see PlayRelease/README.md):
#   - upload keystore + HERDRCHAT_STORE_* credentials, via android/keystore.properties
#     or the environment
#   - the app created once by hand in the Play Console (the API cannot create it)
#   - a service-account JSON key with "Release manager" on the app
#
# Usage:
#   HERDRCHAT_PLAY_KEY=~/.herdrchat/play-service-account.json scripts/play.sh
#   scripts/play.sh --no-upload           # stop after producing the .aab
#   PLAY_TRACK=alpha scripts/play.sh      # default track is `internal`
set -euo pipefail

cd "$(dirname "$0")/.."

: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
: "${ANDROID_HOME:=/opt/homebrew/share/android-commandlinetools}"
export JAVA_HOME ANDROID_HOME
TRACK="${PLAY_TRACK:-internal}"
AAB="android/app/build/outputs/bundle/release/app-release.aab"

# Upload-key credentials. The password lives in the macOS Keychain rather than any
# file, so nothing secret sits on disk in or beside the repo; it is read here and
# passed to Gradle through the environment. Anything already exported wins, which
# is how CI (or a non-mac machine) supplies its own.
: "${HERDRCHAT_STORE_FILE:=$HOME/.herdrchat/upload-keystore.jks}"
: "${HERDRCHAT_KEY_ALIAS:=upload}"
if [[ -z "${HERDRCHAT_STORE_PASSWORD:-}" ]] && command -v security >/dev/null 2>&1; then
  HERDRCHAT_STORE_PASSWORD=$(
    security find-generic-password -a herdrchat -s herdrchat-upload-key -w 2>/dev/null || true
  )
fi
export HERDRCHAT_STORE_FILE HERDRCHAT_KEY_ALIAS HERDRCHAT_STORE_PASSWORD

if [[ ! -f "$HERDRCHAT_STORE_FILE" ]]; then
  echo "ERROR: no upload keystore at $HERDRCHAT_STORE_FILE" >&2
  echo "       See PlayRelease/README.md → 'Upload key'." >&2
  exit 1
fi
if [[ -z "${HERDRCHAT_STORE_PASSWORD:-}" ]]; then
  echo "ERROR: the upload-key password isn't in the Keychain and isn't exported." >&2
  echo "       Expected Keychain item: account 'herdrchat', service" >&2
  echo "       'herdrchat-upload-key'. See PlayRelease/README.md." >&2
  exit 1
fi

echo "==> Building the release App Bundle…"
# Delete the previous bundle first. Gradle's up-to-date check does NOT notice that
# the signing config changed, so an earlier UNSIGNED build gets reused verbatim and
# the signing guard below then fails on a bundle that would sign fine — measured,
# not hypothetical. Removing the output makes the task genuinely re-run, and also
# guarantees we can never upload a stale bundle from an older versionCode.
rm -f "$AAB"
android/gradlew -p android :app:bundleRelease -q

[[ -f "$AAB" ]] || { echo "ERROR: $AAB was not produced." >&2; exit 1; }

# Prove the bundle is actually SIGNED before going near the network. Without the
# upload credentials `bundleRelease` happily produces an UNSIGNED bundle, and
# Play's rejection doesn't say that's why — the same class of trap the
# aps-environment guard covers on the iOS side.
echo "==> Verifying the bundle is signed…"
if ! unzip -l "$AAB" | grep -qE 'META-INF/.*\.(RSA|DSA|EC)$'; then
  echo "ERROR: $AAB is NOT signed." >&2
  echo "       Set HERDRCHAT_STORE_FILE / HERDRCHAT_STORE_PASSWORD (see" >&2
  echo "       PlayRelease/README.md) and re-run — an unsigned bundle cannot be" >&2
  echo "       published, and Play's error won't tell you this is the reason." >&2
  exit 1
fi
echo "   ✓ signed"

VERSION_CODE=$(grep -oE 'versionCode = [0-9]+' android/app/build.gradle.kts | grep -oE '[0-9]+')
VERSION_NAME=$(grep -oE 'versionName = "[^"]+"' android/app/build.gradle.kts | cut -d'"' -f2)
ls -lh "$AAB"
echo "==> Built $VERSION_NAME (versionCode $VERSION_CODE)"

if [[ "${1:-}" == "--no-upload" ]]; then
  echo "==> --no-upload set; skipping the Play upload."
  exit 0
fi

if [[ -z "${HERDRCHAT_PLAY_KEY:-}" ]]; then
  echo "ERROR: set HERDRCHAT_PLAY_KEY to the service-account JSON key path." >&2
  echo "       See PlayRelease/README.md → 'Service account'." >&2
  exit 1
fi

echo "==> Uploading to the '$TRACK' track…"
python3 scripts/play-upload.py "$AAB" --key "${HERDRCHAT_PLAY_KEY/#\~/$HOME}" --track "$TRACK"
echo "==> Done. Testers on '$TRACK' get it within minutes (no review on internal)."
