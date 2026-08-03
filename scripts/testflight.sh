#!/usr/bin/env bash
# Archive → export → upload the Expo app to TestFlight, using an App Store
# Connect API key (no interactive Apple ID / 2FA needed).
#
# The predecessor of this script, which shipped the SwiftUI app, is
# scripts/legacy-testflight.sh. Both target the SAME bundle id, so whichever
# ships last is what testers get.
#
# Prereqs (already true on this machine):
#   - Full Xcode, ASC API key at ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8
#   - An App Store Connect app record for the bundle id in app.json
#
# Usage:
#   APPLE_TEAM_ID=<team> ASC_KEY_ID=<key> ASC_ISSUER_ID=<uuid> scripts/testflight.sh
#   ... scripts/testflight.sh --no-upload   # stop at the .ipa
#
# See RELEASING.md.
#
# NOTE: TestFlight rate-limits uploads per app per day (altool 90382). Bump the
# build number on every change so commits stay honest, but batch the uploads.
set -euo pipefail

cd "$(dirname "$0")/.."

SCHEME="HerdrChat"
# Account-specific, so they come from the environment. A fork must not silently
# try to sign against someone else's Apple team.
TEAM_ID="${APPLE_TEAM_ID:?set APPLE_TEAM_ID (Apple Developer > Membership)}"
KEY_ID="${ASC_KEY_ID:?set ASC_KEY_ID (App Store Connect API key id)}"
PROFILE_NAME="${ASC_PROFILE_NAME:-HerdrChat App Store}"
KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
BUILD_DIR="build"
ARCHIVE="$BUILD_DIR/HerdrChat.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
IPA="$EXPORT_DIR/HerdrChat.ipa"
PLIST="$BUILD_DIR/ExportOptions.plist"

if [[ -z "${ASC_ISSUER_ID:-}" ]]; then
  echo "ERROR: set ASC_ISSUER_ID (App Store Connect > Users and Access > Integrations)." >&2
  exit 1
fi
if [[ ! -f "$KEY_PATH" ]]; then
  echo "ERROR: API key not found at $KEY_PATH" >&2
  exit 1
fi

AUTH=(-allowProvisioningUpdates
      -authenticationKeyPath "$KEY_PATH"
      -authenticationKeyID "$KEY_ID"
      -authenticationKeyIssuerID "$ASC_ISSUER_ID")

BUNDLE_ID=$(node -p "require('./app.json').expo.ios.bundleIdentifier")
VERSION=$(node -p "require('./app.json').expo.version")
BUILD_NUMBER=$(node -p "require('./app.json').expo.ios.buildNumber")

# ios/ is generated, so regenerate it rather than trusting whatever is on disk.
# This is also what applies any app.json change since the last run.
echo "==> Prebuilding ios/ from app.json ($VERSION build $BUILD_NUMBER)…"
npx expo prebuild --platform ios --clean

rm -rf "$ARCHIVE" "$EXPORT_DIR"
mkdir -p "$BUILD_DIR"

echo "==> Archiving (Release)…"
xcodebuild archive \
  -workspace "ios/${SCHEME}.xcworkspace" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  COMPILER_INDEX_STORE_ENABLE=NO \
  "${AUTH[@]}"

# MANUAL signing, not cloud. This machine's ASC key lacks the role cloud
# signing needs, so `-exportArchive` fails with "Cloud signing permission
# error / No profiles were found" even though the archive signed fine. The
# distribution certificate and the "HerdrChat App Store" profile are already
# installed locally (see scripts/legacy-dist-signing.sh, which created them);
# naming them explicitly sidesteps the cloud path entirely.
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key><string>app-store-connect</string>
    <key>teamID</key><string>${TEAM_ID}</string>
    <key>signingStyle</key><string>manual</string>
    <key>signingCertificate</key><string>Apple Distribution</string>
    <key>provisioningProfiles</key>
    <dict>
        <key>${BUNDLE_ID}</key><string>${PROFILE_NAME}</string>
    </dict>
    <key>destination</key><string>export</string>
    <key>uploadSymbols</key><true/>
    <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
EOF

echo "==> Exporting signed .ipa…"
# No auth key here: passing it re-engages the cloud-signing path the manual
# ExportOptions above exists to avoid.
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$PLIST"

echo "==> Built: $IPA"
ls -lh "$IPA"

# The dev launcher must not be in a TestFlight build: it would put a server
# picker in front of the app on a tester's phone. Expo disables it in Release,
# and this is the guard that proves it did — the same class of check the legacy
# script ran for aps-environment.
echo "==> Verifying the dev launcher is not embedded…"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q -o "$IPA" -d "$WORK"
APP="$(/bin/ls -d "$WORK"/Payload/*.app | head -1)"
if [[ -d "$APP/EXDevLauncher.bundle" ]]; then
  echo "ERROR: EXDevLauncher.bundle is inside the .ipa — this is not a release build." >&2
  exit 1
fi
# The SSH module is the app: without it there is no transport and every screen
# is an error state. Autolinking is silent when it doesn't happen, so prove the
# native side AND the JS side both made it in. (Hermes bytecode keeps its string
# table as one blob, so this must be a substring search, not a line match.)
#
# The needle is the registered CLASS name, not a message. An earlier version of
# this check looked for an error string from the host-key path and started
# failing on a clean build — the Swift optimiser is free to fold a literal that
# only appears in one error branch, so a message is not an invariant. The class
# name is: `expo-module.config.json` names it, and the module cannot resolve at
# runtime without it.
# `grep -c`, not `grep -q`. Under `set -o pipefail`, `grep -q` exits the moment
# it matches, `strings` then dies of SIGPIPE, and the pipeline reports 141 — so
# `if ! ...` fires exactly when the string WAS found. That inverted guard failed
# two good builds before the cause was spotted. `-c` consumes all input.
if [ "$(strings -a "$APP/$SCHEME" | grep -cF "HerdrSshModule")" -eq 0 ]; then
  echo "ERROR: the native SSH module is not in the binary." >&2
  exit 1
fi
if [ "$(strings -a "$APP/main.jsbundle" | grep -cF "HerdrSsh")" -eq 0 ]; then
  echo "ERROR: the JS bundle never references the HerdrSsh module." >&2
  exit 1
fi

BUILT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Info.plist")"
BUILT_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Info.plist")"
if [[ "$BUILT_VERSION" != "$VERSION" || "$BUILT_BUILD" != "$BUILD_NUMBER" ]]; then
  echo "ERROR: built $BUILT_VERSION($BUILT_BUILD), expected $VERSION($BUILD_NUMBER)." >&2
  echo "       app.json and the archive disagree — prebuild probably didn't run." >&2
  exit 1
fi
echo "   ✓ release build, $BUILT_VERSION ($BUILT_BUILD)"

if [[ "${1:-}" == "--no-upload" ]]; then
  echo "==> --no-upload set; skipping the TestFlight upload."
  exit 0
fi

echo "==> Validating with App Store Connect…"
xcrun altool --validate-app -f "$IPA" -t ios \
  --apiKey "$KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "==> Uploading to TestFlight…"
xcrun altool --upload-app -f "$IPA" -t ios \
  --apiKey "$KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "==> Done. The build appears in App Store Connect → TestFlight in a few minutes."
