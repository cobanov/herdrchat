# HerdrChat — conventions

A React Native / Expo app for driving Claude Code agents from a phone. Each
herdr workspace is a chat; the transport is SSH over Tailscale, so nothing is
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

**Live tails are keyed by session id, never by cwd.** Two agents in one
directory collapse onto a single map entry, and the second one silently never
streams.

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
maestro test .maestro/
```

Then actually look at the app in both light and dark mode. A screenshot you
didn't open is not a check.

## Building

```bash
npx expo prebuild --clean     # regenerate ios/ and android/
npx expo run:ios --device "iPhone 17 Pro"
npx expo start --dev-client
```

Changes under `modules/herdr-ssh/ios` or `.../android` need a native rebuild;
Fast Refresh does not reload native code.

## Not yet built

Notifications work on iOS and ship with the push entitlement, but have not been
confirmed against APNs on a real device — the Simulator cannot register at all.
The host watcher (`scripts/herdr-apns-notifier.py`) is complete.

Android compiles and the SSH module is implemented in Kotlin/sshj, but it has
never been run and there is **no Android release path in this branch** — no
`scripts/play.sh`, no EAS equivalent. iOS ships via `scripts/testflight.sh`,
which targets the Expo app (see RELEASING.md).
