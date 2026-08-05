# Lessons from the Herdr Raycast extension

What to take, what to leave, and what to defend. Companion to
[`herdr-raycast-comparison.md`](./herdr-raycast-comparison.md); every claim there carries its
citation, so this file stays short and opinionated.

Their tree: `raycast/extensions` @ `45742065`, `extensions/herdr/`, MIT. Ideas are reimplemented
in our idioms — nothing is copied. Where a design is theirs, the backlog item says so.

---

## Take

### 1. Let herdr do the work herdr already does

The single biggest theme. Three places where we hand-roll something the CLI offers:

| We do | herdr offers | Their use |
|---|---|---|
| `pane run <id> 'claude …'`, then poll for an agent to appear | `agent start <name> --kind <k> --pane <id> --timeout <ms>` — registers, names, attaches the integration, **and blocks until interactive** | `components/start-agent-form.tsx:115-117` |
| `pane run <id> <text>` + `agent wait` + blind `Enter` retry | `agent prompt <target> <text>` | `lib/herdr.ts:227-229` |
| — | `agent send-keys <target> ctrl+c` | `components/resource-actions.tsx:106-125` |

`pane run` and `pane send-keys` are *pane* primitives — herdr's own description, quoted in
their UI (`components/resource-forms.tsx:225`), is "submits this atomically with Enter and
honors bracketed-paste mode." That's a shell-command verb. `agent prompt` is the agent-aware
one, and it's what they use for every prompt.

Our Enter-retry heuristic (`src/features/thread/useThread.ts:548-576`) is a good workaround
for a call we shouldn't be making. Keep the *failed-bubble + retry* affordance
(`app/chat/[workspaceId].tsx:333-340`) — it's better than their fire-and-forget — and drop the
blind second Enter.

Ours: **B4** (start), **B3** (prompt), **B2** (interrupt).

### 2. Every remote call gets a deadline

`execFile(..., { timeout: 30_000 })` (`lib/herdr.ts:104`), raised deliberately for the slow
ones: 70 s agent start, 120 s worktree, 300 s plugin install. A `timeout` error code all its
own, so the message can say "timed out" instead of "failed."

We have **no timeout anywhere** — not in `HerdrClient`, not in `SshConnection.swift`, not in
`SshConnection.kt`. And because both poll loops re-arm in a `finally`, a command that never
settles doesn't just delay a refresh, it stops the loop permanently with no error shown. See
comparison §4.4. This is the top backlog item and it isn't close.

Ours: **B1**.

### 3. One snapshot feeds everything

`useHerdrSnapshot` (`hooks/use-herdr-snapshot.ts`) is ~15 lines: one `api snapshot`, cached,
revalidated on a timer. Dashboard, agents list, menu bar, worktrees and the start-agent form
all read the same object. No view fetches anything of its own.

We call `workspace list` *and* `api snapshot` in parallel for data one of them already
returns (`src/features/chats/useWorkspaces.ts:70`, decoder at
`src/lib/herdr/models.ts:272-283`), and the list keeps polling while a thread is open.

Ours: **B6**.

### 4. Let the user set the refresh rate

`refreshInterval` is a preference — 2/5/10/30 s, clamped to ≥ 2 s in code
(`lib/preferences.ts:9-12`), so a bad stored value can't spin. `outputLines` is clamped
20–2000 the same way. Both defaults are conservative.

Ours are constants: `STATUS_POLL_MS = 2000`, `POLL_INTERVAL_MS = 3000`. On a phone, on
cellular, the person holding it should get a say — and unlike them we're spending radio.

Ours: **B13**.

### 5. Auto-detect the binary before asking

PATH, then `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`; cached but
re-`access()`-checked; explicit preference wins and produces a *specific* error if it isn't
executable (`lib/herdr.ts:42-75`).

We ship a `herdrPath` field on every connection defaulting to `"herdr"`
(`src/state/connections.ts:32`) and a PATH prefix covering the same directories
(`src/lib/herdr/shell.ts:26-28`) — so we mostly get there. What we lack is the *diagnosis*: on
exit 127 we say "not installed, or not on PATH" (`client.ts:227-231`) without ever having
looked. One `command -v herdr; ls ~/.local/bin/herdr` turns a guess into a fact.

Ours: **B14**.

### 6. Name your agents

`agent start <name>` then target by name forever (`lib/herdr.ts:243-245`,
`getAgentTarget` falls back to `pane_id`). Names are validated client-side against
`/^[a-z][a-z0-9_-]{0,31}$/` (`start-agent-form.tsx:14`) — herdr's own constraint, checked
before the round-trip so the error is instant and specific.

For us a name is worth more than it is for them: it's a stable handle that survives pane
churn, and it's what would let a push notification say "**review** needs you" instead of
"an agent in workspace 3 needs you."

Ours: **B4**.

### 7. Diagnose *and* repair

`integration status` → install/reinstall/uninstall (`integrations.tsx`). Plugin install shows
a trust confirmation naming the risk before doing it (`plugins.tsx:47-55`) — a good pattern for
"this downloads and runs code."

We already diagnose the exact failure they'd need this for: `sessionState: 'missing'` after
~80 s of an agent reporting no session id (`useThread.ts:441-443`) *is* "the Claude integration
isn't installed on this host." We just don't offer the fix, even though we already do the
harder version of it — remote-installing herdr itself (`client.ts:73`).

Ours: **B10**.

### 8. Small things worth copying outright

- **Read errors from stderr *and* stdout** before trusting the exit code
  (`lib/herdr.ts:77-90`). Ours only decodes stdout.
