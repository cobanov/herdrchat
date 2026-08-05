# Backlog — from the Raycast comparison

Ranked by **user impact**, not by effort. Every item traces to a finding in
[`herdr-raycast-comparison.md`](./herdr-raycast-comparison.md).

Effort: **S** ≤ half a day · **M** 1–3 days · **L** ≥ a week.

**Ten of the sixteen shipped in 0.5.0 (39)**, one landed partly, five are open. Status is in
the table. Two of the open ones — B3 and B4, the `agent prompt` / `agent start` pair — are
blocked on three commands that need running against a live herdr host once; the issues say
exactly which. The other three are unblocked, just not done yet.

All sixteen are filed as GitHub issues #8–#23, tracked by [#24](https://github.com/cobanov/herdrchat/issues/24), which carries the suggested order.

| | Title | Issue | Status | Effort | Risk |
|---|---|---|---|---|---|
| B1 | Put a deadline on every remote call | [#8](https://github.com/cobanov/herdrchat/issues/8) | ✅ shipped 0.5.0 | M | med |
| B2 | Give the phone a stop button | [#9](https://github.com/cobanov/herdrchat/issues/9) | ✅ shipped 0.5.0 | S | low |
| B3 | Send prompts with `agent prompt` | [#10](https://github.com/cobanov/herdrchat/issues/10) | ⬜ needs a live host | S | med |
| B4 | Start agents with `agent start`, and give them names | [#11](https://github.com/cobanov/herdrchat/issues/11) | ⬜ needs a live host | M | med |
| B5 | Fix the live-preview ANSI regex | [#12](https://github.com/cobanov/herdrchat/issues/12) | ✅ shipped 0.5.0 | S | low |
| B6 | Collapse the polls onto one snapshot | [#13](https://github.com/cobanov/herdrchat/issues/13) | 🟡 partly — see #13 | M | med |
| B7 | Pause polling in the background; back off on failure | [#14](https://github.com/cobanov/herdrchat/issues/14) | ✅ shipped 0.5.0 | S | low |
| B8 | Rename and close a chat | [#15](https://github.com/cobanov/herdrchat/issues/15) | ⬜ open | S | low |
| B9 | Named herdr sessions | [#16](https://github.com/cobanov/herdrchat/issues/16) | ⬜ open | M | low |
| B10 | Install the Claude integration from the app | [#17](https://github.com/cobanov/herdrchat/issues/17) | ✅ shipped 0.5.0 | S | low |
| B11 | Agents that aren't Claude | [#18](https://github.com/cobanov/herdrchat/issues/18) | ⬜ blocked on B4 | L | high |
| B12 | Prompt history | [#19](https://github.com/cobanov/herdrchat/issues/19) | ✅ shipped 0.5.0 | S | low |
| B13 | Refresh-interval preference | [#20](https://github.com/cobanov/herdrchat/issues/20) | ✅ shipped 0.5.0 | S | low |
| B14 | Diagnose a missing binary instead of guessing | [#21](https://github.com/cobanov/herdrchat/issues/21) | ✅ shipped 0.5.0 | S | low |
| B15 | Don't send to a pane id sampled two seconds ago | [#22](https://github.com/cobanov/herdrchat/issues/22) | ✅ shipped 0.5.0 | S | low |
| B16 | Stop conflating "couldn't find out" with "isn't there" | [#23](https://github.com/cobanov/herdrchat/issues/23) | ✅ shipped 0.5.0 | S | low |

---

## B1 — Put a deadline on every remote call · [#8](https://github.com/cobanov/herdrchat/issues/8)

**Effort M · Risk medium · Finding §4.4**

### Why it matters

There is no timeout anywhere in our stack. `grep -rn -i timeout modules/herdr-ssh` returns
only comments; `SshConnection.execOnce` (`modules/herdr-ssh/ios/SshConnection.swift:238-260`)
awaits the command stream with no deadline, and Kotlin matches.

That is not "a slow refresh." Both poll loops re-arm inside a `finally`
(`src/features/thread/useThread.ts:512-514`, `src/features/chats/useWorkspaces.ts:98-102`), so
a command that never settles means the `finally` never runs: the loop stops forever, no error
is set, no spinner appears, and the screen holds stale data until the app is force-quit. The
trigger is ordinary — phone sleeps, Tailscale reroutes, host suspends — and leaves a half-open
TCP that never returns and never resets.

Worst on iOS specifically: Android sets `keepAliveInterval = 20`
(`.../android/.../SshConnection.kt:58`) and would eventually tear the socket down. Citadel
exposes no equivalent (`SshConnection.swift:46-53`), so on the platform we ship there is
nothing underneath.

Theirs: `execFile(..., { timeout: 30_000 })` with a distinct `timeout` error code
(`lib/herdr.ts:104-117`), raised per-operation to 70/120/300 s.

### Proposed implementation

Two layers, because each catches what the other can't.

**1. Native (authoritative).** Add `timeoutMs` to the exec/stream contract in
`modules/herdr-ssh/src/HerdrSsh.types.ts` and thread it through
`modules/herdr-ssh/src/index.ts`. In Swift, race the command against a sleep:

```swift
// SshConnection.execOnce — sketch
try await withThrowingTaskGroup(of: CommandOutput.self) { group in
  group.addTask { try await self.runToCompletion(command) }
  group.addTask {
    try await Task.sleep(for: .milliseconds(timeoutMs))
    throw SshFailure(code: "timeout", message: "The host didn't answer in time.")
  }
  let first = try await group.next()!
  group.cancelAll()
  return first
}
```

A timeout must also `resetClient()` — a channel that blew its deadline is evidence the
connection is bad, and the existing retry-once path (`SshConnection.swift:224-236`) should
*not* absorb a `timeout` the way it absorbs `transport_failed`, or a wedged host costs two
deadlines per call. Mirror in Kotlin with `withTimeout`.

**2. JS (belt).** In `HerdrClient.shell` and `TranscriptStore.shell`, wrap with
`Promise.race` against a timer, so a native module that mis-behaves still can't hang a screen.

Defaults, following theirs: 15 s for polls (they use 30 s locally; we're on a LAN-ish tailnet
and a poll that takes 15 s is already useless), 60 s for `workspace create` +
`agent start`, 20 s for `pane run` / `send-keys`.

Add `'timeout'` to the error vocabulary in `src/lib/herdr/protocol.ts` and give it copy that
says what to do: *"The host stopped responding. Check that it's awake and on the tailnet."*
Both poll loops already render `error` through `ErrorBanner`, so the surface is free.

### Affected files

`modules/herdr-ssh/src/HerdrSsh.types.ts`, `modules/herdr-ssh/src/index.ts`,
`modules/herdr-ssh/ios/SshConnection.swift`, `modules/herdr-ssh/ios/HerdrSshModule.swift`,
`.../android/.../SshConnection.kt`, `.../android/.../HerdrSshModule.kt`,
`src/lib/herdr/client.ts`, `src/lib/herdr/transport.ts`, `src/lib/transcript/store.ts`,
`src/lib/herdr/protocol.ts`.

### Risk

Native change on both platforms → requires `npx expo prebuild` + a device rebuild; Fast
Refresh won't pick it up. A too-tight default turns a slow-but-working host into an error
loop, so start generous. Test with a fake transport that never resolves — the existing
`HerdrTransport` seam makes this a unit test, and it should assert the loop *keeps running*
after a timeout, which is the actual bug.

---

## B2 — Give the phone a stop button · [#9](https://github.com/cobanov/herdrchat/issues/9)

**Effort S · Risk low · Finding §4.3**

### Why it matters

We can start an agent from a phone and cannot stop it. New chats default to
`bypassPermissions` (`src/lib/herdr/permissionMode.ts:20`) — the right default for a phone,
and the reason this is urgent rather than nice: the agent runs tools without asking, and the
only way to interrupt it today is to open a laptop.

Theirs has it three ways: "Interrupt Agent" (`ctrl+c`), "Send Escape", and a key submenu
(`components/resource-actions.tsx:104-144`).

We already have the primitive. `client.sendKeys` (`src/lib/herdr/client.ts:141-146`) works and
is used by `BlockedBar` for menu answers. Nothing is missing but the affordance.

### Proposed implementation

In the thread header (`app/chat/[workspaceId].tsx`), show a Stop control whenever
`thread.status === 'working'`, next to the existing status line. Tap → `thread.sendKeys(['escape'])`
(Claude's own interrupt); long-press or a confirm sheet → `['ctrl+c']` for the harder kill.

`useThread.sendKeys` already routes to `blockedPane ?? primaryPane`
(`useThread.ts:611-622`) — correct target, no change needed. Add haptic feedback via
`src/lib/haptics.ts`, consistent with quick replies.

Prefer `escape` as the primary: Claude treats it as "stop this turn," while `ctrl+c` can exit
the process and end the session — a much bigger hammer, and one that costs the conversation.
Worth a distinct label ("Stop" vs. "Force quit agent") rather than two identical-looking
buttons.

### Affected files

`app/chat/[workspaceId].tsx`, `src/components/Header.tsx` (or a new
`src/features/thread/StopButton.tsx`), `src/features/thread/useThread.ts` (no logic change).

### Risk

Low. Worth one Maestro flow asserting the control appears only while working. Confirm on a
real host which of `escape` / `esc` herdr's `send-keys` accepts — theirs sends `"esc"`
(`resource-actions.tsx:120`) while our `BlockedBar` sends `'Enter'` capitalised
(`blockedPrompt.ts:28`), so the key vocabulary is worth pinning down once and writing into
`client.ts`.

---

## B3 — Send prompts with `agent prompt` · [#10](https://github.com/cobanov/herdrchat/issues/10)

**Effort S · Risk medium · Finding §4.2**

### Why it matters

We send a chat message with `pane run <paneId> <text>` — the *pane* primitive — and then
paper over its ambiguity: wait up to 3.5 s for the status to flip to `working`, and if it
doesn't, send a bare `Enter` and wait 2.5 s more, and if *that* fails, mark the bubble failed
(`src/features/thread/useThread.ts:548-576`).

herdr has an agent-aware verb for this. Theirs uses `agent prompt <target> <text>` for every
prompt it sends (`lib/herdr.ts:227-229`). The blind extra `Enter` is the part that worries me
most: if the first send *did* land and merely hadn't flipped status yet, we've now submitted
an empty line into a live agent.

Worst case today is a 6-second stall on every send to an idle agent on a slow host, then a
"couldn't confirm delivery" banner on a message that was in fact delivered.

### Proposed implementation

Add to `src/lib/herdr/client.ts`:

```ts
/**
 * Send a chat message to an agent. `agent prompt` is the agent-aware verb —
 * `pane run` is the shell one, and using it here is what forced the
 * confirm-then-press-Enter-again dance this replaces.
 */
async promptAgent(target: string, text: string): Promise<void> {
  const output = await this.shell(shellCommand([this.herdr, 'agent', 'prompt', target, text]));
  checkEnvelope(output);
}
```

`deliver()` calls `promptAgent` instead of `sendMessage`. **Keep** `waitAgentStatus` as
confirmation and keep the failed-bubble + retry UI (`app/chat/[workspaceId].tsx:333-340`) —
that's ours and it's better than their fire-and-forget. **Delete** the blind second `Enter`.

Target: the pane id today (`agent prompt` accepts either, per `getAgentTarget`,
`lib/herdr.ts:243-245`); switch to the agent name once B4 lands.

Keep `sendMessage` — `pane run` is still the right call for running a *command* in a plain
pane, which is a feature we may want later.

### Affected files

`src/lib/herdr/client.ts`, `src/features/thread/useThread.ts`,
`src/lib/__tests__/` (new coverage; the canned-transport pattern in
`transcriptStore.test.ts` is the model).

### Risk

Medium, and entirely about verification: this is the app's core action, and the current path
is battle-tested. Verify first on a real host that `agent prompt` (a) submits without a
separate Enter, (b) handles multi-line text — open question §8.3 — and (c) behaves when the
agent is already working. Ship behind the existing retry affordance so a regression is
recoverable by the user, not just by us.

---

## B4 — Start agents with `agent start`, and give them names · [#11](https://github.com/cobanov/herdrchat/issues/11)

**Effort M · Risk medium · Finding §4.1**

### Why it matters

We launch Claude by typing a shell command into a fresh pane —
`pane run <rootPane> 'claude --permission-mode bypassPermissions'`
(`src/lib/herdr/client.ts:163-166`, called from `app/new-chat.tsx:95`) — then navigate
straight to the thread and let `useThread` poll until an agent appears with a session id,
waiting up to 80 s before blaming the host (`useThread.ts:81`).

`agent start <name> --kind claude --pane <id> --timeout 60000` does all of it in one blocking
call: registers the agent, names it, attaches the `--kind` integration — **which is what
produces `agent_session.value`, the single field our whole transcript reader depends on** — and
returns only when the agent is interactive. Theirs then sends the initial prompt, knowing it
will land (`components/start-agent-form.tsx:110-122`; the form says so at line 259).

Today we start a bare process and hope herdr's screen detection notices. When it doesn't, the
user gets an empty thread and, eventually, a message about a missing integration.

The name is the second prize. It's a stable handle that survives pane churn, and it's what
would let a push notification say "**review** needs you" instead of "an agent in workspace 3."

### Proposed implementation

```ts
// src/lib/herdr/client.ts
async startAgent(
  paneId: string,
  name: string,
  mode: PermissionMode,
  timeoutMs = 60_000
): Promise<void> {
  const argv = [this.herdr, 'agent', 'start', name,
                '--kind', 'claude', '--pane', paneId,
                '--timeout', String(timeoutMs),
                '--', '--permission-mode', mode];
  checkEnvelope(await this.shell(shellCommand(argv)));
}
```

`--` forwarding is how theirs passes extra agent arguments (`start-agent-form.tsx:116`);
verify herdr accepts it before relying on it, and fall back to today's `pane run` path if not.

Name: derive from the label or folder name, lowercased and sanitised to herdr's own
constraint `/^[a-z][a-z0-9_-]{0,31}$/` (`start-agent-form.tsx:14`) — validate client-side so
the error is instant. Collisions need a suffix; `agent list` at creation time is the cheap
check.

`new-chat.tsx` must now **await** a call that can take a minute: keep the sheet open with
"Starting Claude…" and only then `router.push`. That's a better arrival than today's empty
thread. Persist the name so the thread header and notifications can use it.

Requires B1 first, or a 60-second herdr-side wait sits behind an unbounded client-side one.

### Affected files

`src/lib/herdr/client.ts`, `app/new-chat.tsx`, `src/lib/herdr/models.ts` (decode `name` on
`AgentInfo`), `src/features/thread/useThread.ts` (prefer name as target),
`src/features/chats/ChatRow.tsx` + `useWorkspaces.ts` (show the name),
`src/lib/herdr/permissionMode.ts` (`launchCommand` may become argv rather than a string),
`src/lib/__tests__/`.

### Risk

Medium. Blocking for up to a minute is a real UX change and needs a cancel path. `--kind`
values are herdr's vocabulary — theirs lists 21 (`lib/types.ts:107-129`) — so `claude` is
near-certain but should be confirmed. Keep the old path behind a fallback for one release:
if `agent start` errors with an unknown-subcommand shape, fall back to `pane run` and log it,
so an older herdr on someone's host doesn't break new chats.

---

## B5 — Fix the live-preview ANSI regex · [#12](https://github.com/cobanov/herdrchat/issues/12)

**Effort S · Risk low · Finding §5**

### Why it matters

`src/lib/transcript/livePreview.ts:56` is missing the ESC byte:

```
const ANSI_CSI = /\[[0-9;?]*[A-Za-z]/g;      // livePreview.ts  — wrong
const ANSI_CSI = /\x1b\[[0-9;?]*[A-Za-z]/g;  // blockedPrompt.ts:83 — right
```

Because `[0-9;?]*` may match empty, the pattern collapses to "`[` followed by a letter" and
eats ordinary prose. Measured against the real function:

- `I checked the [TODO] list and the [README](docs/readme.md) link is stale.`
  → `I checked the ODO] list and the EADME](docs/readme.md) link is stale.`
- A colour-wrapped line keeps its raw ESC byte, which reaches a `<Text>`.

So the streaming preview bubble mangles any bracketed text — which in a coding agent's output
means TODO markers, markdown links and array indices — and leaks a control character.

The two files disagree and the *other* one is correct. This is a typo, not a design.

### Proposed implementation

Delete one of them. Move the shared terminal-scrubbing helpers — `ANSI_CSI`, `BORDER_CHARS`,
`clean()` — into a new `src/lib/transcript/ansi.ts` and import from both `livePreview.ts` and
`blockedPrompt.ts`. Two copies of a tricky regex is how they drifted.

Note the one real difference to preserve: `livePreview.clean` also normalises interior
`│`/`┃` to `|` (lines 66-71), which is load-bearing for its status-bar detection. Keep that as
a `livePreview`-local step after the shared `clean()`.

Then add the missing test. `src/lib/__tests__/paneParsing.test.ts:42` covers ANSI for
`blockedPrompt` but has no ANSI case for `extractLivePreview` — which is exactly why this
survived. Two cases: a real `\x1b[1m`-wrapped line, and a line containing `[TODO]` and a
markdown link that must come through **unchanged**.

### Affected files

`src/lib/transcript/livePreview.ts`, `src/lib/transcript/blockedPrompt.ts`,
new `src/lib/transcript/ansi.ts`, `src/lib/__tests__/paneParsing.test.ts`.

### Risk

Low, and covered by tests on both sides. One thing to watch: `isChrome`/`isStatusLine` matched
against today's *mangled* strings, and now see clean ones. Re-run the existing four
live-preview tests — if any passed because of the corruption, that's worth knowing.

---

## B6 — Collapse the polls onto one snapshot · [#13](https://github.com/cobanov/herdrchat/issues/13)

**Effort M · Risk medium · Finding §3.1, §3.2**

`herdr api snapshot` returns workspaces, tabs, panes, agents, layouts, version and protocol in
one object — their `lib/types.ts:77-88`, consumed at `dashboard.tsx:36-39`. Our
`decodeSnapshot` (`src/lib/herdr/models.ts:272-283`) keeps agents, three focus ids and layouts,
and throws the rest away — so `useWorkspaces` issues a second `workspace list` in parallel for
data it already had (`useWorkspaces.ts:70`).

Worse, expo-router's native stack keeps background screens mounted, so opening a thread
doesn't stop the list's 3-second poll. Reading one conversation sustains roughly **two remote
commands per second**: list (`workspace list` + `api snapshot` + preview read) every 3 s, plus
thread (`api snapshot` + a `pane read`) every 2 s.

**Verify first** (one command on a live host, settles open question §8.1):

```
herdr api snapshot | python3 -c 'import json,sys; print(sorted(json.load(sys.stdin)["result"]["snapshot"]))'
```

Then: extend `decodeSnapshot` to decode `workspaces`, `tabs`, `panes`, `version`, `protocol`
and the pane fields we ignore (`interactive_ready`, `launch_pending`, `name`, `title`,
`display_agent`, `terminal_title_stripped`); delete `client.workspaces()` from the hot path;
and hoist the poll into a single shared source — a small store, or one hook the list and the
thread both subscribe to — so two mounted screens share one round-trip instead of racing.

Keep the batched preview read (`store.ts:237`) — that one is already optimal and has no
equivalent on their side.

**Files:** `src/lib/herdr/models.ts`, `src/lib/herdr/client.ts`,
`src/features/chats/useWorkspaces.ts`, `src/features/thread/useThread.ts`, probably a new
`src/state/snapshot.ts`. **Risk:** medium — a shared poll changes lifecycle assumptions in two
hooks that currently own their own timers, and `useThread`'s tail-restart logic reads the
snapshot it fetched. Do it after B1.

---

## B7 — Pause polling in the background; back off on failure · [#14](https://github.com/cobanov/herdrchat/issues/14)

**Effort S · Risk low · Finding §3.3**

`grep -rn AppState src app modules` → nothing. We poll at full rate regardless of whether the
app is foregrounded, and neither loop backs off after an error — a host that's down gets a
failing SSH round-trip every 2–3 s forever, on a metered radio. (Theirs has the same gap for
the same reason it costs them nothing: `hooks/use-herdr-snapshot.ts:10-13` revalidates on a
fixed interval regardless of the last result. Upstream **U5**.)

Subscribe to `AppState` in the shared poll (B6) or in each loop: stop the timer on
`background`, and on `active` run one immediate poll — the socket has usually died while
suspended, and the native retry-once path will re-dial. Add exponential backoff on
consecutive failures (3 s → 6 s → 12 s, cap 60 s), reset on the first success, and keep the
error banner visible throughout so backing off never looks like recovery.

**Files:** `src/features/chats/useWorkspaces.ts`, `src/features/thread/useThread.ts` (or
`src/state/snapshot.ts`). **Risk:** low. Interacts with push notifications — an agent that
blocks while we're backgrounded is exactly what the notifier is for, so this shouldn't be
mistaken for a substitute.

---

## B8 — Rename and close a chat · [#15](https://github.com/cobanov/herdrchat/issues/15)

**Effort S · Risk low · Finding §3 matrix**

Chats accumulate forever. There is no way to rename a workspace whose auto-label is wrong, or
to close one that's finished — `herdr workspace rename` / `workspace close` exist and theirs
uses both (`components/resource-forms.tsx:30`, `components/resource-actions.tsx:57-76`).

Add `renameWorkspace(id, label)` and `closeWorkspace(id)` to `HerdrClient`; wire to a swipe
action on `ChatRow` and a header menu in the thread. Close is destructive — it stops every
process in the workspace — so copy the confirmation wording from theirs
(`resource-actions.tsx:66-68`), which names that consequence explicitly. On success, drop the
workspace's cached messages (`state/threadCache.ts`) so a recycled id can't resurrect them.

**Files:** `src/lib/herdr/client.ts`, `src/features/chats/ChatRow.tsx`,
`app/(tabs)/index.tsx`, `app/chat/[workspaceId].tsx`, `src/state/threadCache.ts`.

---

## B9 — Named herdr sessions · [#16](https://github.com/cobanov/herdrchat/issues/16)

**Effort M · Risk low · Finding §4.6**

A host can run several herdr sessions; we silently control whichever the default resolves to
and give no sign the others exist. Theirs sets `HERDR_SESSION` per invocation from a
preference (`lib/herdr.ts:95-98`) and manages sessions with `session list/stop/delete`
(`sessions.tsx`).

Add an optional `sessionName` to `ServerConnection` (`src/state/connections.ts:13-22`), and
have `withPath()` (`src/lib/herdr/shell.ts:26`) export `HERDR_SESSION` when it's set — one
place, since every command already flows through it. A session picker in the host editor, fed
by `session list --json`, is the visible half. Note their detail: session-management commands
deliberately run *outside* any session (`lib/herdr.ts:144`).

**Files:** `src/state/connections.ts`, `src/lib/herdr/shell.ts`, `src/lib/herdr/client.ts`,
`app/server/[id].tsx`, `src/state/db.ts` (migration).

---

## B10 — Install the Claude integration from the app · [#17](https://github.com/cobanov/herdrchat/issues/17)

**Effort S · Risk low · Finding §4.7**

We already diagnose this precisely: after ~80 s of an agent reporting no session id,
`sessionState` becomes `'missing'` (`useThread.ts:441-443`) and the thread says the host is
probably missing herdr's Claude integration. That diagnosis is better than anything in their
tree — and then we stop, at a dead end.

They run `integration status` and `integration install <name>` (`integrations.tsx:14,71`). We
already do the harder version of this move — remote-installing herdr itself via a piped
installer (`client.ts:73`), surfaced as one tap (`app/(tabs)/index.tsx:78-81`). This is the
same pattern, one level down, and turns the dead end into a button.

Add `installIntegration(name)` → `herdr integration install claude`, and render it as the
action on the `sessionState === 'missing'` view (`app/chat/[workspaceId].tsx:440`).

**Files:** `src/lib/herdr/client.ts`, `app/chat/[workspaceId].tsx`.

---

## B11 — Agents that aren't Claude · [#18](https://github.com/cobanov/herdrchat/issues/18)

**Effort L · Risk high · Finding §3 matrix**

They support 21 kinds with aliases and per-kind icons (`lib/types.ts:107-129`,
`lib/agent-appearance.ts`); we are Claude-only, because our whole reading path is Claude
Code's JSONL (`src/lib/transcript/`).

The trap is that "support more agents" quietly turns the chat into a terminal viewer — which
is what theirs is (`components/pane-output.tsx:25`), honestly, for exactly this reason. Don't
follow them down.

Shape: keep the transcript reader as the Claude-only path; add a **screen-view fallback** for
other kinds, clearly labelled as the terminal rather than a conversation, reading
`pane read --source visible` (which we already have, `client.ts:113`, and which is the source
they get wrong — §6.2). Introduce an `AgentKind` union and a per-kind capability record
(`readsTranscript: boolean`), so a kind without a transcript reader degrades by design rather
than by accident.

Do this **after** B4 — `agent start --kind` is where the kind enters the system.

---

## B12 — Prompt history · [#19](https://github.com/cobanov/herdrchat/issues/19)

**Effort S · Risk low**

Theirs keeps the last 30 prompts, deduped on text+target, in local storage
(`lib/prompt-history.ts`), reachable from the prompt form. Typing on a phone is far more
expensive than typing on a Mac, so this is worth more to us than to them — and re-sending
"run the tests" or "commit and push" is the most repetitive thing this app is used for.

We have SQLite already (`src/state/db.ts`): a `prompts` table keyed by connection, capped at
~30, deduped the same way. Surface as a chip row above the composer when it's empty, or a
long-press on the send button.

**Files:** `src/state/db.ts` (migration), new `src/state/promptHistory.ts`,
`src/features/thread/Composer.tsx`.

---

## B13 — Refresh-interval preference · [#20](https://github.com/cobanov/herdrchat/issues/20)

**Effort S · Risk low · Finding §3.2**

`STATUS_POLL_MS = 2000` and `POLL_INTERVAL_MS = 3000` are constants. Theirs is a preference —
2/5/10/30 s — clamped in code so a bad stored value can't spin (`lib/preferences.ts:9-12`).
On a phone, on cellular, the person holding it should get a say.

Add to `src/state/settings.ts` and the Settings screen, defaulting to today's values, clamped
to ≥ 2 s. Pairs naturally with B7 (a "Low data" mode could set a long interval and skip live
previews). Do it after B6, or you're making two independent polls configurable twice.

---

## B14 — Diagnose a missing binary instead of guessing · [#21](https://github.com/cobanov/herdrchat/issues/21)

**Effort S · Risk low · Finding §4.5**

On exit 127 we say herdr "wasn't found on this account… likely not installed for this user, or
not on PATH" (`client.ts:227-231`) — accurate, but we never looked. Theirs probes PATH plus
four standard directories before concluding anything (`lib/herdr.ts:54-69`).

Our `withPath()` (`shell.ts:26-28`) already prefixes the same directories, so the *fix* is
usually in place; what's missing is the *evidence*. On a 127, run one diagnostic —
`command -v herdr; ls -l "$HOME/.local/bin/herdr" /opt/homebrew/bin/herdr 2>/dev/null` — and
say which it is: not installed anywhere, installed at a path we can offer to save into the
connection's `herdrPath` field, or present but not executable. Three different fixes currently
share one message.

**Files:** `src/lib/herdr/client.ts`, `app/(tabs)/index.tsx`, `app/server/[id].tsx`.

---

## B15 — Don't send to a pane id sampled two seconds ago · [#22](https://github.com/cobanov/herdrchat/issues/22)

**Effort S · Risk low · Finding §7.1**

The one design the Raycast maintainers reversed during review (`8b38dc1a`, "avoid stale split
targets"): the shipped code now *deliberately omits* a snapshotted pane id and lets herdr
resolve the target at execution time (`lib/agent-launch.ts:26-29`).

We follow this for workspace creation — we use the `root_pane` herdr returned
(`client.ts:156`). We don't for sending: `send()` targets `primaryPane`, derived from a poll up
to 2 s old (`useThread.ts:538-539,592`). If the agent's pane changed in that window the message
goes to a stale pane.

Once B4 lands this mostly dissolves — send to the agent *name* and herdr resolves it. Until
then, re-read the agent for the workspace immediately before `deliver()`, or accept the risk
knowingly and write it down. Low frequency; the failure is silent, which is what makes it
worth a note.

---

## B16 — Stop conflating "couldn't find out" with "isn't there" · [#23](https://github.com/cobanov/herdrchat/issues/23)

**Effort S · Risk low · Finding §7.2**

Their `pgrep` returned `[]` on timeout — read as "no client running" — and launched a
duplicate. The fix distinguishes confirmed absence from unknown (`lib/process-lookup.ts:15-31`)
and is pinned by a test (`tests/process-lookup.test.ts:5-24`).

Ours has the same shape at `src/lib/transcript/store.ts:62-66`: `fileSize()` returns `-1` for
both "no such file" and "the read failed." `startTail` treats `< 0` as "not there yet, retry
next poll" (`useThread.ts:340`) — right for a genuinely absent file, but a transient read
failure re-enters the same wait silently, and a thread can sit in "waiting for the session"
for a reason unrelated to the session.

Return a discriminated result — `{ kind: 'size', bytes } | { kind: 'absent' } | { kind: 'unknown' }`
— by separating the `wc` exit code from its output instead of swallowing it with `2>/dev/null`.
`'unknown'` should surface, not retry silently.

**Files:** `src/lib/transcript/store.ts`, `src/features/thread/useThread.ts`,
`src/lib/__tests__/transcriptStore.test.ts`.

---

## Suggested order

**B1** first — it's the only item whose absence can make the app stop working with no
indication, and B3/B4 add long-running calls that need a deadline underneath them.

Then **B2** and **B5**: both small, both visible, and B2 closes a genuine safety gap given the
`bypassPermissions` default.

Then **B3 → B4** as one arc (send and start via the agent verbs), which unlocks B15 for free
and is the prerequisite for B11.

Then **B6 → B7 → B13** as the polling arc, in that order — collapse the polls before making
them configurable.

Everything after that is independent.
