<p align="center">
  <img src="assets/icon.png" alt="HerdrChat" width="140">
</p>

<p align="center">
  Your coding agents, as a chat on your phone — over SSH to your own machine,
  with nothing in between.
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/iOS-26%2B-6E74E6?labelColor=1a1a1a">
  <img alt="tests" src="https://img.shields.io/badge/tests-102-6E74E6?labelColor=1a1a1a">
  <img alt="testflight" src="https://img.shields.io/badge/TestFlight-0.3.0%20(36)-6E74E6?labelColor=1a1a1a">
  <a href="LICENSE"><img alt="licence" src="https://img.shields.io/badge/licence-Apache--2.0-6E74E6?labelColor=1a1a1a"></a>
</p>

---

Agents run on the machine under your desk, and checking on one means opening a
laptop — or SSHing in from a phone to a TUI that was never designed for a
six-inch screen and a soft keyboard. HerdrChat makes each [herdr][herdr]
workspace a conversation instead.

It does not scrape the terminal. herdr's `pane.read` returns the raw TUI buffer,
which is noise; this reads Claude Code's own transcript files, which hold
structured turns. That is the whole reason the bubbles are clean, and why a tool
call can be a chip rather than a wall of output.

```
 herdrchat                                        0.3.0   macmini

   herdrchat          ● working   Tests are green — 102 passing
 > helva-todo         ○ idle      Added the recurring-task migration
   fight-sim-main     ! blocked   Do you want to proceed?

   +  new chat

 Chats            Hosts            Settings
```

- **No account and no server.** There is nothing to sign into and no service of
  ours in the path. Your phone talks to your machine and to nothing else.
- **Nothing is exposed.** In normal use the connection rides your existing
  Tailscale network. Host keys are pinned on first use, and a changed key is
  refused rather than warned about.
- **Keys stay in the Keychain**, never in the app's database and never off the
  device.
- **Answer a blocked agent in two taps.** A prompt's options are parsed into
  labelled buttons, so choosing one is a tap rather than a guess at which number
  to type.
- **Notifications come from your own machine.** A watcher you run signs with
  your own Apple push key and talks to APNs directly.

Verified on **iPhone 17 Pro, iOS 26.5** against a real host. Android compiles
and its SSH module is written, but it has never been run — see [Status](#status).

## Install

The app is in TestFlight. To run it yourself you need Node 22+, Xcode 26+, and
an iOS 26 device or simulator.

```bash
npm install
npx expo prebuild --clean
npx expo run:ios --device "iPhone 17 Pro"
```

On the machine you want to reach you need [herdr][herdr], Claude Code, and —
this one is not optional:

```sh
herdr integration install claude
```

Without it herdr never learns Claude Code's session id, and the app cannot tell
one conversation in a directory from another. It refuses to guess, so threads
open empty. The hook fires on session start, so **agents already running when
you install it must be restarted** before they report anything.

Then add a host in the app: name, address, username, and an OpenSSH private key
or password. The connection has to pass a live test before it can be saved — a
saved-but-broken host produces a chat list that fails with no visible cause.

## Use

**The chat list**

| | |
|---|---|
| **tap a row** | open the thread |
| **the host name under the title** | switch machines |
| **compose** | new chat — pick a folder on the host, and a permission mode |
| **● ○ !** | working · idle · blocked, polled live |

A row shows an unread dot when the agent has spoken since you last opened it.
Read state is keyed to the conversation rather than to the workspace, so a new
chat in a recycled slot announces itself instead of inheriting the last one's
dot.

**A thread**

| | |
|---|---|
| **pull down at the top** | load older history, a page at a time |
| **the bar above the composer** | a blocked agent's options, as buttons |
| **send** | delivery is verified — a message that did not land says so |

Tool calls, results and thinking collapse into chips; subagent turns are hidden.
Both are switches in Settings.

**Notifications**

Opt-in. Your device's APNs token is written to a file on your own host over the
same SSH connection, and `scripts/herdr-apns-notifier.py` there pushes to Apple
with your own key. It needs an **APNs auth key** from Apple Developer — the Keys
section, which is not the same thing as an App Store Connect API key. Nothing of
ours is in the path, because nothing of ours exists.

## Build

```bash
npx tsc --noEmit          # zero errors
npx expo lint             # zero errors
npx jest                  # 102 tests
maestro test .maestro/smoke.yaml .maestro/new-chat.yaml .maestro/folder-picker.yaml
```

`.maestro/add-server.yaml` needs a real host and reads its credentials from the
environment, so no key is ever committed. Shipping is `scripts/testflight.sh` —
see [RELEASING.md](RELEASING.md).

`ios/` and `android/` are generated and gitignored. Change `app.json` or a config
plugin and re-run prebuild; never edit the generated project.

## How it is built

```
iPhone — React Native / Expo, New Architecture
   │  SSH, normally over Tailscale. Existing keys, no public surface.
   ▼
your machine
   ├─ herdr ─── snapshot, workspace list, pane run, agent wait
   └─ ~/.claude/projects/<escaped-cwd>/<session>.jsonl ─── tailed for messages
```

- `app/` — routes, thin: screens compose, they do not implement.
- `src/lib/` — the core, and the reason it is testable: herdr protocol and
  client, transcript parsing, the byte-windowed store, blocked-prompt and
  live-preview scraping. It imports neither React nor the SSH module, so all of
  it runs against a canned transport.
- `src/features/`, `src/components/`, `src/state/`, `src/theme/`
- `modules/herdr-ssh/` — the transport as a local Expo module: Citadel on iOS,
  sshj on Android. Its README explains what it deliberately does not do.
- `site/` — [herdrchat.cobanov.dev][site], privacy policy included, so the
  published page and the behaviour it describes are reviewed together.

[`CLAUDE.md`](CLAUDE.md) records the conventions and, more usefully, the rules
that were learned by running the thing: why a chat's identity is its session and
not its workspace slot, why offsets are UTF-8 bytes and not string length, why
glass lives in exactly one file. Reading it will save you a review round.

HerdrChat was two native apps first, in SwiftUI and Jetpack Compose. Both are in
the git history before the Expo rewrite, if you want the same product across
three stacks.

## Status

- [x] SSH transport as a native module, verified against a live host
- [x] herdr protocol, models, client
- [x] Transcript → bubbles, bounded recent window, resuming live tail
- [x] Chat list with live presence and batched previews
- [x] Thread: bubbles, live preview, blocked quick-replies, verified send
- [x] Load older history on pull-up
- [x] Unread state, keyed to the session
- [x] Hosts: add / edit / test / remove, Keychain secrets, TOFU pins
- [x] New chat: folder browser on the host, permission mode
- [x] iOS release path — [RELEASING.md](RELEASING.md)
- [ ] Notifications end to end. The app registers and the entitlement ships; the
      host-side sender has never been set up ([#2][i2])
- [ ] Android runtime verification and a release path ([#4][i4])
- [ ] Public TestFlight — blocked on a demo host for review ([#3][i3])

Open [issues][issues] are the honest version of this list.

## Contributing

Issues and pull requests welcome. Before opening one:

```bash
npx tsc --noEmit && npx expo lint && npx jest
```

## Licence

[Apache-2.0](LICENSE). Third-party components and their licences are in
[NOTICE](NOTICE).

[herdr]: https://herdr.dev
[site]: https://herdrchat.cobanov.dev
[issues]: https://github.com/cobanov/herdrchat/issues
[i2]: https://github.com/cobanov/herdrchat/issues/2
[i3]: https://github.com/cobanov/herdrchat/issues/3
[i4]: https://github.com/cobanov/herdrchat/issues/4
