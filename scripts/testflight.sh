#!/usr/bin/env bash
# Archive → export → upload HerdrChat to TestFlight using an App Store Connect
# API key (no interactive Apple ID / 2FA needed).
#
# Prereqs (already true on this machine):
#   - Full Xcode installed, ASC API key at ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8
#   - Bundle id dev.herdr.HerdrChat; team 6U58AKY6F8
#
# Usage:
#   ASC_ISSUER_ID=<uuid> scripts/testflight.sh            # full: archive + export + upload
#   ASC_ISSUER_ID=<uuid> scripts/testflight.sh --no-upload # stop after producing the .ipa
#
# Env overrides: ASC_KEY_ID (default RQ96AFW6H2), BUILD_NUMBER (default: auto date-based).
set -euo pipefail

cd "$(dirname "$0")/.."

# The SwiftUI app now lives under legacy/ios/ (the shipping stack is being
# rewritten on the Expo branch); paths below are repo-root relative.
LEGACY_IOS="legacy/ios"
SCHEME="HerdrChat"
PROJECT="$LEGACY_IOS/HerdrChat.xcodeproj"
TEAM_ID="6U58AKY6F8"
KEY_ID="${ASC_KEY_ID:-RQ96AFW6H2}"
KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
BUILD_DIR="$LEGACY_IOS/build"
ARCHIVE="$BUILD_DIR/HerdrChat.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
IPA="$EXPORT_DIR/HerdrChat.ipa"

if [[ -z "${ASC_ISSUER_ID:-}" ]]; then
  echo "ERROR: set ASC_ISSUER_ID (App Store Connect > Users and Access > Integrations > API key issuer ID)." >&2
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

# Ensure the .xcodeproj matches project.yml.
if command -v xcodegen >/dev/null 2>&1; then
  (cd "$LEGACY_IOS" && xcodegen generate >/dev/null)
fi

rm -rf "$ARCHIVE" "$EXPORT_DIR"
mkdir -p "$BUILD_DIR"

echo "==> Archiving (Release, generic iOS device)…"
xcodebuild archive \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  "${AUTH[@]}" \
  COMPILER_INDEX_STORE_ENABLE=NO

echo "==> Exporting signed .ipa…"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$LEGACY_IOS/ExportOptions.plist" \
  "${AUTH[@]}"

echo "==> Built: $IPA"
ls -lh "$IPA"

# Prove aps-environment=production survived into the SIGNED binary. A build whose
# entitlement is 'development' emits a sandbox APNs token, which the host push
# watcher (production, api.push.apple.com) would get rejected as BadDeviceToken.
# Guards the class of regression where a config-level entitlement doesn't make it
# into the signed app. (Lesson from the cmux review.)
echo "==> Verifying signed aps-environment=production…"
APS_WORK="$(mktemp -d)"
unzip -q -o "$IPA" -d "$APS_WORK"
APS_APP="$(/bin/ls -d "$APS_WORK"/Payload/*.app 2>/dev/null | head -1)"
# Entitlements print as a single XML line, so parse the plist properly.
APS_ENV="$(codesign -d --entitlements :- "$APS_APP" 2>/dev/null | plutil -extract aps-environment raw -o - - 2>/dev/null)"
rm -rf "$APS_WORK"
if [[ "$APS_ENV" != "production" ]]; then
  echo "ERROR: signed aps-environment is '${APS_ENV:-<missing>}', expected 'production'." >&2
  echo "       Push tokens from this build would be rejected by prod APNs. Check $LEGACY_IOS/App/HerdrChat.entitlements + the profile." >&2
  exit 1
fi
echo "   ✓ aps-environment=production confirmed in the signed binary"

if [[ "${1:-}" == "--no-upload" ]]; then
  echo "==> --no-upload set; skipping TestFlight upload."
  exit 0
fi

echo "==> Validating with App Store Connect…"
xcrun altool --validate-app -f "$IPA" -t ios \
  --apiKey "$KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "==> Uploading to TestFlight…"
xcrun altool --upload-app -f "$IPA" -t ios \
  --apiKey "$KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "==> Done. Build should appear in App Store Connect → TestFlight in a few minutes."
