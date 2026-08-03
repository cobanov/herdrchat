# HerdrChat for Android

A native Android port of [HerdrChat](../README.md): use herdr from your phone
like WhatsApp, over SSH + Tailscale. Feature-parity with the iOS app.

- **Kotlin + Jetpack Compose** (Material 3), WhatsApp-flavoured theme (light/dark)
- **[sshj](https://github.com/hierynomus/sshj)** for SSH over Tailscale (ed25519 /
  RSA key or password); one reused connection, `tail -f` streamed as a `Flow`
- **kotlinx.serialization** for the herdr NDJSON envelope + transcript parsing
- Secrets in **EncryptedSharedPreferences** (Android Keystore) — the Keychain equivalent
- `minSdk 26`, `targetSdk 35`

## Layout

Mirrors the Swift package, one-to-one:

| iOS (Swift) | Android (`app/src/main/java/dev/herdr/herdrchat/`) |
|-------------|----------------------------------------------------|
| `HerdrKit/Models`, `HerdrProtocol` | `core/model/` (Models.kt, AgentStatus.kt) |
| `HerdrKit/Transcript` | `core/transcript/` (ChatMessage.kt, TranscriptParser.kt) |
| `HerdrKit/Client` | `core/client/` (HerdrClient.kt, TranscriptStore.kt) |
| `HerdrNet/SSHTransport` | `core/net/` (SshTransport.kt via sshj, SshConfig.kt) |
| `HerdrChatUI/Theme` | `ui/theme/Theme.kt` |
| `HerdrChatUI/Chat` (view models) | `ui/chat/` (WorkspacesViewModel, ChatThreadViewModel) |
| `HerdrChatUI/Connection` | `ui/connection/` (ConnectionStore, SecretStore) |
| `HerdrChatUI/Views` | `ui/screens/` + `ui/components/` |

## Build

Needs JDK 17 and the Android SDK (platform 35, build-tools 35+). Point
`local.properties` at your SDK (`sdk.dir=...`) — it's gitignored.

```bash
cd android
./gradlew :app:assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

## Install on a phone

Debug APKs are self-signed and sideloadable — the Android equivalent of an
internal TestFlight build. Either:

```bash
adb install app/build/outputs/apk/debug/app-debug.apk   # USB / wireless debugging
```

or copy `app-debug.apk` to the phone and open it (enable "install unknown apps"
for your file manager once).

On first launch, add a server: name, Tailscale host, SSH username, and paste an
OpenSSH private key (or password). The phone must be on the same tailnet.

## Notes

- No public network surface: the phone reaches herdr as a Tailscale peer over SSH.
- Host key verification is permissive (`PromiscuousVerifier`) since the peer is
  already authenticated by the tailnet — matching the iOS `acceptAnything()`.
- For a Play Store / release build, add a signing config and run
  `./gradlew :app:assembleRelease` (currently unsigned release).
