# herdr-ssh

SSH transport for HerdrChat, as a local Expo module.

## Why this exists

There is no usable SSH client for React Native. The one package with
TurboModule support is Android-only; the rest have not been touched since 2022.
Since the entire app is "run a command on the user's machine and follow a file
on it", the transport is not optional, so it is written here rather than
depended upon.

Both platform implementations are ports of code that already shipped in the
native apps under `legacy/`, which is where their less obvious behaviours were
learned:

- **Lazy, reused connection.** One SSH connection per host, opened on first use
  and kept. Cached clients are liveness-checked before reuse.
- **No ambiguous replay.** A connection-level failure drops the client; the
  next request reconnects. The failed command is never automatically repeated,
  because the host may have applied it before losing the reply.
- **Route-change invalidation.** iOS watches `NWPathMonitor`; when the interface
  set changes (wifi↔cellular, Tailscale up/down) the cached client is dropped so
  the next command dials on the new route rather than stalling on a dead socket.
- **TOFU host-key pinning.** The first key seen is returned to JS to persist; a
  later connection presenting a different key is refused with
  `host_key_changed`.
- **Line-framed streaming.** A `tail -f` chunk boundary lands mid-line often
  enough that splitting per chunk would corrupt transcript JSON, so only whole
  lines are emitted.

## What it deliberately does not do

**It never throws for an expected failure.** Talking to someone else's machine
fails routinely — host down, key rotated, herdr not installed — and each of
those means something different to the user. Native returns a tagged result
(`{ ok: false, code, message }`) and TypeScript owns the policy, where it can be
tested. A non-zero exit status is likewise a *result*, not an error: `exit 127`
meaning "herdr isn't installed here" is an interpretation, and interpretations
belong in `src/lib`.

It writes no secrets to disk. Credentials are passed in from `expo-secure-store`
and kept in memory for the connection lifetime. An accepted key remains pinned
across native reconnects, including before the first pin has been saved to disk.

## API

```ts
import { connect, exec, streamLines } from '../modules/herdr-ssh/src';

const result = await connect('server-1', {
  host: '100.x.y.z', port: 22, username: 'you',
  auth: { kind: 'privateKey', pem: '-----BEGIN OPENSSH PRIVATE KEY-----\n…' },
  hostKeyFingerprint: storedPin ?? null,
});
if (result.ok) await persistPin(result.fingerprint);

const output = await exec('server-1', 'herdr api snapshot', 10_000);

const controller = new AbortController();
for await (const line of streamLines('server-1', 'tail -f session.jsonl', 10_000, controller.signal)) {
  // Break to stop after a line, or controller.abort() to stop even a silent read.
}
```

### Terminal shells

A pane's terminal is a pseudo-terminal channel on the same connection. Its
bytes never cross the JavaScript bridge: output goes natively to the
`TerminalView` of `modules/herdr-terminal` through `ShellRegistry` (in
`modules/herdr-shell-registry`, a dependency-free pod both import), and what the view sends (typing, a
hardware keyboard, mouse reports) goes straight back. JavaScript opens, sizes
and closes the shell, writes the accessory bar's keys, and hears how it ended.

```ts
import { openShell, writeShellText, resizeShell, closeShell } from '../modules/herdr-ssh/src';

const opened = await openShell('server-1', {
  command: 'herdr agent attach w1:p2',   // POSIX sh; PATH etc. are the caller's (src/lib)
  cols: 80, rows: 24,                    // from the view's first onSizeChange
  startTimeoutMs: 10_000,
  onClosed: ({ reason, exitCode }) => {}, // 'exited' | 'connection_lost' | 'transport_failed'
});
if (opened.ok) {
  // <TerminalView shellId={opened.shellId} … /> shows it.
  await writeShellText(opened.shellId, '\u001b');  // the accessory bar's Esc
  await resizeShell(opened.shellId, 100, 40);      // the view also does this natively
  await closeShell(opened.shellId);                 // reports no onClosed
}
```

