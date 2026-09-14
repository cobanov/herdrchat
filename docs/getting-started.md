# Getting started

[Back to the overview](../README.md)

You need an iPhone running iOS 17+ and a computer you administer. That computer
runs [herdr](https://herdr.dev) and Claude Code or Codex. The phone connects over
SSH, usually through your existing Tailscale network. Keep SSH on your private
network; there is no need to expose it to the internet.

## Prepare your computer

Enable SSH access and make sure the phone can reach the computer. Then install
the integration for the agent you use.

### Claude Code

On the host:

```sh
herdr integration install claude
```

The integration reports the native session ID that identifies each conversation.
If an agent was already running before installation, wait until it is idle,
then restart or resume it so the session-start hook can run.

### Codex

Open the unreported Codex chat in HerdrChat and use **Install it on the host**
when offered. This installs the official Herdr integration and the
`herdrchat-codex` helper. It does not restart a running agent.

Start future Codex sessions inside their Herdr pane with:

```sh
herdrchat-codex
```

For an existing session, get its exact ID with `/status`. When the agent is
idle, exit and run `herdrchat-codex resume <session-id>`. Review the Herdr hook
in `/hooks` if requested. The helper carries the pane identity into Codex's
shared service without replacing the global `codex` command or bypassing trust.

For manual host setup, run `herdr integration install codex` and install this
repo's [named launcher](../scripts/herdr-codex.sh) as `herdrchat-codex` on the
host's PATH. The helper needs Python 3 and Codex. More detail is in the
[Codex support report](codex-pass-2026-09-14.md#host-setup-and-existing-sessions).

## Connect the phone

1. Open **Hosts** and add the computer's reachable address, SSH username and
   password or existing OpenSSH private key.
2. Test the connection and verify the host fingerprint before saving. If herdr
   is not on the SSH session's PATH, enter its full executable path.
3. Open **Chats** and choose a workspace. No session ID means no safe history
   lookup: the app will explain the missing integration instead of guessing
   which conversation belongs to you.

## Build the iOS app

On a Mac with Node.js and Xcode installed, clone this repository and run:

```bash
npm ci
npx expo prebuild --clean --platform ios
npx expo run:ios
```

The local SSH module requires a native development build, not Expo Go.
For a physical device, use `npx expo run:ios --device` and select your unlocked,
trusted iPhone. Start Metro again later with `npm start`.

Run the checks before contributing:

```bash
npm run typecheck
npm run lint
npm test
```

UI flows and their host fixtures are documented in [.maestro/README.md](../.maestro/README.md).
Native `ios/` and `android/` directories are generated. Edit `app.json` or config
plugins, not those generated projects. Changes to the SSH native module need
a native rebuild. See [conventions](../CLAUDE.md) and [release setup](../RELEASING.md).

## Optional notifications

Push notifications require your own Apple **APNs auth key**, not an App Store
Connect API key. The app registers its device token on your host over SSH;
the [host-side notifier](../scripts/herdr-apns-notifier.py) sends notifications
directly to APNs. Its header documents the environment variables and usage.
Keep keys on your host and out of the repository.

## Beta limitations

- Public TestFlight access depends on Beta App Review; an internal build being
  ready does not mean it is available through the public link.
- Android has a buildable native implementation but is not runtime-verified.
- Physical-device APNs delivery and recovery from a real Tailscale interruption
  still need acceptance testing. Simulator checks are not proof of either.
- Reconnect banners and waiting/live-preview presentation are being refined.
  Current test evidence and remaining work are in the [UI report](ui-pass-2026-09-14.md),
  [Codex report](codex-pass-2026-09-14.md) and [issues](https://github.com/cobanov/herdrchat/issues).
