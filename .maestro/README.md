# Maestro flows

## The regression suite

`npm run e2e` runs `scripts/e2e.sh`: the flows under `regression/` plus the
Demo flows below, each in dark and light, against the built-in Demo host. The
E2E workflow runs the same script on demand with a Release build
(`gh workflow run e2e.yml --ref <branch>`); it is slow, so the local run is the gate.
Every fix and feature adds a flow here (or a jest test), so a phone is not
where regressions are found.

| Flow | Covers |
|------|--------|
| `regression/chat-list` | pin and mute (swipe right, long press), the Pinned group appearing on screen, the trailing swipe opening and closing |
| `regression/new-chat` | Start reachable with the keyboard up, Cancel |
| `regression/omp` | an OMP chat read by its journal path, its folded tool run and provider-free model name, a reply, mute and unmute |
| `regression/welcome` | the four welcome pages (Next and a swipe), the setup guide link, the star card, closing on the Demo, and its two Settings rows |
| `regression/thread` | the row and the header titled by the Claude session with the workspace below, effort in the header, a folded tool run with a failure, a two-part question advancing without reopening the chat, hiding the keyboard, the `/` palette, the `/model` panel with "this session only", the `/effort` slider |
| `regression/keyboard` | pulling the conversation down takes the keyboard with it and the composer stays above the keys and the home indicator (two screenshots to open) |
| `regression/composer-keys` | Return sends from the composer; with Settings > "Return sends" off, Return keeps the draft and sends nothing; the setting put back |
| `regression/menu` | the Chats menu: its rows, Settings, Hosts and New chat each opening as a sheet and Done landing back on the same list, and a cold `herdrchat://settings` link whose Done lands on the chats (screenshot `menu-<appearance>` with the menu open) |
| `regression/host-editor-keyboard` | the host editor's private key field reachable and typed into with the keyboard up (open the screenshot: the field must sit above the keys) |
| `regression/folder-trust` | Claude's folder-trust question on a first start: shown with the folder, no numbers, answered with the arrows, the reply after it |
| `regression/multi-agent` | a workspace with two agents: a row for each under it titled by its session, a thread with only that agent's lines, titled by its session, with the workspace and its name in the header, a reply landing on that agent's row alone, unread kept per agent |
| `regression/machines` | a machine saved on the host (the Demo's `nuku`) listing its chat in the host's list as `chat-row-demo-nuku-w1`, its line led by the machine, its thread titled by its session with the machine leading the header, a reply sent through the jump landing on its row and not on the host's `w1` (screenshots `machines-list-<appearance>`, `machines-<appearance>`) |
| `regression/host-theme` | a host's `~/.herdrchat/theme.json`: Settings says Default, the Demo agent writes a theme, Reload theme names it, Reset to default puts the app back on its own colours |

Maestro cannot press hardware-keyboard key commands, so these are checked by
hand on an iPad with a keyboard, after a native build:

- Shift-Return starts a new line, also over a selection, and right after
  picking a `/` command from the suggestions (the newline goes at the end, not
  where the caret was before the pick) and after a send.
- Command-Return sends, with "Return sends" on and off.
- With "Return sends" off, Return and Shift-Return both start a new line.
- Return on an empty draft, or while a send is in flight, does nothing and
  keeps the draft.
- Return that commits a Chinese or Japanese candidate commits it and does not
  send.
- Command-V with a copied picture attaches it. Expect the system "Allow Paste"
  prompt unless Settings > HerdrChat > Paste from Other Apps is Allow; the
  attach menu's "Paste Picture" asks the same.
- Command-V with copied text pastes the text with no "Allow Paste" prompt.
- Command-V with a picture and text both on the pasteboard (a copied web page)
  pastes the text.
- At four pictures, Command-V with a picture does nothing new.

On an iPhone, with no hardware keyboard: the keyboard's Return key reads Send
with the setting on and return with it off, also after flipping the setting
while the composer was focused; with it on, Return sends and there is no way to
type a newline but turning the setting off, as its footnote says.

A fresh install with no host opens on the welcome, so every flow runs
`regression/_skip-welcome.yaml` right after launching.

The app opens on Chats; Hosts, Settings and New chat sit behind its "…" menu
(`chats-menu`) and open as sheets closed by Done (`header-close`). Flows reach
them through `regression/_menu.yaml` with `ITEM` set to the row's text, never
by tapping a screen's name on its own: the name is also a menu row and a sheet
title, so assert something only that screen renders. Leaving a sheet is
proved the same way: assert the sheet's own element is gone, since the chats'
title is still in the hierarchy behind a page sheet.

The Demo understands a few phrases for this (`src/lib/demo/scenarios.ts`):
`/model`, `/effort`, "ask me two questions", "run the checks", "open a new folder",
"restyle the app".


Run against a booted simulator with the app installed and Metro running:

```bash
maestro test .maestro/smoke.yaml .maestro/new-chat.yaml .maestro/folder-picker.yaml
```

| Flow | Covers | Needs a host |
|------|--------|--------------|
| `smoke` | launch, the host switcher, Settings and Hosts from the Chats menu, back to Chats | no |
| `scene-lifecycle` | Release launch, background return, warm and cold links on iOS 27 and older runtimes | no, selects Demo explicitly |
| `settings` | host anchor, support, legal, danger zone | no |
| `new-chat` | the sheet's fields, permission mode, both exits | no |
| `folder-picker` | opening over the sheet, abandon vs. commit | no |
| `add-server` | that the connection test really connects | **yes** |
| `host-editor-check` | one host's Test connection, ending on the result you name (`EXPECT_ID`: `test-ok`, `connection-recovery`, `test-key-changed`); used for each failure mode against an isolated sshd | **yes**, env only |
| `thread-back` | that a thread can be left by swiping, not only by the chevron | **yes** |
| `thread-bottom` | initial bottom, jump, reload and reopen | **yes**, final reply `HELLO` |
| `thread-opening` | iPhone initial bottom, background return, reopen, draft and reload in both themes | no, selects Demo explicitly |
| `thread-scroll` | a reader in history stays there across a background return, and sending brings them to the end, in both themes | no, sends only to local Demo |
| `tool-activity` | tool runs folded into a summary line by default, the header switch opens them, in both themes; clear the stored choice first (see the flow) | no, selects Demo explicitly |
| `thread-header` | floating glass header, long title, keyboard and scrolling under it; includes `thread-opening` | no, sends only to local Demo |
| `composer` | multiline draft, keyboard and final-message clearance screenshot | **yes**, final reply `HELLO` |
| `thread-empty` | usable initial conversation before the first transcript exists | **yes**, unprompted agent |
| `blocked-replies` | that a parsed option is tappable and delivers | **yes**, blocked |
| `codex-thread` | exact Codex history, same-folder isolation, reload and phone delivery | **yes**, two disposable Codex sessions |
| `tablet-demo` | iPad split chats/settings, rotation, composer, reply and action sheets (cancelled) | no, selects Demo explicitly |

Run `tablet-demo` on an iPad simulator with `-e APPEARANCE=Dark`, then `Light`.
Use `--test-output-dir` outside the repository and open its screenshots: the
keyboard must not cover the composer or final reply, and content must stay
readable in portrait and landscape. This is demo acceptance, not an SSH test.

`maestro test .maestro/` runs `add-server` and `thread-back` too, and fails
without a host, that is those flows doing their job, not a broken suite.

`blocked-replies` passed against a real Claude AskUserQuestion prompt on
2026-09-14. It needs a disposable agent driven into `blocked` before each run:

```bash
herdr agent prompt <pane> 'Use AskUserQuestion to ask me to choose Blue or Green, then wait'
herdr agent wait <pane> --until blocked --timeout 60000
maestro test -e BLOCKED_WORKSPACE_ID='<workspace-id>' .maestro/blocked-replies.yaml
```

`agent wait` exiting 0 is the synchronisation point. Do not substitute a sleep,
polling the screen for a prompt is what makes this class of test flaky.

**Not covered against a real host:** the chat-row swipe actions. Maestro's `swipe` can open the
panel, but the actions behind it are Rename and Close, one of which stops every
process in a workspace on a real machine. A flow that runs against a live host
must not have that as its failure mode, so the swipe is verified by hand.

## Credentials

`codex-thread.yaml` requires two disposable Codex sessions in the same folder.
Install the official integration with `herdr integration install codex`, then
start each session with `herdrchat-codex` inside its own Herdr pane. Confirm
`herdr agent list --json` reports different native session IDs. Give the primary
a table/code rendering prompt ending in `RENDERDONE`, and ask the secondary to
reply exactly `CODEX_BETA`. Run with the test host already selected:

```bash
maestro test -e PRIMARY_WORKSPACE_ID='<primary-id>' \
  -e SECONDARY_WORKSPACE_ID='<secondary-id>' .maestro/codex-thread.yaml
```

This flow sends one harmless prompt to the primary. Recreate that fixture before
repeating the flow, so an old identical reply cannot satisfy its assertion.
For session rotation, issue `/new` in the disposable primary pane, verify its
reported native ID changes, and check that only its new conversation appears.
Do not guess a transcript by folder or latest modification time. Inspect every
published screenshot, and keep raw artifacts outside the repository.

`add-server.yaml` needs a real host, because the whole point of that flow is
that the connection test actually connects. It reads them from the environment
rather than the file, so no key is ever committed:

```bash
maestro test \
  -e HOST=100.x.y.z \
  -e USERNAME=you \
  -e HERDR_PATH=/absolute/path/to/herdr \
  -e SSH_KEY="$(< /path/to/existing/test-key)" \
  .maestro/add-server.yaml
```

Pass the key with real newlines, not literal `\n` sequences. The flow uses
[setClipboard](https://docs.maestro.dev/reference/commands-available/setclipboard)
and [pasteText](https://docs.maestro.dev/reference/commands-available/pastetext)
to fill the multiline control. Keep Maestro's output directory outside the
repository: command logs and failed screenshots may contain the key. Never
upload those raw artifacts to CI or a public issue.

For the full suite, also pass `WORKSPACE_ID` (a disposable thread with enough
history to scroll and a final `HELLO` reply) and `BLOCKED_WORKSPACE_ID` (a
different disposable thread with a pending two-option question), and
`EMPTY_WORKSPACE_ID` (a third, newly started agent with no prompts). Select that
host in the app before starting. Do not use production conversations as fixtures.
Open the `composer-multiline` screenshot after running: the full final bubble
and its timestamp must be above the composer. A green accessibility assertion
cannot detect overlapping views by itself.

## Notes for writing flows here

- `launchApp` restarts by default. Use `launchApp: { stopApp: false }` after
  Home when testing a background return, otherwise the test checks a cold start.
- **Don't use `clearState`.** On a development build it also wipes the dev
  client's saved bundler URL, so the app launches into the launcher's server
  picker instead of the app.
- **Scroll before tapping anything below the fold.** `tapOn` does not scroll,
  and on a form it will silently leave focus where it was, a key typed into the
  username field looks like a flaky test but is actually a typo you wrote.
- **Submit a single-line field with `pressKey: enter` before tapping a lower
  button.** XCTest can report controls behind the keyboard as visible, which
  makes `scrollUntilVisible` finish too early.
- **Chat rows are matched by `testID`, not by their label.** Each row is one
  accessibility element with a composed label (title, state, preview), which is
  correct for VoiceOver and means the title is not separately matchable.
- **A green run can mean nothing on a development build.** The dev-client menu
  is a separate window that Maestro's hierarchy cannot see, so a `runFlow: when:
  visible:` guard for it reports SKIPPED, while the window sits over the app
  swallowing every tap. Maestro then logs each `tapOn` as COMPLETED because it
  found the element in the hierarchy behind the menu. `launchApp` and scroll
  gestures both raise it. **If a flow passes but a screenshot shows the dev
  menu, the run proved nothing.** Screenshot the end state and look at it.
- **The bundler URL is not project-scoped.** `expo run:ios` points the dev
  client at whatever is on :8081, which may be a different project's Metro, the
  app then loads a foreign JS bundle and dies on a native module it has no
  reason to contain. Check `lsof -a -p <pid> -d cwd` before believing the crash.
