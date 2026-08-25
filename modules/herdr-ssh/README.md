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
- **Retry-once heal.** A command that fails at the connection level (network
  change, background suspension, NAT idle timeout) drops the client, reconnects
  and retries exactly once, so a stale connection heals instead of erroring
  until app restart.
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

It also holds no secrets. The private key and the host-key pin are passed in per
connect from `expo-secure-store`; nothing is cached natively.

## API

```ts
import { connect, exec, streamLines } from '../modules/herdr-ssh/src';

const result = await connect('server-1', {
  host: '100.x.y.z', port: 22, username: 'you',
  auth: { kind: 'privateKey', pem: '-----BEGIN OPENSSH PRIVATE KEY-----\n…' },
  hostKeyFingerprint: storedPin ?? null,
});
if (result.ok) persistPin(result.fingerprint);

const { stdout, exitCode } = await exec('server-1', 'herdr api snapshot');

for await (const line of streamLines('server-1', 'tail -f session.jsonl')) {
  // breaking out of the loop stops the remote command
}
```

Note there is no PATH handling here. Non-interactive SSH shells do not load the
user's profile, so every command needs a full `PATH` prefix — but that is policy,
so it lives in `src/lib/herdr/shell.ts` with the quoting.

## Native dependencies

- **iOS**: [Citadel](https://github.com/orlandos-nl/Citadel) (SwiftNIO SSH),
  pulled in through `spm_dependency` in the podspec since it ships only via SPM.
- **Android**: [sshj](https://github.com/hierynomus/sshj).

Changing anything under `ios/` or `android/` here requires a native rebuild
(`npx expo run:ios`); Fast Refresh does not reload native code.

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
