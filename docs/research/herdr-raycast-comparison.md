# HerdrChat (iOS) vs. the Herdr Raycast extension

A read-only audit, 2026-08-05.

**Their tree:** `raycast/extensions` @ `45742065aea03ead3cc8098350607d3c1d42df35`, path
`extensions/herdr/`. MIT, by `vlste`, merged 2026-07-23 as PR #29669. ~57 source files,
~150 KB of TypeScript. Line references below are to that pinned tree.

**Our tree:** this repository @ `3ac7f04`. ~12 300 lines across `app/`, `src/`, `modules/`.

Nothing of theirs is copied into this repo. Where a design is clearly borrowed, the
backlog item says so.

---

## 0. Architecture map (ours), so the comparison is grounded

```
app/                            routes; thin, compose from src/features
  (tabs)/index.tsx              chat list          → useWorkspaces
  chat/[workspaceId].tsx        one thread         → useThread
  new-chat.tsx                  create + launch
  server/[id].tsx               host CRUD + connection test
src/lib/herdr/                  the herdr protocol. No React.
  transport.ts                  interface: exec(cmd) / streamLines(cmd)
  sshTransport.ts               SSH implementation, one per host
  client.ts                     typed herdr operations
  models.ts                     wire decoders
  protocol.ts                   {id,result}/{id,error} envelope
  shell.ts                      POSIX quoting + PATH prefix
src/lib/transcript/             Claude Code JSONL reader. No React.
  store.ts                      recent / older / tail / latestMessages
  parser.ts                     JSONL → ChatMessage
  blockedPrompt.ts              parse an on-screen choice menu
  livePreview.ts                scrape an in-progress answer off the screen
src/state/                      zustand + SQLite + keychain
modules/herdr-ssh/              TurboModule: Citadel (iOS) / sshj (Android)
```

The load-bearing decision: **everything is a shell command over one long-lived SSH
connection.** `HerdrTransport` (`src/lib/herdr/transport.ts:11-16`) is the only seam, which
is what lets the whole core be tested against a canned host.

Their equivalent seam is `runHerdr` (`src/lib/herdr.ts:92-123`) — `execFile` of a local
binary. Same shape, local instead of remote. That single difference explains most of what
follows: their round-trips cost ~5 ms, ours cost a network hop over Tailscale.

---

## 1. Inventory — ours

| Capability | Where | State |
|---|---|---|
| List workspaces | `client.ts:48` `workspace list` | complete |
| List agents / snapshot | `client.ts:43,53` | complete (decoder discards most of the payload — §3.1) |
| List panes | `client.ts:58` | complete, **unused by any screen** |
| Ping host | `client.ts:64` `status server` | complete |
| Install herdr on host | `client.ts:73` curl one-liner | complete, with one-tap recovery UI (`app/(tabs)/index.tsx:78-81`) |
| Browse host directories | `client.ts:92` `ls -1Lp` | complete |
| Read pane's visible screen | `client.ts:113` `--source visible` | complete |
| Create workspace | `client.ts:152` `workspace create --cwd --no-focus` | partial — no `--env`, no label-less tab/split variants |
| Start agent | `client.ts:163` `pane run <id> 'claude …'` | partial — see §4.1 |
| Send a message | `client.ts:135` `pane run <id> <text>` | partial — see §4.2 |
| Send raw keys | `client.ts:141` `pane send-keys` | complete |
| Wait for status | `client.ts:174` `agent wait --status --timeout` | complete |
| Permission modes | `permissionMode.ts` | complete, Claude-only |
| Transcript: recent window | `transcript/store.ts:80` | complete |
| Transcript: older pages | `transcript/store.ts:130` | complete |
| Transcript: live tail | `transcript/store.ts:183` | complete, byte-exact cursor |
| Transcript: batched previews | `transcript/store.ts:237` | complete, one round-trip for N workspaces |
| Blocked-prompt parsing | `transcript/blockedPrompt.ts` | complete |
| Live in-progress preview | `transcript/livePreview.ts` | **buggy** — §5 |
| Unread tracking | `src/lib/unread.ts`, `state/db.ts` | complete |
| Offline message cache | `state/threadCache.ts` | complete |
| Host key pinning (TOFU) | `SshConnection.swift:184-211` | complete |
| Push notifications | `features/notifications/push.ts` | complete on iOS, unverified against APNs |
| Tail watchdog | `useThread.ts:496-507` | complete |