How it runs, and why:

- **A login shell, then `exec`.** Citadel 0.12.1 asks for a PTY only with a
  `shell` request; its exec request has no PTY form and the channel API that
  would allow one is internal. So the command is typed into the login shell
  as ` exec /bin/sh -c '<marker>; <command>'`, and `MarkerGate` drops every
  byte up to the marker's line: no MOTD, prompt or echoed command in the
  scrollback. The marker is split in the typed text, so only the shell's
  output can match it; if it never comes (an odd login shell), the output is
  shown as it is after `startTimeoutMs`. The command runs under `/bin/sh`
  whatever the login shell is.
- **Ends are reported, closes are not.** `exited` carries the status
  (`exec` makes the command's status the channel's). Citadel's own close after
  a host-side close throws `alreadyClosed` over the real status, so the status
  is taken inside the read loop. `connection_lost` is a route change or a
  `disconnect` under the shell; it is never reopened here, since reconnecting
  is the person's choice.
- **Output before the view is kept.** `ShellRegistry` holds what arrives
  before the view attaches (bounded), so a command that fails at once still
  shows why.
- **The Demo** opens on the connection id `demo` (`DEMO_CONNECTION`): an echo
  shell with no SSH, which the Demo feeds with `feed` from `herdr-terminal`.

Note there is no PATH handling here. Non-interactive SSH shells do not load the
user's profile, so every command needs a full `PATH` prefix — but that is policy,
so it lives in `src/lib/herdr/shell.ts` with the quoting.

## Native dependencies

- **iOS**: [Citadel](https://github.com/orlandos-nl/Citadel) (SwiftNIO SSH),
  pulled in through `spm_dependency` in the podspec since it ships only via SPM.
- **Android**: [sshj](https://github.com/hierynomus/sshj).

Changing anything under `ios/` or `android/` here requires a native rebuild
(`npx expo run:ios`); Fast Refresh does not reload native code.

`swift run --package-path modules/herdr-ssh NativeChecks` exercises the production
pin policy, and the terminal's launch line and marker gate, on macOS. Optional `<test-key> <test-directory>` arguments run actual SSH checks
with an isolated loopback sshd on port 22264: nonzero exit status, 20 silent
stream cancellations, a PTY shell (clean output, typing, resize, exit status,
hang-up, a lost connection), five concurrent commands sharing one connection
after a reset, a lost reply, and a changed host key. The test
starts and stops its own sshd. The directory must contain `config` (bound to
127.0.0.1:22264 with an absolute HostKey path ending in `/host_a`), a second
`host_b` key, and the test client's public key in AuthorizedKeysFile. Use only
disposable keys and a writable directory below `/tmp`; no real host is needed.

## Host key fingerprints

Both platforms report OpenSSH's form: unpadded base64 of SHA-256 over the SSH
**wire** encoding of the public key, which is the same string `ssh-keygen -lf`
prints. That matters because the pin is meant to be compared against the machine
by eye, and a fingerprint no other SSH tool prints cannot be.

Android hashed `key.getEncoded()` until August 2026. That is X.509 SPKI DER — a
different blob for the same key — so it produced a fingerprint that matched
nothing, including iOS. It now hashes `Buffer.PlainBuffer().putPublicKey(key).compactData`.

Verified: the algorithm reproduces `ssh-keygen -lf` exactly for an ed25519 key
(the `.pub` blob IS the wire encoding, so SHA-256 over its base64-decoded bytes
is the whole computation), `:app:assembleDebug` passes, and `HerdrSshModule` and
`SshConnection` are present in the APK's dex.

**Not** verified, because Android has never been run: any host pinned by an
Android build from before that change reads as a key change on the first connect
after it. That is the honest outcome — the two digests are over different bytes,
so neither is derivable from the other, and silently accepting the new one would
give away the only thing a pin is for. The key-change flow exists for exactly
this, but nobody has watched it happen. See issue #4.
