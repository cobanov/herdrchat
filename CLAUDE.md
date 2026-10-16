# HerdrChat — conventions

A React Native / Expo app for driving coding agents (Claude Code, Codex, Grok,
Antigravity, Pi, OMP) from a phone. Each herdr workspace is a
chat; the transport is SSH over Tailscale, so nothing is
exposed publicly.

## Stack (not negotiable without a reason in the commit message)

- **Expo SDK 57**, React Native 0.86, React 19.2, **New Architecture** (Fabric,
  Bridgeless, TurboModules, Hermes). Verify at runtime, never assume.
- **TypeScript strict**, plus `noUncheckedIndexedAccess`. No `any`, no
  `@ts-ignore` without a comment saying why.
- **Expo Router**, file-based, typed routes. Route files stay thin — under ~100
  lines, composing from `src/features/`.
- **CNG**: `ios/` and `android/` are generated and gitignored. Native config
  lives in `app.json` and config plugins. Never hand-edit the generated projects.
- **npm**, and `npx expo install` for anything in the SDK so versions stay
  aligned. Not pnpm — its symlink layout breaks native module resolution.
- Install order matters for one thing: `react-dom` is pinned in `overrides`
  because a web-only transitive of `@expo/ui` otherwise pulls a React the
  native side doesn't have.

## Layout

```
app/                    routes only, thin
src/components/         presentational primitives, no data fetching
src/features/<domain>/  feature components + hooks
src/lib/                pure logic, no React — this is what tests cover
src/state/              zustand stores, SQLite, keychain
src/theme/              tokens, provider
modules/herdr-ssh/      the SSH TurboModule (see its README)
modules/herdr-keys/     hardware keys on the composer: Command-Return on iOS,
                        Ctrl-Enter on Android; iOS only: Esc on the iPad's
                        layout card (UIKeyCommand views), and pointer hover
                        (Pressable's onHoverIn never fires on iOS here)
modules/herdr-terminal/ a pane's terminal: SwiftTerm on iOS, Termux's emulator on
                        Android, in a native view (see its README)
modules/herdr-shell-registry/  the open terminal shells, shared by herdr-ssh and herdr-terminal
relay/                  the push relay, a Cloudflare Worker (see RELEASING.md)
                        (the SwiftUI and Compose apps this replaced are not in
                         the tree — they live in git history before the rewrite)
.maestro/               UI flows
```

`src/lib/` imports nothing from React or from the SSH module — the transport is
an interface, which is what lets the whole core be tested against a canned host.

## Rules earned the hard way

**Native never throws for an expected failure.** Host down, key rotated, herdr
not installed — each means something different to the user. The module returns
`{ ok: false, code, message }` and TypeScript decides what it means. `exit 127 →
"herdr isn't installed here"` is an interpretation and lives in `client.ts`
where a test pins it.

**A chat's identity is its Claude session, not its workspace slot.** herdr
reuses workspace ids. Anything cached per workspace carries a `session_sig`, and
when it changes the cache is dropped. Without this, a new chat in a recycled
workspace opens showing the previous conversation.

**Never guess a transcript file.** When an agent reports a session id, that id
IS the filename. Falling back to "newest .jsonl in the project dir" previews a
foreign session — a reported bug, not a theory. The trigger is two chats opened
on ONE folder: they share a project dir, so the newest file belongs to whichever
was touched last. Without a session id there is nothing safe to open — wait for
it; the status poll retries every couple of seconds. `TranscriptStore` therefore
offers no "newest transcript" call at all, deliberately.

**An agent is described once, in `src/lib/herdr/agents.ts`.** Its name, the
reader for its history, its herdr integration and its default titles live in
that table; `TranscriptStore.transcriptPath` picks the lookup by the reader. A
new agent is an entry there, a parser under `src/lib/transcript/` and a Demo
pane, never another `=== 'codex'` branch in a feature. An agent with no
reader stays a terminal row: the Terminal tab already covers it. Every step
is in `docs/adding-an-agent.md`.

**Live tails are keyed by session id, never by cwd.** Two agents in one
directory collapse onto a single map entry, and the second one silently never
streams.

**A sent picture is a path, and a sent message is matched by its text and its
picture count.** The app uploads a picture over SSH to
`~/.cache/herdrchat/uploads/` and puts the path on its own line in the prompt.
Claude Code turns that line into `[Image #1]` plus an `[Image: source: …]`
block; Codex keeps it as typed. `splitImages` must leave exactly what was
typed, or the echo is never confirmed and the bubble says "Failed to send".
Matching text alone confirmed a picture-only message with any tool result.