**Not present at all:** interrupt/stop an agent, rename anything, close a
workspace/tab/pane, tabs, splits, zoom, named herdr sessions, git worktrees, plugins,
agent integrations, non-Claude agents, prompt history, environment variables,
agent naming.

## 2. Inventory — theirs

21 commands (`package.json`). Grouped:

| Group | Commands | Implementation |
|---|---|---|
| Browse | Dashboard, Manage Agents | `dashboard.tsx`, `agents.tsx`, both off one snapshot |
| Prompt | Prompt Agent (+ arg), history | `components/prompt-agent-form.tsx`, `lib/prompt-history.ts` |
| Launch | Start Agent (+ 3 args, Quicklink) | `components/start-agent-form.tsx`, `lib/agent-launch.ts` |
| Create | Workspace, Tab, Split, Worktree | `components/create-*-form.tsx`, `components/resource-forms.tsx` |
| Lifecycle | rename / close / zoom / interrupt / send-key / attach | `components/resource-actions.tsx` |
| Sessions | Manage Sessions | `sessions.tsx` — `session list/stop/delete` |
| Worktrees | Manage Git Worktrees | `worktrees.tsx` — `worktree create/remove` |
| Plugins | Manage Plugins | `plugins.tsx` — `plugin list/install/enable/disable/uninstall`, `plugin action invoke` |
| Integrations | Manage Agent Integrations | `integrations.tsx` — `integration status/install/uninstall` |
| Ambient | Menu bar | `menu-bar.tsx` |
| Hotkeys | 8 disabled-by-default no-view commands | `src/focus-*.ts`, `src/split-*.ts`, `src/toggle-zoom.ts`, `src/new-tab.ts` |

Preferences: binary path, default session, terminal app, custom launcher template,
refresh interval (2/5/10/30 s), output lines (80–600), focus behaviour, close-after-prompt,
show-idle-in-menu-bar.

---

## 3. Capability matrix

Gap type: `missing` · `partial` · `buggy` · `parity` · `we-are-ahead` · `platform-blocked`.

### Core control

| Capability | Ours | Theirs | Gap | Notes |
|---|---|---|---|---|
| One-call state snapshot | decodes ~30 % of payload; 2nd call for workspaces | one `api snapshot` feeds every view | **partial** | §3.1 |
| Send a prompt | `pane run` + status probe + Enter retry | `agent prompt <target>` | **partial** | §4.2 |
| Start an agent | `pane run 'claude …'` then poll | `agent start <name> --kind --pane --timeout` | **partial** | §4.1 |
| Interrupt / stop | — | `agent send-keys ctrl+c`, `esc` | **missing** | §4.3 |
| Arbitrary key send | ✅ `pane send-keys` | ✅ both pane and agent variants | parity | we target panes only |
| Named agents | — | `agent start <name>`, targeted by name | **missing** | `lib/herdr.ts:243-245` |
| Rename ws/tab/pane/agent | — | `<kind> rename <id> <name>` | **missing** | `resource-forms.tsx:30` |
| Close ws/tab/pane | — | `<kind> close <id>` + confirm | **missing** | `resource-actions.tsx:57-76` |
| Tabs / splits / zoom | — | full | **missing** | mostly desk ergonomics |
| Named herdr sessions | — | `HERDR_SESSION` + `session list/stop/delete` | **missing** | §4.6 |
| Worktrees | — | `worktree create/remove` | **missing** | |
| Plugins | — | `plugin *`, incl. trust confirmation | **missing** | |
| Integrations | detects absence, can't fix | `integration install/uninstall` | **missing** | §4.7 — we already diagnose it |
| Multi-agent kinds | Claude only | 21 kinds + aliases + icons | **missing** | `lib/types.ts:107`, `lib/agent-appearance.ts` |
| Env vars on create | — | `--env` on workspace/tab/split | **missing** | |
| Working-dir choice | host folder browser (`client.ts:92`) | native `Form.FilePicker` | parity | different means, same end |

