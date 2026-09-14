# Codex chat support, 2026-09-14

The UI pass shipped first as iOS 0.7.9 (57), source `71ed13a`. Apple accepted
that build (`VALID`, internal `IN_BETA_TESTING`). Codex support is a separate
change for build 58, source
[`523cbc8`](https://github.com/cobanov/herdrchat/commit/523cbc8).
Its archive, signed export, Apple package validation and upload passed. At
18:33 TRT, Apple reported upload `COMPLETE`, build `VALID`, and internal
`IN_BETA_TESTING`, with no upload errors or warnings. Build 58 is available to
the existing internal test group. Release notes include the host launcher setup.
Neither build was submitted to external Beta App Review in this pass.

## Root cause and fix

Two independent problems produced the waiting screen:

1. The app only knew Claude's transcript path and message format. Codex writes
   timestamped rollout files with `session_meta`, `response_item` and `event_msg`.
2. The local Codex 0.154.0 TUI attached to an already running shared app server
   (0.153.4). The TUI had `HERDR_*` environment values, but the server-side
   SessionStart hook did not inherit the pane identity. Updating Herdr's
   official hook from v8 to v9 alone did not fix the session report.

Implemented in small commits:

- [`80aa111`](https://github.com/cobanov/herdrchat/commit/80aa111): Decode
  canonical Codex response items, not both response items and their duplicate
  semantic events. Preserve user/assistant messages, tool calls, one-word
  replies, tables and code. Hide system/developer input and internal analysis;
  opaque encrypted reasoning is never decoded.
- [`574ef79`](https://github.com/cobanov/herdrchat/commit/574ef79): Find only the
  exact native session ID under `CODEX_HOME/sessions` or `archived_sessions`,
  validate its `session_meta.id`, and reject duplicate or mismatched files.
  Connect this reader to history, previews, paging and live tails. Cache and
  tail identity include the agent kind. Missing or unsupported sessions get
  explicit states. A superseded older-history request cannot enter a new chat.
- [`c934799`](https://github.com/cobanov/herdrchat/commit/c934799): Add the
  `herdrchat-codex` launcher. It enables hooks and forwards only this pane's
  three Herdr environment values through Codex's per-session shell environment
  policy. It preserves user arguments, does not replace `codex`, and does not
  bypass sandbox or hook trust. The app's Codex integration action installs
  the official integration plus this separately named helper.
- [`0331523`](https://github.com/cobanov/herdrchat/commit/0331523): A new matching
  transcript user record acknowledges phone delivery when the host cannot
  observe Codex's TUI composer. Never send a second Enter to Codex. Earlier
  identical messages cannot acknowledge a new prompt. Without confirmation,
  show a warning to inspect the host before retrying.
- [`a055255`](https://github.com/cobanov/herdrchat/commit/a055255): Filter shared
  app-server harness blocks while retaining a real prompt beside those blocks.
- [`0f94cb8`](https://github.com/cobanov/herdrchat/commit/0f94cb8): Keep
  underscores inside identifiers literal, for example `CODEX_PHONE_OK`.
- [`ca9eb07`](https://github.com/cobanov/herdrchat/commit/ca9eb07): Reload replaces
  the scoped local message cache as well as its byte cursor. Previously stale
  parsed bubbles returned on cold reopen even after a correct fresh read.
  Host transcript files, other chats and connection settings are untouched.

The existing SSH/socket transport, its fallback rules, native modules and
shared Codex/Herdr services were not changed or restarted. No newest-file,
cwd-only or title-based transcript fallback was added.

## Host setup and existing sessions

The Mac's official Codex integration is now v9. The named helper is installed
in `~/.local/bin`. Start future Codex sessions **inside a Herdr pane** with:

```bash
herdrchat-codex
```

For an existing unreported session, obtain the exact native ID from `/status`.
Once the agent is idle, exit it and resume the same session:

```bash
herdrchat-codex resume <session-id>
```

Review the Herdr hook in `/hooks` if Codex requests trust. Plain `codex` is not
globally wrapped. Running agents are not restarted by the app's install button.

For the user's currently active HerdrChat work session, the native ID and
rollout header were verified against that exact pane and its session metadata
was repaired without interrupting it or sending a prompt. Private conversation
contents and identifiers are not included in public artifacts.

## Verification

- TypeScript and Expo lint: zero errors. Jest: **430 passed, 6 opt-in live tests
  skipped**, 35 passing suites. New receipt, repeated-prompt, underscore and
  reload regressions were observed failing before their fixes.
- Real SSH to the Mac from an iPhone 17 Pro simulator, iOS 26.5. Two disposable
  Codex sessions used the same scratch folder and distinct exact session IDs.
  Each showed only its own messages, including after reload and reopening.
- Desktop-originated responses reached the matching phone thread. Phone
  composer input reached Codex and returned as a user record plus an assistant
  response, with its preview updating in the chat list.
- Starting the test session through the launcher, then issuing `/new`, caused
  the SessionStart hook to report the new native ID automatically. The old
  phone conversation disappeared, `FRESHCHAT` appeared, and the other chat
  retained `CODEX_BETA`.
- Both themes were opened and visually inspected. Table headers, cells, fenced
  JavaScript, the final reply, timestamp and composer remain legible and clear.
- A real tool turn lasted about 33 seconds before a **shared Codex code-mode
  host negotiation timeout**. Its tool call and later final Markdown response
  reached the app. The screenshot's generated `Tool / OK` row is rendering
  fixture text, not proof that the shell command succeeded. The shared service
  was not restarted to conceal that unrelated host failure.
- Four existing host-free Maestro flows passed: smoke, Settings, new chat and
  folder picker. The initial Codex flow caught the stale cache bug documented
  above. After the fix, the reusable Codex flow passed exact history, reload,
  phone delivery, list preview and same-folder isolation assertions. No stale
  harness bubble returned when the secondary conversation was reopened.
- The simulator's scoped SQLite cache independently contained one session
  signature per test workspace, two `CODEX_MOBILE_FINAL` records only in the
  primary (user and assistant), two `CODEX_BETA` records only in the secondary,
  no harness records and no remaining local echoes.
- Rapid reopen testing briefly showed an NIOSSH reconnect banner. The next
  cold open recovered without resending; the final response remained in the
  exact-session cache. This is not proof of physical network-loss recovery.
- [CI on the final implementation](https://github.com/cobanov/herdrchat/actions/runs/34860986057)
  passed on `ca9eb07`.
- [CI on the release source](https://github.com/cobanov/herdrchat/actions/runs/34861270732)
  passed on `523cbc8`.

Physical iPhone acceptance, APNs, a dropped real Tailscale connection and the
isolated host failure matrix remain open as documented in the
[UI report](ui-pass-2026-09-14.md). No Android build was made; its existing
build 56 artifact does not include this Codex work. Generic non-Claude agent
support in [issue 18](https://github.com/cobanov/herdrchat/issues/18) remains
broader than this Codex implementation and is not closed by it.

## Evidence and reproduction

The reusable [.maestro/codex-thread.yaml](../.maestro/codex-thread.yaml) flow
requires two disposable same-folder Codex sessions. Setup and unique-prompt
requirements are in [.maestro/README.md](../.maestro/README.md).
Only opened and inspected scratch-session screenshots belong in
[codex-pass-2026-09-14/](codex-pass-2026-09-14/). Raw logs, session files and
credential-entry artifacts are deliberately outside the repository.

Five screenshots were opened and inspected before inclusion: table/code in
both themes, the isolated secondary chat, the new session after `/new`, and
the completed phone-delivery round trip. After verification only the two
disposable test workspaces were closed; their transcript files were retained.
The user's existing Claude and Codex workspaces remained running.

## Reference implementations

The chosen approach keeps message rendering, not a raw terminal view:

- [HAPI's native Codex launcher](https://github.com/tiann/hapi/blob/main/cli/src/codex/codexLocalLauncher.ts)
  and [transcript locator](https://github.com/tiann/hapi/blob/main/cli/src/codex/utils/codexTranscriptLocator.ts)
  informed explicit session binding rather than guessing by working directory.
- [Happier's native session log resolver](https://github.com/happier-dev/happier/blob/dev/apps/cli/src/backends/codex/utils/resolveCodexNativeSessionLogPath.ts)
  uses the native ID and active/archived session roots.
- [Codex hooks documentation](https://learn.chatgpt.com/docs/hooks) documents
  SessionStart identity and hook trust. The locally installed CLI's config
  schema and an isolated test session verified per-session environment passing.
- [Herdr's official Codex hook](https://github.com/jerryfane/herdr/blob/master/src/integration/assets/codex/herdr-agent-state.sh)
  is the host-side reporter. No private upstream fork was installed.
