# HerdrChat

Drive [herdr](https://herdr.dev) agents from your phone like a messaging app.
Each workspace is a chat, the agent's output arrives as clean message bubbles,
and you reply from the composer. Connects to your machines over SSH on your
tailnet — there is no server, no account, and no public network surface.

## Why it works this way

herdr exposes a local newline-delimited JSON socket API with full
workspace/agent/pane control, but no network transport and no auth. Rather than
expose that, HerdrChat reaches herdr **over your existing SSH + Tailscale**,
running `herdr` CLI commands and tailing agent transcripts.

The trick behind clean bubbles: herdr's `pane.read` returns the raw TUI buffer,
which is noise. Instead the app reads Claude Code's own transcript at
`~/.claude/projects/<escaped-cwd>/<session>.jsonl`, which holds structured
user/assistant turns. Sending a message is `herdr pane run` into the agent.

```
iPhone (React Native / Expo)
   │  SSH over Tailscale — existing keys, no public surface
   ▼
remote machine (nuc / spark / mac …)
   ├─ herdr  ── snapshot, workspace list, pane run/send-keys/read, agent wait
   └─ ~/.claude/projects/**/*.jsonl  ── tail -f for live messages
```

## Setup

Requires Node 22+, Xcode 26+, and an iOS 26 simulator or device.

```bash
npm install
npx expo prebuild --clean
npx expo run:ios --device "iPhone 17 Pro"
npx expo start --dev-client
```

On first launch, add a server: name, Tailscale address, SSH username, and an
OpenSSH private key (or password). The connection must pass a live test before
it can be saved — a saved-but-broken server produces a chat list that fails with
no obvious cause. Your phone must be on the same tailnet.

If herdr isn't installed on that account, the failed test offers to install it.

## What needs iOS 26, and what degrades

| Feature | iOS 26+ | Below 26 | Android |
|---|---|---|---|
| Liquid Glass composer and quick-reply bar | real glass | `expo-blur` | solid surface |
| SF Symbols | native | native | text fallback |
| Everything else | ✓ | ✓ | ✓ |

Reduce Transparency replaces every glass surface with a solid one, on every OS.
Reduce Motion stops the presence ring, the typing dots and the waiting bar.

Android compiles and the SSH module is implemented, but it has not been
runtime-verified — this release is iOS-first.

## Testing

```bash
npx tsc --noEmit
npx expo lint
npx jest                  # pure logic in src/lib
maestro test .maestro/    # UI flows, see .maestro/README.md
```

`.maestro/add-server.yaml` needs a real host; it reads credentials from the
environment so no key is ever committed.

## Repository layout

- `app/` — routes (thin; screens compose, they don't implement)
- `src/lib/` — pure core: herdr protocol and client, transcript parsing, the
  byte-windowed transcript store, blocked-prompt and live-preview scraping. No
  React, no SSH import, fully tested.
- `src/features/`, `src/components/`, `src/theme/`, `src/state/`
- `modules/herdr-ssh/` — the SSH transport as a local Expo module (Citadel on
  iOS, sshj on Android). See its README for why it exists.
- `legacy/ios`, `legacy/android` — the original SwiftUI and Jetpack Compose
  apps. Still buildable, kept as the reference implementation.
- `scripts/` — host-side helpers and the release scripts for the legacy apps.

## Status

- [x] SSH transport as a native module, verified against a live host
- [x] herdr protocol, models, client
- [x] Transcript parsing → bubbles, with a bounded recent window and a resuming
      live tail
- [x] Chat list with live presence and batched last-message previews
- [x] Thread: transcript bubbles, live preview, blocked quick-replies, send with
      delivery verification
- [x] Servers: add / edit / test / remove, keychain secrets, TOFU host-key pins
- [x] New chat: folder browser on the host, permission mode
- [ ] Notifications (background refresh, foreground service, APNs)
- [ ] Release path — `scripts/testflight.sh` and `scripts/play.sh` still target
      `legacy/`, so this branch doesn't ship until EAS replaces them
- [ ] Load older history on scroll-up
- [ ] Unread state persistence