### Reading the conversation

| Capability | Ours | Theirs | Gap | Notes |
|---|---|---|---|---|
| Structured transcript | Claude JSONL → typed bubbles | raw scrollback in a code fence | **we-are-ahead** | §6.1 |
| Live streaming | `tail -f` with byte cursor | re-read N lines every interval | **we-are-ahead** | |
| History paging | byte-anchored `older()` | fixed 80–600 line window | **we-are-ahead** | |
| Offline cache | SQLite, session-keyed | none | **we-are-ahead** | |
| Last-message previews | batched, 1 round-trip for N | none | **we-are-ahead** | `store.ts:237` |
| Full-screen TUI output | `--source visible` | `--source recent-unwrapped` | **we-are-ahead** | §6.2, and an upstream bug |
| Blocked-prompt labels | parsed choices | raw key sends | **we-are-ahead** | §6.3 |
| In-progress preview | scraped off screen | none | **we-are-ahead** (but buggy, §5) | |

### Plumbing

| Capability | Ours | Theirs | Gap | Notes |
|---|---|---|---|---|
| Command timeout | **none** | 30 s default, 70/120/300 s for long ops | **missing** | §4.4 — most serious finding |
| Poll interval | fixed 2 s / 3 s | user preference, clamped ≥ 2 s | **partial** | §3.2 |
| Backgrounded polling | no `AppState` awareness | n/a (Raycast unmounts) | **partial** | §3.3 |
| Error taxonomy | 6 codes | 8 codes, + stdout *and* stderr | **partial** | §4.5 |
| Binary discovery | manual path field | PATH + 4 dirs + override, cached | **partial** | |
| Protocol/version guard | comment only | reads `version`/`protocol` fields | **missing** | §4.8 |
| Retry on transport failure | ✅ once, native | ❌ | **we-are-ahead** | `SshConnection.swift:224-236` |
| Network-path invalidation | ✅ `NWPathMonitor` | n/a | **we-are-ahead** | `SshConnection.swift:88-105` |
| Host-key pinning | ✅ TOFU | n/a (local) | **platform-blocked** for them | |
| Credential storage | Keychain / SecureStore | Raycast prefs | **we-are-ahead** | |
| Injection safety | `shellQuote` everything | `execFile` argv (no shell) | **parity** | theirs is structurally safer; ours is tested (`paneParsing.test.ts:118+`) |
| Ambient status | push notifications | menu bar | **parity** | different platform idioms |
| Global hotkeys | — | 8 commands | **platform-blocked** | |
| Terminal focus | — | AppleScript per terminal | **platform-blocked** | |
| Quicklinks / deeplinks | — | `createDeeplink` presets | **partial** | iOS equivalent: Shortcuts / App Intents |

### 3.1 Snapshot decoding

`herdr api snapshot` returns one object. Their type (`src/lib/types.ts:77-88`) declares
`version`, `protocol`, `focused_*`, `workspaces`, `tabs`, `panes`, `agents`, `layouts`, and
`dashboard.tsx:36-39` consumes `workspaces`/`tabs`/`panes` straight off it — so the payload
demonstrably carries them.

Our `decodeSnapshot` (`src/lib/herdr/models.ts:272-283`) keeps `agents`, three focus ids and
`layouts`, and drops the rest. `useWorkspaces` then issues a **second** command,
`workspace list`, in parallel (`src/features/chats/useWorkspaces.ts:70`) for data the first
call already returned.

