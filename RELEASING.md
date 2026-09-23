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

Before building, run the live socket suite against **upstream stable herdr**,
not only against the fork the development Mac runs. App Store users run
upstream; a suite that passed only on the fork is how the app came to depend
on fork-only events and fields (#75, #76, #85). A throwaway session keeps it
away from your real workspaces:

```bash
gh release download v0.9.1 -R herdrdev/herdr -p herdr-macos-aarch64 -O ~/.local/bin/herdr-stable-0.9.1
chmod +x ~/.local/bin/herdr-stable-0.9.1 && xattr -c ~/.local/bin/herdr-stable-0.9.1
HERDR_SESSION=hc-upstream-test ~/.local/bin/herdr-stable-0.9.1 server &   # headless, own socket
HERDR_LIVE=1 HERDR_LIVE_BIN=~/.local/bin/herdr-stable-0.9.1 \
  HERDR_LIVE_SESSION=hc-upstream-test npx jest socket.live --forceExit
# Optional, spends one Claude turn: HERDR_LIVE_PROMPT=1 HERDR_LIVE_CWD=<a folder Claude trusts>
HERDR_SESSION=hc-upstream-test ~/.local/bin/herdr-stable-0.9.1 server stop
```

Run inside a herdr pane, the test strips the inherited `HERDR_*` variables
itself; an inherited `HERDR_SOCKET_PATH` would otherwise win over the session.

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
- The generated app and exported IPA declare an application scene delegate.
  Xcode 27 builds without one crash immediately on iOS 27, even if they passed
  tests on an older simulator. SDK 57 uses Expo's official scene support opt-in
  in `expo-build-properties`; keep Expo at 57.0.23 or newer. See the
  [Expo migration guide](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27).
  Run the Release launch, foreground/background and cold deep-link checks on
  iOS 27 as well as the older supported runtime before uploading.

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
  machine over SSH, plus the built-in Demo host working in the submitted build.
  Review requires no account or SSH credentials. Keep review notes consistent
  with that exact build and keep account-specific correspondence out of git.
- An export-compliance answer. The app uses only standard SSH cryptography, so
  `ITSAppUsesNonExemptEncryption` is `false` in `app.json`. Re-confirm this if
  you ever add your own cryptography.

## App Store

HerdrChat is live on the [App Store](https://apps.apple.com/app/herdrchat/id6791874615)
(first release 0.7.9, 2026-09-22). The same uploaded build goes to the store:
in App Store Connect, create the next version with the same string as
`expo.version` in `app.json`, attach the build and submit it for App Review.
The Demo host is what lets review run without an account or SSH credentials,
so it has to work in every submitted build.

## Android

There is no Android release path in this repo. The module builds and the app
compiles, but it has not been runtime-verified. See the
[current limitations](docs/getting-started.md#known-limitations).

## Push relay

Notifications for the App Store build go through `relay/`, a Cloudflare Worker
at `push.herdrchat.cobanov.dev` that holds the team's APNs key (#95). It has its
own deploy, separate from the app:

```bash
cd relay
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
wrangler deploy
# Once, and again whenever the key is rotated. APNs keys are created under
# Certificates, Identifiers & Profiles → Keys, with "Apple Push Notifications
# service" enabled, and can be downloaded only once.
wrangler secret put APNS_KEY_ID          # the 10-character key id
wrangler secret put APNS_KEY < AuthKey_XXXXXXXXXX.p8
curl https://push.herdrchat.cobanov.dev/   # {"configured":true}
```

The Worker is tested with the app (`npx jest relay`). It has no request logs or
traces by design (`observability` is off in `wrangler.toml`); keep it that way,
and keep `site/privacy/` in step with what it receives.

The watcher the app installs on a host is embedded at build time. After
changing `scripts/herdr-apns-notifier.py`, bump its `WATCHER_VERSION` (hosts
running an older one are offered the update) and run
`node scripts/embed-watcher.mjs`; a test fails until you do.