- **Link the docs from the error screen** (`lib/ui.tsx:73-77`). Ours has the better action
  (one-tap remote install) and no links at all.
- **Prompt history**, 30 entries, deduped by text+target (`lib/prompt-history.ts`). Typing on
  a phone is expensive; this is worth more to us than to them.
- **Validate before the round-trip**: env vars (`parseEnvironment`), shell words
  (`parseShellWords`), names, split ratios — all rejected client-side with a message naming
  the offending token.
- **A test that asserts UI conventions**, not behaviour: `tests/raycast-ui-contracts.test.ts`
  greps the source to prove no reserved shortcut is used and no `List.EmptyView` carries
  actions. The analogue for us is a test that fails if a colour literal appears outside
  `src/theme/` — our CLAUDE.md rule that currently has no enforcement.

---

## Avoid

### 1. Don't act on an id you sampled a moment ago

The one design they reversed during review, twice flagged and fixed by a Raycast maintainer
(`8b38dc1a` "avoid stale split targets"). The shipped code is explicit
(`lib/agent-launch.ts:26-29`): when splitting, it *deliberately omits* the pane id it just read
and lets herdr resolve the focused pane at execution time.

Generalised: `read state → decide → act on the id you read` is TOCTOU whenever the state can
change in between. Prefer the id herdr itself just returned (we already do this for workspace
creation, `client.ts:156`), or let herdr resolve it.

Where we still do it: `send()` targets `primaryPane`, derived from a poll up to 2 s old
(`useThread.ts:538-539,592`). Backlog **B15**.

### 2. Don't collapse "couldn't find out" into "there are none"

Their `pgrep` returned `[]` on timeout, which read as "no client running" and launched a
duplicate. Fixed by returning `undefined` for unknown and `[]` only when `pgrep` exits 1
(`lib/process-lookup.ts:15-31`), pinned by a test.

Ours: `fileSize()` returns `-1` for both "no such file" and "the read failed"
(`transcript/store.ts:62-66`). Backlog **B16**.

### 3. Don't poll a dead thing at full rate

`useHerdrSnapshot` revalidates on a fixed interval regardless of whether the last attempt
errored (`hooks/use-herdr-snapshot.ts:10-13`). With herdr not installed that's a failing
process spawn every 2–5 s, forever, plus a red menu-bar icon. Cheap for them; for us the same
shape is a failing SSH round-trip on a metered radio. We have the same gap — neither poll
loop backs off. Backlog **B7** (which is about backgrounding, and should carry error backoff
with it). Also upstream item **U5**.

### 4. Don't reach for the terminal when the data has a structure

`PaneOutput` renders scrollback into a Markdown code fence (`components/pane-output.tsx:25`).
For 21 agent kinds that's the honest choice. For us it would be a regression — the reason
this app is usable on a phone is that it reads Claude's JSONL and renders *messages*.

The trap is the mirror image: don't let "support more agents" (**B11**) quietly turn the chat
into a terminal viewer. Non-Claude agents should degrade to a clearly-labelled screen view,
not drag Claude down to it.

### 5. Don't hardcode a source that doesn't apply to the thing you're reading

`readPane` always uses `--source recent-unwrapped` (`lib/herdr.ts:224`), including for agents
(`resource-actions.tsx:101`). Claude, Codex and friends run on the terminal's *alternate
screen*, where scrollback sources come back empty — which we learned the hard way and wrote
down (`client.ts:107-112`). By our reading, their "View Live Output" shows nothing for exactly
the agents it targets. Upstream **U1**.

---

## Defend

Things we do that they don't, that cost real effort and are easy to lose in a refactor.

| | Ours | Why it matters |
|---|---|---|
| Structured transcripts | `src/lib/transcript/` | Makes it a chat, not a terminal. The whole premise. |
| Byte-exact UTF-8 cursors | `store.ts:318-330` | One emoji and `String.length` drifts the tail. |
| Session-signature identity | `models.ts:71-78` | herdr recycles workspace ids; without it a new chat opens the old conversation. |
| Never guess a transcript file | `store.ts:55-59` | Two chats on one folder share a project dir. Wrong exactly when it looks right. |
| `--source visible` for agents | `client.ts:107-126` | See "Avoid" #5. |
| Parsed blocked prompts | `blockedPrompt.ts` | Real labels beat blind keystrokes — and keeping only the *last* menu (line 46-54) stops a stale menu being answered by accident. |
| Batched preview reads | `store.ts:237-277` | N previews, one round-trip. The right shape for a remote transport. |
| TOFU host-key pinning | `SshConnection.swift:184-211` | Plus error copy that explains MITM vs. reinstall vs. recovery. |
| Retry + path invalidation | `SshConnection.swift:88-105,224-236` | A route change (wifi↔cellular, Tailscale up/down) invalidates the socket instead of stalling on it. |
| Offline cache | `state/threadCache.ts` | Reopening is instant and works with no host. |
| Tail watchdog | `useThread.ts:496-507` | The only cover on iOS for a silently-dropped stream, since Citadel has no keepalive. |

---

## The one-line summary

They are broader and we are deeper, and the reason is the transport: their calls are free, so
they built twenty commands; ours cost a network hop, so we built a cache, a batcher, a
byte-exact tail and a watchdog.

The work worth doing is not "catch up on commands." It is: **stop reimplementing what herdr
already does** (`agent start`, `agent prompt`, `agent send-keys`), **put a deadline on every
remote call**, and **spend the round-trips we save on the two controls a phone actually needs
— stop, and a name.**