Their `PaneInfo` also carries fields we never decode: `interactive_ready`, `launch_pending`,
`revision`, `terminal_title`, `terminal_title_stripped`, `display_agent`, `name`, `title`,
`scroll{offset_from_bottom,max_offset_from_bottom,viewport_rows}`, and `AgentInfo.state_change_seq`.
`start-agent-form.tsx:54` filters candidate panes with `!pane.agent && !pane.launch_pending`
— exactly the readiness signal our start path currently infers by polling.

> Open question: `state_change_seq` is declared but I found no read of it anywhere in their
> tree. If herdr increments it per agent state transition it is a cheap change-detector for
> both of us. Not verified.

### 3.2 Poll cost

Ours, steady state:

| Screen | Commands per tick | Period |
|---|---|---|
| Chat list | `workspace list` + `api snapshot` (parallel) + batched preview read | 3 s |
| Thread | `api snapshot` + `pane read --source visible` when working **or** blocked | 2 s |

`useThread.ts:428,466,473`; `useWorkspaces.ts:70,75`.

Both loops are chained `setTimeout`s inside a `useEffect` whose cleanup runs only on unmount
or a dep change — neither of which happens when a route is *pushed* on top. Nothing in the
app configures `unmountOnBlur`, `freezeOnBlur` or `enableFreeze` (checked), so `(tabs)` stays
mounted beneath `chat/[workspaceId]` (`app/_layout.tsx:98-99`) and its 3-second poll keeps
running. Freezing wouldn't help even if it were on: react-freeze suspends rendering, not
already-scheduled timers.

So reading one conversation sustains roughly **2 remote commands per second over SSH**.
That figure is *derived* from the periods and per-tick command counts above, not measured —
worth confirming with a counter on `transport.exec` before quoting it anywhere load-bearing.
Theirs is one local `execFile` every 5 s by default, user-adjustable.

### 3.3 Background behaviour

`grep -rn AppState src app modules` → nothing. When iOS suspends us the timers stop mid-flight
and the SSH socket usually dies; on resume the first poll runs against a dead connection.
The native layer retries once and the `NWPathMonitor` catches route changes
(`SshConnection.swift:88-105`), which covers most of it — but the in-flight command that was
suspended has no deadline (§4.4), so an unlucky resume can wedge instead of erroring.

---

## 4. Deep dives

### 4.1 Agent lifecycle: start

**Theirs** (`components/start-agent-form.tsx:110-122`):

1. `prepareAgentPane(destination, …)` → creates the workspace / tab / split, or reuses a pane
   (`lib/agent-launch.ts:13-41`), always with `--no-focus`, and **returns the pane herdr
   reported** rather than re-deriving it.
2. `agent start <name> --kind <kind> --pane <id> --timeout 60000`, with the client-side
   timeout set to 70 s.
3. Only then `agent prompt <name> <initial prompt>`.
4. Optionally `agent focus`.

The form says it plainly (line 259): *"Herdr waits for the agent to become interactive before
sending the prompt or changing focus."* The readiness wait is herdr's job, done server-side,
in one blocking call.

**Ours** (`app/new-chat.tsx:91-95` → `client.ts:152,163`):

1. `workspace create --cwd <dir> --no-focus` → returns `root_pane`. Same as theirs. Good.
2. `pane run <rootPaneId> 'claude --permission-mode bypassPermissions'` — types a shell
   command into the new pane's shell.
3. Navigate to the thread immediately. `useThread` then polls until an agent appears and
   reports a session id, waiting up to 80 s before accusing the host of a missing integration
   (`useThread.ts:81`).

Why we're behind: **unimplemented, not architectural.** `agent start` gives, in one call,
the three things we currently reconstruct — a registered agent with a *name*, a `--kind` that
tells herdr which integration to attach (which is what produces `agent_session.value`, the
one field our entire transcript reader depends on), and a server-side readiness wait. We
launch a bare process and hope herdr's screen detection notices it.

