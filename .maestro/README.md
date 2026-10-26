# Maestro flows

## The regression suite

`npm run e2e` runs `scripts/e2e.sh`: the flows under `regression/` plus the
Demo flows below, against the built-in Demo host, split over two simulators
(the script makes the second from the booted one). Most run in Dark only; the
screens looked at most (`BOTH_THEMES` in the script) run in Light too, and
`E2E_APPEARANCES="Dark Light"` runs everything in both. `npm run e2e -- changed`
runs only the flows the uncommitted changes can reach (`flows_for` in the
script), and `E2E_DRY_RUN=1` lists the runs without starting any. A run is
killed after eight minutes and a failed one is tried once more. The
E2E workflow runs the same script on demand with a Release build
(`gh workflow run e2e.yml --ref <branch>`); it is slow, so the local run is the gate.
Every fix and feature adds a flow here (or a jest test), so a phone is not
where regressions are found.

| Flow | Covers |
|------|--------|
| `regression/chat-list` | pin and mute (swipe right, long press), the Pinned group appearing on screen, the trailing swipe opening and closing |
| `regression/new-chat` | Start reachable with the keyboard up, Cancel |
| `regression/omp` | an OMP chat read by its journal path, its folded tool run and provider-free model name, a reply, mute and unmute |
| `regression/grok` | a Grok chat (`w8`, "infra") read from its ACP update log, found by its session id: the row named Grok with its last reply, the model (`grok-5`) in the header, its thought and command folded into one run, a reply sent and confirmed rather than "Failed to send" (screenshots `grok-row-<appearance>`, `grok-thread-<appearance>`) |
| `regression/agy` | an Antigravity chat (`wA`, "assets") read from agy's conversation log, found by its id: the row named Antigravity, the model (`Gemini 3.8 Flash (High)`) in the header, its thought and command folded into one run, a reply sent and confirmed rather than "Failed to send" (screenshots `agy-row-<appearance>`, `agy-thread-<appearance>`) |
| `regression/welcome` | the four welcome pages (Next and a swipe), the setup guide link, the star card, closing on the Demo, and its two Settings rows |
| `regression/thread` | the row and the header titled by the Claude session with the workspace below, effort in the header, a folded tool run with a failure, a two-part question advancing without reopening the chat, hiding the keyboard, the `/` palette, the `/model` panel with "this session only", the `/effort` slider, a Bash permission prompt showing its tool, description, command, warning and auto-deny time above the question (`blocked-details` screenshot) |
| `regression/keyboard` | pulling the conversation down takes the keyboard with it and the composer stays above the keys and the home indicator (two screenshots to open) |
| `regression/composer-keys` | the software keyboard's Return in the composer starts a new line and sends nothing, with Settings > "Return sends" on and off; the setting put back. Hardware Return, Shift-Return, Option-Return and Command-Return are key commands Maestro cannot press: jest covers them (`composerKeys.test.ts`, `Composer.test.tsx`) and the hand checks below |
| `regression/menu` | the Chats menu: its rows, Settings, Hosts and New chat each opening as a sheet and Done landing back on the same list, and a cold `herdrchat://settings` link whose Done lands on the chats (screenshot `menu-<appearance>` with the menu open) |
| `regression/list-modes` | the chats title as a picker: Agents listing each agent as a row of its own (`chat-row-w2` for the one-agent w2, `chat-row-w6:p1` and `chat-row-w6:p2` for w6's two, by `agentTestKey`), titled by its session with its workspace on its line, a row opening that agent's own thread, and no terminal row (`terminal-row-w6:p3`) among them, and Spaces bringing back w6's card with its two agents and its shell pane's terminal row under it; `scripts/e2e.sh` clears the saved choice around it (screenshots `list-agents-<appearance>`, `list-spaces-<appearance>`) |
| `regression/host-editor-keyboard` | the host editor's private key field reachable and typed into with the keyboard up (open the screenshot: the field must sit above the keys) |
| `regression/folder-trust` | Claude's folder-trust question on a first start: shown with the folder, no numbers, answered with the arrows, the reply after it |
| `regression/multi-agent` | a workspace with two agents: a row for each under it titled by its session, a thread with only that agent's lines, titled by its session, with the workspace and its name in the header, a reply landing on that agent's row alone, unread kept per agent |
| `regression/host-theme` | a host's `~/.herdrchat/theme.json`: Settings says Default, the Demo agent writes a theme, Reload theme names it, Reset to default puts the app back on its own colours |
| `regression/subagents` | a subagent's card in the thread running, then done; its chevron opening the agent's own transcript, read only, with its type and its answer; the review workflow's card opening its run with both phases and an agent still running; a workflow agent opening its transcript (screenshots `subagent-running`, `subagent-thread`, `workflow`) |
| `regression/agents-pane` | Claude Code's agents pane as the bar above the composer, from the Demo's "delegate the review" (`delegateScreen`): folded to `2 agents working · …`; the live preview showing the reply, never a row (`general-purpose`, `tokens`, `more`); opened, the General row with the subagent's description, the Fork row, `1 more in the terminal`; the General row's time changing between two reads; the row opening the subagent's transcript; the bar gone once the delegation ends (screenshot `agents-bar-<appearance>`: the kinds in one column, the times on the right) |
| `regression/slash-commands` | the `/` palette from the Demo's catalogue: Built-in and Skills sections, a built-in's hint (`/model [model]`), the hidden built-in left out, narrowing to one headerless ranked list (`/release-notes`, then `/review`), `/review` (optional `[pr]`) sent at once and answered, `/add-dir` filling in with its required `<path>` hint after it until something is typed, `/compact` (it rewrites the conversation) only filled from a fresh `/`, then sent by hand with its note in the thread, the notes folder's own `/notes:summarise` (screenshots `slash-palette-<appearance>`, `slash-filled-<appearance>`: the hint must start right after the caret) |
| `regression/shell-commands` | a `!` command as one block in the thread: the Demo notes chat's seeded `! git status --short` with its two lines of output, the hint above the composer once `!` is typed in a Claude chat, a sent `! ls` landing as a block with the Demo's three-file listing under it and its echo confirmed rather than "Failed to send" (screenshots `shell-seeded-<appearance>`, `shell-<appearance>`: the output box must read as a terminal, stdout in the label colour) |
| `regression/terminal` | the Demo's shell pane `w6:p3` as a terminal row under its card (`terminal-row-w6:p3`), opening its terminal (Connected, no Reconnect, no Take over), the accessory bar's Tab, Esc and sticky Ctrl, the keyboard from the bar's own control and `ls` typed; then a chat's header Terminal (`thread-terminal`) opening its agent's pane, and back to the chat (screenshots `terminal-row-<appearance>`, `terminal-<appearance>`: the recorded prompt, `ls` listing and coloured `git status` with `ls` echoed after the last prompt, in the app's colours; `terminal-agent-<appearance>`) |
| `regression/space-layout` | Spaces: w6 "api" as a space card titled by its label with its stats (`2 agents, 1 working · 2 tabs · 4 panes · demo/api`), its two agents' rows and its shells' terminal rows (`w6:p3`, and `w6:p4` "npm run dev") under it, grouped by tab: the agents and the shell under their tab's name (`tab-header-w6:t1`, "api"), the dev server after a line and its tab's name (`tab-header-w6:t2`, "server"), w7's one tab with neither; its layout button (`space-layout-w6`) opening the sheet with both tabs and every pane as a box (`layout-pane-w6:p3`), that box closing the sheet and opening the shell's terminal, the card itself opening the same sheet and Done closing it; w2 "notes" (one agent, nothing else) still a chat card titled by its session, with no layout button and no agent row; w7 "site" (one agent and one shell) a space card (`1 agent · 1 tab · 2 panes · demo/site`) with its agent's row (`pane-row-w7:p1`, opening the workspace's chat) and its terminal row under it, and its layout drawing the agent above the shell (screenshots `space-tab-groups-<appearance>`: "api" over the agents and the shell, a hairline inset to the rows' text, then "server" over the dev server, both quieter than the rows, the rail unbroken; `space-layout-<appearance>`: two tabs, the agents side by side with the shell under the first, the dev server alone in the second; `space-agent-shell-<appearance>`: w7's card, agent row and terminal row) |

