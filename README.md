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

- `Sources/HerdrKit/` — pure, dependency-free core (models, protocol envelope,
  transcript parser). Builds and tests with the Swift toolchain, no Xcode.
- `Sources/HerdrSmoke/` — runnable assertion harness for machines without XCTest.
- `Tests/HerdrKitTests/` — XCTest suite + JSON/JSONL fixtures (runs in Xcode/CI).
- *(coming)* SSH transport target (Citadel) and the SwiftUI iOS app.

## Verify the core (no Xcode needed)

```bash
swift build
swift run HerdrSmoke                 # runs all core assertions
swift run HerdrSmoke path/to/session.jsonl   # parse a real transcript
```

## Status

- [x] HerdrKit models decode real herdr `snapshot` / `workspace list` JSON
- [x] Transcript parser → chat bubbles (verified on real Claude Code transcripts)
- [ ] SSH transport (Citadel) + herdr client
- [ ] SwiftUI app: chat list, chat thread, blocked quick-replies, ntfy alerts

Building the app targets requires a full Xcode install (this repo's core only
needs Command Line Tools).
