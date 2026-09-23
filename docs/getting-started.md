# Getting started

[Back to the overview](../README.md)

You need an iPhone or iPad running iOS 17+ with
[HerdrChat from the App Store](https://apps.apple.com/app/herdrchat/id6791874615), and a computer you administer. That computer
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
Codex launcher in `~/.local/bin`. It does not restart a running agent.

Start future Codex sessions normally inside their Herdr pane:

```sh
codex
```

For an existing session, get its exact ID with `/status`. When the agent is
idle, exit and run `herdrchat-codex resume <session-id>`. Review the Herdr hook
in `/hooks` if requested. The helper carries the pane identity into Codex's
shared service. The `codex` entry point forwards to your original executable;
outside Herdr it passes your arguments through unchanged. It never changes
Codex settings or hook trust, and refuses to overwrite an unrelated launcher.
Keep `~/.local/bin` before the original Codex directory on PATH, or use
`herdrchat-codex` explicitly. A brand-new chat reports its ID after its first message.

For manual host setup, run `herdr integration install codex` and install this
repo's [named launcher](../scripts/herdr-codex.sh) as `herdrchat-codex` on the
host's PATH. The helper needs Python 3 and Codex.

## Connect the phone

1. Open **Hosts** and add the computer's reachable address, SSH username and
   password or existing OpenSSH private key.
2. Test the connection and verify the host fingerprint before saving. If herdr
   is not on the SSH session's PATH, enter its full executable path.
3. Open **Chats** and choose a workspace. No session ID means no safe history
   lookup: the app will explain the missing integration instead of guessing
   which conversation belongs to you.

## Build the iOS app

On a Mac with Node.js 22+ and Xcode installed, clone this repository and run:

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
python3 -m unittest discover -s scripts -p 'test_*.py'
```

UI flows and their host fixtures are documented in [.maestro/README.md](../.maestro/README.md).
Native `ios/` and `android/` directories are generated. Edit `app.json` or config
plugins, not those generated projects. Changes to the SSH native module need
a native rebuild. See [conventions](../CLAUDE.md) and [release setup](../RELEASING.md).

## Optional notifications

Push notifications require an Apple **APNs auth key from the team that signed
the app** (not an App Store Connect API key). Apple rejects a push signed by any
other team, so today this works with a build you sign yourself, under your own
team and bundle identifier. The App Store build cannot be set up this way yet;
see [#95](https://github.com/cobanov/herdrchat/issues/95).

The app registers its device token on your host over SSH;
the [host-side notifier](../scripts/herdr-apns-notifier.py) sends notifications
directly to APNs. Its header documents the environment variables and usage.
Set `APNS_KEY_ID`, `APNS_TEAM_ID` and `APNS_KEY_PATH` explicitly in
`~/.config/herdrchat/apns.env` or the environment. The watcher does not search
for keys or reuse App Store Connect credentials. Keep keys on your host and
out of the repository. Verify delivery on a physical iPhone before relying on it.

## Known limitations

- Android has a buildable native implementation but is not runtime-verified.
- Physical-device APNs delivery and recovery from a real Tailscale interruption
  still need acceptance testing. Simulator checks are not proof of either.
- Reconnect banners and waiting/live-preview presentation are being refined.
  Report problems in [issues](https://github.com/cobanov/herdrchat/issues).
