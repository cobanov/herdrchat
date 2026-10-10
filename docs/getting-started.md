# Getting started

[Back to the overview](../README.md)

You need an iPhone or iPad running iOS 17+ with
[HerdrChat from the App Store](https://apps.apple.com/app/herdrchat/id6791874615), and a computer you administer. That computer
runs [herdr](https://herdr.dev) and Claude Code, Codex or [OMP](https://omp.sh/). The phone connects over
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

### OMP (Oh My Pi)

On the host, install Herdr's built-in OMP extension:

```sh
herdr integration install omp
```

If your Herdr version does not recognize `omp`, update Herdr first. Start or
resume OMP inside a Herdr pane after installation; an already-running agent
must load the extension before it can identify its session. You can also
choose **OMP** when creating a chat in HerdrChat. OMP keeps its own permission
settings; the app does not pass Claude permission flags.

The extension reports the exact session file, so custom `--session-dir`
locations and profile paths do not require guessing a folder. Install the
extension into the same OMP agent directory used by that session (set
`PI_CODING_AGENT_DIR` when needed). An id-only report is looked up by exact
filename and checked against its session header; ambiguous matches are
refused. No session reference means no history lookup.

OMP history shows saved journal records in chronological order, including
thinking and tool activity. Branch summaries and context resets appear as
journal boundaries; this is not OMP's active-branch tree view. Replies appear
when OMP persists them, not token by token. The existing SSH transcript reader
requires a POSIX host shell and absolute POSIX paths without `..` segments;
Windows-native paths are not translated.

## Connect the phone

1. Open **Hosts** (the **…** menu at the top of Chats, or the host name under
   its title) and add the computer's reachable address, SSH username and
   password or existing OpenSSH private key.
2. Test the connection and verify the host fingerprint before saving. If herdr
   is not on the SSH session's PATH, enter its full executable path.
3. Back on **Chats**, choose a workspace. No session ID means no safe history
   lookup: the app will explain the missing integration instead of guessing
   which conversation belongs to you.
   A workspace running more than one agent lists each one under it: tap an
   agent to talk to it alone, or the workspace to read them all together.

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

Turn on **Settings → Notifications** (Settings is in the **…** menu at the top
of Chats). The app registers this phone's push token
on the selected host over SSH, then offers to install the watcher there. The
watcher is a small Python script
([`scripts/herdr-apns-notifier.py`](../scripts/herdr-apns-notifier.py)) that the
app installs as a background service: a LaunchAgent on macOS, a systemd user
service on Linux (with lingering, so it survives logging out), or a plain
background process elsewhere. It needs `python3` on the host. Each herdr
session gets its own watcher.

When an agent is waiting for you or has finished, the watcher sends the
notification through the HerdrChat relay (`push.herdrchat.cobanov.dev`). Apple
only delivers a push signed with the key of the team that published the app, so
the relay holds that key. It receives the device token, the notification text
and the identifiers that open the right chat, forwards them to Apple and keeps
nothing. Its source is in [`relay/`](../relay).

If you build and sign the app yourself, you can skip the relay: set
`APNS_KEY_ID`, `APNS_TEAM_ID` and `APNS_KEY_PATH` for your own APNs auth key
(not an App Store Connect API key) in `~/.config/herdrchat/apns.env` on the
host, and the watcher sends straight to Apple. Setting only some of the three
is an error, not a fallback.

To remove the watcher from a host, run
`launchctl bootout gui/$(id -u)/dev.herdr.herdrchat-notifier` and delete
`~/Library/LaunchAgents/dev.herdr.herdrchat-notifier.plist` on macOS, or
`systemctl --user disable --now dev.herdr.herdrchat-notifier` on Linux. A named
session's service carries the session name as a suffix.

## Theming

Each host can restyle the app through one file, `~/.herdrchat/theme.json`. It
applies while that host is selected, so two machines can look different, which
also tells you at a glance which one you are on. The app caches the last theme
it read, so launch and offline still look right.

Any agent that can edit files on the host can write it. In **Settings →
Appearance**, open **Host theme** and tap **Copy prompt for an agent**, then
paste it into a chat and finish the sentence:

> Restyle HerdrChat for me. Edit ~/.herdrchat/theme.json on this machine; the
> schema is in ~/.herdrchat/theme.schema.json and ~/.herdrchat/README.md
> explains the keys. Keep text contrast at or above 4.5:1. I would like: a
> warm dusk look

Every key is optional:

```json
{
  "name": "Warm dusk",
  "accent": "#D08A3E",
  "light": { "tint": "#B06A1E", "systemBackground": "#FBF7F2" },
  "dark":  { "tint": "#E9A25A" },
  "avatars": ["#8C4A12", "#2E6B5E"]
}
```

- `light` and `dark` override any colour of the app's palette by its name.
  Colours are `#RGB`, `#RRGGBB`, `#RRGGBBAA`, `rgb(...)` or `rgba(...)`.
- `accent` sets the tint, its muted wash, the outgoing bubble and the text on
  it for both schemes, darkening the bubble until white text on it clears
  4.5:1 (on a tint too light for white text, the text is dark and the bubble
  is the tint). A key you set in `light` or `dark` wins over it.
- `avatars` replaces the chat avatar colours; each chat keeps its slot.
- `name` is what Settings shows, up to 40 characters.

The first time it checks a host's theme, and whenever you copy the agent
prompt, the app writes `theme.schema.json`, `README.md` (every key, one line
each) and `theme.example.json` next to it when they are missing, and never
overwrites them. A wrong key or colour is skipped and listed under **Host
theme**; the rest of the file still applies. The phone checks for changes
about every 10 seconds while the chat list is on screen; **Reload theme**
reads the file at once, **Reset to default** renames it to `theme.json.bak`
(`theme.json.bak.1` and on when that is taken, so an older backup is kept),
and **Use host themes** turns every host's theme off without touching the
files.

## Known limitations

- Android has been run in an emulator against a real host (connecting,
  history, sending, blocked prompts, reconnecting, a changed host key), but
  not on a physical device, and it has no notifications: those are APNs,
  which is iOS only.
- Notifications need the relay's APNs key in place and have not yet been
  confirmed on a physical iPhone. Recovery from a real Tailscale interruption
  also still needs a device. Simulator checks are not proof of either.
- Reconnect banners and waiting/live-preview presentation are being refined.
  Report problems in [issues](https://github.com/cobanov/herdrchat/issues).
