# HerdrChat

A native iOS app that talks to [herdr](https://herdr.dev) like WhatsApp: each
workspace is a chat, agents' output shows up as clean message bubbles, and you
reply from your phone. Connects to your machines over SSH via Tailscale.

## Why this works

herdr exposes a local newline-delimited JSON socket API (protocol 16) with full
workspace/agent/pane control and an event stream, but no network transport and
no auth. Rather than expose it, HerdrChat reaches herdr **over your existing SSH
+ Tailscale**, running `herdr` CLI commands and tailing agent transcripts.

The key trick for clean chat bubbles: herdr's `pane.read` returns the raw TUI
buffer (noisy). Instead we read Claude Code's own transcript at
`~/.claude/projects/<escaped-cwd>/<session>.jsonl`, which holds clean
user/assistant turns. Sending a message = `herdr pane send-text` into the agent.

## Architecture

```
iPhone (SwiftUI)
   │  SSH over Tailscale (existing keys, no public surface)
   ▼
remote machine (nuc / spark / mac …)
   ├─ herdr server  ── CLI: snapshot, send-text, send-keys, agent list
   └─ ~/.claude/projects/**/*.jsonl  ── tail -f for live chat messages
```

- **Chat list** ← `herdr workspace list` / `session.snapshot`. Status drives
  presence: `working` = typing…, `blocked` = waiting for you (badge),
  `idle`/`done` = quiet.
- **Chat thread** ← parsed transcript bubbles (one workspace = one thread,
  labelled by agent when several run in it).
- **Send** ← `herdr pane send-text <pane> "…"` + Enter.
- **Blocked** ← quick Yes/No via `herdr pane send-keys`.
- **Alerts** ← `blocked` transitions pushed to homelab ntfy (no APNs needed).

## Layout

- `Sources/HerdrKit/` — pure, dependency-free core: models, protocol envelope,
  transcript parser, and the transport-agnostic `HerdrClient` / `TranscriptStore`.
  Builds and tests with the Swift toolchain, no Xcode.
- `Sources/HerdrNet/` — `SSHTransport` (Citadel/SwiftNIO SSH) for reaching a
  remote herdr host over Tailscale. Kept separate so the core stays dep-free.
- `Sources/HerdrChatUI/` — SwiftUI views + view models (chat list, thread,
  blocked quick-replies, connection setup). A library so it type-checks on macOS.
- `App/` — the thin `@main` iOS shell that shows `RootView()`.
- `Sources/HerdrSmoke/` — runnable assertion harness for machines without XCTest.
- `Tests/HerdrKitTests/` — XCTest suite + JSON/JSONL fixtures (runs in Xcode/CI).
- `scripts/herdr-ntfy-notifier.py` — host-side blocked→ntfy push.
- `project.yml` / `HerdrChat.xcodeproj` — XcodeGen spec and generated project.
- `android/` — native Android port (Kotlin + Jetpack Compose + sshj), feature
  parity with the iOS app. See [`android/README.md`](android/README.md).

## Verify the core (no Xcode needed)

```bash
swift build                          # builds HerdrKit + HerdrNet + HerdrChatUI
swift run HerdrSmoke                 # 22 core assertions
swift run HerdrSmoke --live          # exercises HerdrClient against local herdr
swift run HerdrSmoke path/to/session.jsonl   # parse a real transcript
```

## Build & run the iOS app (needs full Xcode)

```bash
brew install xcodegen        # once
xcodegen generate            # regenerate HerdrChat.xcodeproj from project.yml
open HerdrChat.xcodeproj     # build & run on a device/simulator in Xcode
```

On first launch, add a server: name, Tailscale host, SSH username, and paste an
OpenSSH private key (or password). The phone must be on the same tailnet
(Tailscale app installed and logged in).

## Notifications (optional, no APNs)

Run the notifier on the herdr host so a blocked agent pings your phone's ntfy app:

```bash
NTFY_URL=https://ntfy.example.ts.net/herdr scripts/herdr-ntfy-notifier.py
```

## Status

- [x] HerdrKit models decode real herdr `snapshot` / `workspace list` JSON
- [x] Transcript parser → chat bubbles (verified on real Claude Code transcripts)
- [x] `HerdrClient` + `TranscriptStore` (verified live against local herdr)
- [x] SSH transport (Citadel 0.12.1) — compiles; runtime auth needs a device test
- [x] SwiftUI app: chat list, chat thread, blocked quick-replies
- [x] Host-side ntfy notifier for blocked agents
- [ ] Runtime test on device over Tailscale (needs Xcode + iPhone on tailnet)
- [ ] Multi-agent thread merge polish; transcript-file rotation handling

Building the app requires a full Xcode install (this repo's core only needs
Command Line Tools).