iOS-native equivalent: unchanged UI. `client.startAgent` becomes
`agent start <name> --kind claude --pane <id> --timeout <ms> -- --permission-mode <mode>`,
and `new-chat.tsx` awaits it before pushing the route, showing "Starting Claude…" instead of
an empty thread. The `--` passthrough is how they forward extra agent arguments
(`start-agent-form.tsx:116`).

### 4.2 Sending a message

**Theirs:** `agent prompt <target> <text>` (`lib/herdr.ts:227-229`). One call, no
verification, no retry. `target` is the agent name when it has one, else the pane id
(`lib/herdr.ts:243-245`).

**Ours:** `pane run <paneId> <text>` (`client.ts:135-138`), then — unless the agent was
already working — `agent wait --status working --timeout 3500`; if that fails, send a bare
`Enter` and wait 2500 ms more; if *that* fails, mark the bubble failed and show a banner
(`useThread.ts:548-576`).

Our own comment (`client.ts:130-134`) explains the choice: `pane run` sends text and a real
Enter in one request, whereas `send-keys enter` types but doesn't submit inside an agent TUI.
Both true. But `pane run` is the *pane* primitive — herdr's own description of it, quoted in
their UI (`components/resource-forms.tsx:225`), is *"Herdr submits this atomically with Enter
and honors bracketed-paste mode."* That is a shell-command primitive. `agent prompt` is the
agent-aware one, and it is what the extension uses for every prompt it sends.

Why we're behind: **unimplemented.** The Enter-retry heuristic is a workaround for using the
lower-level call. It is also the reason a multi-line message can misbehave: `pane run` is
one command line.

iOS-native equivalent: `client.sendMessage` → `agent prompt <target> <text>`; keep
`waitAgentStatus` at first as a belt-and-braces check, delete the blind second `Enter`. Keep
the failed-bubble + retry affordance (`app/chat/[workspaceId].tsx:333-340`) — that is ours
and it is better than their fire-and-forget.

### 4.3 Interrupt

**Theirs** (`components/resource-actions.tsx:104-144`): "Interrupt Agent" → `agent send-keys
<target> ctrl+c`; "Send Escape" → `esc`; plus a submenu for enter/tab/shift+tab/arrows.

**Ours:** none. `sendKeys` exists (`client.ts:141`) and `BlockedBar` uses it for menu answers
(`app/chat/[workspaceId].tsx:397`), but there is no stop control anywhere in the UI.

This matters more for us than for them. New chats default to `bypassPermissions`
(`src/lib/herdr/permissionMode.ts:20`) — chosen deliberately, and correctly, for a phone —
which means an agent we start runs tools without asking, and the phone currently offers no
way to stop it short of opening the laptop.

### 4.4 Timeouts — the most serious finding

**Theirs:** `execFile(..., { timeout: options.timeout ?? 30_000, maxBuffer: 16 MB })`
(`lib/herdr.ts:104`), surfaced as a distinct `timeout` error code (lines 110-117). Long
operations opt into more: 70 s for agent start, 120 s for worktree create/remove
(`worktrees.tsx:31`, `create-worktree-form.tsx:41`), 300 s for plugin install
(`plugins.tsx:62`).

**Ours: there is no timeout anywhere in the stack.** `grep -rn -i timeout modules/herdr-ssh`
returns only comments. `SshConnection.execOnce` (`SshConnection.swift:238-260`) awaits
`executeCommandStream` to completion with no deadline; the Kotlin path is the same.

The consequence is not "a slow command": it is a **silent, permanent freeze**. Both poll
loops are chained timeouts that schedule the next tick in a `finally`
(`useThread.ts:512-514`, `useWorkspaces.ts:98-102`). If `client.snapshot()` never settles —
half-open TCP after the host sleeps, a wedged `herdr` — the `finally` never runs, no error is
ever set, and the screen sits on stale data forever. No banner, no spinner, no retry. Only
killing the app recovers.

