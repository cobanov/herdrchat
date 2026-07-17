#!/usr/bin/env bash
# One-shot: create an Apple Distribution cert + key locally, create an App Store
# provisioning profile, and re-export the existing archive with manual signing.
# Fixes the "No signing certificate iOS Distribution found" / cloud-signing errors
# that block export on a machine whose keychain has no distribution key.
#
# Usage:
#   ASC_ISSUER_ID=<uuid> KC_PW=<login-pw> scripts/dist-signing.sh
#
# Produces build/export/HerdrChat.ipa. Secrets (key/p12) live in a temp dir and
# are deleted on exit; only the cert/profile (safe) touch the system stores.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}"
: "${KC_PW:?set KC_PW (login keychain password, for set-key-partition-list)}"
TEAM_ID="6U58AKY6F8"
KC="$HOME/Library/Keychains/login.keychain-db"
ARCHIVE="build/HerdrChat.xcarchive"
EXPORT_DIR="build/export"
PLIST="build/ExportOptions-appstore.plist"

[[ -d "$ARCHIVE" ]] || { echo "ERROR: $ARCHIVE not found; run the archive step first." >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Generating private key + CSR…"
openssl genrsa -out "$WORK/dist.key" 2048 2>/dev/null
openssl req -new -key "$WORK/dist.key" -out "$WORK/dist.csr" \
  -subj "/CN=HerdrChat Distribution/O=AHMET MERT COBANOGLU/C=US" 2>/dev/null

echo "==> Creating Apple Distribution certificate via ASC API…"
CERT_OUT="$(swift scripts/asc.swift "$ASC_ISSUER_ID" create-dist-cert "$WORK/dist.csr" "$WORK/dist.cer")"
echo "$CERT_OUT"
CERT_ID="$(echo "$CERT_OUT" | sed -n 's/^CERT_ID=//p')"
[[ -n "$CERT_ID" ]] || { echo "ERROR: no CERT_ID returned" >&2; exit 1; }

echo "==> Building PKCS#12 and importing into the login keychain…"
openssl x509 -inform der -in "$WORK/dist.cer" -out "$WORK/dist.pem" 2>/dev/null
openssl pkcs12 -export -legacy \
  -inkey "$WORK/dist.key" -in "$WORK/dist.pem" \
  -name "Apple Distribution: AHMET MERT COBANOGLU" \
  -out "$WORK/dist.p12" -passout pass:hcp12 2>/dev/null
security import "$WORK/dist.p12" -k "$KC" -P hcp12 \
  -T /usr/bin/codesign -T /usr/bin/productbuild >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KC_PW" "$KC" >/dev/null 2>&1 || true

echo "==> Installed identities:"
security find-identity -v -p codesigning "$KC" | grep -iE "distribution" || true

echo "==> Creating App Store provisioning profile…"
swift scripts/asc.swift "$ASC_ISSUER_ID" create-profile "$CERT_ID"

echo "==> Writing manual-signing ExportOptions…"
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
        <key>dev.herdr.HerdrChat</key><string>HerdrChat App Store</string>
    </dict>
    <key>destination</key><string>export</string>
    <key>uploadSymbols</key><true/>
    <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
EOF

echo "==> Exporting signed .ipa (manual)…"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$PLIST" 2>&1 | grep -avE "env '|_TOKEN=|_KEY=|_API|SECRET|PASSW|TELEGRAM|CLOUDFLARE|HASS_|NTFY_|LINEAR_|TS_API|BOT_TOKEN|ANTHROPIC|AuthKey"

echo "==> Done:"
ls -lh "$EXPORT_DIR"/*.ipa
