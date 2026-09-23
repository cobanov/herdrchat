#!/usr/bin/env bash
# Build a signed Android release (App Bundle for Play, APK for sideloading) and,
# with a service-account key, upload the bundle to a Play track.
#
# The Android counterpart of scripts/testflight.sh (#4). Signing uses the Play
# upload key through plugins/withReleaseSigning.js; this script refuses to call
# anything a release unless both outputs are signed with THAT key, because
# without credentials Gradle quietly signs with the debug key and Play's
# rejection does not say why.
#
# Credentials, from the environment:
#   HERDRCHAT_STORE_FILE       default ~/.herdrchat/upload-keystore.jks
#   HERDRCHAT_STORE_PASSWORD   default: read from the login Keychain
#                              (account herdrchat, service herdrchat-upload-key)
#   HERDRCHAT_KEY_ALIAS        default upload
#   HERDRCHAT_PLAY_KEY         service-account JSON; without it, no upload
#   PLAY_TRACK                 default internal
#
# Usage:
#   scripts/android-release.sh              # build, verify, upload if a Play key is set
#   scripts/android-release.sh --no-upload  # stop after the verified files
set -euo pipefail

cd "$(dirname "$0")/.."

: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
: "${ANDROID_HOME:=/opt/homebrew/share/android-commandlinetools}"
: "${LANG:=en_US.UTF-8}"
export JAVA_HOME ANDROID_HOME LANG

export HERDRCHAT_STORE_FILE="${HERDRCHAT_STORE_FILE:-$HOME/.herdrchat/upload-keystore.jks}"
export HERDRCHAT_KEY_ALIAS="${HERDRCHAT_KEY_ALIAS:-upload}"
if [[ -z "${HERDRCHAT_STORE_PASSWORD:-}" ]]; then
  if ! HERDRCHAT_STORE_PASSWORD=$(security find-generic-password -a herdrchat -s herdrchat-upload-key -w 2>/dev/null); then
    echo "ERROR: no HERDRCHAT_STORE_PASSWORD, and the Keychain would not give it up." >&2
    echo "       In an SSH session, run 'security unlock-keychain' first, or export the password." >&2
    exit 1
  fi
fi
export HERDRCHAT_STORE_PASSWORD
[[ -f "$HERDRCHAT_STORE_FILE" ]] || { echo "ERROR: no keystore at $HERDRCHAT_STORE_FILE" >&2; exit 1; }

# The certificate the outputs must carry. Compared by SHA-256, not by "is it
# signed": a debug-signed bundle is signed too.
normalize() { tr -d ': ' | tr '[:lower:]' '[:upper:]'; }
UPLOAD_CERT=$(keytool -exportcert -rfc -keystore "$HERDRCHAT_STORE_FILE" -alias "$HERDRCHAT_KEY_ALIAS" \
  -storepass:env HERDRCHAT_STORE_PASSWORD 2>/dev/null | openssl x509 -noout -fingerprint -sha256 | cut -d= -f2 | normalize)
[[ -n "$UPLOAD_CERT" ]] || { echo "ERROR: could not read alias '$HERDRCHAT_KEY_ALIAS' from the keystore." >&2; exit 1; }

VERSION=$(node -p "require('./app.json').expo.version")
CODE=$(node -p "require('./app.json').expo.android.versionCode")

echo "==> Regenerating android/ for $VERSION ($CODE)"
npx expo prebuild --clean -p android --no-install >/dev/null

echo "==> Building the App Bundle and the APK"
# Gradle keeps a previous output when only the signing inputs changed; start clean.
rm -rf android/app/build/outputs
(cd android && ./gradlew -q :app:bundleRelease :app:assembleRelease)

AAB=android/app/build/outputs/bundle/release/app-release.aab
APK=android/app/build/outputs/apk/release/app-release.apk
APKSIGNER=$(ls "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -n 1)
signer_of() {
  # A bundle carries a JAR signature; a release APK for this minSdk only the
  # v2/v3 scheme, which keytool cannot read.
  case "$1" in
    *.aab) keytool -printcert -jarfile "$1" 2>/dev/null | awk '/SHA256:/ {print $2; exit}' | normalize ;;
    *.apk) "$APKSIGNER" verify --print-certs "$1" 2>/dev/null | awk -F': ' '/certificate SHA-256 digest/ {print $2; exit}' | normalize ;;
  esac
}
for file in "$AAB" "$APK"; do
  [[ -f "$file" ]] || { echo "ERROR: $file was not produced." >&2; exit 1; }
  signer=$(signer_of "$file")
  if [[ "$signer" != "$UPLOAD_CERT" ]]; then
    echo "ERROR: $file is not signed with the upload key (got ${signer:-no signature})." >&2
    exit 1
  fi
done
echo "   signed with the upload key ($UPLOAD_CERT)"

mkdir -p dist
cp "$AAB" "dist/HerdrChat-$VERSION-b$CODE.aab"
cp "$APK" "dist/HerdrChat-$VERSION-b$CODE.apk"
ls -lh dist/HerdrChat-"$VERSION"-b"$CODE".*

if [[ "${1:-}" == "--no-upload" ]]; then
  echo "==> --no-upload: stopping before Play."
  exit 0
fi
if [[ -z "${HERDRCHAT_PLAY_KEY:-}" ]]; then
  echo "==> No HERDRCHAT_PLAY_KEY, so no upload. The signed files are in dist/."
  exit 0
fi
TRACK="${PLAY_TRACK:-internal}"
echo "==> Uploading to Play, track '$TRACK'"
python3 scripts/play-upload.py "dist/HerdrChat-$VERSION-b$CODE.aab" --key "${HERDRCHAT_PLAY_KEY/#\~/$HOME}" --track "$TRACK"