The shell block against a real Claude Code, checked by hand on a phone
(Gimel), in light and dark, since the Demo cannot reproduce a real record:

- `! pwd` and `!pwd` from the phone, and `!pwd` typed in the desktop TUI: one
  block each, the echo confirmed, never "Failed to send".
- `! ls -la | head`: symlinks read `->`, not `-&gt;`.
- `! ls /nope`: the error in the attention colour.
- `! seq 1 200`: folded with "Show all 200 lines", opening and closing.
- `! sleep 3; echo done`: "Running" until `done` lands.

Maestro cannot press hardware-keyboard key commands, so these are checked by
hand on an iPad (or an iPhone) with a keyboard, after a native build:

- Return sends with "Return sends" on.
- Shift-Return and Option-Return each start a new line, also over a selection,
  and right after picking a `/` command from the suggestions (the newline goes
  at the end, not where the caret was before the pick) and after a send.
- Command-Return sends, with "Return sends" on and off.
- With "Return sends" off, Return, Shift-Return and Option-Return all start a
  new line.
- Return on an empty draft, or while a send is in flight, does nothing and
  keeps the draft.
- Return that commits a Chinese or Japanese candidate commits it and does not
  send.
- With a Japanese keyboard mid-composition (underlined candidate showing),
  Shift-Return does not send and does not break the line under the candidate.
