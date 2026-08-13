# Maestro flows

Run against a booted simulator with the app installed and Metro running:

```bash
maestro test .maestro/smoke.yaml .maestro/new-chat.yaml .maestro/folder-picker.yaml
```

| Flow | Covers | Needs a host |
|------|--------|--------------|
| `smoke` | launch, all three tabs, the host switcher | no |
| `settings` | host anchor, support, legal, danger zone | no |
| `new-chat` | the sheet's fields, permission mode, both exits | no |
| `folder-picker` | opening over the sheet, abandon vs. commit | no |
| `add-server` | that the connection test really connects | **yes** |
| `thread-back` | that a thread can be left by swiping, not only by the chevron | **yes** |
| `blocked-replies` | that a parsed option is tappable and delivers | **yes**, blocked |

`maestro test .maestro/` runs `add-server` and `thread-back` too, and fails
without a host — that is those flows doing their job, not a broken suite.

**`blocked-replies` has never been run.** It is written against the real
testIDs in `BlockedBar.tsx`, but no host with a blocked agent was reachable when
it was authored, so treat its first execution as authoring rather than
regression. It needs an agent driven into `blocked` first:

```bash
herdr agent prompt <pane> 'Ask me to choose between two options, then wait'
herdr agent wait <pane> --status blocked --timeout 60000
maestro test .maestro/blocked-replies.yaml -e WORKSPACE='<title>'
```

`agent wait` exiting 0 is the synchronisation point. Do not substitute a sleep —
polling the screen for a prompt is what makes this class of test flaky.

**Also not covered:** the chat-row swipe actions. Maestro's `swipe` can open the
panel, but the actions behind it are Rename and Close — one of which stops every
process in a workspace on a real machine. A flow that runs against a live host
must not have that as its failure mode, so the swipe is verified by hand.

## Credentials

`add-server.yaml` needs a real host, because the whole point of that flow is
that the connection test actually connects. It reads them from the environment
rather than the file, so no key is ever committed:

```bash
maestro test .maestro/add-server.yaml \
  -e HOST=100.x.y.z \
  -e USERNAME=you \
  -e SSH_KEY="$(awk '{printf "%s\\n", $0}' ~/.ssh/id_ed25519)"
```

The key must be a single line with escaped newlines — `inputText` cannot type a
multi-line value.

## Notes for writing flows here

- **Don't use `clearState`.** On a development build it also wipes the dev
  client's saved bundler URL, so the app launches into the launcher's server
  picker instead of the app.
- **Scroll before tapping anything below the fold.** `tapOn` does not scroll,
  and on a form it will silently leave focus where it was — a key typed into the
  username field looks like a flaky test but is actually a typo you wrote.
- **Chat rows are matched by `testID`, not by their label.** Each row is one
  accessibility element with a composed label (title, state, preview), which is
  correct for VoiceOver and means the title is not separately matchable.
- **A green run can mean nothing on a development build.** The dev-client menu
  is a separate window that Maestro's hierarchy cannot see, so a `runFlow: when:
  visible:` guard for it reports SKIPPED — while the window sits over the app
  swallowing every tap. Maestro then logs each `tapOn` as COMPLETED because it
  found the element in the hierarchy behind the menu. `launchApp` and scroll
  gestures both raise it. **If a flow passes but a screenshot shows the dev
  menu, the run proved nothing.** Screenshot the end state and look at it.
- **The bundler URL is not project-scoped.** `expo run:ios` points the dev
  client at whatever is on :8081, which may be a different project's Metro — the
  app then loads a foreign JS bundle and dies on a native module it has no
  reason to contain. Check `lsof -a -p <pid> -d cwd` before believing the crash.
