# Upstream feedback for the Herdr Raycast extension

Five drafts, ready to paste as GitHub issues on `raycast/extensions`. All line references are
to `45742065aea03ead3cc8098350607d3c1d42df35`, path `extensions/herdr/`.

Context to include once, wherever the first one goes:

> We maintain [HerdrChat](https://github.com/cobanov/herdrchat), an open-source iOS client for
> Herdr that drives it over SSH. We went through your extension while auditing our own gaps —
> it's a genuinely good piece of work and we're borrowing several ideas from it. These are
> five things we hit on our side that look like they apply here too.

Status of each: **U1**, **U4** are defects we're confident about. **U2**, **U3** are
suggestions. **U5** is a small robustness note.

---

## U1 — `View Live Output` is likely empty for the agents it targets

**Title:** Agent output reads `recent-unwrapped`, which is empty for full-screen TUI agents

Claude Code, Codex, Gemini CLI and friends run on the terminal's **alternate screen**. Nothing
they draw goes into scrollback, so `--source recent` and `--source recent-unwrapped` come back
empty for exactly those panes. Only `--source visible` captures what's on screen.

`readPane` hardcodes `recent-unwrapped`:

```ts
// src/lib/herdr.ts:223-225
export async function readPane(target: string, lines: number, agent = false): Promise<string> {
  return runHerdr([agent ? "agent" : "pane", "read", target, "--source", "recent-unwrapped", "--lines", String(lines)]);
}
```

and `AgentActions` passes `isAgent` to it (`src/components/resource-actions.tsx:97-102`), so
"View Live Output" on a live agent should show `"No terminal output yet."`
(`src/components/pane-output.tsx:19`) even while the agent is actively writing.

We hit this early and it's written into our client:

> The pane's currently VISIBLE screen — needed to read Claude's on-screen choice menus
> (permission prompts, AskUserQuestion). Claude runs on the terminal's alternate screen, so
> `recent`/`recent-unwrapped` (scrollback) come back empty; only `visible` captures the live
> menu.
> — [`src/lib/herdr/client.ts:107-112`](https://github.com/cobanov/herdrchat/blob/main/src/lib/herdr/client.ts)

**Suggested fix:** use `--source visible` when `isAgent` is true, keep `recent-unwrapped` for
plain shell panes. Note that `visible` is viewport-sized, so the `outputLines` preference
becomes a cap rather than a request for that path.

Worth checking against a running `claude` before acting — if herdr's `agent read` already
redirects to the visible screen internally, this is a non-issue and only the plain-`pane read`
path is affected.

---

## U2 — Focusing a pane costs ~4N CLI invocations; the layout response already has the geometry

**Title:** `focusPane` BFS spawns 4 `pane neighbor` processes per node

`focusPane` (`src/lib/herdr.ts:166-221`) walks the pane graph by asking herdr for each
neighbour:

```ts
const neighbors = await Promise.all(
  directions.map(async (direction) => {
    const result = await runHerdrJson<PaneNeighborResponse>([
      "pane", "neighbor", "--direction", direction, "--pane", source,
    ]);
    ...
```

Every one of those is a separate `execFile` of the `herdr` binary. For a tab with N panes the
BFS can reach **4N process spawns** before the first `pane focus` is sent — on top of the
`pane get`, `tab focus` and `pane layout` calls that precede it. On a 6-pane layout that's ~25
process launches for one "Focus Pane."

The interesting part: `pane layout` already returns everything needed to compute this locally.
Your type narrows it to pane ids —

```ts
// src/lib/herdr.ts:169-174
runHerdrJson<{ layout: { focused_pane_id: string; panes: Array<{ pane_id: string }> } }>(...)
```

— but the response also carries each pane's rectangle and the split tree. We decode both in
our own client:

```ts
// src/lib/herdr/models.ts:114-143 (ours)
export interface PaneBox { paneId: string; focused: boolean; rect: Rect }
export interface SplitInfo { id: string; direction: 'right' | 'down'; ratio: number; rect: Rect }
export interface Rect { x: number; y: number; width: number; height: number }
```

**Suggestion:** widen the `pane layout` type to include `panes[].rect`, derive adjacency from
the rectangles, and emit the direction sequence from one call instead of 4N. Same behaviour,
one round-trip, and it removes the "could not find a focus path" failure mode
(`src/lib/herdr.ts:206-208`) for layouts where the BFS is fine but slow.

---

## U3 — Blocked agents could offer real choices instead of raw keystrokes

**Title:** Parse the on-screen choice menu so blocked agents get labelled actions

When an agent is `blocked` it's usually sitting on a numbered menu — a permission prompt, or
an `AskUserQuestion`. Today the action panel offers `Send Key… → 1 / 2 / enter / esc`
(`src/components/resource-actions.tsx:126-144`), so answering means remembering, or guessing,
what option 2 was.

The menu is readable from the pane's visible screen. We parse it into a question plus labelled
options and render real buttons:

- [`src/lib/transcript/blockedPrompt.ts`](https://github.com/cobanov/herdrchat/blob/main/src/lib/transcript/blockedPrompt.ts)
  — strip ANSI and box-drawing chrome, match `❯ 2. Yes, allow all`, submit as `["2", "Enter"]`.

Two details that took us a couple of tries and are worth stealing rather than rediscovering:

1. **Keep only the last contiguous menu.** Scrollback holds old menus, and answering the
   previous question with this question's key is the kind of mistake that's invisible until
   it does something destructive. We detect the boundary by a non-increasing option number
   (`blockedPrompt.ts:46-54`).
2. **Return no options rather than guess.** If nothing parses, fall back to the generic keys
   instead of inventing choices — a wrong label is worse than no label.

This depends on U1: the menu only exists on the visible screen.

MIT on our side; copy it outright if it's useful.

---

## U4 — `parseEnvironment` splits on commas, so a value containing a comma can't be expressed

**Title:** Environment values cannot contain a comma

```ts
// src/lib/parsers.ts:3
for (const rawLine of input.split(/\r?\n|,/)) {
```

Splitting on `,` as well as newlines is clearly deliberate — `tests/parsers.test.ts:6` asserts
`"FOO=one\n# comment\nBAR=two=three, EMPTY="` yields three values. But it makes commas
unrepresentable in a value, with no escape hatch:

- `LIST=a,b,c` → `LIST=a`, then `b` and `c` each throw *"Invalid environment value 'b'. Use
  KEY=VALUE."*
- `ARGS=--foo,--bar` → same
- `NO_PROXY=localhost,127.0.0.1` → same, and that's a common real one

The failure is at least loud rather than silent, but the message points at the wrong thing —
the user wrote a valid value and is told it isn't `KEY=VALUE`.

Note that `=` inside a value is already handled correctly via `indexOf` (line 6), so the
principle is established; it's only the separator that's lossy.

**Options:** newline-only (matching the `.env` convention the placeholders already suggest —
`"ROLE=development\nPORT=3000"`, `src/components/create-workspace-form.tsx:59`); or keep comma
support and allow a quoted value; or at minimum mention the limitation in the field
description.

---

## U5 — Polling doesn't back off when Herdr is unavailable

**Title:** Snapshot polling keeps spawning processes at full rate after a failure

```ts
// src/hooks/use-herdr-snapshot.ts:10-13
useEffect(() => {
  const timer = setInterval(() => void result.revalidate(), interval);
  return () => clearInterval(timer);
}, [interval, result.revalidate]);
```

`revalidate` fires on the interval regardless of whether the previous attempt failed. If
Herdr isn't installed, or its server isn't running, that's a `herdr` process spawned and
failed every 2–5 s for as long as the view is open — and for `menu-bar`, that's as long as
Raycast is running.

Functionally harmless locally, so this is a polish note rather than a bug. It'd be more
noticeable for anything driving Herdr remotely (our case: the same shape is a failing SSH
round-trip on a metered connection).

**Suggestion:** skip or lengthen the interval while `result.error` is set — e.g. back off to
30 s after two consecutive failures, reset on the first success. Keeping the error visible
throughout matters, so that backing off never reads as recovery.

**Unrelated nit in the same area:** `src/components/pane-output.tsx:13-16` calls
`getRefreshIntervalMs()` inside the effect but lists only `[result.revalidate]` as
dependencies, so changing the Refresh Interval preference doesn't take effect there until the
view is re-pushed. `use-herdr-snapshot.ts` gets this right by including `interval` in its
deps.
