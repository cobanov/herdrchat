# Maestro flows

Run against a booted simulator with the app installed and Metro running:

```bash
maestro test .maestro/smoke.yaml .maestro/new-chat.yaml .maestro/folder-picker.yaml
```

| Flow | Covers | Needs a host |
|------|--------|--------------|
| `smoke` | launch, all three tabs, the host switcher | no |
| `scene-lifecycle` | Release launch, background return, warm and cold links on iOS 27 and older runtimes | no, selects Demo explicitly |
| `settings` | host anchor, support, legal, danger zone | no |
| `new-chat` | the sheet's fields, permission mode, both exits | no |
| `folder-picker` | opening over the sheet, abandon vs. commit | no |
| `add-server` | that the connection test really connects | **yes** |
| `thread-back` | that a thread can be left by swiping, not only by the chevron | **yes** |
| `thread-bottom` | initial bottom, jump, reload and reopen | **yes**, final reply `HELLO` |
| `thread-opening` | iPhone initial bottom, background return, reopen, draft and reload in both themes | no, selects Demo explicitly |
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
