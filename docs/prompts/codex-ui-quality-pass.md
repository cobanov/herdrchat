# Prompt: UI quality pass

Paste everything below the line into the agent. Written for Codex; any
agent with shell access to this repo and a simulator can run it.

---

You are working in `~/Developer/herdrchat`, a React Native / Expo app that
drives Claude Code agents on a remote machine from a phone. Read `CLAUDE.md`
first and follow it; it is the house style and every rule in it was earned.
Then read `docs/handoff-2026-09-14.md` for what changed today.

The transport was just rewritten (herdr socket API + event stream instead of
CLI polling) and it is verified against a real host, but nobody has looked at
the app as a product since. Your job is the product: the chat experience,
the flows, the design details, and the setup path. Do not touch
`src/lib/herdr/socket.ts`, `src/lib/herdr/events.ts` or the transport
behaviour in `client.ts` unless you find a bug there, in which case write the
failing test first.

## How to work

- Run the app in the iOS simulator against the herdr on this Mac. The simulator
  can reach it: add a server with host `127.0.0.1`, this user, and the key
  `~/.ssh/herdrchat_ed25519` (already in `authorized_keys`; do not add keys).
  Workspace `~/Developer/apptest` is scratch; create chats there freely.
- Look at every screen in light AND dark mode. A screenshot you did not open
  is not a check.
- Work in small commits, one concern each, with messages that say what changed
  and why. Run `npx tsc --noEmit`, `npx expo lint`, `npx jest` before each
  commit; all three must be clean. Do not bump the version or build number;
  do not run `scripts/testflight.sh`.
- No em dashes anywhere (text, code, comments, commits). No `any`, no magic
  numbers outside `src/theme/`, no `.value` on shared values, no setState in
  an effect body. Glass only through `src/components/Glass.tsx`.
- When you are unsure whether something is a bug or a decision, check git
  log and the comments first; most decisions are written down next to the
  code. If it is a decision you disagree with, say so in your final report
  instead of reverting it.

## What to check and fix, in order

### 1. The chat thread (`app/chat/[workspaceId].tsx`, `src/features/thread/`)

- **Opens at the bottom, every time**, like WhatsApp: cold open, reopen from
  the list, return from background, after a rotation. No visible jump from
  the top, no flash of an empty list, no scroll position lost when new
  messages arrive while the user is reading older ones (then the
  jump-to-bottom affordance must appear instead).
- **Messages arrive correctly**: send a prompt from the phone, watch the
  user echo, the working state, the streaming preview bubble, and the final
  assistant message land in order with no duplicates and no gap. Then send
  from the desktop terminal into the same session and confirm the phone
  shows it. Try a long tool-heavy turn, a one-word answer, and a Markdown
  reply with a table and a code block.
- **Readability**: bubble width, line length, font sizes at the default and
  at a larger Dynamic Type setting, timestamps, grouping of consecutive
  messages, contrast of code blocks and tables in both themes, the tool
  chips. Fix what is cramped or inconsistent; keep the design language.
- **Composer**: keyboard avoidance with and without the blocked-prompt bar,
  multi-line growth, send button state while sending, the stop button while
  working, prompt history. The composer must never cover the last message.
- **States**: empty thread, waiting for a session id, integration missing,
  host down mid-conversation, tail died and restarted, a chat whose agent
  exited. Each should say what happened and what to do, not just a spinner.

### 2. The chat list (`app/(tabs)/index.tsx`, `src/features/chats/`)

- Rows update on host events now; confirm status, preview and unread dots
  move without pull-to-refresh, and that pull-to-refresh still works.
- Swipe actions, rename, delete (destructive: confirm wording), the new-chat
  flow through the folder picker, and what an empty list says on a fresh
  install.

### 3. Connections and setup (`app/(tabs)/hosts.tsx`, `app/server/[id].tsx`, `src/features/servers/`, `src/features/settings/`)

Walk the whole first-run path as a new user would, on a fresh simulator
install:

- Add a server: host, user, key import or generation, the host-key
  fingerprint step and the "key changed" banner. Wrong password, wrong host,
  host unreachable, herdr not installed, herdr installed but not running,
  and herdr installed but not on PATH must each produce their own message
  and their own recovery action (install, start, set path). These paths
  exist in `client.ts`; make sure the UI surfaces each one and that the
  buttons do what they say.
- Test the connection from a server's page and from Settings. Confirm the
  reported herdr version appears.
- Switching between two servers; deleting the current server; what the chat
  list shows during a reconnect.
- Settings: appearance toggle applies immediately and survives restart;
  notification permission flow; diagnostics export contains nothing that
  identifies the host user (see the `explainAgent` note in `client.ts`).

### 4. Flows and bugs

- Kill the SSH connection under the app (toggle Wi-Fi off and on in the
  simulator, or stop herdr on the Mac) while a thread is open. The app must
  recover on its own within the poll interval and say what happened
  meanwhile. Check for stuck spinners, double error banners, and a thread
  that silently stops updating.
- Background the app for a minute and return: list and thread refresh once,
  not repeatedly.
- Two chats on the same folder: each shows its own transcript, never the
  other's (this was a real bug; `CLAUDE.md` explains the rule).
- Run `maestro test .maestro/` and fix any flow the changes broke. Add a
  flow for anything you fixed that a flow could have caught.

### 5. Design polish

Only after 1 to 4. Consistent spacing from `src/theme/tokens.ts`, header
and tab bar behaviour, haptics where the app already uses them, animation
durations from tokens, no layout shift on first render. If a change needs a
new token, add the token.

## What to deliver

A final report, in the repo as `docs/ui-pass-<date>.md`, with three lists:
what you fixed (commit per item), what you found and did not fix (with why
and a suggested owner), and what you looked at and found fine. Plus the
screenshots you took, in `docs/ui-pass-<date>/`, named by screen and theme.
