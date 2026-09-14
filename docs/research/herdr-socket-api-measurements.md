# herdr socket API, measured on 2026-09-14

Everything here was observed against a running daemon on the Mac mini, not
read off a changelog. Two binaries were involved:

| binary | version | source |
|---|---|---|
| running server | `0.9.0-preview.2026-09-09-5a244caa60b0` | jerryfane/herdr fork, preview release |
| `~/.local/bin/herdr-stable-0.9.0` | `0.9.0` | herdrdev/herdr upstream stable |

Why this was measured: [jerryfane/herdrup](https://github.com/jerryfane/herdrup)
solves the problems HerdrChat keeps fighting (transcript guessing, submit
verification, status polling) by talking to the socket API instead of shelling
out to the CLI. The question was how much of that API upstream already has.

## What upstream stable 0.9.0 has on the socket

From `herdr-stable-0.9.0 api schema --json`. All of these are the same method
names the fork uses:

- `agent.list`, `agent.get`, `agent.read`, `agent.prompt` (with `wait`),
  `agent.start`, `agent.wait`, `agent.send_keys`
- `pane.read`, `pane.send_text`, `pane.send_keys`, `pane.wait_for_output`
- `events.subscribe` (persistent), `events.wait`
- events: `pane.agent_status_changed`, `pane.agent_detected`, `pane.exited`,
  `pane.output_matched`

## What only the fork has

- `herdr api-bridge <base64 json>`: a CLI subcommand that proxies one request to
  the socket. Upstream stable answers `unknown command: api-bridge`.
- `pane.turns`, `pane.turn_completed`
- `gram.*` (owner/agent messaging, file upload), `pane.stream`, `pane.bytes`,
  `pane.input.stream`, `accounts.*`, `agent.transfer_session`

`ping` advertises the fork-only surface in `capabilities`:
`pane_input_stream`, `gram_upload_stream`, `agent_session_transfer`. Upstream's
`ping` returns `live_handoff`, `detached_server_daemon`, `health_check` only.

## Reaching the socket without the fork

`api-bridge` is a convenience, not a requirement. The raw socket answers a
newline-terminated JSON request on stdin:

```
printf '%s\n' '{"id":"p","method":"ping","params":{}}' | nc -U ~/.config/herdr/herdr.sock
```

6 ms round trip on loopback. macOS `nc` supports `-U`. On Linux hosts it depends
on which netcat is installed (openbsd-netcat and nmap `ncat` have `-U`, busybox
does not), so the transport needs a per-host probe with a `python3 -c` fallback.

The socket is single-shot: one request per connection. `events.subscribe` is
the exception; it keeps the connection open and streams one JSON object per
line.

## Measured shapes

### `agent.prompt` with `wait`

```
{"method":"agent.prompt","params":{"target":"wAX:p1","text":"...","wait":{"until":["idle","done"],"timeout_ms":90000}}}
```

Returned after 2.49 s with `"delivery":"submitted"` and the full agent record,
including `last_completed_turn`. Sent before the agent finished launching, it
returns `{"code":"agent_not_ready","message":"agent wAX:p1 is not an active named agent"}`.
That is the typed error `client.ts` wants; the CLI path had to infer it.

### `events.subscribe`, one prompt, observed sequence

```
{"id":"e","result":{"type":"subscription_started"}}
{"event":"pane.agent_status_changed","data":{"agent_status":"working","turn":0,...}}
{"event":"pane.agent_status_changed","data":{"agent_status":"done","turn":1,...}}
{"event":"pane.turn_completed","data":{"turn":1,"outcome":"completed","completed_unix_ms":...,"pane":{...full pane record, agent_session included...}}}
{"event":"pane.agent_status_changed","data":{"agent_status":"idle","turn":1,...}}
```

Subscriptions are pane-scoped; there is no wildcard. Watching N chats means N
subscription entries on one connection, plus a re-subscribe when a pane is
created. A 12-entry subscription request was 1008 bytes of base64.

`agent.start` returns immediately with `launch_pending: true`; the
`pane.agent_detected` event and the first `agent_status_changed` (idle) arrive
a few seconds later. That is the moment a new chat becomes promptable.

### `pane.turns` (fork only)

```
{"type":"pane_turns","turns":{"pane_id":"wAX:p1","turn_epoch":1789380291269348000,
 "records":[{"turn":1,"turn_epoch":...,"outcome":"completed","completed_unix_ms":...}],
 "oldest_available":1}}
```

Records carry no message text on this build, even though the schema declares a
nullable `message`. So `pane.turns` is a completeness signal ("turn 1 finished at
T"), not a content source. The transcript file stays the content source, and
`agent_session.value` stays the file name.

### `agent.read`

`{"target":"wAX:p1","source":"visible","lines":12}` returns the screen as text
with `strip_ansi` on by default, plus `revision` and `truncated`. Same data the
live-preview bubble reads today, one round trip, no CLI parsing.

## What this changes for HerdrChat

| today | with the socket |
|---|---|
| `herdr agent prompt` via CLI, output parsed | `agent.prompt` JSON, typed error codes |
| 2 s status poll per chat, 3 s per list | one `events.subscribe` connection per server |
| "when did the turn end" inferred from status flips | `pane.turn_completed` (fork) or the `working -> done/idle` edge (upstream) |
| `agent list` CLI dump (cwd, title, session id per pane) | `agent.list` JSON, same fields, no `--help` sniffing |

Not changed: transcript reading. Neither binary hands out the turn text over the
socket, so `TranscriptStore` and the UTF-8 byte cursor stay.

The fork is not a requirement for any of the above except `pane.turns`. Keep
"works with upstream herdr" as the product stance; use `ping.capabilities` to
light up fork-only features when they are there.

## Test rig

Workspace `apptest` (`~/Developer/apptest`) was created for this and holds a
Claude agent named `apptest`. Safe to prompt from the app; nothing in it matters.