Android sets `keepAliveInterval = 20` (`SshConnection.kt:58`), which would eventually tear
the socket down; iOS cannot, because Citadel exposes no equivalent
(`SshConnection.swift:46-53`). So the exposure is worst on the platform we actually ship.

The tail watchdog (`useThread.ts:496-507`) covers a *stream* that goes quiet. It does not
cover a *command* that never returns — it lives inside the poll that would be hung.

### 4.5 Error taxonomy

| Theirs (`lib/herdr.ts`) | Ours |
|---|---|
| `binary_not_found` | `herdr_not_found` (`client.ts:227`) |
| `timeout` | — |
| `command_failed` | `ssh_command_failed` (`client.ts:235`) |
| `invalid_json` | `unparseable_response` (`protocol.ts:43`) |
| `invalid_snapshot` | — |
| `pane_focus_path_not_found`, `invalid_pane_layout`, `no_focused_pane`, `pane_not_returned` | — (features we lack) |
| — | `empty_response` (`protocol.ts:36`) |
| — | `auth_failed`, `bad_key`, `host_key_changed`, `connect_failed`, `transport_failed` (native) |

Two things they do that we don't:

1. **`extractCliError` scans stderr *and* stdout for a JSON error envelope**
   (`lib/herdr.ts:77-90`), before even looking at the exit code. Ours only decodes stdout
   (`protocol.ts:33`) and otherwise leans on the exit code (`client.ts:213`). A herdr that
   prints its error envelope to stderr while exiting 0 would read to us as an empty response.
2. **The error surface offers next steps** — `ErrorView` (`lib/ui.tsx:62-80`) links the
   install guide when the code is `binary_not_found`, plus preferences and the troubleshooting
   page. Ours has the better *action* (one-tap remote install, `app/(tabs)/index.tsx:78-81`)
   but no documentation links at all.

Our transport codes are richer than theirs and carry genuinely good copy — the host-key
mismatch message (`SshConnection.swift:138-141`) explains MITM vs. reinstall vs. how to
recover. That is ahead.

### 4.6 Named sessions

Theirs sets `HERDR_SESSION` per invocation from a preference, and deletes it for the default
session (`lib/herdr.ts:95-98`); session-management commands deliberately pass `session: ""` to
run outside any session (`lib/herdr.ts:144`, `sessions.tsx:22,41`). A whole command manages
them.

We have no concept of a session. On a host running more than one herdr session we silently
control whichever one the default resolves to, with no indication another exists.

### 4.7 Integrations — we diagnose, they fix

We already detect the failure precisely. `useThread.ts:441-443` counts polls where an agent
exists but reports no session id, and after ~80 s sets `sessionState: 'missing'` with copy
that names the cause: the host is missing herdr's Claude integration. That diagnosis is
better than anything in their tree.

But we stop there. They run `integration status` / `integration install <name>`
(`integrations.tsx:14,71`). We already install herdr itself remotely when it's absent
(`client.ts:73`), so the pattern and the trust model are established — this is the same move,
one level down, and it turns a dead end into a button.

### 4.8 Version and compatibility

The snapshot carries `version` and `protocol` (`lib/types.ts:78-79`). They declare a floor in
the README ("Herdr 0.7 or newer") but I found no runtime check.

We do less: `src/lib/herdr/protocol.ts:7` records "protocol 16, schema_version 1" as a
*comment*, and `decodeSnapshot` doesn't read either field. Our decoders are defensively
written — unknown statuses degrade to `'unknown'` (`models.ts:16-20`), missing layouts to
`null` — which is the right instinct and genuinely protects us against additive changes. What
neither of us has is a **removal** story: an older herdr that lacks `agent_session` entirely
makes us wait 80 s and then blame the integration, when the truthful message is "this herdr is
too old."

---

## 5. A defect this audit found in *our* code

`src/lib/transcript/livePreview.ts:56` declares

```
const ANSI_CSI = /\[[0-9;?]*[A-Za-z]/g;
```