**A `!` line is a shell exchange, not a message.** Claude records it as two
user turns back to back, `<bash-input> cmd</bash-input>` then
`<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>`; `threadItems` pairs
only those two turns into one shell block, adjacent in their own transcript
(by `agentLabel`; an echo is in none), never across another line of it: a
workspace thread merges two agents' lines, and the output is written seconds
after the command. Claude escapes `&`, `<`, `>` in the output (not the command)
except inside `<persisted-output>`. It records the command with or without a
leading space, depending on its version, so the receipt trims both sides
through `shellReceiptText`; never strip exactly one space.

**Only `useThreadScroll` moves the thread list.** The rules are one pure
function (`src/lib/threadScroll.ts`): the reader is following the end or
reading, only the reader's own scrolls and asks (send, jump, reload) change
that, and everything else only keeps a follower at the end. The screen once
spread this over four flags, five forced scrolls and the list's own autoscroll,
and each fix reopened another case. A tail restart continues the window
(`continueWindow`) rather than re-keying the list, which rebuilt it at the end
under a reader.

**Byte offsets are UTF-8 bytes.** The host counts bytes; `String.length` counts
UTF-16 units. The drift silently skips messages on any transcript with an emoji.

**Glass lives in exactly one file.** `src/components/Glass.tsx` is the only
importer of `expo-glass-effect`. Some iOS 26 builds ship without the API and
rendering a `GlassView` on those crashes. Never set `opacity: 0` on glass or any
ancestor — it disables the effect; fade with `glassEffectStyle.animate`.

**No magic numbers outside `src/theme/`.** If a screen needs a colour, radius,
duration or spacing value that isn't a token, add the token.

**Shared values use `.get()` / `.set()`**, not `.value`. The React Compiler is on
and flags direct mutation.

**Don't setState in an effect body.** To reset state when a prop changes, key
the component (see `ChatsForServer`). To hand a value back from a modal, use a
store — `router.setParams` after `router.back()` applies to the route being left.

## Gates

```bash
npx tsc --noEmit      # zero errors
npx expo lint         # zero errors
npx jest              # src/lib and hooks
npm run e2e           # UI regression suite on two simulators, Demo host (~15 min)
npm run e2e -- changed  # only the flows the uncommitted changes can break
```

Then actually look at the app in both light and dark mode, starting with the
screenshots `npm run e2e` leaves behind. A screenshot you didn't open is not a
check.

**Every bug fix and every feature adds a test that would have caught it.**
Logic goes in jest; anything a person sees or taps goes in a Maestro flow
under `.maestro/regression/`, run by `npm run e2e` before shipping (the E2E
workflow runs the same on a GitHub runner on demand; its native build is slow). The flows need no host: the Demo (`src/lib/demo/`) plays
the agent, including its scenarios (`scenarios.ts`: slash-command panels, a
question in parts, a tool run with a failure). A feature the Demo cannot show
gets a Demo scenario first. The person using this app tests on a phone; they
should not be the one to find what broke.

## Building

```bash
npx expo prebuild --clean     # regenerate ios/ and android/
npx expo run:ios --device "iPhone 17 Pro"
npx expo start --dev-client
```

The iOS build needs Xcode's Metal toolchain (SwiftTerm compiles a shader);
`scripts/ensure-metal-toolchain.sh` installs it when missing.

Changes under `modules/*/ios` or `.../android` need a native rebuild;
Fast Refresh does not reload native code.

After an Xcode update, `npm ci` before the next build. Expo builds
`ExpoModulesJSI` into `node_modules` on the first build and keys that cache on
the Swift compiler, not the Xcode build, so Xcode 27.1 reused 27.0's slice and
every build failed with `cannot find type '__ObjC::expo'` (expo/expo#50365).
Deleting `node_modules/expo-modules-jsi/apple/Products/*/*/.build-hash` does
the same. CI installs fresh and never sees it.

## Not yet built

Notifications: the app registers its token on the host and installs the
watcher (`scripts/herdr-apns-notifier.py`, embedded via
`scripts/embed-watcher.mjs`) as a service. The watcher sends through the relay
(`relay/`, deployed at push.herdrchat.cobanov.dev), which needs the team's APNs
key as a Worker secret before anything reaches a phone. Delivery has not been
confirmed on a real device; the Simulator cannot register at all. Android
registers an FCM token (`"service": "fcm"` in its token file) and the relay
sends it as a data message, shown by expo-notifications on the `agents`
channel; it needs `google-services.json` (`android.googleServicesFile` in
`app.json`) and the Firebase service account as the `FCM_SERVICE_ACCOUNT`
Worker secret, neither of which exists yet.

**The relay is the one server of ours.** It stores nothing, logs nothing,
shapes the payload itself and sends only to this app. Any change to what it
receives changes the privacy policy (`site/privacy/`) in the same commit.

Android ships through `scripts/android-release.sh` (signed AAB and APK, Play
upload with a service-account key; see RELEASING.md), which still needs the
Play Console app and that key. iOS ships via `scripts/testflight.sh`.