- Command-V with a copied picture attaches it. Expect the system "Allow Paste"
  prompt unless Settings > HerdrChat > Paste from Other Apps is Allow; the
  attach menu's "Paste Picture" asks the same.
- Command-V with copied text pastes the text with no "Allow Paste" prompt.
- Command-V with a picture and text both on the pasteboard (a copied web page)
  pastes the text.
- At four pictures, Command-V with a picture does nothing new.
- On Android with a hardware keyboard, the same list with Enter for Return,
  Ctrl-Enter for Command-Return, Alt-Enter for Option-Return and Ctrl-V for
  Command-V (Android asks no "Allow Paste").

On an iPhone or an Android phone, with no hardware keyboard: the keyboard's
Return key reads return and starts a new line, with the setting on and off; it
never sends.

### Terminal, by hand on a device

The Demo's terminal is an echo shell fed a recording, so the flow above proves
the screen, not the attach. After a native build, on a real host (Gimel), with
herdr open on the desktop as well, check each of these and what it should do:

- **Nothing moves on the desktop.** On Gimel, note which workspace, tab and
  pane the desktop shows, and its sidebar. Open a shell pane's Terminal row
  from the iPad: the iPad shows that pane alone (no herdr sidebar, no
  header), and on the desktop nothing zoomed, focus did not move and the
  sidebar did not change. Type in it and back out: still nothing moved on the
  desktop. The pane's size follows the iPad while attached and comes back on
  leaving; that is the only shared effect.
- **Two of our clients on one pane.** While the iPad holds a shell pane's
  terminal, open the same pane from the phone: the phone's banner says "herdr
  could not attach. Another client may be attached to this pane, or it may
  have closed." with Take over beside Reconnect, and the iPad is untouched.
  Reconnect on the phone is refused the same way. Tap Take over: the phone
  shows the pane, and the iPad's terminal ends; record what its header says
  (expected "Ended", or "Ended with exit N"). Reconnect on the iPad is then
  refused, with Take over offered, until the phone leaves; after that it
  attaches again.
- **Android.** On an Android phone, open a shell pane's and an agent pane's
  terminal: both draw in the app's colours; the first tap brings up the
  keyboard and typing reaches the pane (Return, Delete, the bar's Esc, Tab,
  arrows and sticky Ctrl: Ctrl then `c` stops a running command); a swipe up
  scrolls the pane's history in herdr rather than selecting; a pinch changes
  the font size and the pane follows; Paste on the bar pastes. A login shell
  from the Computers tab opens without a MOTD in front of it.
- **Locked or backgrounded while attached.** Attach a shell pane's terminal,
  then lock the phone (or go to the home screen). On the desktop the pane gets
  its own size back within a second or two. Unlock: the terminal says "Hung
  up" and does not reconnect by itself; Reconnect attaches again.
- **The keyboard resizes the desktop pane once.** With the terminal open,
  show and hide the keyboard: the desktop pane redraws once per show or hide,
  not through the animation.
- **The app killed while attached.** Attach a shell pane's terminal, then
  kill the app (swipe it away). On the desktop, check the pane got its own
  size back, and note how long that took. Reopen the app and the same pane's
  Terminal row: record whether it attaches without Take over, or is refused
  ("Another client may be attached") because herdr still holds the dead
  client, and if so how long until a Reconnect attaches. A refusal here means
  the person has to take the pane from their own ghost session.
- **Leaving while connecting.** Open a shell pane's Terminal row and tap Back
  while the header still says Connecting…. Then do the same checks: the
  desktop's pane has its own size, nothing else moved, and opening the pane
  again attaches without Take over (record how long, if not at once).