with **no ESC byte**. The equivalent line in `blockedPrompt.ts:83` is
`/\x1b\[[0-9;?]*[A-Za-z]/g` — correct. The two files disagree and `livePreview` is the wrong
one. (Both render identically in a terminal, because the ESC byte is invisible. Confirmed by
reading the raw bytes, not the display.)

Because `[0-9;?]*` may match empty, the pattern reduces to "`[` followed by a letter", so it
eats ordinary prose. Measured against the real function:

| in | out |
|---|---|
| `I checked the [TODO] list and the [README](docs/readme.md) link is stale.` | `I checked the ODO] list and the EADME](docs/readme.md) link is stale.` |
| `\x1b[1m⏺ The refactor is complete…\x1b[0m` | `\x1b⏺ The refactor is complete…\x1b` — the ESC byte survives into the bubble |

Two user-visible symptoms: bracketed text is mangled in the live preview, and a raw control
character reaches a `<Text>`. `paneParsing.test.ts` covers ANSI for `blockedPrompt` (line 42)
but has no ANSI case for `extractLivePreview`, which is why it never surfaced.

Backlog item **B5**.

---

## 6. Where we are ahead, and why it is worth defending

### 6.1 Structured transcripts

They render the terminal (`components/pane-output.tsx:25`): `readPane` → a Markdown code
fence, refreshed on an interval. That is the honest thing to do for 21 different agents.

We read Claude Code's own JSONL (`src/lib/transcript/`), producing typed messages with roles,
timestamps, tool activity and sidechain flags. That is what makes a *chat* rather than a
terminal viewer, and it is the reason the app is worth using on a phone. The cost is being
Claude-only.

Three hard-won details worth naming, because they're invisible until they break:

- **Byte offsets are UTF-8 bytes** (`store.ts:318-330`). The host counts bytes;
  `String.length` counts UTF-16 units. One emoji and the cursor drifts.
- **A chat's identity is its session, not its workspace slot** (`models.ts:71-78`). herdr
  reuses workspace ids; without the signature a new chat opens showing the previous
  conversation.
- **Never guess a transcript file** (`store.ts:55-59`). Two chats on one folder share a
  project dir, so "newest `.jsonl`" is wrong precisely when it looks right.

### 6.2 Reading a full-screen agent

`client.ts:107-112` records the finding: Claude runs on the terminal's *alternate screen*, so
`recent` / `recent-unwrapped` return empty and only `--source visible` captures it.

Their `readPane` hardcodes `--source recent-unwrapped` (`lib/herdr.ts:224`) and their agent
action panel passes `isAgent` to it (`resource-actions.tsx:101`). By our measurement their
"View Live Output" shows nothing for exactly the agents it targets. Upstream item **U1**.

### 6.3 Blocked prompts

They can send `1`, `enter`, `esc` blind. We parse the visible screen into a question plus
labelled options and render real buttons (`blockedPrompt.ts:36-75`, `BlockedBar.tsx`), keeping
only the *last* contiguous menu so a stale menu in the scrollback can't be answered by
accident (`blockedPrompt.ts:46-54`). Upstream item **U3**.

### 6.4 Batched reads

`latestMessages` (`store.ts:237-277`) builds one shell script that tails N transcripts with a
marker between them, and parses the blocks apart — N previews, one round-trip. Nothing in
their tree needs this, because their round-trips are free. It is the right shape for a
remote transport and worth keeping in mind as the model for §3.2.

---

## 7. Lessons from their history (Phase 4)

Thin by construction: `CHANGELOG.md` has exactly one entry ("Initial Release", 2026-07-23) and
the extension landed as a single squashed commit. There is no post-release bug history to
mine — the extension is two weeks old.

The **PR itself** is the real source: 6 commits, 7 automated review findings, and a Raycast
maintainer (`0xdhrv`) pushing fixes before merge.

| Commit | |
|---|---|
| `5e314632` | Add Herdr extension |
| `fde24d21` | Fix Herdr review issues |
| `d4ae124c` | improve UI navigation and error handling |
| `d3d9dd06` | refresh pane focus and clear Ghostty markers |
| `8b38dc1a` | avoid stale split targets and clear markers reliably |
| `0d9cb1b6` | changelog + images |

