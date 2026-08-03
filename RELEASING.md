# Releasing

Everything here is account-specific and comes from the environment; nothing
about a particular Apple team is committed. A fork sets its own values.

## One-time setup

1. An Apple Developer account and an App Store Connect **app record** for the
   bundle id in `app.json` (`expo.ios.bundleIdentifier`). The API cannot create
   the record — do it once in the App Store Connect UI.
2. An **App Store Connect API key** (Users and Access → Integrations), saved at
   `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`.
3. A distribution certificate and an App Store provisioning profile installed
   locally. `xcodebuild` can create them with `-allowProvisioningUpdates` if
   your API key has the role for it; if it doesn't, create them once in Xcode.

## Shipping a build

```bash
# Bump the build number first — App Store Connect rejects a duplicate.
#   app.json → expo.ios.buildNumber

APPLE_TEAM_ID=XXXXXXXXXX \
ASC_KEY_ID=XXXXXXXXXX \
ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
  scripts/testflight.sh
```

`--no-upload` stops after producing the `.ipa`, which is what you want when
you only need to check that it builds and signs.

Set `ASC_PROFILE_NAME` if your provisioning profile isn't named
`HerdrChat App Store`.

### What the script checks before uploading

Each of these fails silently and only a tester would notice, so they are
enforced rather than trusted:

- The dev launcher is **not** embedded. A development build ships a server
  picker that would appear in front of the app on a tester's phone.
- The archive's version and build number match `app.json`, which proves
  `expo prebuild` actually ran rather than reusing a stale `ios/`.
- Both halves of the SSH module are present — the native symbols in the binary
  and the module name in the JS bundle. Autolinking says nothing when it
  doesn't happen, and without the transport every screen is an error state.

### Gotchas learned the hard way

- **Cloud signing may fail** with "Cloud signing permission error / No profiles
  were found" even though the archive itself signed fine. The export step
  therefore uses manual signing and deliberately does **not** pass the auth key,
  because passing it re-engages the cloud path.
- **TestFlight rate-limits uploads** per app per day (`altool` error 90382).
  Bump the build number on every change so commits stay honest, but batch the
  uploads.
- `ios/` and `android/` are generated. Never edit them; change `app.json` or a
  config plugin and re-run prebuild.

## Public TestFlight

A public link needs **Beta App Review**, which requires more than a build:

- App description, and a **privacy policy URL** (required for a public link).
- Beta App Review notes explaining that the app connects to the tester's *own*
  machine over SSH, plus a working demo host and credentials in the review
  fields — never in the repo. See `AppStoreReview/`.
- An export-compliance answer. The app uses only standard SSH cryptography, so
  `ITSAppUsesNonExemptEncryption` is `false` in `app.json`. Re-confirm this if
  you ever add your own cryptography.

## Android

There is no Android release path in this repo. The module builds and the app
compiles, but it has not been runtime-verified — see the README status list.