- **An agent pane through a chat's header Terminal.** Watch the desktop: does
  the agent's pane shrink to the phone's size while the phone is attached
  (`agent attach` draws it at the client's size), and get its size back on
  leaving? Nothing else on the desktop should move.
- **Phone upright, on its side, and the iPad.** The pane alone at every
  width: no herdr sidebar or header, whatever the size (on iPad, the width of
  the detail column).
- **Scrolling.** After `git log` (or in an agent's pane), a one-finger swipe up
  scrolls herdr's history of the pane, a swipe down comes back; it does not
  select text or drag a split. A tap still clicks. A pinch
  changes the font size and moves nothing in herdr. On an iPad with a
  trackpad, a two-finger scroll does the same as the swipe (it is an
  indirect scroll event, which the wheel gesture accepts).
- **Programs.** `htop` (colours, live, `q` quits), `vim` (arrows, Esc from the
  bar, `:q`), a `git log` with colours, the agent's own `/model` panel through
  the header Terminal.
- **iPad with a keyboard.** Right after opening, without a tap: Ctrl-C stops a
  running command, the arrows move, Option acts as Meta, Command-K clears the
  scrollback. Ctrl-B is herdr's prefix and does not reach the program.
- **Rotation.** Rotate the iPad: the pane redraws at the new size, nothing
  left over from the old one.
- **Light and dark.** Screenshot a shell pane and an agent pane in both: what
  herdr draws should sit on the app's terminal background, not clash with it.
- **klaw through the machine jump.** Open a shell pane on klaw: the same
  private attach, through the host, with the header naming klaw (klaw's herdr
  must be 0.9 or newer, or the screen says so).
- **iPad: beside the sidebar, not over it.** In Spaces, open a shell pane's
  Terminal row: the terminal fills the detail column with the chats still on
  the left, that row lit as an open agent's row is, and no workspace card or
  chat row lit. Its header sits where a chat's does in the same column, with
  no gap on its left. Its leading control is an ✕, Close, not a Back
  chevron: it shows "Select a conversation" again.
- **iPad: a chat's Terminal swaps the detail.** Open a chat, tap its header's
  Terminal: the terminal replaces the chat in the column (the chat's row is no
  longer lit). Its Back is labelled with that chat's name and brings it
  back. Open another pane's Terminal row while a terminal is open: it
  replaces it, Back still goes to that chat, and the desktop shows the first
  pane got its own size back (its shell hung up). Close a workspace from the
  sidebar while a terminal on one of its panes is open: the terminal goes
  too.
- **iPad: narrow and upright.** Rotate to portrait, then narrow the app with
  Split View to its smallest: the terminal goes on alone, its Back still goes
  where it came from. At the narrowest two-column split (the column is
  448pt) the accessory bar shows Esc, Tab, Ctrl and Alt without a scroll,
  the rest scrolling sideways, Paste and the keyboard control still beside
  it. At Split View's one third (320pt) Alt scrolls in, as it does on a
  320pt phone (`barFit.test.ts` pins both). At the widest two-column split
  and the narrowest, the pane redraws at the column's size.
- **iPad: klaw in the column.** Open a shell pane on klaw from the sidebar:
  the same, with the header naming klaw and its row lit.
- **iPad: a link.** There is no documented `herdrchat://` terminal link; if
  one is added, it must land in the column (the route hands over to the
  detail), never as a second screen over the split.

### Spaces cards, by hand on a device

Maestro has no pointer and no real host, so after a build, with the app on
Gimel, check these on the iPad (with a trackpad or mouse) and on the phone, in
light and dark:

- **Hover on iPad.** Rest the pointer on the layout button of `herdrchat`'s
  card: after a moment the layout card appears beside the list, level with
  the button, at its full width, and moving the pointer away (not onto the
  card) makes it vanish. Moving straight from the button onto the card keeps
  it. Sweeping the pointer down the list across several buttons does not
  flash a card at each one, and the card never covers the buttons below.
  Hover goes through the native `HerdrHover` view (React Native's own
  `onHoverIn` never fires on iOS in this build), so it needs a native build
  with it; on an older build only a tap shows the card.
- **Pinned on iPad.** Tap the button (or the card): the layout card stays
  when the pointer leaves. A tap anywhere outside it closes it, on the list
  or in the open thread beside it (that tap does not also land in the
  composer); so does its Close, and so does Esc on a hardware keyboard (this
  needs the native build with `HerdrEscape`; on an older build Esc does
  nothing and the other two still work). With the composer focused before
  the card was pinned, closing the card gives the composer its focus back:
  typing goes on without tapping the field.
- **Narrow iPad window** (Split View, the list alone): the card hangs under
  or over the button inside the list instead.
- **A box opens its pane.** In the card, tap an agent's box: the box dims
  under the finger, the card closes and that agent's chat opens beside the
  list. Tap a shell's box: its terminal opens, attached privately as its
  terminal row does. Then the cases that used to swallow the tap: with the
  composer focused and typing, show the card by hover and click a box (one
  click opens it, it does not just put the keyboard away); and hold a click
  on a box of a hovered, unpinned card for a second before letting go (the
  card stays and the pane opens).
- **The phone.** The button and the card open the layout as a sheet sized to
  its tabs; Done closes it; a box dims under the finger, the sheet slides
  away and then its pane opens, every time, for an agent's box and a
  shell's.
- **All tabs.** `play` (four tabs) draws all four, each titled by herdr's tab
  label, the active one ringed, side by side two to a row.
- **A machine.** A workspace on klaw draws its one tab, titled `klaw · <label>`
  on its card.
- **One agent and nothing else** (a workspace with no shell pane) is still a
  chat card titled by its session, with no layout button; the same workspace
  with a shell split beside the agent becomes a space card with the agent as
  a row under it, then the terminal.
- **Rows grouped by tab.** `play` (four tabs): the rows under its card come
  tab by tab in the tabs' order, each tab's agents then its terminals; a
  hairline between tabs, inset to the rows' text, with the rail running
  unbroken through it; a small, quiet header with the tab's name above each
  named tab's rows (the first tab's too, with no line above it), and only the
  line for a tab herdr labels with its number. A search that leaves rows in
  one tab shows no line; a one-tab workspace shows neither. Check light and
  dark.
- **Agents view unchanged.** Switch to Agents: every agent is its own row as
  before, titled by its session, no terminal rows, no layout buttons.

A fresh install with no host opens on the welcome, so every flow runs
`regression/_skip-welcome.yaml` right after launching.

`regression/_open-settings.yaml` and `_close-settings.yaml` wrap the menu for
flows that only need Settings.

The app opens on the chats list, titled by its view (Spaces or Agents, picked
by tapping the title, `chats-view`), above a tab bar of Chats and Computers
(`tabs.yaml`). New chat is the header's "+" (`header-action`), Settings its gear
(`chats-settings`) and Hosts the host's name under the title (`server-switcher`);
each opens as a sheet closed by Done (`header-close`). Flows reach them through
`regression/_menu.yaml` with `ITEM` set to the screen's name, and assert
something only that screen renders, never its name, which is also a sheet title. Leaving a sheet is
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
| `screenshots-ipad` | the README's iPad screenshots, in landscape on the Demo: the list beside a chat with a subagent card (`ipad-split`), `w6`'s layout as the floating card (`ipad-layout`), the shell `w6:p3`'s terminal beside the list (`ipad-terminal`), the list on Agents (`ipad-agents`) | no, selects Demo explicitly |

Run `tablet-demo` on an iPad simulator with `-e APPEARANCE=Dark`, then `Light`.
Use `--test-output-dir` outside the repository and open its screenshots: the
keyboard must not cover the composer or final reply, and content must stay
readable in portrait and landscape. This is demo acceptance, not an SSH test.

### The README's screenshots

`docs/screenshots/` holds the pictures the top-level README shows, copied
from a suite run on an iPhone 17 Pro simulator and from `screenshots-ipad` on
an iPad Pro 13-inch simulator, in dark:

```bash
E2E_DEVICE=<iphone udid> E2E_OUT=<out> npm run e2e
maestro --device <ipad udid> test -e APPEARANCE=Dark --test-output-dir <out> .maestro/screenshots-ipad.yaml
# Landscape is saved on its side with an EXIF orientation tag; turn the pixels
# upright and drop the tag, so every viewer shows it the same way:
ffmpeg -noautorotate -i <out>/.../ipad-split-Dark.png -vf transpose=2 docs/screenshots/ipad-split-dark.png
exiftool -overwrite_original -all= docs/screenshots/ipad-split-dark.png
# ipad-layout-dark.png is the left of its shot: -vf transpose=2,crop=1380:2064:0:0
```

| README image | Flow | Its screenshot |
|--------------|------|----------------|
| `chats-dark.png` | `regression/list-modes` | `list-spaces-Dark` |
| `thread-subagents-dark.png` | `regression/shell-commands` | `shell-seeded-Dark` |
| `ipad-split-dark.png` | `screenshots-ipad` | `ipad-split-Dark`, rotated |
| `ipad-terminal-dark.png` (also in Terminal) | `screenshots-ipad` | `ipad-terminal-Dark`, rotated |
| `ipad-layout-dark.png` | `screenshots-ipad` | `ipad-layout-Dark`, rotated, its left 1380 px |
| `agents-dark.png` | `regression/list-modes` | `list-agents-Dark` |
| `slash-palette-dark.png` | `regression/slash-commands` | `slash-palette-Dark` |

Open each before copying it: a flow that passes can still have caught the
screen mid-animation.

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