The seven flagged issues, and whether they touch us:

| # | Their bug | Do we have it? |
|---|---|---|
| 1 | **Split target remains stale** — a pane id snapshotted before the command executes may no longer be focused (`lib/agent-launch.ts`) | **No — and we should keep it that way.** The fix is visible in the shipped code: `agent-launch.ts:26-29` deliberately omits the snapshotted pane id and lets herdr resolve the target at execution time. We currently create workspaces (which return their own root pane) so the race can't arise — but it *would* the moment we add splits. §7.1 |
| 2 | **Cached focus targets wrong pane** — same root cause | same |
| 3 | **Pane inference selects unrelated panes** — inferring a created pane by diffing snapshots picks up a concurrently-created one | **No.** We use the returned `root_pane` (`client.ts:156`, `models.ts:285-292`) — the same discipline they arrived at. |
| 4 | **Lookup timeout duplicates clients** — a timed-out `pgrep` returned `[]` ("none exist") instead of "unknown", so a duplicate client was launched | **Conceptually yes.** §7.2 |
| 5-7 | Ghostty/AppleScript title-marker races | platform-blocked |

### 7.1 "Don't pass an id you sampled a moment ago"

The reversal is worth internalising because it generalises past splits. Any command shaped
*read state → decide → act on the id you read* is a TOCTOU bug when the state can change
between the read and the act. Prefer letting herdr resolve the target, or use the id herdr
itself just returned.

We already follow this for workspace creation. Where we don't: `useThread.ts:592` sends to
`primaryPane`, computed from the last poll up to 2 s ago (`useThread.ts:538-539`). If the
agent's pane changed in that window we send into a stale pane. Low frequency, real. Backlog
**B15**.

### 7.2 "Unknown" is not "none"

Their fix (`lib/process-lookup.ts:19-31`, test at `tests/process-lookup.test.ts:5-24`)
distinguishes *confirmed absence* (`pgrep` exits 1 → `[]`) from *couldn't find out*
(timeout → `undefined`), because collapsing the two made a failure look like a fact and
caused a destructive-ish action.

Ours, same shape, `src/lib/transcript/store.ts:62-66`:

```ts
async fileSize(path: string): Promise<number> {
  const output = (await this.shell(`wc -c < ${shellQuote(path)} 2>/dev/null`)).trim();
  const size = Number.parseInt(output, 10);
  return Number.isNaN(size) ? -1 : size;
}
```

`-1` means both "no such file" and "`wc` was missing / the read failed". `startTail` treats
`< 0` as "file isn't there yet, retry next poll" (`useThread.ts:340`) — benign for a genuinely
absent file, but a transient read failure silently re-enters the same wait, and a thread can
sit in "waiting for the session" for a reason that has nothing to do with the session.
Backlog **B16**.

---

## 8. Open questions

Marked rather than guessed.

1. Does `herdr api snapshot` on the version we target return `workspaces`? Their types and
   `dashboard.tsx` say yes. One command on a live host settles it — see backlog **B6**.
2. Is `AgentInfo.state_change_seq` populated, and does it increment per transition? Declared
   (`lib/types.ts:67`), never read in their tree.
3. Does `agent prompt` accept multi-line text, and does it handle bracketed paste better than
   `pane run`? Their form has a multi-line `TextArea` (`prompt-agent-form.tsx:186`) which
   implies yes, but the CLI contract isn't visible from either tree.
4. Does `agent start --timeout` return an error on timeout, or a result with the agent not
   ready? Determines whether we can trust it as our only readiness gate.
5. Does the extension's menu-bar command refresh while its window is closed? Raycast supports
   an `interval` field on menu-bar commands; theirs doesn't declare one and uses `setInterval`
   inside instead (`hooks/use-herdr-snapshot.ts:10-13`). Not verified.
