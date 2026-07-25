# Shipping HerdrChat to Google Play

The Android analogue of `AppStoreReview/`. Play's flow differs from TestFlight in
three ways that shape everything below:

1. **A new app entry cannot be created through the API.** Same as App Store
   Connect: the Play Developer API can upload builds to an app that already
   exists, but the app itself is created once, by hand, in the Play Console.
2. **The upload key is yours to keep forever.** Lose it and you cannot publish
   updates without a Google-assisted key reset. It must be backed up somewhere
   that survives this machine.
3. **A first release is gated on paperwork, not review time.** Internal testing
   needs no review, but Play still blocks the release until the Data safety form,
   content rating, target audience and privacy policy are all filled in.

Package name: **`dev.herdr.herdrchat`** — permanent once the app is created, and
distinct from the iOS bundle id `dev.herdr.HerdrChat` (Play requires lowercase).

## One-time setup

### 1. Upload key

```sh
keytool -genkeypair -v \
  -keystore ~/.herdrchat/upload-keystore.jks \
  -alias upload -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=HerdrChat, O=HerdrChat, C=TR"
```

Then point the build at it, either via `android/keystore.properties` (gitignored)
or the same names as environment variables:

```properties
HERDRCHAT_STORE_FILE=/Users/<you>/.herdrchat/upload-keystore.jks
HERDRCHAT_STORE_PASSWORD=…
HERDRCHAT_KEY_ALIAS=upload
HERDRCHAT_KEY_PASSWORD=…
```

Without these, release builds stay unsigned — deliberately, so cloning the repo
never fails on a missing key. **Back up the .jks and its password off this
machine.** Enrol in Play App Signing when prompted (Google holds the release key,
you hold this upload key); it is the default for new apps and it means a lost
upload key is recoverable.

### 2. Create the app in the Play Console

Play Console → **Create app**: name, default language, "App", "Free". Then work
through *Dashboard → Set up your app*:

| Item | HerdrChat's answer |
|---|---|
| Privacy policy | Required, must be a public URL. Needed because the app stores connection credentials. |
| Data safety | Declare: **no data collected or shared by us**. Server addresses, usernames and SSH keys are stored **on the device only** (Android Keystore-backed), never transmitted anywhere but the user's own host. |
| Content rating | Questionnaire → Utility/Productivity, no objectionable content. |
| Target audience | 18+ (a developer tool); no children's content. |
| Ads | None. |
| Government app | No. |
| Financial features | None. |
| Account deletion | Not applicable: no account exists. Link to a page saying so. |

### 3. Foreground service declaration

`AgentWatchService` is declared `foregroundServiceType="dataSync"`. Play requires a
justification for foreground service use, and often asks for a short screen
recording showing it in action. Prepared answer:

> The app watches the user's own herdr host over SSH so it can post a local
> notification the moment an agent finishes or needs input. The work is a
> long-lived connection to a user-configured server, which is why it runs as a
> `dataSync` foreground service rather than a deferrable job — a deferred check
> would defeat the purpose of the notification.

### 4. Service account for automated uploads

Only needed once the app exists and you want `scripts/play.sh` to upload for you:

1. Google Cloud Console → the project linked to your Play account → **Service
   accounts** → create one, no roles needed at the GCP level.
2. Create a **JSON key**, save it outside the repo (e.g.
   `~/.herdrchat/play-service-account.json`). It is gitignored either way.
3. Play Console → **Users and permissions** → invite that service account's email
   → grant **Release manager** on this app.

## Every release after that

```sh
# versionCode must increase every upload; Play rejects duplicates.
#   android/app/build.gradle.kts → versionCode
HERDRCHAT_PLAY_KEY=~/.herdrchat/play-service-account.json scripts/play.sh
```

That builds a **signed AAB** (`bundleRelease` — Play requires App Bundles for new
apps, not APKs), verifies it is actually signed, and uploads it to the **internal
testing** track, which is the TestFlight analogue: available to your tester list
within minutes, no review.

Promote internal → closed → open/production in the Console when you want wider
distribution. Only those later tracks incur review.

## Notes

- Sideloaded debug APKs and Play builds have **different signing keys**, so Play's
  build will not install over a sideloaded one. Uninstall the sideloaded app first.
- `isMinifyEnabled = false` today. If that ever changes, keep ProGuard rules for
  sshj/BouncyCastle or SSH breaks in release only.
- Play's target-API requirement rises yearly; `targetSdk = 35` is current.
